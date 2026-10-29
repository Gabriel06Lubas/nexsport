import { describe, expect, it } from "vitest";

import { DEFAULT_LOGIN_REDIRECT, safeCallbackUrl } from "./redirects";
import { canAccessArea, homePathFor } from "./roles";
import {
  capExpiry,
  hashSessionToken,
  isPastAbsoluteLifetime,
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
} from "./session-policy";
import { describeUserAgent } from "./user-agent";

describe("safeCallbackUrl", () => {
  it.each(["/dashboard", "/dashboard/coach?tab=1#x", "/"])("keeps same-site path %s", (v) => {
    expect(safeCallbackUrl(v)).toBe(v);
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "",
    undefined,
    42,
  ])("rejects %s", (v) => {
    expect(safeCallbackUrl(v)).toBe(DEFAULT_LOGIN_REDIRECT);
  });
});

describe("roles", () => {
  it("enforces the RBAC table", () => {
    expect(canAccessArea("CLUB_OWNER", "club")).toBe(true);
    expect(canAccessArea("STAFF", "club")).toBe(true);
    expect(canAccessArea("COACH", "club")).toBe(false);
    expect(canAccessArea("COACH", "coach")).toBe(true);
    expect(canAccessArea("STUDENT", "coach")).toBe(false);
    expect(canAccessArea("ADMIN", "athlete")).toBe(true);
  });

  it("sends each role to a home it can access", () => {
    expect(homePathFor("STAFF")).toBe("/dashboard/club");
    expect(homePathFor("COACH")).toBe("/dashboard/coach");
    expect(homePathFor("STUDENT")).toBe("/dashboard/athlete");
    expect(homePathFor("ADMIN")).toBe("/admin");
  });
});

describe("session policy", () => {
  it("hashes tokens deterministically to 64 hex chars", () => {
    const h = hashSessionToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashSessionToken("abc"));
    expect(h).not.toBe(hashSessionToken("abd"));
  });

  it("caps sliding refresh at the absolute deadline", () => {
    const created = new Date("2030-01-01T00:00:00Z");
    const deadline = new Date(created.getTime() + SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000);
    expect(capExpiry(new Date("2030-01-10T00:00:00Z"), created)).toEqual(new Date("2030-01-10T00:00:00Z"));
    expect(capExpiry(new Date("2031-01-01T00:00:00Z"), created)).toEqual(deadline);
    expect(isPastAbsoluteLifetime(created, deadline)).toBe(true);
    expect(isPastAbsoluteLifetime(created, new Date(deadline.getTime() - 1))).toBe(false);
  });
});

describe("describeUserAgent", () => {
  it("labels common devices", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari on iPhone");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe(
      "Edge on Windows",
    );
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});
