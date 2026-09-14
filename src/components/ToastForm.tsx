"use client";

import { useToastAction } from "@/components/Toast";

// A plain server-action <form> that toasts its result — drop-in replacement for
// `<form action={serverAction}>` when you want success/error feedback and no confirm dialog.
// Pass successMessage={null} to stay silent on success (e.g. pure toggles that are obvious).
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
  return (
    <form action={withToast(action, { success: successMessage, error: errorMessage })} className={className} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
