"use client";

import { useToastAction } from "@/components/Toast";

// A server-action form that asks for confirmation before submitting, then toasts the result. Use for
// money/destructive actions (settle, close/delete loan, delete card, etc.). Pass `successMessage` to
// tailor the toast (defaults to "Done"); pass successMessage={null} to stay silent on success.
export function ConfirmForm({
  action,
  message,
  className,
  successMessage = "Done",
  children,
}: {
  action: (formData: FormData) => void;
  message: string;
  className?: string;
  successMessage?: string | null;
  children: React.ReactNode;
}) {
  const withToast = useToastAction();
  return (
    <form
      action={withToast(action, { success: successMessage })}
      className={className}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
