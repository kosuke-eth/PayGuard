// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * Minimal ERC-1271 smart-contract-owner fixture. Lets Stage 2 tests exercise the vault's owner
 * path (SignatureChecker.isValidSignatureNow, which accepts both EOA and ERC-1271 signers) through
 * a real contract deployment, not just an EOA — proving the exception-approval path is not
 * accidentally EOA-only despite the vault's agent/merchant paths being EOA-only by design (P0
 * scope, ARCH 3.3).
 */
contract MockERC1271Owner is IERC1271 {
    address public immutable authorizedSigner;

    constructor(address _authorizedSigner) {
        authorizedSigner = _authorizedSigner;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == authorizedSigner) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }
}
