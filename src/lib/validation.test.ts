import { describe, expect, it } from "vitest";

import { idSchema, plainText } from "./validation";

const displayName = plainText({ min: 2, max: 60, label: "display name" });

describe("plainText", () => {
  it.each([
    ["Mar\u00eda N\u00fa\u00f1ez", "Mar\u00eda N\u00fa\u00f1ez"],
    ["  Jean-Luc   O'Brien ", "Jean-Luc O'Brien"],
    ["Robert'); DROP TABLE \"User\";--", "Robert'); DROP TABLE \"User\";--"], // stored as plain text, never executed
    ["<script>alert(1)</script>", "<script>alert(1)</script>"], // React escapes it on output
    ["Zoe\u0308", "Zo\u00eb"], // NFC: decomposed and composed forms store the same
    ["\ufeffAna\ufeff", "Ana"], // a BOM counts as whitespace: trimmed, never stored
  ])("accepts %j", (input, stored) => {
    expect(displayName.parse(input)).toBe(stored);
  });

  it.each([
    "nul\u0000byte",
    "line\r\nbreak\u0007",
    "evil\u202egnp.exe", // right-to-left override
    "zero\u200bwidth",
    "iso\u2066late",
    "x",
    "a".repeat(61),
  ])("rejects %j", (input) => {
    expect(displayName.safeParse(input).success).toBe(false);
  });
});

describe("idSchema", () => {
  it("accepts generated ids and rejects anything else", () => {
    expect(idSchema.safeParse("cm0abc123def456ghi789jkl").success).toBe(true);
    for (const bad of ["", "1 OR 1=1", "abc;--", "ABC", "a".repeat(65), "../etc"]) {
      expect(idSchema.safeParse(bad).success).toBe(false);
    }
  });
});
