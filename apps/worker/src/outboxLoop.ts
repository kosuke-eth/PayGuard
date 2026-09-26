/**
 * The bounded outbox-claim-dispatch-retry loop (item 1). One tick: claim due jobs under THIS
 * worker's lease identity, dispatch each by eventType, and requeue (bounded, backed off) whatever
 * a handler did not itself complete. `claimDueJobs`/`retryJob`'s lease-owner+lease-version fencing
 * is what stops a stale worker's late retryJob call from overwriting a newer worker's result --
 * this loop just has to keep using the exact `(leaseOwner, leaseVersion)` the claim returned.
 */
import { claimDueJobs, type OutboxRow, retryJob } from '@payguard/db';
import type pg from 'pg';
import {
  handlePaymentSubmissionJob,
  type SubmitDeps,
  type SubmitJobPayload,
} from './submitPayment.js';

const MAX_ATTEMPTS = 20;
const BACKOFF_SECONDS = 5;

export interface OutboxLoopDeps {
  pool: pg.Pool;
  submitDeps: SubmitDeps;
  leaseDurationSeconds: number;
}

async function dispatch(
  deps: OutboxLoopDeps,
  job: OutboxRow,
): Promise<{ completed: boolean; error?: string }> {
  if (!job.leaseOwner) {
    return { completed: false, error: 'claimed job has no lease_owner -- should be unreachable' };
  }
  switch (job.eventType) {
    case 'PAYMENT_SUBMISSION_REQUESTED': {
      try {
        const result = await handlePaymentSubmissionJob(deps.submitDeps, {
          id: job.id,
          leaseOwner: job.leaseOwner,
          leaseVersion: job.leaseVersion,
          payload: job.payload as SubmitJobPayload,
        });
        return result.kind === 'DONE'
          ? { completed: true }
          : { completed: false, error: result.reason };
      } catch (error) {
        return { completed: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    default:
      // An event type this worker doesn't own (e.g. a future observation-triggered kind handled
      // elsewhere) -- leave it for its real consumer rather than guessing at behavior.
      return { completed: false, error: `unhandled eventType ${job.eventType}` };
  }
}

/** One claim-dispatch-retry pass. Returns how many jobs were claimed this tick. */
export async function runOutboxTick(deps: OutboxLoopDeps, workerId: string): Promise<number> {
  const jobs = await claimDueJobs(deps.pool, {
    leaseOwner: workerId,
    leaseDurationSeconds: deps.leaseDurationSeconds,
    limit: 5,
  });
  for (const job of jobs) {
    const outcome = await dispatch(deps, job);
    if (!outcome.completed) {
      await retryJob(deps.pool, {
        id: job.id,
        leaseOwner: workerId,
        expectedLeaseVersion: job.leaseVersion,
        error: outcome.error ?? 'unknown handler failure',
        maxAttempts: MAX_ATTEMPTS,
        backoffSeconds: BACKOFF_SECONDS,
      });
    }
  }
  return jobs.length;
}
