/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 * Source: contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json (the actual compiled Foundry artifact).
 * Regenerate: pnpm --filter @payguard/integration abi:generate
 * Drift guard: packages/integration/test/abi-drift.test.ts
 */

export const PAYGUARD_VAULT_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialSupportedTokens",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "DIRECT_ROUTE_ID",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelApprovalNonce",
    "inputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPolicy",
    "inputs": [
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PolicyConfig",
        "components": [
          {
            "name": "agent",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "inputToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "adapter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalOutputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "epochOutputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "automaticOutputCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "escalationOutputCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalInputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxInputPerPayment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "allowedCategoryBitmap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          }
        ]
      },
      {
        "name": "merchants",
        "type": "tuple[]",
        "internalType": "struct IPayGuardVault.MerchantPermission[]",
        "components": [
          {
            "name": "merchantId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "invoiceSigner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "category",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "evaluate",
    "inputs": [
      {
        "name": "invoice",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.Invoice",
        "components": [
          {
            "name": "invoiceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "merchantId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "category",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "name": "intent",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PaymentIntent",
        "components": [
          {
            "name": "policyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "invoiceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "maxInputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          },
          {
            "name": "maxSubsidyAmount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "agentSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "merchantSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "approval",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.ExceptionApproval",
        "components": [
          {
            "name": "intentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "name": "ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "evaluation",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.Evaluation",
        "components": [
          {
            "name": "decision",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.Decision"
          },
          {
            "name": "reason",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.Reason"
          },
          {
            "name": "remainingOutput",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remainingEpochOutput",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remainingInput",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "signaturesChecked",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executePayment",
    "inputs": [
      {
        "name": "invoice",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.Invoice",
        "components": [
          {
            "name": "invoiceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "merchantId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "category",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "name": "intent",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PaymentIntent",
        "components": [
          {
            "name": "policyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "invoiceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "maxInputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          },
          {
            "name": "maxSubsidyAmount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "agentSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "merchantSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "approval",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.ExceptionApproval",
        "components": [
          {
            "name": "intentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "name": "ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "intentHashOut",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actualInput",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "subsidyAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getExecutionContext",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.ExecutionContext",
        "components": [
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "intentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "policyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "adapter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "merchant",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "inputToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          },
          {
            "name": "maxSubsidyAmount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMerchantPermission",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "merchantId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.MerchantPermission",
        "components": [
          {
            "name": "merchantId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "invoiceSigner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "category",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPolicy",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PolicyConfig",
        "components": [
          {
            "name": "agent",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "inputToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "adapter",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalOutputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "epochOutputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "automaticOutputCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "escalationOutputCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalInputBudget",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxInputPerPayment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "allowedCategoryBitmap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPolicyState",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "state",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PolicyState",
        "components": [
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "agentRevoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "executionPaused",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "outputSpent",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "epochOutputSpent",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "inputSpent",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hashApproval",
    "inputs": [
      {
        "name": "approval",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.ExceptionApproval",
        "components": [
          {
            "name": "intentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hashIntent",
    "inputs": [
      {
        "name": "intent",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.PaymentIntent",
        "components": [
          {
            "name": "policyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "invoiceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "maxInputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "subsidyMode",
            "type": "uint8",
            "internalType": "enum IPayGuardVault.SubsidyMode"
          },
          {
            "name": "maxSubsidyAmount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hashInvoice",
    "inputs": [
      {
        "name": "invoice",
        "type": "tuple",
        "internalType": "struct IPayGuardVault.Invoice",
        "components": [
          {
            "name": "invoiceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "merchantId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "category",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validUntil",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isAgentNonceUsed",
    "inputs": [
      {
        "name": "agent",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isApprovalNonceUsedOrCancelled",
    "inputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isInvoiceConsumed",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "invoiceId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSupportedToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revokeAgent",
    "inputs": [
      {
        "name": "agent",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokePolicy",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setExecutionPaused",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AgentRevoked",
    "inputs": [
      {
        "name": "agent",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ApprovalNonceCancelled",
    "inputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      {
        "name": "payer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExecutionPaused",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentExecuted",
    "inputs": [
      {
        "name": "intentHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "policyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "invoiceKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "merchant",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "inputToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "actualInput",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "outputToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "exactOutput",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "routeId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "subsidyAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PolicyCreated",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "agent",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "configHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PolicyRevoked",
    "inputs": [
      {
        "name": "policyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidMerchantConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPolicyConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRecipient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PaymentRejected",
    "inputs": [
      {
        "name": "reason",
        "type": "uint8",
        "internalType": "enum IPayGuardVault.Reason"
      }
    ]
  },
  {
    "type": "error",
    "name": "PolicyNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SettlementInvariant",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
