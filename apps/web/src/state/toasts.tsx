import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface Toast {
  id: string;
  tone: 'allow' | 'escalate' | 'block' | 'info';
  title: string;
  text?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  push: (toast: Omit<Toast, 'id'>) => void;
}

const Context = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback(
    (id: string) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID();
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      // Approval requests stay until dismissed; everything else clears itself.
      if (toast.tone !== 'escalate') setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);

  return (
    <Context.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <div>
              <strong>{toast.title}</strong>
              {toast.text && <div className="small">{toast.text}</div>}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              {toast.action && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    toast.action?.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                className="btn btn-quiet"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}

export function useToasts(): ToastState {
  const value = useContext(Context);
  if (!value) throw new Error('useToasts must be used inside ToastProvider');
  return value;
}
