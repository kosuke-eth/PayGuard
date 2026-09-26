/**
 * Real local Anvil integration test — spawns its own isolated Anvil instance on a dedicated
 * port so it does not collide with the contracts/core-v4 Foundry test suite's own instance.
 */
import { type SpawnedAnvil, spawnAnvil } from '@payguard/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkChainConnectivity } from '../src/clients.js';

const PORT = 8547;
const CHAIN_ID = 31338;

let anvil: SpawnedAnvil;

beforeAll(async () => {
  anvil = await spawnAnvil({ port: PORT, chainId: CHAIN_ID });
}, 20_000);

afterAll(async () => {
  await anvil.stop();
});

describe('real local Anvil connectivity', () => {
  it('connects and reports the configured chain ID', async () => {
    const result = await checkChainConnectivity({ rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID });
    expect(result.ok).toBe(true);
    expect(result.observedChainId).toBe(CHAIN_ID);
  });

  it('reports a genesis block number of 0 for a fresh instance', async () => {
    const result = await checkChainConnectivity({ rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID });
    expect(result.blockNumber).toBe(0n);
  });
});
