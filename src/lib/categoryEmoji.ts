// Leading emoji shown before a category on the Sheet. Keyed by category name
// (case-insensitive, trimmed). Unknown categories simply render without an emoji.
const CATEGORY_EMOJI: Record<string, string> = {
  // Monthly
  "eb": "⚡️",
  "wifi": "🛜",
  "lpg gas": "⛽️",
  "petrol": "🏍️",
  "mobile recharge": "📱",
  "provision": "🛒",
  "veg & fruits & milk & maavu": "🥬",
  "non-veg": "🍗",
  "household": "🧹",
  "cook (servant)": "🧑‍🍳",
  "transport": "🚌",
  "youtube premium": "▶️",
  "you tube charges": "▶️",
  "god": "🪔",
  "activa bike insurance": "🛵",
  "r15 bike insurance": "🛡️",
  "arumugam health insurance (star health)": "🩺",
  "harish health insurance": "🩺",
  "vl & baala health insurance": "🩺",
  "family insurance amount for ka": "🛡️",
  "arni house property tax": "🏛️",
  "bfc property tax": "🏛️",
  "kanniyammal property tax": "🏛️",
  "harish expense": "👤",
  "vl expense": "👤",
  // Loans
  "loan": "🏠",
  "interest": "💸",
  // Chits
  "chit": "🎟️",
  // Misc
  "giving/religious": "🙏",
  "personal/misc": "🛍️",
};

export function categoryEmoji(name: string | null | undefined): string | null {
  if (!name) return null;
  return CATEGORY_EMOJI[name.trim().toLowerCase()] ?? null;
}
