import { describe, expect, it } from "vitest";
import { suggestCategoryName, isLearnable, normalizeItem, resolveCategoryId, suggestSpendKind, validateSpendLabel } from "./spendCategorize";

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

describe("resolveCategoryId", () => {
  const cats = [
    { id: 1, name: "Provision" },
    { id: 2, name: "Veg & Fruits & Milk & Maavu" }, // renamed (expanded) category
    { id: 3, name: "Non-Veg" },
  ];
  it("matches exactly", () => {
    expect(resolveCategoryId("Provision", cats)).toBe(1);
    expect(resolveCategoryId("Non-Veg", cats)).toBe(3);
  });
  it("matches a renamed/expanded category by token containment (the real bug)", () => {
    // seed suggests "Veg & Fruits"; the household renamed the category
    expect(resolveCategoryId("Veg & Fruits", cats)).toBe(2);
  });
  it("returns null when nothing plausibly matches", () => {
    expect(resolveCategoryId("Petrol", cats)).toBeNull();
    expect(resolveCategoryId(null, cats)).toBeNull();
  });
});

describe("normalizeItem", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeItem("  Veg & Fruits! ")).toBe("veg fruits");
  });
});

describe("suggestSpendKind", () => {
  it("maps typed items to a CATEGORY_KINDS name", () => {
    expect(suggestSpendKind("Swiggy dinner")).toBe("Food & Dining");
    expect(suggestSpendKind("tomato")).toBe("Groceries");
    expect(suggestSpendKind("Petrol")).toBe("Transport & Fuel");
    expect(suggestSpendKind("EB bill")).toBe("Bills & Utilities");
    expect(suggestSpendKind("medicine")).toBe("Health");
    expect(suggestSpendKind("Netflix")).toBe("Entertainment");
  });
  it("matches whole words / phrases and returns null otherwise", () => {
    expect(suggestSpendKind("beverage")).toBeNull(); // 'veg' must not fire inside a word
    expect(suggestSpendKind("")).toBeNull();
    expect(suggestSpendKind("random gibberish xyz")).toBeNull();
  });
  it("routes the household's new kinds", () => {
    expect(suggestSpendKind("Cat food")).toBe("Pets");
    expect(suggestSpendKind("Pradhosham koil exp")).toBe("God & Temple");
    expect(suggestSpendKind("Arni house property tax")).toBe("Bills & Utilities");
    expect(suggestSpendKind("Idiyappam vadacurry")).toBe("Food & Dining");
  });
});

describe("validateSpendLabel", () => {
  it("blocks a bare restatement of the category", () => {
    expect(validateSpendLabel("provision", "Provision")).not.toBeNull();
    expect(validateSpendLabel("provision items", "Provision")).not.toBeNull();
    expect(validateSpendLabel("veggies", "Veg & Fruits")).not.toBeNull();
    expect(validateSpendLabel("vegetables", "Veg & Fruits")).not.toBeNull();
    expect(validateSpendLabel("fruits", "Veg & Fruits")).not.toBeNull();
    expect(validateSpendLabel("vinayagar chaturthi", "Vinayagar chaturthi")).not.toBeNull();
    expect(validateSpendLabel("vinayagar items", "Vinayagar chaturthi")).not.toBeNull();
    expect(validateSpendLabel("Krishnar & accessories", "Krishna jayanthi")).not.toBeNull();
    expect(validateSpendLabel("Dhashni birthday", "Dhashni birthday")).not.toBeNull();
    expect(validateSpendLabel("", "Provision")).not.toBeNull();
  });
  it("allows a note that names a concrete item", () => {
    expect(validateSpendLabel("milk", "Veg & Fruits")).toBeNull();
    expect(validateSpendLabel("paal", "Veg & Fruits")).toBeNull();
    expect(validateSpendLabel("maavu", "Veg & Fruits")).toBeNull();
    expect(validateSpendLabel("flour", "Veg & Fruits")).toBeNull();
    expect(validateSpendLabel("vinayagar idol", "Vinayagar chaturthi")).toBeNull();
    expect(validateSpendLabel("krishnar idol", "Krishna jayanthi")).toBeNull();
    expect(validateSpendLabel("doll", "Krishna jayanthi")).toBeNull();
    expect(validateSpendLabel("Dhashni birthday cake", "Dhashni birthday")).toBeNull();
    expect(validateSpendLabel("rice", "Provision")).toBeNull();
  });
  it("requires a vehicle/detail for fuel, not a bare fuel word", () => {
    expect(validateSpendLabel("petrol", "Petrol")).toMatch(/vehicle/i);
    expect(validateSpendLabel("diesel", "Petrol")).not.toBeNull();
    expect(validateSpendLabel("petrol Activa", "Petrol")).toBeNull();
    expect(validateSpendLabel("Brio diesel", "Petrol")).toBeNull();
  });
});
