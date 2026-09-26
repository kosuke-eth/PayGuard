-- Stage 3, migration 0003: operations needs a compare-and-set version column.
--
-- Gap found while implementing the operations repository: Prompt 3 item 4 requires
-- "Enforce allowed transitions with state-version compare-and-set updates in SQL" for every
-- status axis including operation status, but DATABASE_SCHEMA.sql's operations table has no
-- version column at all (payments.state_version exists for the four payment axes; operations has
-- nothing equivalent). Without it, a status update can only be guarded by matching the previous
-- status value itself (WHERE status = $expected), which breaks the moment two different valid
-- prior states could legally transition to the same next state (e.g. QUEUED and UNKNOWN both
-- retry to IN_PROGRESS) -- the WHERE clause can no longer distinguish "nothing changed since I
-- read this row" from "something else changed it to the same status I expected". A dedicated
-- version counter is the correct fix, matching the pattern already used on payments/outbox/
-- indexer_cursors.
ALTER TABLE operations
  ADD COLUMN state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1);
