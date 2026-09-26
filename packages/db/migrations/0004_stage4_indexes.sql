-- Stage 4, migration 0004: two indexes the HTTP control plane needs as correctness constraints,
-- both identified by the Stage 4 pre-implementation design review.

-- SPEC-020. `POST /v1/payment-intents/{id}/submit` is authorized for EITHER the vault owner OR the
-- bound agent, and API_CONTRACT.md requires "Repeating submit returns the same operation."
-- Idempotency keys alone cannot deliver that: `idempotency_keys` is unique on
-- (principal_wallet_id, operation, client_key), so an owner submit and an agent submit of the SAME
-- intent are two different principals and both insert successfully -- producing two QUEUED
-- operations and two outbox jobs for one payment. The vault's own replay defences would stop the
-- second payment at execution time, but the API contract would already have been broken, and the
-- duplicate job would fail confusingly inside the Stage 5 worker.
--
-- Submission is therefore made idempotent on INTENT IDENTITY, independent of who submitted it.
-- Scoped to non-terminal statuses so that a genuinely FAILED submission can be retried later
-- (a FAILED operation is a resolved outcome, not an in-flight claim on the intent).
CREATE UNIQUE INDEX one_open_submission_per_intent
  ON operations (resource_id)
  WHERE resource_kind = 'payment_intent' AND status <> 'FAILED';

-- Merchant-scoped payment reads resolve "is this caller the merchant for THIS payment?" through
-- payments -> invoices -> signed_artifacts.signer. Being listed as an `invoice_signer` in some
-- policy snapshot deliberately does NOT grant access (that would leak every payment in the vault
-- to every merchant of that vault), so the signer column is the real authorization boundary and
-- needs to be indexed for it.
CREATE INDEX artifacts_signer ON signed_artifacts (signer, id);
