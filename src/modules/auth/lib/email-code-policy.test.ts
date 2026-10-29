import { describe, expect, it } from "vitest";

import { codeSchema, emailSchema, generateCode, hashCode, hashesMatch, maskEmail } from "./email-code-policy";

describe("generateCode", () => {
  it("always returns exactly 6 digits, including leading zeros", () => {
    for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe("hashCode / hashesMatch", () => {
  const secret = "test-secret";

  it("is deterministic per (row, code) and differs across rows and secrets", () => {
    const h = hashCode(secret, "row1", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(secret, "row1", "123456")).toBe(h);
    expect(hashCode(secret, "row2", "123456")).not.toBe(h);
    expect(hashCode("other-secret", "row1", "123456")).not.toBe(h);
  });

  it("compares in constant time and rejects malformed input", () => {
    const h = hashCode(secret, "row1", "123456");
    expect(hashesMatch(h, hashCode(secret, "row1", "123456"))).toBe(true);
    expect(hashesMatch(h, hashCode(secret, "row1", "123457"))).toBe(false);
    expect(hashesMatch(h, "")).toBe(false);
    expect(hashesMatch(h, "zz")).toBe(false);
  });
});

describe("emailSchema", () => {
  it("normalises valid addresses", () => {
    expect(emailSchema.parse("  María@Example.COM ".replace("í", "i"))).toBe("maria@example.com");
  });

  it.each([
    "",
    "not-an-email",
    "a@b",
    "' OR 1=1 --@example.com",
    "victim@example.com\r\nBcc: everyone@example.com",
    "victim@example.com\nSubject: hi",
    "x@example.com\u0000",
    "<script>alert(1)</script>@example.com",
    "a\"b@example.com",
    `${"a".repeat(250)}@example.com`,
  ])("rejects %j", (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(emailSchema.safeParse(undefined).success).toBe(false);
    expect(emailSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });
});

describe("codeSchema", () => {
  it.each(["123456", " 123456 ", "123 456", "123-456"])("accepts %j", (value) => {
    expect(codeSchema.parse(value)).toBe(value.replace(/[\s-]/g, ""));
  });

  it.each(["12345", "1234567", "12345a", "' OR '1'='1", "１２３４５６", "123456; DROP TABLE x", "", "1".repeat(40)])(
    "rejects %j",
    (value) => {
      expect(codeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("maskEmail", () => {
  it("hides the local part", () => {
    expect(maskEmail("maria@example.com")).toBe("m••••@example.com");
    expect(maskEmail("a@example.com")).toBe("a•@example.com");
  });
});
