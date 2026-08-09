import { describe, expect, it } from "vitest";
import { serializeStructuredData, toMetaDescription } from "../../src/lib/seo";

describe("SEO helpers", () => {
  it("normalizes and truncates long descriptions without splitting a word", () => {
    const description = toMetaDescription("  A portfolio   description with deliberate spacing and several words.  ", 44);
    expect(description).toBe("A portfolio description with deliberate…");
    expect(description.length).toBeLessThanOrEqual(44);
  });

  it("escapes script-opening characters in structured data", () => {
    expect(serializeStructuredData({ value: "</script>" })).toContain("\\u003c/script>");
  });
});
