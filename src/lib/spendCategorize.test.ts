import { describe, expect, it } from "vitest";
import { suggestCategoryName, isLearnable, normalizeItem } from "./spendCategorize";

describe("suggestCategoryName", () => {
  it("maps the household's staples to the right category", () => {
    expect(suggestCategoryName("Milk")).toBe("Veg & Fruits");
    expect(suggestCategoryName("paal")).toBe("Veg & Fruits");
    expect(suggestCategoryName("Maavu")).toBe("Veg & Fruits");
    expect(suggestCategoryName("Coconut")).toBe("Veg & Fruits");
    expect(suggestCategoryName("tomato")).toBe("Veg & Fruits");
    expect(suggestCategoryName("Ration")).toBe("Provision");
    expect(suggestCategoryName("rice")).toBe("Provision");
    expect(suggestCategoryName("Chicken")).toBe("Non-Veg");
    expect(suggestCategoryName("Petrol")).toBe("Petrol");
    expect(suggestCategoryName("diesel")).toBe("Petrol");
  });

  it("matches a keyword inside a longer label", () => {
    expect(suggestCategoryName("2 packets milk")).toBe("Veg & Fruits");
    expect(suggestCategoryName("petrol for the car")).toBe("Petrol");
  });

  it("does not fire on unrelated words (whole-word match)", () => {
    expect(suggestCategoryName("beverage")).toBeNull(); // must not match 'veg'
    expect(suggestCategoryName("gift for amma")).toBeNull();
    expect(suggestCategoryName("")).toBeNull();
  });

  it("lets a strongly-learned word win", () => {
    // "podi" isn't seeded — learn it to Provision with enough hits
    const learned = [{ keyword: "podi", category: "Provision", hits: 5 }];
    expect(suggestCategoryName("podi")).toBeNull();
    expect(suggestCategoryName("podi", learned)).toBe("Provision");
  });

  it("a single learned hit cannot override a seed", () => {
    const learned = [{ keyword: "milk", category: "Non-Veg", hits: 1 }];
    expect(suggestCategoryName("milk", learned)).toBe("Veg & Fruits");
  });
});

describe("isLearnable", () => {
  it("accepts short item-like labels", () => {
    expect(isLearnable("Amul Milk")).toBe("amul milk");
    expect(isLearnable("Ration")).toBe("ration");
  });
  it("rejects long free-text", () => {
    expect(isLearnable("2kg tomato and onion for the function")).toBeNull();
    expect(isLearnable("   ")).toBeNull();
  });
});

describe("normalizeItem", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeItem("  Veg & Fruits! ")).toBe("veg fruits");
  });
});
