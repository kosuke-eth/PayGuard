/**
 * Liveness and readiness.
 *
 * Stage 5 wires the two checks Stage 4 deliberately left hardcoded `ok: false`: `worker` now reads
 * the freshest `worker_heartbeat` row for this deployment (recovery-table row 14) and fails if it is
 * missing or older than `config.workerHeartbeatStalenessSeconds`; `relayerBalance` queries the
 * relayer's real on-chain native balance via `context.config.relayerAddress` (a PUBLIC address --
 * the API process never holds the relayer's private key, only where it can check gas funding) and
 * fails on zero balance, since a relayer with no gas cannot broadcast anything.
 *
 * B1 (INT-006) adds `vaultCode`: a matching `chainId` or nonempty `getCode` alone does not prove the
 * address we believe is a PayGuardVault still IS one -- an address can be redeployed/self-destructed/
 * reused across a chain reset. Each registered `vaults` row was stamped with `runtime_code_hash` at
 * provisioning time (the actual `keccak256(getCode(vaultAddress))` observed then); this check
 * re-observes the SAME live code now and refuses readiness on any drift, rather than trusting the
 * stored row forever. `abiSchemaVersion` catches the same class of problem for the binding version we
 * compiled against, not just the deployed bytes.
 */

import { getDeploymentById, getFreshestHeartbeat, getVaultsByDeployment } from '@payguard/db';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import type { AppContext } from '../context.js';
import { successEnvelope } from '../errors.js';
import { EXPECTED_ABI_SCHEMA_VERSION } from './config.js';

interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/health/live', async (request, reply) => {
    return reply.status(200).send(successEnvelope({ status: 'LIVE' }, String(request.id)));
  });

  app.get('/health/ready', async (request, reply) => {
    const checks: ReadinessCheck[] = [];

    // SQL access. This route is PUBLIC (no session required), so the detail string must never
    // carry the raw driver error -- pg's own messages routinely include hostnames, ports and the
    // connecting role name. The real error is logged server-side only.
    try {
      await context.pool.query('SELECT 1');
      checks.push({ name: 'database', ok: true, detail: 'reachable' });
    } catch (error) {
      request.log.error({ err: error }, 'health check: database unreachable');
      checks.push({ name: 'database', ok: false, detail: 'unreachable' });
    }

    // Expected deployment identity (SPEC-018: exactly one active deployment).
    let deploymentChainId: bigint | null = null;
    try {
      const deployment = await getDeploymentById(context.pool, context.config.deploymentId);
      if (!deployment) {
        checks.push({
          name: 'deployment',
          ok: false,
          detail: `configured deployment ${context.config.deploymentId} does not exist`,
        });
      } else {
        deploymentChainId = deployment.chainId;
        checks.push({
          name: 'deployment',
          ok: true,
          detail: `${deployment.instanceLabel} (${deployment.environment})`,
        });
      }
    } catch (error) {
      request.log.error({ err: error }, 'health check: deployment lookup failed');
      checks.push({ name: 'deployment', ok: false, detail: 'lookup failed' });
    }

    // Expected chain id: a mismatched chain must refuse payment preparation, never silently
    // select a different network.
    if (context.publicClient) {
      try {
        const observed = await context.publicClient.getChainId();
        const expected = deploymentChainId ?? context.config.chainId;
        checks.push({
          name: 'chain',
          ok: BigInt(observed) === expected,
          detail: `observed=${observed} expected=${expected}`,
        });
      } catch (error) {
        checks.push({
          name: 'chain',
          ok: false,
          detail: error instanceof Error ? error.message : 'rpc unreachable',
        });
      }
    } else {
      checks.push({ name: 'chain', ok: false, detail: 'no chain client configured' });
    }

    // The worker: at least one process has reported a heartbeat for this deployment within the
    // configured staleness bound. A stale or missing row means queued submissions and chain
    // observations will not progress even though the API itself is otherwise healthy.
    try {
      const heartbeat = await getFreshestHeartbeat(context.pool, {
        deploymentId: context.config.deploymentId,
      });
      if (!heartbeat) {
        checks.push({ name: 'worker', ok: false, detail: 'no worker has ever reported in' });
      } else {
        const ageSeconds = (Date.now() - heartbeat.lastSeenAt.getTime()) / 1000;
        const fresh = ageSeconds <= context.config.workerHeartbeatStalenessSeconds;
        checks.push({
          name: 'worker',
          ok: fresh,
          detail: fresh
            ? `last heartbeat ${Math.round(ageSeconds)}s ago`
            : `last heartbeat ${Math.round(ageSeconds)}s ago exceeds ${context.config.workerHeartbeatStalenessSeconds}s staleness bound`,
        });
      }
    } catch (error) {
      request.log.error({ err: error }, 'health check: worker heartbeat lookup failed');
      checks.push({ name: 'worker', ok: false, detail: 'lookup failed' });
    }

    // Relayer funding: the API process never holds the relayer's private key (only its PUBLIC
    // address, used solely as the `from` of eth_call simulations), but a zero-balance relayer
    // genuinely cannot broadcast anything, so this is real evidence, not a placeholder.
    if (context.config.relayerAddress && context.publicClient) {
      try {
        const balance = await context.publicClient.getBalance({
          address: context.config.relayerAddress as `0x${string}`,
        });
        checks.push({
          name: 'relayerBalance',
          ok: balance > 0n,
          detail:
            balance > 0n ? `balanceWei=${balance.toString(10)}` : 'relayer has zero native balance',
        });
      } catch (error) {
        checks.push({
          name: 'relayerBalance',
          ok: false,
          detail: error instanceof Error ? error.message : 'rpc unreachable',
        });
      }
    } else {
      checks.push({
        name: 'relayerBalance',
        ok: false,
        detail: 'no relayer address configured',
      });
    }

    // Vault runtime-code and ABI-binding identity: a chain ID match or nonempty `getCode` alone is
    // not proof the configured vault address is still our vault. Every registered vault must show
    // live code matching what was observed at provisioning, and a schema version we actually
    // compiled bindings for -- a mismatch on either fails readiness closed, not open.
    if (context.publicClient) {
      try {
        const vaults = await getVaultsByDeployment(context.pool, context.config.deploymentId);
        if (vaults.length === 0) {
          checks.push({
            name: 'vaultCode',
            ok: true,
            detail: 'no vaults registered for this deployment yet',
          });
        } else {
          const mismatches: string[] = [];
          for (const vault of vaults) {
            const addressHex = `0x${vault.address.toString('hex')}` as `0x${string}`;
            let observedCodeHash: string;
            try {
              const code = await context.publicClient.getCode({ address: addressHex });
              if (!code || code === '0x') {
                mismatches.push(`${vault.id}: no code at ${addressHex} (EOA or self-destructed)`);
                continue;
              }
              observedCodeHash = keccak256(code);
            } catch (error) {
              mismatches.push(
                `${vault.id}: getCode failed (${error instanceof Error ? error.message : 'rpc error'})`,
              );
              continue;
            }
            const expectedCodeHash = `0x${vault.runtimeCodeHash.toString('hex')}`;
            if (observedCodeHash.toLowerCase() !== expectedCodeHash.toLowerCase()) {
              mismatches.push(
                `${vault.id}: runtime code changed since provisioning (expected ${expectedCodeHash}, observed ${observedCodeHash})`,
              );
            }
            if (vault.abiSchemaVersion !== EXPECTED_ABI_SCHEMA_VERSION) {
              mismatches.push(
                `${vault.id}: registered abiSchemaVersion=${vault.abiSchemaVersion}, this build expects ${EXPECTED_ABI_SCHEMA_VERSION}`,
              );
            }
          }
          checks.push({
            name: 'vaultCode',
            ok: mismatches.length === 0,
            detail:
              mismatches.length === 0
                ? `${vaults.length} vault(s) verified against live code + abiSchemaVersion=${EXPECTED_ABI_SCHEMA_VERSION}`
                : mismatches.join('; '),
          });
        }
      } catch (error) {
        request.log.error({ err: error }, 'health check: vault code verification failed');
        checks.push({ name: 'vaultCode', ok: false, detail: 'vault lookup or getCode failed' });
      }
    } else {
      checks.push({ name: 'vaultCode', ok: false, detail: 'no chain client configured' });
    }

    const ready = checks.every((check) => check.ok);
    const body = {
      status: ready ? 'READY' : 'NOT_READY',
      readyForPaymentExecution: ready,
      checks,
    };
    return reply.status(ready ? 200 : 503).send(successEnvelope(body, String(request.id)));
  });
}
