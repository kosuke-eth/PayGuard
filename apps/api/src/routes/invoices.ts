/**
 * POST /v1/invoices -- merchant invoice ingestion.
 *
 * SPEC-016. Two things are deliberately kept apart here:
 *   - **Cryptographic validity**: the signature recovers to an address. Checked with ECDSA ONLY,
 *     because the vault checks invoice signatures with `ECDSA.tryRecover` (PayGuardVault.sol:506).
 *     Accepting an ERC-1271 invoice signature would report `signatureValid: true` for something
 *     `executePayment` will later reject.
 *   - **Permission to use this merchant under a policy**: NOT decided here. Ingestion only checks
 *     that the signer matches an `invoiceSigner` snapshot somewhere on this vault; per-policy
 *     permission is re-checked at intent creation and again on chain.
 *
 * Matching a snapshot confers NO read access to anything. Merchant read scope is per-payment,
 * resolved through the payment's own invoice signer.
 */
import { randomUUID } from 'node:crypto';
import {
  createOrGetInvoice,
  createSignedArtifact,
  findMerchantSnapshotForVault,
  getVaultWithDeployment,
  withTransaction,
} from '@payguard/db';
import {
  domainFor,
  EIP712_TYPES,
  hashInvoice,
  type Invoice,
  parseUIntOfWidth,
  parseUIntString,
} from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import { addressToBuffer, bufferToAddress, requireSession } from '../auth.js';
import { boundAgentPolicies } from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { INVOICE_BODY } from '../schemas.js';
import { recoverTypedDataSigner } from '../signatures.js';

interface InvoiceBody {
  vaultId: string;
  invoice: Invoice;
  merchantSignature: `0x${string}`;
}

export function registerInvoiceRoutes(app: FastifyInstance, context: AppContext): void {
  app.post<{ Body: InvoiceBody }>(
    '/v1/invoices',
    { schema: { body: INVOICE_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const { vaultId, invoice, merchantSignature } = request.body;

      const vault = await getVaultWithDeployment(context.pool, vaultId);
      if (!vault) throw new ApiError('RESOURCE_NOT_FOUND', 'vault not found');
      if (auth.chainId !== vault.chainId) {
        throw new ApiError('DEPLOYMENT_MISMATCH', 'session chain does not match this vault');
      }

      // Width-check each field at its REAL Solidity width before anything is hashed or stored.
      parseUIntOfWidth(invoice.validUntil, 48);
      const category = parseUIntOfWidth(invoice.category, 32);
      if (category > 255n) {
        throw new ApiError('INVALID_SCHEMA', 'category must be below 256 at the wire boundary');
      }
      if (parseUIntString(invoice.outputAmount) === 0n) {
        throw new ApiError('INVALID_SCHEMA', 'outputAmount must be greater than zero');
      }

      const vaultAddress = bufferToAddress(vault.address);
      const eip712Domain = { chainId: Number(vault.chainId), verifyingContract: vaultAddress };
      const digest = hashInvoice(eip712Domain, invoice);

      // ECDSA recovery only -- mirroring the vault exactly.
      const recovered = await recoverTypedDataSigner(digest, merchantSignature);

      const snapshot =
        recovered === null
          ? null
          : await findMerchantSnapshotForVault(context.pool, {
              vaultId,
              merchantId: Buffer.from(invoice.merchantId.slice(2), 'hex'),
              invoiceSigner: addressToBuffer(recovered),
            });

      // Cryptographically valid AND signed by a merchant this vault has actually configured.
      const signatureValid = recovered !== null && snapshot !== null;

      // Who may submit: the vault owner, a bound agent, or the merchant who signed it. This stops
      // an unrelated third party from writing invoices into someone else's vault.
      const isOwner = vault.ownerWalletId === auth.walletId;
      const agentPolicies = isOwner ? [] : await boundAgentPolicies(context, auth, vaultId);
      const isSigner =
        recovered !== null && recovered.toLowerCase() === auth.walletAddress.toLowerCase();
      if (!isOwner && agentPolicies.length === 0 && !isSigner) {
        throw new ApiError(
          'RESOURCE_FORBIDDEN',
          'only the vault owner, a bound agent, or the invoice signer may submit this invoice',
        );
      }

      if (!signatureValid) {
        throw new ApiError('INVALID_SIGNATURE', 'invoice signature is not valid for this vault', {
          recoveredSigner: recovered,
          knownMerchantSnapshot: snapshot !== null,
        });
      }

      const typedData = {
        domain: domainFor(eip712Domain),
        types: { Invoice: EIP712_TYPES.Invoice },
        primaryType: 'Invoice',
        message: invoice,
      };
      const encodedPayload = Buffer.from(JSON.stringify(invoice), 'utf8');
      const signatureBuffer = Buffer.from(merchantSignature.slice(2), 'hex');

      const outcome = await withTransaction(context.pool, async (client) => {
        const artifact = await createSignedArtifact(client, {
          id: randomUUID(),
          kind: 'INVOICE',
          digest: Buffer.from(digest.slice(2), 'hex'),
          signer: addressToBuffer(recovered as string),
          encodedPayload,
          typedData,
          signature: signatureBuffer,
          signatureHash: Buffer.from(keccak256(merchantSignature).slice(2), 'hex'),
          schemaVersion: '1',
        });

        return createOrGetInvoice(client, {
          id: randomUUID(),
          vaultId,
          invoiceId: Buffer.from(invoice.invoiceId.slice(2), 'hex'),
          recipient: addressToBuffer(invoice.recipient),
          merchantId: Buffer.from(invoice.merchantId.slice(2), 'hex'),
          settlementToken: addressToBuffer(invoice.settlementToken),
          outputAmount: parseUIntString(invoice.outputAmount),
          validUntil: parseUIntString(invoice.validUntil),
          invoiceDigest: Buffer.from(digest.slice(2), 'hex'),
          artifactId: artifact.id,
        });
      });

      if (outcome.kind === 'conflict') {
        // Same (vault, recipient, invoiceId) with different protected bytes. This is a conflict,
        // never a second payable obligation.
        throw new ApiError(
          'INVOICE_ID_REUSED',
          'this invoice identity already exists with different bytes',
          { invoiceResourceId: outcome.row.id },
        );
      }

      const body = {
        invoiceResourceId: outcome.row.id,
        invoiceHash: digest,
        signatureValid,
        // Reconstructed from the signed payload: `category` has no normalized column, and the
        // signed bytes are the evidence while the columns are only the constraint surface.
        invoice,
        // Stated explicitly so nobody reads ingestion as authorization.
        merchantPermissionCheckedAtIntentCreation: true,
      };
      return reply
        .status(outcome.kind === 'created' ? 201 : 200)
        .send(successEnvelope(body, String(request.id)));
    },
  );
}
