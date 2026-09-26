#!/usr/bin/env node
// B4 artifact-equivalence check (per IMPLEMENT item 1: "Document where the adapter itself
// compiles and why the cross-contract ABI matches"). Compares the compiled ABI of the ABI-only
// shim in contracts/aqua/src/interfaces/IPayGuardSettlementAdapterShim.sol (built under this
// project's own solc 0.8.30) against the REAL interface's compiled ABI in contracts/core-v4/out
// (built under the exact-pinned solc 0.8.26) -- both read from each project's own `forge build`
// output, never a shared import. Fails loudly (non-zero exit) on ANY structural difference in the
// function/struct/enum shape the adapter actually relies on.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

function loadAbi(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return json.abi;
}

function findByName(abi, type, name) {
  const found = abi.find((entry) => entry.type === type && entry.name === name);
  if (!found) throw new Error(`${type} '${name}' not found in ABI at ${JSON.stringify(abi.map((e) => e.name))}`);
  return found;
}

// Structural comparison of ABI fragments: ignores ordering-irrelevant metadata (like top-level
// object key order), but is otherwise exact -- same types, same components, same order of
// parameters/fields, since ABI encoding is positional.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'name' || key === 'internalType') continue; // cosmetic only, not encoding-relevant
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

function assertEqual(label, a, b) {
  const na = JSON.stringify(normalize(a));
  const nb = JSON.stringify(normalize(b));
  if (na !== nb) {
    console.error(`MISMATCH: ${label}`);
    console.error(`  real (core-v4, solc 0.8.26): ${na}`);
    console.error(`  shim (aqua, solc 0.8.30):    ${nb}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`OK: ${label}`);
  return true;
}

// ABI JSON encodes an enum field only as its underlying `uintN` type -- it carries no record of
// member NAMES or declaration order (Solidity itself erases that distinction at the ABI level).
// A pure ABI diff would therefore report "OK" even if SubsidyMode's members were reordered on one
// side, silently reinterpreting e.g. REQUIRED(1) as BEST_EFFORT(2) across the pragma boundary --
// a real finding from this gate's own security review. Guard against it explicitly by parsing the
// enum's member order straight out of each side's SOURCE TEXT (not the compiled artifact) and
// asserting the ordered name lists are identical.
function extractEnumMembers(sourcePath, enumName) {
  const source = readFileSync(sourcePath, 'utf8');
  const match = source.match(new RegExp(`enum\\s+${enumName}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`enum '${enumName}' not found in ${sourcePath}`);
  return match[1].split(',').map((m) => m.trim()).filter(Boolean);
}

function assertEnumOrderEqual(label, realPath, shimPath, enumName) {
  const realMembers = extractEnumMembers(realPath, enumName);
  const shimMembers = extractEnumMembers(shimPath, enumName);
  const real = JSON.stringify(realMembers);
  const shim = JSON.stringify(shimMembers);
  if (real !== shim) {
    console.error(`MISMATCH: ${label}`);
    console.error(`  real (core-v4, solc 0.8.26) member order: ${real}`);
    console.error(`  shim (aqua, solc 0.8.30) member order:    ${shim}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`OK: ${label} (member order: ${real})`);
  return true;
}

let enumOk = assertEnumOrderEqual(
  'IPayGuardVault.SubsidyMode member order vs shim.SubsidyMode member order',
  join(repoRoot, 'contracts/core-v4/src/interfaces/IPayGuardVault.sol'),
  join(repoRoot, 'contracts/aqua/src/interfaces/IPayGuardSettlementAdapterShim.sol'),
  'SubsidyMode',
);

const realAdapterAbi = loadAbi(join(repoRoot, 'contracts/core-v4/out/IPayGuardSettlementAdapter.sol/IPayGuardSettlementAdapter.json'));
const realVaultAbi = loadAbi(join(repoRoot, 'contracts/core-v4/out/IPayGuardVault.sol/IPayGuardVault.json'));
const shimAdapterAbi = loadAbi(join(repoRoot, 'contracts/aqua/out/IPayGuardSettlementAdapterShim.sol/IPayGuardSettlementAdapterShim.json'));
const shimVaultCtxAbi = loadAbi(join(repoRoot, 'contracts/aqua/out/IPayGuardSettlementAdapterShim.sol/IPayGuardVaultContextShim.json'));
const testShimVaultAbi = loadAbi(join(repoRoot, 'contracts/aqua/out/IPayGuardVaultTestShim.sol/IPayGuardVaultTestShim.json'));

let ok = true;

// Test-orchestration shim (contracts/aqua/test/interfaces/IPayGuardVaultTestShim.sol): every
// vault function the B4 test suite actually calls cross-project via deployCode.
for (const fn of ['deposit', 'createPolicy', 'hashInvoice', 'hashIntent', 'hashApproval', 'evaluate', 'executePayment', 'getPolicyState', 'getExecutionContext']) {
  ok = assertEqual(
    `IPayGuardVault.${fn}(...) vs test-shim.${fn}(...)`,
    findByName(realVaultAbi, 'function', fn),
    findByName(testShimVaultAbi, 'function', fn),
  ) && ok;
}

// settle(SettlementRequest) -> (uint256,uint256,uint256)
ok = assertEqual(
  'IPayGuardSettlementAdapter.settle(...) vs shim.settle(...)',
  findByName(realAdapterAbi, 'function', 'settle'),
  findByName(shimAdapterAbi, 'function', 'settle'),
) && ok;

// getExecutionContext() -> ExecutionContext
ok = assertEqual(
  'IPayGuardVault.getExecutionContext() vs shim.getExecutionContext()',
  findByName(realVaultAbi, 'function', 'getExecutionContext'),
  findByName(shimVaultCtxAbi, 'function', 'getExecutionContext'),
) && ok;

if (!ok) {
  console.error('\nB4 artifact-equivalence check FAILED -- the shim does not match the real interface.');
  process.exit(1);
}

console.log('\nB4 artifact-equivalence check PASSED: the ABI-only shim is byte-structurally identical');
console.log('to the real IPayGuardSettlementAdapter.settle / IPayGuardVault.getExecutionContext ABI');
console.log('(SettlementRequest struct, SubsidyMode enum, ExecutionContext struct all included via');
console.log('the compared function signatures\' components), despite being compiled under a');
console.log('different solc version (0.8.30 vs 0.8.26) in a fully separate project.');
