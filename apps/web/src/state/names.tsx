import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useApp, useConfig } from './app';

/**
 * The owner's address book. The API identifies agents and merchants by address only, so -- like a
 * wallet's contact list -- names are the owner's own labels, kept in this browser. They change how
 * an address is DISPLAYED and nothing else: no request, signature or decision ever uses a name.
 */
interface NamesState {
  names: Record<string, string>;
  nameOf: (address: string | null | undefined) => string | null;
  rename: (address: string, name: string) => void;
}

const Context = createContext<NamesState | null>(null);

export function NamesProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { session } = useApp();
  const key = `payguard:names:${config.deploymentId}:${(session?.walletAddress ?? '').toLowerCase()}`;
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      setNames(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>);
    } catch {
      setNames({});
    }
  }, [key]);

  const rename = useCallback(
    (address: string, name: string) => {
      setNames((previous) => {
        const next = { ...previous };
        const trimmed = name.trim().slice(0, 40);
        if (trimmed) next[address.toLowerCase()] = trimmed;
        else delete next[address.toLowerCase()];
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // storage unavailable: the name lasts for this session only
        }
        return next;
      });
    },
    [key],
  );

  const value = useMemo<NamesState>(
    () => ({
      names,
      nameOf: (address) => (address ? (names[address.toLowerCase()] ?? null) : null),
      rename,
    }),
    [names, rename],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNames(): NamesState {
  const value = useContext(Context);
  if (!value) throw new Error('useNames must be used inside NamesProvider');
  return value;
}
