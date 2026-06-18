import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, ESCALATE_CHARS, pickModel, modelFor, DEFAULT_TIER } from "@/server/normalize/model";

describe("model tiering", () => {
  it("routes grunt tasks to Haiku and judgment tasks to Sonnet", () => {
    expect(modelFor("extract")).toBe(HAIKU);
    expect(modelFor("classify")).toBe(HAIKU);
    expect(modelFor("gapfind")).toBe(HAIKU);
    expect(modelFor("synthesis")).toBe(SONNET);
    expect(modelFor("critic")).toBe(SONNET);
    expect(modelFor("briefIntro")).toBe(SONNET);
  });

  it("honors a custom tier override", () => {
    expect(modelFor("extract", { ...DEFAULT_TIER, extract: SONNET })).toBe(SONNET);
  });
});

describe("pickModel — Haiku-first extraction with Sonnet escalation", () => {
  it("uses Haiku for a short first attempt (the grunt path)", () => {
    expect(pickModel(100, false)).toBe(HAIKU);
  });

  it("escalates to Sonnet on a validation retry (mis-extraction likelier)", () => {
    expect(pickModel(100, true)).toBe(SONNET);
  });

  it("escalates to Sonnet for a large chunk", () => {
    expect(pickModel(ESCALATE_CHARS + 1, false)).toBe(SONNET);
    expect(pickModel(ESCALATE_CHARS, false)).toBe(HAIKU); // boundary: not strictly greater
  });
});
