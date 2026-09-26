/**
 * Non-secret identifiers only: the selected profile and the ids of demo runs this browser started,
 * so a reload can re-read them from the backend. No credential, token or key is ever stored.
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the app still works, it just forgets across reloads
  }
}

export interface StoredRun {
  runId: string;
  scenarioId: string;
  scenarioLabel: string;
  profileId: string;
  startedAt: string;
  paymentId: string | null;
}

const scope = (deploymentId: string, owner: string) => `${deploymentId}:${owner.toLowerCase()}`;

export const storage = {
  getSelectedProfile: (deploymentId: string, owner: string) =>
    read<string | null>(`payguard:profile:${scope(deploymentId, owner)}`, null),
  setSelectedProfile: (deploymentId: string, owner: string, profileId: string) =>
    write(`payguard:profile:${scope(deploymentId, owner)}`, profileId),
  getRuns: (deploymentId: string, owner: string) =>
    read<StoredRun[]>(`payguard:runs:${scope(deploymentId, owner)}`, []),
  setRuns: (deploymentId: string, owner: string, runs: StoredRun[]) =>
    write(`payguard:runs:${scope(deploymentId, owner)}`, runs.slice(0, 40)),
};
