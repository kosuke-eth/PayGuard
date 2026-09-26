// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * B4 test-side fixture: a REAL maker shipping a REAL, bounded, programmable XYCSwap (constant-
 * product AMM) liquidity position through the actual installed Aqua/SwapVM contracts -- not a
 * trivial fixed-rate wrapper. Mirrors `AquaSwapVMHelper` from the pinned swap-vm test suite
 * (`lib/swap-vm/test/helpers/AquaSwapVMHelper.sol`, inspected this session) exactly: same
 * instruction (`XYCSwap._xycSwapXD`), same salt-for-uniqueness pattern (`Controls._salt`), reused
 * rather than reinvented, per the B4 entry instruction to inspect the actual compatible source
 * graph rather than guess at an encoding. `ProgramBuilder`/`dynamic(...)` are the pinned project's
 * OWN test utilities (test-only, not shipped to any production contract) -- reused here for the
 * same reason `V4SwapFixture.t.sol` (B3) reused `V4SwapHarness` rather than reinventing pool-seed
 * mechanics.
 */

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import { Vm } from "forge-std/Vm.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { AquaOpcodesDebug } from "@1inch/swap-vm/src/opcodes/AquaOpcodesDebug.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Controls, ControlsArgsBuilder } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { Program, ProgramBuilder } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";

/// @title AquaMakerFixture
/// @notice Ships one real, immutable, bounded XYCSwap maker strategy with real token inventory
/// and a real Aqua allowance -- the "guarded liquidation" position PayGuardAquaAdapter settles
/// against as the taker.
contract AquaMakerFixture is AquaOpcodesDebug {
    using ProgramBuilder for Program;

    AquaSwapVMRouter public immutable router;

    constructor(address aqua, address weth, address owner) AquaOpcodesDebug(aqua) {
        router = new AquaSwapVMRouter(aqua, weth, owner, "PayGuardAquaFixture", "1.0.0");
    }

    /// @notice Builds the maker's Order (maker address, traits, program bytecode) for a real
    /// XYCSwap position -- the SAME encoding a real maker's own off-chain tooling would produce,
    /// salted for a fresh, distinct strategyHash per fixture deployment (Aqua strategies are
    /// immutable once shipped -- `Aqua.ship` reverts `StrategiesMustBeImmutable` on any reuse).
    function buildOrder(address maker, uint256 salt) external pure returns (ISwapVM.Order memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        bytes memory programBytes = bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(salt)))
        );

        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: programBytes
        }));
    }

    /// @notice Ships the strategy for real: maker approves Aqua for BOTH tokens (the required
    /// "deliberate Aqua allowance"), then `aqua.ship(...)` registers the bounded balances
    /// (`balanceIn`/`balanceOut`) that cap this AMM position -- the maker must actually hold
    /// `balanceA`/`balanceB` in their own wallet at swap time; Aqua never custodies tokens itself
    /// (confirmed directly from the installed `Aqua.sol` source: `ship` records bookkeeping only,
    /// `push`/`pull` are the only calls that ever move real tokens, always via `transferFrom`
    /// directly between maker and counterparty).
    function shipStrategy(
        Vm vm,
        IAqua aqua,
        address maker,
        ISwapVM.Order memory order,
        TokenMock tokenA,
        TokenMock tokenB,
        uint256 balanceA,
        uint256 balanceB
    ) external returns (bytes32 strategyHash) {
        vm.prank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        vm.prank(maker);
        tokenB.approve(address(aqua), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balanceA;
        amounts[1] = balanceB;

        vm.prank(maker);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }
}
