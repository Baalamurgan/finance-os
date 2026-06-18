# Family Finance OS

A local-first web app that replaces the household's monthly Excel sheet
(`KA_MAR_26.xlsx`). v1 reproduces the **family monthly roll-up**: pooled income,
categorized + per-member-attributed expenses, planned-vs-actual budgets, and a
balance dashboard. Built to grow into settlement, loans/chits, personal mode, and
multi-user later (see `../../.claude/plans/`).

## Stack
- Next.js 16 (App Router) + TypeScript, Tailwind v4
- Prisma 7 + SQLite (via the `better-sqlite3` driver adapter)
- Recharts for charts

## Setup
```bash
npm install
npm run db:migrate     # create the SQLite schema (dev.db)
npm run db:seed        # load the MAR 2026 family data
npm run dev            # http://localhost:3000
```

## What's in v1
- Period switcher (multi-month history)
- Summary cards: total income / expense / balance
- Charts: spend by category (planned vs actual), necessary-vs-other, by-member
- Planned-vs-actual category table with variance
- Quick entry for income & expenses (category + member attribution + necessary/other)
- Inline delete of entries

## Reconciliation
The seed reconstructs the March sheet exactly:
**income ₹3,45,102 · expense ₹1,74,451 · balance ₹1,70,651.**

> Note: the sheet counts Veg/Non-Veg/Provision at their **allocated** amounts
> (₹5,000 / ₹3,000 / ₹5,000), not the Split-Up actuals (₹2,105 / ₹220 / ₹2,867).
> v1 matches the sheet; whether totals should use allocations or actuals is a
> decision for v1.1.

## Roadmap (next)
1. Settlement engine — "who owes whom" netting
2. Loans / chits / interest tracking, carry-forward, Piggy savings
3. Personal mode (designed from scratch, same engine)
4. AI categorization agent + WhatsApp capture; multi-user hosting
