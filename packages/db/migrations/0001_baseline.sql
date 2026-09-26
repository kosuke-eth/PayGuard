-- Stage 3, migration 0001: baseline schema.
-- Verbatim transcription of the proposed DATABASE_SCHEMA.sql body (domains + all P0 tables +
-- indexes), executed for the first time against a real PostgreSQL database. The migration
-- runner wraps this file in its own transaction, so the source file's own BEGIN/COMMIT wrapper
-- is intentionally not reproduced here. docs/implementation/migrations/0002_* records the one
-- schema correction this baseline needed (SPEC-004): DATABASE_SCHEMA.sql itself is preserved
-- unmodified at the repository root as the original design artifact.

CREATE DOMAIN uint256 AS numeric CHECK (
  VALUE >= 0 AND
  VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND
  VALUE = trunc(VALUE)
);
CREATE DOMAIN evm_address AS bytea CHECK (octet_length(VALUE)=20);
CREATE DOMAIN hash32 AS bytea CHECK (octet_length(VALUE)=32);

CREATE TABLE deployments (
  id uuid PRIMARY KEY,
  chain_id uint256 NOT NULL,
  instance_label text NOT NULL UNIQUE,
  environment text NOT NULL CHECK(environment IN ('LOCAL_DEMO','TESTNET')),
  start_block uint256 NOT NULL,
  genesis_or_anchor_hash hash32 NOT NULL,
  configuration jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallets (
  id uuid PRIMARY KEY,
  address evm_address NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  chain_id uint256 NOT NULL,
  nonce_hash hash32 NOT NULL UNIQUE,
  expected_message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  token_hash hash32 NOT NULL UNIQUE,
  csrf_token_hash hash32,
  session_kind text NOT NULL CHECK(session_kind IN ('BROWSER','AGENT')),
  chain_id uint256 NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE TABLE vaults (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  owner_wallet_id uuid NOT NULL REFERENCES wallets(id),
  address evm_address NOT NULL,
  runtime_code_hash hash32 NOT NULL,
  abi_schema_version text NOT NULL,
  UNIQUE(deployment_id,address)
);
CREATE INDEX vaults_owner ON vaults(owner_wallet_id,id);
CREATE TABLE policy_drafts (
  id uuid PRIMARY KEY,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  draft_version bigint NOT NULL CHECK(draft_version>=1),
  body jsonb NOT NULL,
  compiled_bytes bytea,
  compiled_hash hash32,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE policy_draft_revisions (
  draft_id uuid NOT NULL REFERENCES policy_drafts(id),
  draft_version bigint NOT NULL CHECK(draft_version>=1),
  canonical_body jsonb NOT NULL,
  encoded_transaction bytea NOT NULL,
  transaction_digest hash32 NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(draft_id,draft_version)
);
CREATE TABLE policies (
  id uuid PRIMARY KEY,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  onchain_policy_id hash32 NOT NULL,
  agent evm_address NOT NULL,
  input_token evm_address NOT NULL,
  settlement_token evm_address NOT NULL,
  adapter evm_address NOT NULL,
  route_id hash32 NOT NULL,
  total_output_budget uint256 NOT NULL,
  epoch_output_budget uint256 NOT NULL,
  automatic_output_cap uint256 NOT NULL,
  escalation_output_cap uint256 NOT NULL,
  total_input_budget uint256 NOT NULL,
  max_input_per_payment uint256 NOT NULL,
  valid_after uint256 NOT NULL,
  valid_until uint256 NOT NULL,
  subsidy_mode smallint NOT NULL CHECK(subsidy_mode BETWEEN 0 AND 2),
  canonical_config_bytes bytea NOT NULL,
  config_projection jsonb NOT NULL,
  observed_status text NOT NULL CHECK(observed_status IN ('ACTIVE','REVOKED','SUPERSEDED','EXPIRED','ORPHANED')),
  observed_block_hash hash32 NOT NULL,
  UNIQUE(vault_id,onchain_policy_id),
  UNIQUE(id,vault_id),
  CHECK(valid_until>valid_after),
  CHECK(automatic_output_cap<=escalation_output_cap),
  CHECK(escalation_output_cap<=total_output_budget),
  CHECK(epoch_output_budget<=total_output_budget),
  CHECK(max_input_per_payment<=total_input_budget)
);
CREATE TABLE policy_merchants (
  policy_id uuid NOT NULL REFERENCES policies(id),
  merchant_id hash32 NOT NULL,
  recipient evm_address NOT NULL,
  invoice_signer evm_address NOT NULL,
  category integer NOT NULL CHECK(category BETWEEN 0 AND 255),
  display_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(policy_id,merchant_id)
);
CREATE TABLE signed_artifacts (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('INVOICE','INTENT','APPROVAL')),
  digest hash32 NOT NULL,
  signer evm_address NOT NULL,
  encoded_payload bytea NOT NULL,
  typed_data jsonb NOT NULL,
  signature bytea NOT NULL,
  signature_hash hash32 NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,digest,signature_hash)
);
CREATE INDEX artifacts_digest ON signed_artifacts(kind,digest);
CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  invoice_id hash32 NOT NULL,
  recipient evm_address NOT NULL,
  merchant_id hash32 NOT NULL,
  settlement_token evm_address NOT NULL,
  output_amount uint256 NOT NULL CHECK(output_amount>0),
  valid_until uint256 NOT NULL,
  invoice_digest hash32 NOT NULL,
  artifact_id uuid NOT NULL REFERENCES signed_artifacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vault_id,recipient,invoice_id),
  UNIQUE(id,vault_id)
);
CREATE TABLE payments (
  id uuid PRIMARY KEY,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  invoice_id uuid NOT NULL UNIQUE,
  policy_decision text NOT NULL CHECK(policy_decision IN ('ALLOW','ESCALATE','BLOCK','UNKNOWN')),
  execution_status text NOT NULL CHECK(execution_status IN (
    'DRAFT','AWAITING_APPROVAL','READY','QUEUED','SIGNED','SUBMITTED',
    'UNKNOWN','INCLUDED','SUCCEEDED','REVERTED','CANCELLED','REORGED')),
  confidence text NOT NULL CHECK(confidence IN (
    'UNOBSERVED','INCLUDED','DEPTH_CONFIRMED','RPC_FINALIZED','LOCAL_DEMO')),
  reconciliation text NOT NULL CHECK(reconciliation IN ('NOT_CHECKED','MATCHED','MISMATCH')),
  reason_code text,
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
  observed_block_hash hash32,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(invoice_id,vault_id) REFERENCES invoices(id,vault_id),
  UNIQUE(id,vault_id)
);
CREATE INDEX payments_vault_status_time ON payments(vault_id,execution_status,created_at,id);
CREATE TABLE payment_intents (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>=1),
  intent_digest hash32 NOT NULL UNIQUE,
  artifact_id uuid NOT NULL REFERENCES signed_artifacts(id),
  agent_nonce uint256 NOT NULL,
  max_input_amount uint256 NOT NULL CHECK(max_input_amount>0),
  valid_until uint256 NOT NULL,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(payment_id,vault_id) REFERENCES payments(id,vault_id),
  FOREIGN KEY(policy_id,vault_id) REFERENCES policies(id,vault_id),
  UNIQUE(payment_id,version),
  UNIQUE(id,vault_id)
);
CREATE UNIQUE INDEX one_active_intent_per_payment ON payment_intents(payment_id) WHERE retired_at IS NULL;
CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  approval_digest hash32 NOT NULL,
  approval_nonce uint256 NOT NULL,
  artifact_id uuid NOT NULL REFERENCES signed_artifacts(id),
  valid_until uint256 NOT NULL,
  observed_consumed_tx_hash hash32,
  observed_cancelled boolean NOT NULL DEFAULT false,
  FOREIGN KEY(intent_id,vault_id) REFERENCES payment_intents(id,vault_id),
  UNIQUE(vault_id,approval_nonce),
  UNIQUE(intent_id,approval_digest)
);
CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY,
  principal_wallet_id uuid NOT NULL REFERENCES wallets(id),
  operation text NOT NULL,
  client_key text NOT NULL CHECK(length(client_key) BETWEEN 1 AND 200),
  request_digest hash32 NOT NULL,
  resource_kind text,
  resource_id uuid,
  status text NOT NULL CHECK(status IN ('IN_PROGRESS','COMPLETED','FAILED_RETRYABLE','FAILED_TERMINAL')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(principal_wallet_id,operation,client_key)
);
CREATE TABLE operations (
  id uuid PRIMARY KEY,
  principal_wallet_id uuid NOT NULL REFERENCES wallets(id),
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  operation_kind text NOT NULL,
  resource_kind text NOT NULL,
  resource_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('QUEUED','IN_PROGRESS','COMPLETED','UNKNOWN','FAILED')),
  immutable_request bytea NOT NULL,
  request_digest hash32 NOT NULL,
  transaction_hash hash32,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_owner_time ON operations(principal_wallet_id,created_at,id);
CREATE TABLE signer_state (
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  sender evm_address NOT NULL,
  next_nonce uint256 NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(deployment_id,sender)
);
CREATE TABLE nonce_families (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  sender evm_address NOT NULL,
  nonce uint256 NOT NULL,
  intent_id uuid NOT NULL REFERENCES payment_intents(id),
  unsigned_request jsonb NOT NULL,
  expected_to evm_address NOT NULL,
  expected_calldata_hash hash32 NOT NULL,
  canonical_tx_hash hash32,
  closed_at timestamptz,
  UNIQUE(deployment_id,sender,nonce),
  UNIQUE(id,deployment_id)
);
CREATE UNIQUE INDEX one_open_nonce_family_per_intent ON nonce_families(intent_id) WHERE closed_at IS NULL;
CREATE TABLE transaction_attempts (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  nonce_family_id uuid NOT NULL,
  tx_hash hash32 NOT NULL,
  raw_signed_transaction bytea NOT NULL,
  replacement_of_id uuid REFERENCES transaction_attempts(id),
  state text NOT NULL CHECK(state IN ('SIGNED','SUBMITTED','UNKNOWN','INCLUDED','SUCCEEDED','REVERTED','REPLACED','CANCELLED','REORGED')),
  first_broadcast_at timestamptz,
  last_broadcast_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(nonce_family_id,deployment_id) REFERENCES nonce_families(id,deployment_id),
  UNIQUE(deployment_id,tx_hash)
);
CREATE INDEX transactions_pending ON transaction_attempts(state,created_at) WHERE state IN ('SIGNED','SUBMITTED','UNKNOWN','INCLUDED');
CREATE TABLE chain_blocks (
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  block_hash hash32 NOT NULL,
  block_number uint256 NOT NULL,
  parent_hash hash32 NOT NULL,
  canonical boolean NOT NULL,
  confidence text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(deployment_id,block_hash)
);
CREATE UNIQUE INDEX canonical_block_height ON chain_blocks(deployment_id,block_number) WHERE canonical;
CREATE TABLE receipts (
  deployment_id uuid NOT NULL,
  tx_hash hash32 NOT NULL,
  block_hash hash32 NOT NULL,
  receipt_status smallint NOT NULL CHECK(receipt_status IN (0,1)),
  canonical boolean NOT NULL,
  raw_receipt jsonb NOT NULL,
  PRIMARY KEY(deployment_id,tx_hash,block_hash),
  FOREIGN KEY(deployment_id,block_hash) REFERENCES chain_blocks(deployment_id,block_hash)
);
CREATE UNIQUE INDEX canonical_receipt_per_tx ON receipts(deployment_id,tx_hash) WHERE canonical;
CREATE TABLE chain_events (
  deployment_id uuid NOT NULL,
  block_hash hash32 NOT NULL,
  log_index uint256 NOT NULL,
  tx_hash hash32 NOT NULL,
  emitter evm_address NOT NULL,
  topic0 hash32 NOT NULL,
  topics jsonb NOT NULL,
  data bytea NOT NULL,
  decoded_name text,
  decoded_payload jsonb,
  canonical boolean NOT NULL,
  PRIMARY KEY(deployment_id,block_hash,log_index),
  FOREIGN KEY(deployment_id,block_hash) REFERENCES chain_blocks(deployment_id,block_hash)
);
CREATE INDEX events_tx ON chain_events(deployment_id,tx_hash);
CREATE TABLE indexer_cursors (
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  contract_group text NOT NULL,
  next_block uint256 NOT NULL,
  last_canonical_hash hash32,
  lease_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(deployment_id,contract_group)
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  aggregate_kind text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('READY','RUNNING','DONE','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_version bigint NOT NULL DEFAULT 0 CHECK(lease_version>=0),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due ON outbox(available_at,id) WHERE status='READY';
CREATE INDEX outbox_expired_lease ON outbox(locked_until,id) WHERE status='RUNNING';
CREATE TABLE payment_timeline (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timeline_payment_cursor ON payment_timeline(payment_id,created_at,id);
