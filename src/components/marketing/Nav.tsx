"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { label: "Why", href: "#why" },
  { label: "Everything", href: "#everything" },
  { label: "Screens", href: "#screens" },
  { label: "Calm", href: "#calm" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-black/5 bg-[#faf9f6]/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="#top" className="flex items-center gap-2" aria-label="Home">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#3f6152] text-[13px] font-semibold text-white">
            ₹
          </span>
          <span className="font-display text-[17px] text-[#1c1c1a]">Ledger</span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[14px] text-[#57554e] transition-colors hover:text-[#1c1c1a]">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/signin"
            className="hidden rounded-full px-4 py-2 text-[14px] font-medium text-[#57554e] transition-colors hover:text-[#1c1c1a] sm:inline-block"
          >
            Sign in
          </Link>
          <Link
            href="/signin"
            className="rounded-full bg-[#1c1c1a] px-4 py-2 text-[14px] font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5"
          >
            Start free
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 grid h-9 w-9 place-items-center rounded-full text-[#1c1c1a] md:hidden"
            aria-label="Menu"
            aria-expanded={open}
          >
            <span className="text-lg leading-none">{open ? "×" : "≡"}</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-black/5 bg-[#faf9f6]/95 px-5 py-3 backdrop-blur-xl md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-[15px] text-[#57554e]"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}
