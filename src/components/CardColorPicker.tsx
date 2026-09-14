"use client";

import { useState } from "react";

// Shared card-colour picker: a row of default swatches + a custom colour well, backed by a hidden
// input so it works inside plain server-action <form>s (personal add/edit, family add/edit).
export const CARD_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#111827"];

export function CardColorPicker({ name = "color", defaultValue }: { name?: string; defaultValue?: string | null }) {
  const [color, setColor] = useState(defaultValue || CARD_COLORS[0]);
  const isPreset = CARD_COLORS.includes(color);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {CARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          aria-label={`colour ${c}`}
          className={`h-7 w-7 rounded-full ring-2 ring-offset-2 transition ${color === c ? "ring-slate-700" : "ring-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
      {/* custom colour — the well shows the chosen custom colour; ring highlights when it's active */}
      <label
        title="Custom colour"
        className={`grid h-7 w-7 cursor-pointer place-items-center rounded-full ring-2 ring-offset-2 ${!isPreset ? "ring-slate-700" : "ring-transparent"}`}
        style={{ backgroundColor: isPreset ? "#fff" : color, border: isPreset ? "1px dashed #cbd5e1" : "none" }}
      >
        {isPreset && <span className="text-xs leading-none" aria-hidden>🎨</span>}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
      </label>
      <input type="hidden" name={name} value={color} />
    </div>
  );
}
