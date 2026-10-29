// Post-login redirects come from the URL (?callbackUrl=...), so they are
// attacker-controlled. Only same-site relative paths are allowed; anything
// else (absolute URLs, protocol-relative "//evil.com", backslash tricks)
// falls back to the default.

export const DEFAULT_LOGIN_REDIRECT = "/dashboard";

export function safeCallbackUrl(value: unknown, fallback: string = DEFAULT_LOGIN_REDIRECT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Reject control characters, which some browsers strip before resolving.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://n");
    if (url.host !== "n") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
