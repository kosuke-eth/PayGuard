import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('public integration package boundary (ARCH 3.1)', () => {
  it('declares no dependency on @payguard/db or @payguard/chain', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(allDeps)).not.toContain('@payguard/db');
    expect(Object.keys(allDeps)).not.toContain('@payguard/chain');
    expect(Object.keys(allDeps)).not.toContain('pg');
  });

  it('depends only on @payguard/domain at runtime', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@payguard/domain']);
  });
});
