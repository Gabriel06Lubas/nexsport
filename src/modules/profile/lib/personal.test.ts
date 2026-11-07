import { describe, expect, it } from "vitest";

import { countryFromAcceptLanguage, personalDetailsSchema, splitPhone, toE164 } from "./personal";

const valid = { firstName: "María", lastName: "Núñez", handle: "Maria.Nunez", phoneCountry: "ES", phone: "612 34 56 78" };

describe("toE164", () => {
  it.each([
    ["612 34 56 78", "ES", "+34612345678"],
    ["+34 612-345-678", "US", "+34612345678"], // an international number ignores the picker
    ["(415) 555-2671", "US", "+14155552671"],
    ["07400 123456", "GB", "+447400123456"],
    ["912 345 678", "PT", "+351912345678"],
  ])("%j in %s → %s", (raw, country, e164) => {
    expect(toE164(raw, country)).toBe(e164);
  });

  it.each([
    ["12", "ES"], // too short
    ["612 34 56 78 99 99", "ES"], // too long
    ["000 000 000", "ES"], // not in the numbering plan
    ["612345678", "XX"], // unknown country, national format
    ["612345678'; DROP TABLE \"Profile\";--", "ES"],
    ["+34 612\u202e345678", "ES"],
    ["call me", "ES"],
  ])("rejects %j (%s)", (raw, country) => {
    expect(toE164(raw, country)).toBeNull();
  });
});

describe("personalDetailsSchema", () => {
  it("normalises everything for storage", () => {
    expect(personalDetailsSchema.parse({ ...valid, firstName: "  María ", lastName: "Núñez  García" })).toEqual({
      firstName: "María",
      lastName: "Núñez García",
      handle: "maria.nunez",
      phone: "+34612345678",
      displayName: "María Núñez García",
    });
  });

  it.each([
    [{ firstName: "" }, "firstName"],
    [{ firstName: "123" }, "firstName"],
    [{ lastName: "Evil\u202e" }, "lastName"],
    [{ lastName: "x".repeat(51) }, "lastName"],
    [{ handle: "no spaces" }, "handle"],
    [{ handle: "ab" }, "handle"],
    [{ phone: "" }, "phone"],
    [{ phone: "123" }, "phone"],
  ])("rejects %j", (patch, field) => {
    const result = personalDetailsSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });
});

describe("helpers", () => {
  it("reads the country from Accept-Language", () => {
    expect(countryFromAcceptLanguage("pt-PT,pt;q=0.9,en;q=0.8")).toBe("PT");
    expect(countryFromAcceptLanguage("en", "ES")).toBe("ES");
    expect(countryFromAcceptLanguage(null)).toBe("ES");
  });
  it("splits a stored number for the form", () => {
    expect(splitPhone("+34612345678")).toEqual({ country: "ES", national: "612 34 56 78" });
    expect(splitPhone(null)).toEqual({});
  });
});
