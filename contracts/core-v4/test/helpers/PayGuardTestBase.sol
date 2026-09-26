// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PayGuardVault} from "../../src/PayGuardVault.sol";
import {IPayGuardVault} from "../../src/interfaces/IPayGuardVault.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/**
 * Shared Stage 2 test scaffolding: a deployed vault + two mock tokens (one pair usable as a
 * direct-route input==settlement token, a second token to stand in as a distinct settlement
 * token for adapter-route tests), known EOA keys for owner/agent/merchant, and signing helpers
 * built on the vault's own hashInvoice/hashIntent/hashApproval — deliberately reusing the
 * production hasher rather than a parallel test-side implementation, since Stage 1's
 * Eip712HashHarness.sol already independently cross-validated that hashing spec; duplicating it
 * here would only test-side-mirror a bug if the vault's hasher ever drifted, not catch one.
 */
abstract contract PayGuardTestBase is Test {
    PayGuardVault internal vault;
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;

    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant AGENT_KEY = 0xA9E27;
    uint256 internal constant MERCHANT_SIGNER_KEY = 0xBEEF;
    uint256 internal constant OTHER_KEY = 0xD00D;

    address internal owner;
    address internal agent;
    address internal merchantSigner;
    address internal other;
    address internal merchantRecipient = address(0xCAFE);

    bytes32 internal constant MERCHANT_ID = keccak256("test-merchant");

    function _baseSetUp() internal {
        owner = vm.addr(OWNER_KEY);
        agent = vm.addr(AGENT_KEY);
        merchantSigner = vm.addr(MERCHANT_SIGNER_KEY);
        other = vm.addr(OTHER_KEY);

        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);

        address[] memory supported = new address[](2);
        supported[0] = address(tokenA);
        supported[1] = address(tokenB);
        vault = new PayGuardVault(owner, supported);
    }

    // ---- Signing helpers: sign against the vault's own production EIP-712 hashers ----

    function _signInvoice(uint256 pk, IPayGuardVault.Invoice memory invoice) internal view returns (bytes memory) {
        return _sign(pk, vault.hashInvoice(invoice));
    }

    function _signIntent(uint256 pk, IPayGuardVault.PaymentIntent memory intent) internal view returns (bytes memory) {
        return _sign(pk, vault.hashIntent(intent));
    }

    function _signApproval(uint256 pk, IPayGuardVault.ExceptionApproval memory approval)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, vault.hashApproval(approval));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _emptyApproval() internal pure returns (IPayGuardVault.ExceptionApproval memory approval, bytes memory sig) {
        approval = IPayGuardVault.ExceptionApproval({intentHash: bytes32(0), nonce: 0, validUntil: 0});
        sig = bytes("");
    }

    // ---- Default fixture builders (direct route: input == settlement token == tokenA) ----

    function _defaultDirectPolicy() internal view returns (IPayGuardVault.PolicyConfig memory) {
        return IPayGuardVault.PolicyConfig({
            agent: agent,
            inputToken: address(tokenA),
            settlementToken: address(tokenA),
            adapter: address(0),
            routeId: bytes32(0),
            totalOutputBudget: 1_000e18,
            epochOutputBudget: 500e18,
            automaticOutputCap: 100e18,
            escalationOutputCap: 300e18,
            totalInputBudget: 1_000e18,
            maxInputPerPayment: 200e18,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 30 days),
            allowedCategoryBitmap: type(uint256).max,
            subsidyMode: IPayGuardVault.SubsidyMode.NONE
        });
    }

    function _defaultMerchant() internal view returns (IPayGuardVault.MerchantPermission memory) {
        return IPayGuardVault.MerchantPermission({
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            invoiceSigner: merchantSigner,
            category: 1
        });
    }

    function _defaultMerchants() internal view returns (IPayGuardVault.MerchantPermission[] memory merchants) {
        merchants = new IPayGuardVault.MerchantPermission[](1);
        merchants[0] = _defaultMerchant();
    }

    function _defaultInvoice(bytes32 invoiceId, uint256 outputAmount)
        internal
        view
        returns (IPayGuardVault.Invoice memory)
    {
        return IPayGuardVault.Invoice({
            invoiceId: invoiceId,
            merchantId: MERCHANT_ID,
            recipient: merchantRecipient,
            settlementToken: address(tokenA),
            outputAmount: outputAmount,
            category: 1,
            validUntil: uint48(block.timestamp + 1 days)
        });
    }

    function _defaultIntent(bytes32 policyId, bytes32 invoiceHash, uint256 maxInputAmount, uint256 nonce)
        internal
        view
        returns (IPayGuardVault.PaymentIntent memory)
    {
        return IPayGuardVault.PaymentIntent({
            policyId: policyId,
            invoiceHash: invoiceHash,
            routeId: bytes32(0),
            maxInputAmount: maxInputAmount,
            nonce: nonce,
            validUntil: uint48(block.timestamp + 1 hours),
            subsidyMode: IPayGuardVault.SubsidyMode.NONE,
            maxSubsidyAmount: 0
        });
    }
}
