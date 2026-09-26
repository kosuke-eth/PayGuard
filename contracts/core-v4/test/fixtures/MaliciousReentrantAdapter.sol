// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPayGuardSettlementAdapter} from "../../src/interfaces/IPayGuardSettlementAdapter.sol";

/**
 * Adversarial adapter fixture: while the vault is inside executePayment (nonReentrant-guarded),
 * this adapter's settle() callback attempts to re-enter the vault with an arbitrary pre-armed
 * call. The vault must reject that inner call — proving OZ's ReentrancyGuard actually blocks
 * cross-function reentry through the untrusted adapter boundary, not just same-function reentry.
 *
 * Design: settle() always reverts with MaliciousAdapterAborted() at the end, but the specific
 * revert selector observed by the test tells them what happened inside:
 *   - ReentrancyNotBlocked(): the inner reentrant call SUCCEEDED — a real vulnerability.
 *   - MaliciousAdapterAborted(): the inner call failed (as expected) and this adapter then
 *     intentionally aborts its own settlement — the outer executePayment reverts too, and the
 *     whole payment is atomic (no partial state change), matching the "revert the whole payment
 *     on failed postconditions" invariant.
 */
contract MaliciousReentrantAdapter is IPayGuardSettlementAdapter {
    error ReentrancyNotBlocked();
    error MaliciousAdapterAborted();

    address public immutable vault;
    bytes private reentryCall;
    bool private armed;

    constructor(address _vault) {
        vault = _vault;
    }

    function arm(bytes calldata data) external {
        reentryCall = data;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function settle(SettlementRequest calldata)
        external
        returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount)
    {
        if (armed) {
            (bool ok,) = vault.call(reentryCall);
            if (ok) revert ReentrancyNotBlocked();
        }
        revert MaliciousAdapterAborted();
    }
}
