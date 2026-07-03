"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type ToastType = "success" | "error";
type Toast = { id: number; message: string; type: ToastType };

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

/** Fire a toast from any client component: const toast = useToast(); toast("Saved"). */
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {/* bottom-center on mobile, bottom-right on desktop; above the mobile nav */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end">
        {toasts.map((t) => (
          <ToastPill key={t.id} toast={t} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastPill({ toast }: { toast: Toast }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const ok = toast.type === "success";
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full bg-white py-2.5 pl-2.5 pr-4 text-sm font-medium shadow-lg ring-1 transition-all duration-300 sm:max-w-sm ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${ok ? "text-emerald-800 ring-emerald-200" : "text-red-800 ring-red-200"}`}
    >
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ${
          ok ? "bg-emerald-500" : "bg-red-500"
        }`}
        aria-hidden
      >
        {ok ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="leading-snug">{toast.message}</span>
    </div>
  );
}
