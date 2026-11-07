"use client";

import { useState } from "react";

// A "Someone else" name box that suggests people you've split / lent with before. Suggestions show as tap
// chips right under the box (in the flow, so a scrolling modal never clips them) while it's focused,
// filtered by what's typed. Works controlled (value + onChange) or as a plain form field (name + defaultValue).
export function NameInput({
  pastNames, value, onChange, name, defaultValue, placeholder = "Name", required, autoFocus, className = "input w-full",
}: {
  pastNames: string[];
  value?: string;
  onChange?: (v: string) => void;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const [focused, setFocused] = useState(false);
  const v = value ?? inner;
  const set = (s: string) => {
    if (value === undefined) setInner(s);
    onChange?.(s);
  };
  const q = v.trim().toLowerCase();
  const matches = pastNames
    .filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    .slice(0, 8);
  return (
    <div>
      <input
        name={name}
        value={v}
        onChange={(e) => set(e.target.value)}
        onFocus={() => setFocused(true)}
        // let a chip tap land before the list hides
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        className={className}
      />
      {focused && matches.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {matches.map((n) => (
            <button
              key={n}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { set(n); setFocused(false); }}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
            >
              👤 {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
