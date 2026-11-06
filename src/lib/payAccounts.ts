// Who may pick an account as a family spend's "Paid with". A CARD (credit/debit/prepaid) can be used by
// anyone in the family (e.g. a member pays on another's card — it's attributed to the card's owner). A
// BANK / CASH / other balance account is private: only its owner can pay from it, and no one else even
// sees it in the picker. `keepId` = the account a spend already has, so editing someone else's spend never
// silently drops it to cash.
export const CARD_TYPES = ["credit_card", "debit_card", "prepaid_card"] as const;
export const isCardType = (type: string) => (CARD_TYPES as readonly string[]).includes(type);
export function canPayFrom(acct: { type: string; ownerId: number }, viewerId: number | null | undefined, keepId?: number | null, acctId?: number): boolean {
  if (isCardType(acct.type)) return true;
  if (keepId != null && acctId === keepId) return true;
  return viewerId != null && acct.ownerId === viewerId;
}
