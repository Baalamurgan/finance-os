"use client";

import { useId } from "react";
import { useToastAction } from "@/components/Toast";
import { reducedMotion } from "@/components/motion/live";

// A plain server-action <form> that toasts its result — drop-in replacement for
// `<form action={serverAction}>` when you want success/error feedback and no confirm dialog.
// Pass successMessage={null} to stay silent on success (e.g. pure toggles that are obvious).
// The button you pressed shows a spinner while it saves, then a ✓ for a moment (see [data-fo-busy] /
// [data-fo-done] in globals.css) — so a tap visibly "took".
export function ToastForm({
  action,
  className,
  successMessage = "Saved",
  errorMessage,
  onSubmit,
  children,
}: {
  action: (formData: FormData) => void;
  className?: string;
  successMessage?: string | null;
  errorMessage?: string;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const withToast = useToastAction();
  const id = useId(); // finds this form's pressed button again when the save finishes
  const pressed = () => document.querySelector<HTMLElement>(`form[data-fo-form="${CSS.escape(id)}"] [data-fo-busy]`);
  const clear = () => pressed()?.removeAttribute("data-fo-busy");
  const done = () => {
    const b = pressed();
    if (!b) return;
    b.removeAttribute("data-fo-busy");
    b.setAttribute("data-fo-done", "");
    window.setTimeout(() => b.removeAttribute("data-fo-done"), 700);
  };

  return (
    <form
      action={withToast(action, { success: successMessage, error: errorMessage, onSuccess: done, onError: clear })}
      className={className}
      data-fo-form={id}
      onSubmit={(e) => {
        onSubmit?.(e);
        if (e.defaultPrevented || reducedMotion()) return;
        const b = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        if (!b) return;
        b.style.setProperty("--fo-c", getComputedStyle(b).color); // spinner / ✓ in the button's own text colour
        b.setAttribute("data-fo-busy", "");
        window.setTimeout(() => b.removeAttribute("data-fo-busy"), 10000); // never stuck (e.g. the action redirected)
      }}
    >
      {children}
    </form>
  );
}
