// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPayGuardVault} from "./IPayGuardVault.sol";

/**
 * Compiled mirror of reference/CONTRACT_INTERFACE.sol's IPayGuardSettlementAdapter, verbatim.
 */
interface IPayGuardSettlementAdapter {
    struct SettlementRequest {
        bytes32 intentHash;
        bytes32 routeId;
        address inputToken;
        address outputToken;
        address merchant;
        uint256 exactOutput;
        uint256 maxInput;
        uint48 validUntil;
        IPayGuardVault.SubsidyMode subsidyMode;
        uint256 maxSubsidyAmount;
    }
    // Caller is the vault. Outputs/refunds return to that same caller.
    // The vault independently verifies observed token deltas.
    function settle(SettlementRequest calldata request)
        external returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount);
}
