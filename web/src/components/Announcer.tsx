import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/** Short, polite status messages ("Neon Orchard moved to 21:00") read by screen readers. */
interface Toast {
  id: number;
  text: string;
}

const AnnounceContext = createContext<(text: string) => void>(() => {});

let next = 1;

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const announce = useCallback((text: string) => {
    const id = next++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className="toast">
            {t.text}
          </p>
        ))}
      </div>
    </AnnounceContext.Provider>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);
