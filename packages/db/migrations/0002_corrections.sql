-- Stage 3, migration 0002: corrections found while implementing against the actual API/contract.
-- Narrowly scoped, additive -- does not touch 0001's tables beyond what's documented below.

-- SPEC-004 (docs/implementation/DECISIONS.md): DATABASE_SCHEMA.sql's auth_challenges table has
-- no column recording the sessionKind requested at POST /v1/auth/challenges, so nothing stops
-- POST /v1/auth/verify from creating a session of a different kind than what was actually
-- challenged. Persist it at challenge creation; verify-time reads this stored value and never
-- accepts (there is no field for it in the verify request body) a client-supplied kind.
ALTER TABLE auth_challenges
  ADD COLUMN session_kind text NOT NULL CHECK (session_kind IN ('BROWSER', 'AGENT'));

-- Signed evidence must be immutable under ordinary application operations (CLAUDE.md invariant;
-- Prompt 3 item 2). No application code path is written that ever needs to UPDATE a
-- signed_artifacts row -- rows are insert-once, append-only evidence. Enforcing that at the SQL
-- layer with a trigger (rather than relying only on "no code happens to call UPDATE") means a
-- future bug or a direct psql session can't silently mutate a merchant's/agent's/owner's signed
-- bytes after the fact.
CREATE FUNCTION reject_signed_artifact_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signed_artifacts rows are immutable evidence and cannot be updated (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signed_artifacts_immutable
  BEFORE UPDATE ON signed_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_signed_artifact_update();
