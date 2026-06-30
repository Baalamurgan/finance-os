"use client";

// A server-action form that asks for confirmation before submitting. Use for
// money/destructive actions (settle, close/delete loan, etc.).
export function ConfirmForm({
  action,
  message,
  className,
  children,
}: {
  action: (formData: FormData) => void;
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
