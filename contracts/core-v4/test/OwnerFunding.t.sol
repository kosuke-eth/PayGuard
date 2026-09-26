// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PayGuardTestBase} from "./helpers/PayGuardTestBase.sol";
import {IPayGuardVault} from "../src/interfaces/IPayGuardVault.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

contract OwnerFundingTest is PayGuardTestBase {
    function setUp() public {
        _baseSetUp();
    }

    function test_deposit_supportedToken_movesFunds() public {
        tokenA.mint(owner, 100e18);
        vm.startPrank(owner);
        tokenA.approve(address(vault), 100e18);
        vault.deposit(address(tokenA), 100e18);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(vault)), 100e18);
    }

    function test_deposit_anyDepositor_notOwnerOnly() public {
        // deposit() is intentionally callable by anyone funding the vault, not owner-gated.
        tokenA.mint(other, 50e18);
        vm.startPrank(other);
        tokenA.approve(address(vault), 50e18);
        vault.deposit(address(tokenA), 50e18);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(vault)), 50e18);
    }

    function test_deposit_unsupportedToken_reverts() public {
        MockERC20 rogue = new MockERC20("Rogue", "RGE", 18);
        rogue.mint(owner, 10e18);
        vm.startPrank(owner);
        rogue.approve(address(vault), 10e18);
        vm.expectRevert(); // InvalidToken()
        vault.deposit(address(rogue), 10e18);
        vm.stopPrank();
    }

    function test_withdraw_byOwner_movesFundsToRecipient() public {
        tokenA.mint(address(vault), 100e18);
        vm.prank(owner);
        vault.withdraw(address(tokenA), 40e18, other);
        assertEq(tokenA.balanceOf(other), 40e18);
        assertEq(tokenA.balanceOf(address(vault)), 60e18);
    }

    function test_withdraw_byNonOwner_reverts() public {
        tokenA.mint(address(vault), 100e18);
        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.withdraw(address(tokenA), 10e18, other);
    }

    function test_withdraw_toZeroAddress_reverts() public {
        tokenA.mint(address(vault), 100e18);
        vm.prank(owner);
        vm.expectRevert(); // InvalidRecipient()
        vault.withdraw(address(tokenA), 10e18, address(0));
    }

    function test_createPolicy_byNonOwner_reverts() public {
        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
    }

    function test_revokePolicy_byNonOwner_reverts() public {
        vm.prank(owner);
        bytes32 policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());

        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.revokePolicy(policyId);
    }

    function test_revokeAgent_byNonOwner_reverts() public {
        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.revokeAgent(agent);
    }

    function test_setExecutionPaused_byNonOwner_reverts() public {
        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.setExecutionPaused(true);
    }

    function test_cancelApprovalNonce_byNonOwner_reverts() public {
        vm.prank(other);
        vm.expectRevert(IPayGuardVault.Unauthorized.selector);
        vault.cancelApprovalNonce(1);
    }

    // Execution pause must not block owner withdrawal, policy/agent revocation, or approval-nonce
    // cancellation (CLAUDE.md invariant; Prompt 2 §1).
    function test_pause_doesNotBlockWithdraw() public {
        tokenA.mint(address(vault), 10e18);
        vm.startPrank(owner);
        vault.setExecutionPaused(true);
        vault.withdraw(address(tokenA), 5e18, other);
        vm.stopPrank();
        assertEq(tokenA.balanceOf(other), 5e18);
    }

    function test_pause_doesNotBlockPolicyRevocation() public {
        vm.startPrank(owner);
        bytes32 policyId = vault.createPolicy(_defaultDirectPolicy(), _defaultMerchants());
        vault.setExecutionPaused(true);
        vault.revokePolicy(policyId);
        vm.stopPrank();
        assertTrue(vault.getPolicyState(policyId).revoked);
    }

    function test_pause_doesNotBlockAgentRevocation() public {
        vm.startPrank(owner);
        vault.setExecutionPaused(true);
        vault.revokeAgent(agent);
        vm.stopPrank();
    }

    function test_pause_doesNotBlockApprovalCancellation() public {
        vm.startPrank(owner);
        vault.setExecutionPaused(true);
        vault.cancelApprovalNonce(7);
        vm.stopPrank();
        assertTrue(vault.isApprovalNonceUsedOrCancelled(7));
    }

    function test_isSupportedToken_reflectsConstructorAllowlist() public view {
        assertTrue(vault.isSupportedToken(address(tokenA)));
        assertTrue(vault.isSupportedToken(address(tokenB)));
        assertFalse(vault.isSupportedToken(address(0xDEAD)));
    }
}
