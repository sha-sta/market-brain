import { describe, it, expect } from "vitest";
import { normalizeStrength, enforceFloor, isStrength, STRENGTH_LABELS } from "@/server/critic/calibration";

describe("normalizeStrength — clamp to the controlled vocab", () => {
  it("passes a valid label (case/space/underscore-insensitive)", () => {
    expect(normalizeStrength("Well Supported")).toBe("well-supported");
    expect(normalizeStrength("CONTESTED")).toBe("contested");
    expect(normalizeStrength("well_supported")).toBe("well-supported");
  });
  it("maps anything unrecognized to 'weak' (never inflate)", () => {
    expect(normalizeStrength("strong-buy")).toBe("weak");
    expect(normalizeStrength("")).toBe("weak");
    expect(normalizeStrength("definitely true")).toBe("weak");
  });
  it("isStrength guards the vocab", () => {
    expect(isStrength("supported")).toBe(true);
    expect(isStrength("amazing")).toBe(false);
    expect(STRENGTH_LABELS).toContain("unsupported");
  });
});

describe("enforceFloor — deterministic anti-sycophancy backstop", () => {
  it("demotes a high rating with zero confirming evidence", () => {
    expect(enforceFloor("well-supported", 0, 0)).toBe("unsupported");
    expect(enforceFloor("supported", 0, 0)).toBe("unsupported");
    // with only disconfirming evidence, it lands at 'weak', not 'unsupported'
    expect(enforceFloor("well-supported", 0, 3)).toBe("weak");
  });
  it("caps 'well-supported' at 'supported' when only one source confirms", () => {
    expect(enforceFloor("well-supported", 1, 0)).toBe("supported");
  });
  it("leaves a rating that the evidence justifies untouched", () => {
    expect(enforceFloor("supported", 2, 0)).toBe("supported");
    expect(enforceFloor("well-supported", 3, 1)).toBe("well-supported");
    expect(enforceFloor("contested", 1, 2)).toBe("contested");
  });
  it("caps at 'contested' when challenges tie or outnumber confirms", () => {
    expect(enforceFloor("well-supported", 1, 1)).toBe("contested"); // balanced -> never 'supported'
    expect(enforceFloor("supported", 2, 3)).toBe("contested"); // net-negative
    expect(enforceFloor("well-supported", 5, 2)).toBe("well-supported"); // net-positive stands
  });
  it("never INFLATES a conservative self-rating", () => {
    expect(enforceFloor("weak", 5, 0)).toBe("weak");
    expect(enforceFloor("unsupported", 9, 0)).toBe("unsupported");
  });
});
