import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATED_ABI_PATH, renderAbiModule } from '../scripts/generate-abi.js';

describe('generated ABI drift (public integration package)', () => {
  it('src/generated/abi.ts matches a fresh render of the compiled Foundry artifact', () => {
    const committed = readFileSync(GENERATED_ABI_PATH, 'utf8');
    const fresh = renderAbiModule();
    expect(committed).toBe(fresh);
  });
});
