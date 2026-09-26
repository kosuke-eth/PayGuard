// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPayGuardSettlementAdapter} from "../../src/interfaces/IPayGuardSettlementAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * Test-only settlement adapter (Stage 2 scope: prove the adapter boundary against a controllable
 * fixture, not a real conversion protocol — that is Stage 6/Aqua). Behavior for each settle() call
 * is set in advance by the test via configure(); this lets the same fixture drive both the
 * happy-path adapter route and every settlement-invariant violation the vault must catch
 * (over-pull, under-deliver, over-deliver, wrong recipient never touched by the adapter at all
 * since the vault forwards output itself).
 */
contract TestSettlementAdapter is IPayGuardSettlementAdapter {
    using SafeERC20 for IERC20;

    uint256 public inputToPull;
    uint256 public outputToDeliver;
    uint256 public reportedInput;
    uint256 public reportedOutput;
    bool public revertOnSettle;

    /// @param _inputToPull Amount actually pulled from the caller (the vault) via transferFrom --
    /// set above request.maxInput to trigger MAX_INPUT_LIMIT-adjacent SettlementInvariant reverts.
    /// @param _outputToDeliver Amount actually sent back to the caller -- set != request.exactOutput
    /// to trigger the output-delta SettlementInvariant check. Also resets the reported (returned)
    /// values to match the actual transfer, i.e. an honest adapter by default.
    function configure(uint256 _inputToPull, uint256 _outputToDeliver) external {
        inputToPull = _inputToPull;
        outputToDeliver = _outputToDeliver;
        reportedInput = _inputToPull;
        reportedOutput = _outputToDeliver;
        revertOnSettle = false;
    }

    /// Makes settle()'s RETURN VALUES diverge from the tokens actually moved, without changing
    /// the real transfers set by configure(). The vault must ignore these entirely and derive
    /// actualInput/outputDelivered solely from its own measured balance deltas (CLAUDE.md: "An
    /// adapter's return values ... cannot prove settlement").
    function configureFabricatedReturn(uint256 _reportedInput, uint256 _reportedOutput) external {
        reportedInput = _reportedInput;
        reportedOutput = _reportedOutput;
    }

    function configureRevert() external {
        revertOnSettle = true;
    }

    function settle(SettlementRequest calldata request)
        external
        returns (uint256 actualInput, uint256 outputDelivered, uint256 subsidyAmount)
    {
        if (revertOnSettle) revert("TestSettlementAdapter: configured to revert");

        if (inputToPull > 0) {
            IERC20(request.inputToken).safeTransferFrom(msg.sender, address(this), inputToPull);
        }
        if (outputToDeliver > 0) {
            IERC20(request.outputToken).safeTransfer(msg.sender, outputToDeliver);
        }

        return (reportedInput, reportedOutput, 0);
    }
}
