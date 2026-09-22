import { describe, it, expect } from "vitest";
import { evalArithmetic, hasArithmeticOp } from "./calc";

describe("hasArithmeticOp", () => {
  it("detects operators between values", () => {
    expect(hasArithmeticOp("120+45")).toBe(true);
    expect(hasArithmeticOp("10 * 2")).toBe(true);
    expect(hasArithmeticOp("100÷4")).toBe(true);
    expect(hasArithmeticOp("50-10")).toBe(true);
  });
  it("ignores a plain number or a lone leading sign", () => {
    expect(hasArithmeticOp("120")).toBe(false);
    expect(hasArithmeticOp("-120")).toBe(false);
    expect(hasArithmeticOp("")).toBe(false);
  });
});

describe("evalArithmetic", () => {
  it("evaluates with precedence and parentheses", () => {
    expect(evalArithmetic("120+45")).toBe(165);
    expect(evalArithmetic("120+45*2")).toBe(210);
    expect(evalArithmetic("(120+45)*2")).toBe(330);
    expect(evalArithmetic("100-10-5")).toBe(85);
    expect(evalArithmetic("100/4")).toBe(25);
  });
  it("handles ×, ÷, decimals and unary sign", () => {
    expect(evalArithmetic("10×3")).toBe(30);
    expect(evalArithmetic("90÷4")).toBe(22.5);
    expect(evalArithmetic("19.99+0.01")).toBe(20);
    expect(evalArithmetic("-5+10")).toBe(5);
  });
  it("rounds to 2 decimals", () => {
    expect(evalArithmetic("10/3")).toBe(3.33);
  });
  it("returns null on malformed input or divide-by-zero", () => {
    expect(evalArithmetic("")).toBeNull();
    expect(evalArithmetic("12**3")).toBeNull();
    expect(evalArithmetic("abc")).toBeNull();
    expect(evalArithmetic("10/0")).toBeNull();
    expect(evalArithmetic("(1+2")).toBeNull();
    expect(evalArithmetic("1.2.3")).toBeNull();
    expect(evalArithmetic("5*")).toBeNull();
  });
});
