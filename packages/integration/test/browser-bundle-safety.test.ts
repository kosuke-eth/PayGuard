/**
 * B1 (item 5, INT-011): proves -- with a REAL browser-targeted bundle, not a package.json
 * declaration check alone (`boundary.test.ts` already covers that) -- that nothing reachable from
 * this package's public entrypoint pulls in a server-only module. `esbuild` with
 * `platform: 'browser'` cannot resolve Node built-ins/`pg` unless they are explicitly marked
 * external; if any reachable file imported one, this build would fail to resolve it, not silently
 * substitute a shim. A second, independent substring scan over the bundled output is defense in
 * depth against an import that somehow resolved anyway (e.g. via a re-exported alias).
 *
 * This is a minimal build check, not a new frontend app -- no bundler config beyond the options
 * below, and actual execution in a real browser remains explicitly PENDING F1 (per B1's scope: a
 * CLI/Node-context bundling proof is not itself a claim of browser runtime compatibility).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BANNED_IMPORT_SUBSTRINGS = [
  '"pg"',
  "'pg'",
  'require("fs")',
  "require('fs')",
  'node:fs',
  'node:net',
  'node:tls',
  'node:dns',
  'node:child_process',
  'node:cluster',
  'node:dgram',
];

describe('B1 (INT-011): @payguard/integration bundles cleanly for a browser target', () => {
  it('esbuild resolves the whole public entrypoint graph with platform:"browser" and no polyfills, and the output never references pg/fs/node built-ins', async () => {
    const result = await build({
      entryPoints: [resolve(__dirname, '../src/index.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      target: 'es2020',
      // Deliberately NOT externalizing anything -- if a reachable file imported `pg`, `fs`, or any
      // other Node built-in, esbuild would fail to resolve it right here rather than this test
      // passing on a false premise.
      logLevel: 'silent',
    });

    expect(result.errors).toEqual([]);
    const output = result.outputFiles?.[0]?.text ?? '';
    expect(output.length).toBeGreaterThan(0);

    for (const needle of BANNED_IMPORT_SUBSTRINGS) {
      expect(output).not.toContain(needle);
    }
  });

  it('fails loudly (not silently) if a server-only import is actually reachable -- meta-test proving the check above is real', async () => {
    // A synthetic entrypoint one directory up, importing a real Node builtin, to prove the
    // resolve-failure path above is not just an artifact of empty errors always passing.
    await expect(
      build({
        stdin: {
          contents: "import { readFileSync } from 'node:fs'; readFileSync('/dev/null');",
          resolveDir: __dirname,
          loader: 'ts',
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
      }),
    ).rejects.toThrow();
  });
});
