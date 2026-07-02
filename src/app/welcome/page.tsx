import Link from "next/link";
import { Nav } from "@/components/marketing/Nav";
import { Reveal } from "@/components/marketing/Reveal";
import {
  BrowserFrame,
  PhoneFrame,
  OverviewScreen,
  TransactionsScreen,
  DebtsScreen,
  IncomeScreen,
  EmptyStateScreen,
} from "@/components/marketing/Product";

export default function WelcomePage() {
  return (
    <main id="top" className="relative overflow-x-clip">
      <Nav />
      <Hero />
      <Empathy />
      <Simplicity />
      <Everything />
      <Screens />
      <Intention />
      <Trust />
      <FinalCTA />
      <Footer />
    </main>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative px-5 pb-16 pt-32 sm:px-8 sm:pb-24 sm:pt-40">
      {/* soft ambient wash */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-10%] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[#e8f0ea] opacity-70 blur-[120px]" />
        <div className="absolute right-[8%] top-[30%] h-[280px] w-[280px] rounded-full bg-[#f2ead9] opacity-60 blur-[110px]" />
      </div>

      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-[#57554e] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3f6152]" />
            For people who didn&apos;t want another finance app
          </span>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="font-display mt-6 text-[clamp(2.6rem,7vw,4.6rem)] leading-[1.02] tracking-tight text-[#1c1c1a]">
            A calmer way to
            <br className="hidden sm:block" /> manage your money.
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-[#57554e]">
            One quiet place for your income, spending, debts, and plans.
            No clutter. No pressure. Just a little more peace of mind.
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signin"
              className="w-full rounded-full bg-[#1c1c1a] px-7 py-3.5 text-[15px] font-medium text-white shadow-[0_10px_30px_-10px_rgba(28,28,26,0.5)] transition-transform hover:-translate-y-0.5 sm:w-auto"
            >
              Start free
            </Link>
            <a
              href="#screens"
              className="w-full rounded-full border border-black/10 bg-white/70 px-7 py-3.5 text-[15px] font-medium text-[#1c1c1a] backdrop-blur transition-colors hover:bg-white sm:w-auto"
            >
              See how it feels
            </a>
          </div>
        </Reveal>

        <Reveal delay={320}>
          <p className="mt-5 text-[13px] text-[#9b988f]">
            Free to start · No ads · Nothing to cancel
          </p>
        </Reveal>
      </div>

      {/* hero product mockup with floating elements */}
      <Reveal delay={200} y={28}>
        <div className="relative mx-auto mt-16 max-w-4xl">
          <BrowserFrame>
            <div className="grid grid-cols-1 gap-0 sm:grid-cols-[1.15fr_1fr]">
              <div className="border-b border-black/5 sm:border-b-0 sm:border-r">
                <OverviewScreen />
              </div>
              <div className="hidden sm:block">
                <TransactionsScreen />
              </div>
            </div>
          </BrowserFrame>

          {/* floating chips */}
          <div className="animate-float-slow absolute -left-3 top-16 hidden rounded-2xl border border-black/5 bg-white/90 px-4 py-3 shadow-xl backdrop-blur sm:block">
            <div className="text-[11px] text-[#9b988f]">This month</div>
            <div className="text-[15px] font-semibold text-[#3f6152]">You&apos;re ahead ₹21k</div>
          </div>
          <div className="animate-float-slower absolute -right-4 bottom-12 hidden rounded-2xl border border-black/5 bg-white/90 px-4 py-3 shadow-xl backdrop-blur sm:block">
            <div className="text-[11px] text-[#9b988f]">Settled</div>
            <div className="text-[15px] font-semibold text-[#1c1c1a]">All caught up ✓</div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ── Empathy / the objection ─────────────────────────────────────────────── */

const DOUBTS = [
  "I already have enough apps.",
  "Finance apps are complicated.",
  "I'll stop using it in two days.",
  "Another subscription?",
  "It'll track everything and overwhelm me.",
];

function Empathy() {
  return (
    <section id="why" className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#9b988f]">
            We know the feeling
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="font-display mt-4 text-[clamp(2rem,5vw,3.1rem)] leading-tight text-[#1c1c1a]">
            You weren&apos;t looking
            <br /> for another app.
          </h2>
        </Reveal>

        <div className="mt-10 flex flex-wrap justify-center gap-2.5">
          {DOUBTS.map((d, i) => (
            <Reveal key={d} delay={i * 70}>
              <span className="rounded-full border border-black/5 bg-white px-4 py-2 text-[14px] text-[#6b6960] shadow-sm">
                “{d}”
              </span>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <p className="mx-auto mt-12 max-w-xl text-[18px] leading-relaxed text-[#57554e]">
            We felt the same way. So we built the opposite of what you&apos;re picturing —
            something you can open, understand in seconds, and close feeling lighter.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Simplicity statement ────────────────────────────────────────────────── */

function Simplicity() {
  return (
    <section id="calm" className="px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl rounded-[2rem] bg-[#3f6152] px-6 py-20 text-center sm:px-16">
        <Reveal>
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#a9c3b6]">
            Our one belief
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="font-display mt-5 text-[clamp(2rem,5.5vw,3.4rem)] leading-tight text-white">
            Simplicity is the feature.
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-[#d6e3dc]">
            Every screen is calm on purpose. Nothing to learn. Nothing shouting for
            your attention. Technology should lower your stress, not add to it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Everything in one place ─────────────────────────────────────────────── */

const CAPABILITIES: { title: string; body: string; icon: React.ReactNode }[] = [
  { title: "Expenses", body: "Log a spend in a tap. See where it went, without the guilt trip.", icon: <IconMinus /> },
  { title: "Income", body: "Salaries, rent, the occasional extra — all counted, quietly.", icon: <IconPlus /> },
  { title: "Debts", body: "What you owe, at a glance. No dread, just the number.", icon: <IconScale /> },
  { title: "Loans", body: "Track each loan and watch the balance shrink over time.", icon: <IconTrend /> },
  { title: "Borrowed", body: "Remember who lent you what — and when it's due.", icon: <IconIn /> },
  { title: "Lending", body: "The money you're owed, gently kept track of for you.", icon: <IconOut /> },
  { title: "Monthly planning", body: "A simple plan for the month. Adjust it in seconds.", icon: <IconCalendar /> },
];

function Everything() {
  return (
    <section id="everything" className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <Reveal>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#9b988f]">
              One place, not seven
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="font-display mt-4 text-[clamp(2rem,5vw,3.1rem)] leading-tight text-[#1c1c1a]">
              Everything your money does, together.
            </h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-[#57554e]">
              Instead of juggling apps and half-filled spreadsheets, keep it all in one
              calm ecosystem that actually fits how a household works.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={(i % 3) * 80}>
              <div className="group h-full rounded-2xl border border-black/5 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e8f0ea] text-[#3f6152] transition-colors group-hover:bg-[#3f6152] group-hover:text-white">
                  {c.icon}
                </span>
                <h3 className="mt-5 text-[17px] font-semibold text-[#1c1c1a]">{c.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#77746b]">{c.body}</p>
              </div>
            </Reveal>
          ))}
          <Reveal delay={160}>
            <div className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-[#3f6152]/30 bg-[#f3f7f4] p-6">
              <p className="font-display text-[19px] leading-snug text-[#2c4a3d]">
                And nothing you don&apos;t need.
              </p>
              <p className="mt-2 text-[14px] text-[#5c7a6c]">
                No charts you&apos;ll never read. No upsells. No noise.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Screens showcase ────────────────────────────────────────────────────── */

function Screens() {
  return (
    <section id="screens" className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <Reveal>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#9b988f]">
              A quiet look inside
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="font-display mt-4 text-[clamp(2rem,5vw,3.1rem)] leading-tight text-[#1c1c1a]">
              Every screen feels like a deep breath.
            </h2>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal y={26}>
            <BrowserFrame>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                <div className="border-r border-black/5">
                  <OverviewScreen />
                </div>
                <IncomeScreen />
              </div>
            </BrowserFrame>
          </Reveal>

          <div className="flex items-center justify-center gap-5">
            <Reveal delay={80} y={26}>
              <PhoneFrame className="rotate-[-3deg]">
                <TransactionsScreen />
              </PhoneFrame>
            </Reveal>
            <Reveal delay={160} y={26}>
              <PhoneFrame className="mt-10 rotate-[3deg]">
                <DebtsScreen />
              </PhoneFrame>
            </Reveal>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Reveal y={22}>
            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
              <EmptyStateScreen />
            </div>
          </Reveal>
          <Reveal delay={100} y={22}>
            <div className="flex h-full flex-col justify-center rounded-2xl bg-[#f2ead9]/60 p-8">
              <h3 className="font-display text-[22px] text-[#5b4a2f]">Even empty is calming.</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[#7a6a4d]">
                Most apps greet you with red numbers and things to fix. Here, an empty
                screen simply means there&apos;s nothing to worry about — and it says so.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Intention (feature narrative) ───────────────────────────────────────── */

const PRINCIPLES = [
  {
    k: "Calm by default",
    t: "Designed to lower your heart rate.",
    b: "Soft colors, generous space, gentle language. Opening the app feels like tidying a drawer, not doing taxes.",
  },
  {
    k: "Only what helps",
    t: "Every feature earns its place.",
    b: "If something doesn't genuinely reduce your mental load, it doesn't ship. That's why there's so little — and it's the point.",
  },
  {
    k: "Made for real life",
    t: "Money is rarely just yours.",
    b: "Shared expenses, pooled income, who-owes-whom — handled quietly, so a whole household can stay on the same page.",
  },
];

function Intention() {
  return (
    <section className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <p className="text-center text-[13px] font-medium uppercase tracking-[0.14em] text-[#9b988f]">
            Technology, with restraint
          </p>
        </Reveal>
        <div className="mt-14 space-y-14">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.k} delay={i * 60}>
              <div className="grid grid-cols-1 gap-4 border-t border-black/5 pt-10 sm:grid-cols-[0.9fr_1.1fr] sm:gap-10">
                <div>
                  <span className="text-[13px] font-medium text-[#3f6152]">{p.k}</span>
                  <h3 className="font-display mt-2 text-[clamp(1.5rem,3.5vw,2.1rem)] leading-tight text-[#1c1c1a]">
                    {p.t}
                  </h3>
                </div>
                <p className="self-center text-[16px] leading-relaxed text-[#57554e]">{p.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Trust ───────────────────────────────────────────────────────────────── */

const PROMISES = [
  ["No ads, ever", "Your attention isn't for sale. Nothing here is trying to hijack it."],
  ["No upsells", "One honest product. We won't nudge you toward a plan you don't need."],
  ["Your data stays yours", "Private by default. It's your household's money — nobody else's business."],
  ["Leave anytime", "Nothing to cancel, no guilt. Export and walk away whenever you like."],
];

function Trust() {
  return (
    <section className="px-5 py-20 sm:px-8">
      <div className="mx-auto max-w-5xl rounded-[2rem] border border-black/5 bg-white p-8 shadow-sm sm:p-14">
        <Reveal>
          <h2 className="font-display text-center text-[clamp(1.8rem,4.5vw,2.7rem)] leading-tight text-[#1c1c1a]">
            The quiet promises we keep.
          </h2>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
          {PROMISES.map(([t, b], i) => (
            <Reveal key={t} delay={(i % 2) * 80}>
              <div className="flex gap-4">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e8f0ea] text-[#3f6152]">
                  <IconCheck />
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold text-[#1c1c1a]">{t}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#77746b]">{b}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative px-5 py-28 sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[360px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e8f0ea] opacity-70 blur-[120px]" />
      </div>
      <div className="mx-auto max-w-2xl text-center">
        <Reveal>
          <h2 className="font-display text-[clamp(2.2rem,6vw,3.8rem)] leading-[1.05] text-[#1c1c1a]">
            Feel a little calmer
            <br /> about money.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-[#57554e]">
            Give it two minutes. If it doesn&apos;t feel lighter than what you use now,
            just close the tab. No harm done.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="mt-9">
            <Link
              href="/signin"
              className="inline-block rounded-full bg-[#1c1c1a] px-8 py-4 text-[15px] font-medium text-white shadow-[0_14px_36px_-12px_rgba(28,28,26,0.55)] transition-transform hover:-translate-y-0.5"
            >
              Start free — it&apos;s quiet in here
            </Link>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <p className="mt-5 text-[13px] text-[#9b988f]">Free to start · No ads · Nothing to cancel</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-black/5 px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#3f6152] text-[11px] font-semibold text-white">
            ₹
          </span>
          <span className="font-display text-[15px] text-[#1c1c1a]">Ledger</span>
        </div>
        <p className="text-[13px] text-[#9b988f]">Built with intention, for a calmer relationship with money.</p>
        <Link href="/signin" className="text-[13px] font-medium text-[#57554e] hover:text-[#1c1c1a]">
          Sign in →
        </Link>
      </div>
    </footer>
  );
}

/* ── Icons (minimal, stroked) ────────────────────────────────────────────── */

function IconPlus() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
function IconMinus() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
function IconScale() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v16M6 8h12M6 8l-3 6a3 3 0 0 0 6 0L6 8Zm12 0-3 6a3 3 0 0 0 6 0l-3-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconTrend() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 16l5-5 3 3 7-7M20 8h-4M20 8v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconIn() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconOut() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 20V10m0 0 4 4m-4-4-4 4M5 5h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconCalendar() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="4" y="5" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M4 9h16M9 3v4M15 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}
function IconCheck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
