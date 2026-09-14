import { describe, expect, it } from "vitest";
import { addXp, canHost, passGate, previousRank, removeXp } from "../src/ranks.js";

describe("XP progression", () => {
  it("promotes PFC at 100 and resets XP", () => {
    expect(addXp("pfc", 95, 10)).toMatchObject({ rank: "lcpl", xp: 0, promoted: true, appliedDelta: 5 });
  });

  it("caps Corporal at 99 until NCO Training", () => {
    expect(addXp("cpl", 95, 10)).toMatchObject({ rank: "cpl", xp: 99, promoted: false, cappedByGate: "nco" });
  });

  it("requires 99 XP to pass a gate", () => {
    expect(() => passGate("cpl", 98, "nco")).toThrow("99 XP");
    expect(passGate("cpl", 99, "nco")).toMatchObject({ rank: "sgt", xp: 0, promoted: true });
  });

  it("does not demote when XP is removed", () => {
    expect(removeXp("sgt", 3, 10)).toMatchObject({ rank: "sgt", xp: 0, promoted: false });
  });

  it("rejects XP for tutorial and officer ranks", () => {
    expect(() => addXp("bmt", 0, 5)).toThrow("tutorial");
    expect(() => addXp("2lt", 0, 5)).toThrow("hosted event counts");
  });

  it("resolves the previous managed rank for demotions", () => {
    expect(previousRank("pfc")).toBe("bmt");
    expect(previousRank("2lt")).toBe("gysgt");
    expect(previousRank("defacto")).toBe("secgen");
    expect(previousRank("bmt")).toBeNull();
  });
});

describe("event hosting permissions", () => {
  it("allows 2nd Lieutenant basic field events", () => {
    expect(canHost("2lt", "Patrol")).toBe(true);
    expect(canHost("2lt", "Combat Training")).toBe(true);
    expect(canHost("2lt", "Platoon Formation")).toBe(true);
    expect(canHost("2lt", "NCO Training")).toBe(false);
  });

  it("allows 1st Lieutenant and above to host NCO Training", () => {
    expect(canHost("1lt", "NCO Training")).toBe(true);
    expect(canHost("capt", "NCO Training")).toBe(true);
  });

  it("allows only Major and above to host Officer Training and Inspections", () => {
    expect(canHost("capt", "Officer Training")).toBe(false);
    expect(canHost("maj", "Officer Training")).toBe(true);
    expect(canHost("maj", "Inspection")).toBe(true);
  });

  it("allows Secretary General and De-Facto Leader to host every event", () => {
    expect(canHost("secgen", "Officer Training")).toBe(true);
    expect(canHost("secgen", "Inspection")).toBe(true);
    expect(canHost("defacto", "Officer Training")).toBe(true);
    expect(canHost("defacto", "NCO Training")).toBe(true);
  });
});
