"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";

type ToastType = "success" | "error" | "loading";
type ToastAct = { label: string; onClick: () => void };
type Toast = { id: number; message: string; type: ToastType; action?: ToastAct; leaving?: boolean };

const ToastCtx = createContext<(message: string, type?: ToastType, action?: ToastAct) => void>(() => {});

/** Fire a toast from any client component: const toast = useToast(); toast("Saved").
 *  Optional action button (e.g. Undo): toast("Marked paid", "success", { label: "Undo", onClick }). */
export function useToast() {
  return useContext(ToastCtx);
}

/**
 * Wrap a server action so it fires a success/error toast when it finishes — the easy way to give any
 * server-action <form> feedback. Redirect/notFound framework errors pass through (unstable_rethrow) so
 * navigation still works; anything else shows the error toast.
 *   const withToast = useToastAction();
 *   <form action={withToast(deleteThing, { success: "Deleted" })}>…</form>
 */
export function useToastAction() {
  const toast = useToast();
  return useCallback(
    (action: (formData: FormData) => void | Promise<unknown>, opts?: { success?: string | null; error?: string }) =>
      async (formData: FormData) => {
        try {
          await action(formData);
          if (opts?.success !== null) toast(opts?.success ?? "Saved", "success");
        } catch (e) {
          unstable_rethrow(e); // let redirect()/notFound() do their thing
          toast(opts?.error ?? "Something went wrong", "error");
        }
      },
    [toast],
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Slide/fade a pill out, then drop it (instead of vanishing mid-read).
  const leave = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 260);
  }, []);

  const show = useCallback((message: string, type: ToastType = "success", action?: ToastAct) => {
    const id = Date.now() + Math.random();
    // A real result (success/error) also clears any lingering "loading" pill, so a slow save shows
    // "Saving…" and is replaced by the outcome — never two stacked or a stuck spinner.
    setToasts((t) => [...(type === "loading" ? t : t.filter((x) => x.type !== "loading")), { id, message, type, action }]);
    // Loading pills linger (a slow round-trip) with a generous failsafe; results auto-dismiss quickly —
    // one with an action (Undo) stays longer so there's time to tap it.
    setTimeout(() => leave(id), type === "loading" ? 12000 : action ? 6000 : 3200);
  }, [leave]);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {/* bottom-center on mobile, bottom-right on desktop; above the mobile nav */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end">
        {toasts.map((t) => (
          <ToastPill key={t.id} toast={t} onDone={() => leave(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastPill({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const loading = toast.type === "loading";
  const ok = toast.type === "success";
  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full bg-white py-2.5 pl-2.5 pr-4 text-sm font-medium shadow-lg ring-1 transition-all duration-300 sm:max-w-sm ${
        shown && !toast.leaving ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"
      } ${loading ? "text-slate-700 ring-slate-200" : ok ? "text-emerald-800 ring-emerald-200" : "text-red-800 ring-red-200"}`}
    >
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ${
          loading ? "bg-slate-400" : ok ? "bg-emerald-500 fo-check-pop" : "bg-red-500 fo-check-pop"
        }`}
        aria-hidden
      >
        {loading ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        ) : ok ? (
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
      {toast.action && (
        <button
          type="button"
          onClick={() => { toast.action!.onClick(); onDone(); }}
          className="ml-1 shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
