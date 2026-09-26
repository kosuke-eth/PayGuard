/**
 * Spawns a real local Anvil instance for a test run and waits for its RPC to answer. No
 * `--state` persistence flag is passed, so every spawn starts from a fresh genesis (SPEC-009's
 * tested reset strategy: a fresh instance, not a reused one).
 */
import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export interface SpawnedAnvil {
  process: ChildProcessByStdio<null, Readable, Readable>;
  rpcUrl: string;
  chainId: number;
  stop: () => Promise<void>;
}

function resolveAnvilBinary(): string {
  const candidate = join(homedir(), '.foundry', 'bin', 'anvil');
  if (existsSync(candidate)) return candidate;
  return 'anvil'; // fall back to PATH resolution
}

async function waitForRpc(rpcUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil RPC did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

export async function spawnAnvil(options: {
  port: number;
  chainId: number;
  hardfork?: string;
}): Promise<SpawnedAnvil> {
  const rpcUrl = `http://127.0.0.1:${options.port}`;
  const child = spawn(
    resolveAnvilBinary(),
    [
      '--port',
      String(options.port),
      '--chain-id',
      String(options.chainId),
      '--hardfork',
      options.hardfork ?? 'cancun',
      '--silent',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderrBuffer = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  const exitedEarly = new Promise<never>((_resolve, reject) => {
    child.once('exit', (code) => {
      reject(new Error(`anvil exited early with code ${code}: ${stderrBuffer}`));
    });
  });

  await Promise.race([waitForRpc(rpcUrl, 10_000), exitedEarly]).catch((error) => {
    child.kill('SIGKILL');
    throw error;
  });

  // waitForRpc only proves *something* answers on this port -- if another process (e.g. a
  // stale anvil left over from a prior run) already held it, our own spawn would have died
  // with EADDRINUSE while that foreign process kept answering RPC calls, winning the race
  // above. Guard against silently running tests against the wrong chain instance.
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(
      `port ${options.port} is already held by another process (our anvil spawn exited: code=${child.exitCode} signal=${child.signalCode}): ${stderrBuffer}`,
    );
  }

  return {
    process: child,
    rpcUrl,
    chainId: options.chainId,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
