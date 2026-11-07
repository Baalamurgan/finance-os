"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";

// A modal that saves through a server action: the moment it starts saving it HIDES (the caller adds
// `hidden` while `saving`) and this shows a "Saving…" pill. The action's own success/error toast replaces it
// (Toast clears "loading" on any result). On success the modal closes as before; on an error it reappears
// with what you typed. The server's re-render can take a few seconds on prod (cold start + many reads), so
// this keeps the UI from looking frozen on a disabled Save.
export function useSavingToast(saving: boolean, label = "Saving…") {
  const toast = useToast();
  const was = useRef(false);
  useEffect(() => {
    if (saving && !was.current) toast(label, "loading");
    was.current = saving;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
}
