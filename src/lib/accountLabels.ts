// How a family "Paid with" account is named and grouped in the picker. Bank accounts are UPI-capable, so they
// read "Bank / UPI"; cash, debit/prepaid cards and credit cards each get their own group.
export const PAY_GROUPS: { key: string; label: string; icon: string; types: string[] }[] = [
  { key: "bank", label: "Bank / UPI", icon: "🏦", types: ["bank"] },
  { key: "cash", label: "Cash", icon: "💵", types: ["cash"] },
  { key: "debit", label: "Debit & prepaid cards", icon: "💳", types: ["debit_card", "prepaid_card"] },
  { key: "credit", label: "Credit cards (settles at the bill)", icon: "💳", types: ["credit_card"] },
];

export function payTypeLabel(type: string): string {
  return type === "bank" ? "bank · UPI" : type === "cash" ? "cash" : type === "credit_card" ? "credit" : type === "prepaid_card" ? "prepaid" : "debit";
}
export function payTypeIcon(type: string): string {
  return type === "bank" ? "🏦" : type === "cash" ? "💵" : "💳";
}
