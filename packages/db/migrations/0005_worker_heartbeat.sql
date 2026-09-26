-- Stage 5, migration 0005: worker freshness storage.
--
-- API_CONTRACT.md GET /health/ready: "Readiness checks SQL access, worker freshness, expected
-- chain ID, required code/ABI/deployment configuration, and relayer balance sufficient for
-- configured operations." No table existed for "worker freshness" before this stage -- the worker
-- process did not exist yet (Stage 1 scaffold only). This is new schema, not a recovery of an
-- existing primitive.
--
-- One row per running worker instance (worker_id is a process-unique identity chosen at boot --
-- e.g. hostname:pid:startedAt -- NOT the relayer address, since one relayer key could in principle
-- be configured for more than one process and the freshness check is about the PROCESS being
-- alive, not the key). The worker updates its own row on a short interval; `/health/ready` reads
-- the freshest row for the configured deployment and fails readiness if every row's last_seen_at
-- is older than a configured staleness bound, or if no row exists yet.
CREATE TABLE worker_heartbeat (
  worker_id text PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments(id),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_heartbeat_deployment ON worker_heartbeat (deployment_id, last_seen_at);
