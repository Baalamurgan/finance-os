import { redirect } from "next/navigation";

// The Cards tab became the Finance section. Keep the old URL working.
export default function LegacyCC() {
  redirect("/personal/finance");
}
