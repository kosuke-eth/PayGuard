# PayGuard end-to-end plan

Living tracker. Update this file as each step is proven on http://localhost:5173. Open one pull request only after every step below is done.

## What this product is

A human sets a budget and rules. An agent proposes a payment. PayGuard decides ALLOW, ESCALATE, or BLOCK on-chain. The owner panel only shows what the API and the chain report. It never decides an outcome itself.

## Current step

**Step 14 next.** Reload and a stopped relayer are proven. Check every page on a phone-width screen and on desktop with the real API.

## Local database (no Supabase)

`DATABASE_URL` stays:

`postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev`

Install PostgreSQL 17 and Foundry on this Windows PC, create the `payguard` role and the `payguard_dev` / `payguard_test` databases, then continue from step 1.

## Already done

- [x] Owner panel in `apps/web` (landing, overview, policies, approvals, activity, test payments, settings), merged to `backend/contract`
- [x] Panel calls `/v1` on the same origin; Vite proxies that to the API
- [x] API, worker, migrations `0001`–`0005`, vault, direct transfer, Uniswap v4, and Aqua code exist in this repo
- [x] SIWE in `.env` is set for `http://localhost:5173`
- [x] Owner private key stays in MetaMask, never in `.env`

## Build order

Each step is done only after a localhost check, then this box is checked.

1. [x] **Database is reachable.** Local Postgres 17 on `127.0.0.1:5432`. Migrations `0001`–`0005` applied.
2. [x] **Chain is up.** Foundry 1.5.1, Anvil on `http://127.0.0.1:8545` (chain 31337, Cancun).
3. [x] **Demo deployment exists.** `PAYGUARD_DEPLOYMENT_ID=59e7ce6f-278d-4e97-af38-9535cc2478c1` (direct, Uniswap v4, and Aqua vaults).
4. [x] **Real API replaces the mock.** API + worker running. `/health/ready` is READY. `/v1/config` serves this deployment.
5. [x] **Owner sign-in.** MetaMask Anvil #0 `0xf39F…2266` signed SIWE and opened Overview.
6. [x] **Overview is live.** Remaining 300.00 mUSDC, Allow 100, Escalate 200, Block above 200.
7. [x] **Direct ALLOW.** Demo Compute 0.50 mUSDC ALLOW, tx `0x696fe62e…8773` in block 38, merchant paid, vault spent 0.50.
8. [x] **BLOCK.** Over Hard Budget 500 mUSDC BLOCK (over total budget). No settlement, no transaction, funds moved 0.
9. [x] **ESCALATE.** Demo Hotel 180 mUSDC waited, owner signed ExceptionApproval, tx `0x361f9465…b8370` in block 39, 180 mUSDC delivered, 180 mUSDC taken from the vault.
10. [x] **Uniswap v4.** Demo Compute 0.50 mUSDC ALLOW via Uniswap v4, tx `0x757def38…008ed5d5` in block 40, 0.50 mUSDC delivered, 0.000000000000501050 mRWA taken from the vault.
11. [x] **Aqua / SwapVM.** Demo Compute 0.50 AQOUT ALLOW via Aqua / SwapVM, tx `0x5d09f2b1…` in block 41, 0.50 AQOUT delivered, ~0.50000025 AQIN taken from the vault.
12. [x] **Owner controls.** Pause block 42, resume block 43, withdraw 1 mUSDC block 44, deposit blocks 45–46, replace policy auto 90 (block 47), revoke `0x544ad10c…8d55f0d8` block 48 (Policies shows REVOKED).
13. [x] **Reload and failure.** With the relayer stopped, Demo Compute stayed queued (intent `688fb4c4…`, funds moved 0, sidebar **Service degraded**). After the relayer restarted, that same intent settled via Uniswap v4, tx `0xb4318b14…d95c228b` in block 50, 0.50 mUSDC delivered. Sidebar returned to **All systems operational**.
14. [ ] **Phone and desktop pass** on every page with the real API. No sideways scroll, no mock data left in the product path.
15. [ ] **One pull request** onto `backend/contract` after steps 1–14 are checked.

## Do not do

- Do not put `OWNER_PRIVATE_KEY`, the owner mnemonic, the anon key, or the service-role key in any env file.
- Do not point `DATABASE_TEST_URL` at Supabase.
- Do not open the pull request early.
