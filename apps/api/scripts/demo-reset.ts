/**
 * B2 demo bridge: EXPLICIT destructive reset (docs/PAYGUARD_INTEGRATION_BOUNDARY.md section 5,
 * docs/implementation/checkpoints/B2.md).
 *
 * A real reset means deploying a GENUINELY NEW vault (a new `verifyingContract` address, which is
 * the only thing that actually invalidates old EIP-712 signatures -- see
 * `packages/domain/test/eip712-vectors.test.ts`'s "deployment-record identity never participates
 * in the domain" tests). It never wipes DB rows against the existing address, and never touches
 * an existing deployment/vault/payment row -- those stay exactly as they are, simply no longer
 * selected by the NEW `PAYGUARD_DEPLOYMENT_ID` the operator switches to afterwards.
 *
 * This is a deliberate, explicit, operator-invoked action -- never reachable from any HTTP
 * endpoint, anonymous or otherwise. It refuses to run without an explicit confirmation, exactly
 * so a stray `pnpm exec tsx` (or a copy-pasted `payguard demo:reset` without reading it) cannot
 * accidentally provision a second demo deployment.
 *
 * Run: `PAYGUARD_DEMO_RESET_CONFIRM=yes pnpm --filter @payguard/api exec tsx scripts/demo-reset.ts`
 * (or `./scripts/payguard demo:reset`).
 */
import { createPool, getDeploymentById } from '@payguard/db';
import {
  CHAIN_ID,
  DATABASE_URL,
  printDemoEnvBlock,
  provisionFreshDemoDeployment,
  RPC_URL,
} from './demo-setup.js';

async function main() {
  if (process.env.PAYGUARD_DEMO_RESET_CONFIRM !== 'yes') {
    console.error(
      'demo-reset: refusing to run without explicit confirmation.\n' +
        'This deploys a BRAND NEW vault and provisions a NEW demo deployment -- old signatures\n' +
        'against the previous vault stop validating, and every process using the old\n' +
        'PAYGUARD_DEPLOYMENT_ID must be repointed at the new one it prints.\n' +
        'Existing deployment/vault/payment rows are left untouched (nothing is deleted).\n\n' +
        'Re-run with PAYGUARD_DEMO_RESET_CONFIRM=yes to proceed.',
    );
    process.exitCode = 1;
    return;
  }

  const instanceLabel = `payguard-local-demo-reset-${Date.now()}`;
  const pool = createPool({ connectionString: DATABASE_URL });
  try {
    console.log(
      `Provisioning a fresh demo deployment '${instanceLabel}' (chain ${CHAIN_ID} at ${RPC_URL})...`,
    );
    const provisioned = await provisionFreshDemoDeployment(pool, instanceLabel);
    const deployment = await getDeploymentById(pool, provisioned.deploymentId);
    if (!deployment)
      throw new Error('demo-reset: provisioned deployment vanished immediately after creation');

    console.log('');
    console.log(
      `Reset complete: new demo deployment '${instanceLabel}' (${provisioned.deploymentId}).`,
    );
    console.log(
      `New vault address: ${provisioned.vaultAddress} -- signatures against the previous vault no longer validate.`,
    );
    printDemoEnvBlock(provisioned.deploymentId, provisioned);
    console.log('');
    console.log(
      'Restart the API and worker with the new PAYGUARD_DEPLOYMENT_ID above. The previous deployment' +
        ' row (and its payments) still exist in Postgres -- this never deleted anything -- they are' +
        ' simply no longer the active deployment.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
