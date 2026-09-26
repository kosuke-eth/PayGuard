import { useCallback, useEffect, useState } from 'react';
import { type StoredRun, storage } from '../lib/storage';
import { useApp, useConfig } from '../state/app';

/**
 * The API identifies a merchant by address only. For payments this browser started from the Agent
 * Demo we remember which scripted scenario produced them, purely as a display name.
 */
export function useStoredRuns() {
  const config = useConfig();
  const { session } = useApp();
  const owner = session?.walletAddress ?? '';
  const [runs, setRuns] = useState<StoredRun[]>([]);

  useEffect(() => {
    setRuns(owner ? storage.getRuns(config.deploymentId, owner) : []);
  }, [config.deploymentId, owner]);

  const save = useCallback(
    (update: (previous: StoredRun[]) => StoredRun[]) => {
      setRuns((previous) => {
        const next = update(previous);
        if (owner) storage.setRuns(config.deploymentId, owner, next);
        return next;
      });
    },
    [config.deploymentId, owner],
  );

  const labelFor = useCallback(
    (paymentId: string): string | null =>
      runs.find((run) => run.paymentId === paymentId)?.scenarioLabel ?? null,
    [runs],
  );

  return { runs, save, labelFor };
}
