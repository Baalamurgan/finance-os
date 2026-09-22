// Item → category intelligence for family spend entry. Pure & dependency-free so it
// runs on both client and server. It fixes the common miscategorisation where staples
// (milk/maavu/coconut/ration/petrol) get dumped into "Personal/Misc". Every suggestion
// is SOFT — the UI always lets the user keep their choice, because the same item can
// legitimately be Misc (e.g. petrol bought for someone else). Categories are referenced
// by NAME here and resolved to ids at the edge (ids differ per DB / reseed).
//
// The Add-Spend quick chips are now head-curated (SpendShortcut) rather than hardcoded;
// this module keeps only the seed keyword knowledge that powers the on-save suggestion.

/** Seed word → category map that powers the "did you mean {Category}?" nudge. Per the
 *  household's own rules: milk & maavu (flour) live with veg/fruits; rice/dal/oil/etc are
 *  Provision. Keywords must NOT overlap across categories (a word maps to one place). */
export const SEED_KEYWORDS: { category: string; keywords: string[] }[] = [
  {
    category: "Veg & Fruits",
    keywords: [
      "milk", "paal", "maavu", "flour", "atta", "coconut", "thengai", "tomato", "thakkali",
      "onion", "vengayam", "greens", "keerai", "vegetable", "vegetables", "veg", "veggies",
      "fruit", "fruits", "banana", "apple", "carrot", "potato", "urulai", "beans", "brinjal",
      "kathrikai", "curry leaves", "coriander", "kothamalli", "chilli", "milagai", "lemon",
    ],
  },
  {
    category: "Provision",
    keywords: [
      "ration", "provision", "provisions", "rice", "arisi", "dal", "paruppu", "oil", "ennai",
      "sugar", "sakkarai", "salt", "uppu", "masala", "grocery", "groceries", "sooji", "rava",
      "tea", "coffee", "biscuit", "soap", "detergent", "toothpaste",
    ],
  },
  {
    category: "Non-Veg",
    keywords: ["chicken", "kozhi", "mutton", "fish", "meen", "egg", "muttai", "prawn", "beef", "meat"],
  },
  {
    category: "Petrol",
    keywords: ["petrol", "diesel", "fuel", "bunk"],
  },
];

export type LearnedKeyword = { keyword: string; category: string; hits: number };

/** Lowercase, strip punctuation/diacritics, collapse whitespace. */
export function normalizeItem(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Seed rows carry a high baseline weight so a one-off wrong learn can't outrank them,
// but a repeatedly-confirmed learned word (hits) eventually can.
const SEED_HITS = 1000;
const seedRows: LearnedKeyword[] = SEED_KEYWORDS.flatMap((m) =>
  m.keywords.map((k) => ({ keyword: normalizeItem(k), category: m.category, hits: SEED_HITS })),
);

/**
 * Best-guess category NAME for a typed item, or null if nothing matches. Single-word
 * keywords match on a whole word (so "veg" doesn't fire inside "beverage"); multi-word
 * keywords match as a phrase. `learned` rows (from the DB) are merged in and can win
 * when their hit-count is high enough. More-specific (longer) keywords break ties.
 */
export function suggestCategoryName(label: string, learned: LearnedKeyword[] = []): string | null {
  const norm = normalizeItem(label);
  if (!norm) return null;
  const tokens = new Set(norm.split(" "));
  const rows = [...seedRows, ...learned.map((l) => ({ ...l, keyword: normalizeItem(l.keyword) }))];

  let best: { category: string; score: number } | null = null;
  for (const r of rows) {
    if (!r.keyword) continue;
    const matched = r.keyword.includes(" ") ? norm.includes(r.keyword) : tokens.has(r.keyword);
    if (!matched) continue;
    const score = r.hits + r.keyword.length; // weight by confidence, then specificity
    if (!best || score > best.score) best = { category: r.category, score };
  }
  return best?.category ?? null;
}

/**
 * Resolve a suggested category NAME (from the seed / a learned word) to a real category id.
 * Categories are renamable, so an exact-string match is fragile — e.g. a household renamed
 * "Veg & Fruits" to "Veg & Fruits & Milk & Maavu". So after an exact (normalized) match we
 * fall back to a category whose name CONTAINS every token of the suggested name. Returns null
 * if nothing plausibly matches (the suggestion is then dropped rather than mis-filed).
 */
export function resolveCategoryId(name: string | null, categories: { id: number; name: string }[]): number | null {
  if (!name) return null;
  const target = normalizeItem(name);
  if (!target) return null;
  for (const c of categories) if (normalizeItem(c.name) === target) return c.id; // exact
  const tokens = target.split(" ").filter(Boolean);
  for (const c of categories) {
    const cset = new Set(normalizeItem(c.name).split(" "));
    if (tokens.length > 0 && tokens.every((t) => cset.has(t))) return c.id; // renamed/expanded
  }
  return null;
}

// ── Item → "kind of spend" (misc sub-category / personal category) ────────────────────
// Maps a typed item to one of the shared CATEGORY_KINDS names (see @/lib/misc). Powers the
// auto-fill of the "Kind of spend" field on the family Misc modal and the category on the
// personal spend modal. Hardcoded seed knowledge from the household's real spending; every
// fill is SOFT (the user can always change it). Keywords must be whole-word (single) or a
// phrase (multi-word), and must not overlap across kinds. Names MUST match CATEGORY_KINDS.
const SPEND_KIND_KEYWORDS: { kind: string; keywords: string[] }[] = [
  { kind: "Food & Dining", keywords: ["restaurant", "hotel", "swiggy", "zomato", "dinner", "lunch", "breakfast", "snacks", "biryani", "biriyani", "meals", "food", "cafe", "pizza", "burger", "dosa", "idli", "parotta", "juice", "bakery", "sweets", "sweet", "tiffin", "eat", "eatery", "kfc", "dominos", "chaat", "shawarma", "samosa", "vadacurry", "vada", "vadai", "cooz", "idiyappam", "chapati", "chapathi", "chappathi", "chappathis", "chapatis", "bonda", "bondas", "sundal", "puff", "appam", "poori", "puri", "pongal", "upma", "bajji", "murukku", "mixture", "kheer", "payasam", "halwa", "sambar", "rasam", "banana chips", "soup"] },
  { kind: "Groceries", keywords: ["grocery", "groceries", "provision", "provisions", "ration", "rice", "arisi", "dal", "paruppu", "oil", "ennai", "sugar", "sakkarai", "salt", "uppu", "milk", "paal", "vegetables", "vegetable", "veg", "veggies", "fruits", "fruit", "atta", "flour", "maavu", "onion", "vengayam", "tomato", "thakkali", "masala", "biscuit", "egg", "muttai", "coconut", "thengai", "greens", "keerai"] },
  { kind: "Shopping", keywords: ["dress", "shirt", "tshirt", "clothes", "saree", "shoes", "chappal", "amazon", "flipkart", "myntra", "shopping", "electronics", "gadget", "headphone", "charger", "watch", "bag", "slippers", "mattress", "phone case", "nail cutter", "battery", "thread", "jacket", "jackets", "mat", "cover"] },
  { kind: "Bills & Utilities", keywords: ["eb", "electricity", "current bill", "water bill", "gas", "cylinder", "recharge", "wifi", "broadband", "internet", "dth", "cable", "postpaid", "prepaid", "property tax", "house tax", "carpenter", "plumber", "electrician", "labour"] },
  { kind: "Rent", keywords: ["rent", "vaadagai"] },
  { kind: "Transport & Fuel", keywords: ["petrol", "diesel", "fuel", "bunk", "bus", "train", "auto", "cab", "uber", "ola", "metro", "parking", "toll", "fare", "rapido", "share auto"] },
  { kind: "Entertainment", keywords: ["movie", "cinema", "netflix", "spotify", "hotstar", "prime", "game", "ott"] },
  { kind: "Travel", keywords: ["flight", "trip", "tour", "holiday", "resort", "stay", "booking", "irctc", "vacation"] },
  { kind: "Health", keywords: ["medical", "medicine", "tablet", "tablets", "hospital", "doctor", "pharmacy", "clinic", "health", "scan", "lab", "apollo", "mediplus"] },
  { kind: "Education", keywords: ["school", "college", "fees", "fee", "tuition", "book", "books", "course", "exam", "class", "stationery", "marker", "pen", "pencil", "notebook", "chart paper"] },
  { kind: "Personal Care", keywords: ["salon", "haircut", "parlour", "parlor", "cosmetics", "cosmetic", "grooming", "spa", "beauty"] },
  { kind: "Gifts & Donations", keywords: ["gift", "donation", "temple", "offering", "hundial", "kovil", "charity"] },
  { kind: "Transfers / Sent", keywords: ["sent", "transfer", "gpay", "phonepe", "upi"] },
  { kind: "EMI & Loans", keywords: ["emi", "loan", "interest", "kist"] },
  { kind: "Investments", keywords: ["sip", "mutual fund", "stock", "gold", "investment", "chit", "chitfund", "fd", "rd"] },
  { kind: "Pets", keywords: ["pet", "pets", "dog", "puppy", "cat", "kitten", "vet", "veterinary", "kennel", "pet food", "dog food", "cat food", "fish food", "aquarium"] },
  // Temple / ritual spends — the household tracks these apart from Gifts & Donations (their own "God &
  // Temple" tag, used ~9× in Jun–Aug). Deity/ceremony words route here; plain "gift"/"donation" stay Gifts.
  { kind: "God & Temple", keywords: ["temple", "koil", "kovil", "pooja", "puja", "pradhosham", "amavasa", "amavasya", "dakshinai", "dakshina", "jothidar", "homam", "abhishekam", "abisekam", "hundial", "nonbu", "nombu", "gopooja", "seemantham", "varalakshmi", "thithi", "deepam", "prasadam", "archanai", "kumkum", "vibhuti", "vinayagar", "perumal", "amman", "ayyappan"] },
];

const kindRows = SPEND_KIND_KEYWORDS.flatMap((m) => m.keywords.map((k) => ({ kind: m.kind, keyword: normalizeItem(k) })));

/** Best-guess "kind of spend" NAME (a CATEGORY_KINDS name) for a typed item, or null.
 *  Whole-word for single keywords, phrase-match for multi-word; longer keyword wins ties. */
export function suggestSpendKind(label: string): string | null {
  const norm = normalizeItem(label);
  if (!norm) return null;
  const tokens = new Set(norm.split(" "));
  let best: { kind: string; len: number } | null = null;
  for (const r of kindRows) {
    if (!r.keyword) continue;
    const matched = r.keyword.includes(" ") ? norm.includes(r.keyword) : tokens.has(r.keyword);
    if (!matched) continue;
    if (!best || r.keyword.length > best.len) best = { kind: r.kind, len: r.keyword.length };
  }
  return best?.kind ?? null;
}

/** Should this saved label be learned? Keep it to short, item-like labels to avoid
 *  learning noisy free-text ("2kg tomato for the function"). 1–3 words, not too long. */
export function isLearnable(label: string): string | null {
  const norm = normalizeItem(label);
  if (!norm) return null;
  const words = norm.split(" ");
  if (words.length > 3 || norm.length > 24) return null;
  return norm;
}

// ── "Be specific" validation for a spend note ──────────────────────────────────────────
// A note that merely restates the category ("veggies" under Veg & Fruits, "provision" under Provision,
// "Dhashni birthday" under Dhashni birthday) or is a bare umbrella/fuel word carries no information — the
// category already says that much. validateSpendLabel HARD-BLOCKS those so entries stay meaningful, while
// allowing any note with at least one concrete item ("milk", "idol", "cake", "petrol activa"). Pure &
// shared so the Add-Spend modal (instant) and the server action (authoritative) enforce the same rule.

// Words that add no meaning on their own.
const FILLER_WORDS = new Set([
  "items", "item", "stuff", "things", "thing", "group", "accessories", "accessory", "other", "others",
  "misc", "general", "expense", "expenses", "exp", "purchase", "purchases", "bought", "related", "and",
  "for", "of", "the", "a", "an", "some", "nos", "no", "pcs", "pieces", "pack", "packet",
]);
// Whole-CATEGORY words — they name a bucket, not an item. Grocery umbrellas AND the bare fuel words (a
// fuel note must say WHICH vehicle / add a detail, per the household's rule).
const UMBRELLA_WORDS = new Set([
  "veggies", "vegetable", "vegetables", "veg", "fruit", "fruits", "provision", "provisions", "grocery",
  "groceries", "ration", "petrol", "diesel", "fuel", "bunk", "gas",
]);
const FUEL_WORDS = ["petrol", "diesel", "fuel", "bunk"];

// A note word "is just the category name" when it equals a category-name token or shares a 4+ char prefix
// with one ("provisions"↔"provision", "krishnar"↔"krishna"). Short tokens (<3) are ignored to stay safe.
function echoesCategory(word: string, catTokens: string[]): boolean {
  for (const c of catTokens) {
    if (c.length < 3) continue;
    if (word === c) return true;
    let i = 0;
    while (i < word.length && i < c.length && word[i] === c[i]) i++;
    if (i >= 4) return true;
  }
  return false;
}

/**
 * Returns an error MESSAGE when the note is too generic to save (a bare restatement of the category, an
 * umbrella/fuel word, or only filler), else null. `categoryName` lets it treat category-echoing words as
 * meaningless. Empty note gets its own prompt.
 */
export function validateSpendLabel(label: string, categoryName = ""): string | null {
  const note = normalizeItem(label);
  if (!note) return "Add what you bought — e.g. milk, idol, cake.";
  const catTokens = normalizeItem(categoryName).split(" ").filter(Boolean);
  const words = note.split(" ").filter(Boolean);
  const hasItem = words.some(
    (w) => !FILLER_WORDS.has(w) && !UMBRELLA_WORDS.has(w) && !echoesCategory(w, catTokens),
  );
  if (hasItem) return null;
  if (words.some((w) => FUEL_WORDS.includes(w))) {
    return "Say which vehicle — e.g. “petrol — Activa”, not just “petrol”.";
  }
  return "Too generic — add what you actually bought (e.g. milk, idol, cake).";
}
