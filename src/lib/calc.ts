// Tiny, safe arithmetic evaluator for the amount field — lets a user type "120+45*2" and get a number.
// Supports + − × ÷ (and * /), decimals, unary sign, and parentheses. No eval / Function — a hand-written
// recursive-descent parser that returns null on anything malformed, so bad input never crashes a save.

// True when the trimmed string contains an operator BETWEEN values (a lone leading sign doesn't count),
// i.e. it looks like a calculation worth offering the "=" button for.
export function hasArithmeticOp(s: string): boolean {
  return /[+\-*/×÷]/.test(s.trim().replace(/^\s*[+-]/, ""));
}

export function evalArithmetic(input: string): number | null {
  const s = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!s || !/^[0-9+\-*/().]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  try {
    const parseFactor = (): number => {
      if (peek() === "(") { i++; const v = parseExpr(); if (peek() !== ")") throw new Error("paren"); i++; return v; }
      if (peek() === "+" || peek() === "-") { const op = s[i++]; const v = parseFactor(); return op === "-" ? -v : v; }
      let num = "";
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      if (num === "" || (num.match(/\./g)?.length ?? 0) > 1) throw new Error("num");
      const n = Number(num);
      if (Number.isNaN(n)) throw new Error("nan");
      return n;
    };
    const parseTerm = (): number => {
      let v = parseFactor();
      while (peek() === "*" || peek() === "/") {
        const op = s[i++]; const r = parseFactor();
        if (op === "/" && r === 0) throw new Error("div0");
        v = op === "*" ? v * r : v / r;
      }
      return v;
    };
    function parseExpr(): number {
      let v = parseTerm();
      while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = parseTerm(); v = op === "+" ? v + r : v - r; }
      return v;
    }
    const val = parseExpr();
    if (i !== s.length || !Number.isFinite(val)) return null;
    return Math.round(val * 100) / 100;
  } catch {
    return null;
  }
}
