import { useState } from 'react';
import { shortHex } from '../../lib/labels';
import { useNames } from '../../state/names';

/**
 * An agent or merchant: the owner's name for it when there is one, always next to the real
 * address. `suggested` is a fallback display name (e.g. the test scenario that created a payment).
 */
export function Party({
  address,
  suggested,
  kind,
  editable = true,
}: {
  address: string | null | undefined;
  suggested?: string | null;
  kind: 'agent' | 'merchant';
  editable?: boolean;
}) {
  const { nameOf, rename } = useNames();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!address) return <span className="muted">—</span>;
  const name = nameOf(address) ?? suggested ?? null;

  if (editing) {
    const save = () => {
      rename(address, draft);
      setEditing(false);
    };
    return (
      <span className="row" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ width: 200, padding: '5px 8px' }}
          // biome-ignore lint/a11y/noAutofocus: the field appears because the owner asked to rename
          autoFocus
          value={draft}
          placeholder={kind === 'agent' ? 'e.g. Travel agent' : 'e.g. Acme Hotels'}
          aria-label={`Name for ${address}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
        <button type="button" className="btn" onClick={save}>
          Save
        </button>
      </span>
    );
  }

  return (
    <span className="party">
      <span className="party-name">
        {name ?? (kind === 'agent' ? 'Unnamed agent' : 'Unnamed merchant')}
      </span>
      <span className="mono small muted" title={address}>
        {shortHex(address)}
      </span>
      {editable && (
        <button
          type="button"
          className="btn btn-quiet small"
          style={{ padding: '0 4px' }}
          onClick={() => {
            setDraft(nameOf(address) ?? '');
            setEditing(true);
          }}
        >
          {nameOf(address) ? 'Rename' : 'Name'}
        </button>
      )}
    </span>
  );
}
