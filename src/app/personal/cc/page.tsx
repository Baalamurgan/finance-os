import { redirect } from "next/navigation";

// Old credit-card URL — cards (and bank/cash accounts) live under the Accounts tab now.
export default function LegacyCC() {
  redirect("/personal/cards"); // credit cards live under Accounts
}
