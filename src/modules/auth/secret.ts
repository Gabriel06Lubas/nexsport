import "server-only";

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The server secret used by Auth.js (cookie encryption, CSRF) and to key the
// email-code HMACs.
//
// Production: AUTH_SECRET is required; starting without it is an error.
// Development: if AUTH_SECRET is empty, a random secret is generated once and
// kept in .local/dev-auth-secret (git-ignored), so `npm run dev` works right
// after copying .env.example and sessions survive restarts.

const DEV_SECRET_FILE = join(process.cwd(), ".local", "dev-auth-secret");
let cached: string | undefined;

export function authSecret(): string {
  if (cached) return cached;
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return (cached = configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not set. Generate one with `openssl rand -base64 33` and add it to the environment.");
  }
  try {
    cached = readFileSync(DEV_SECRET_FILE, "utf8").trim() || undefined;
  } catch {
    // not created yet
  }
  if (!cached) {
    cached = randomBytes(33).toString("base64");
    mkdirSync(join(process.cwd(), ".local"), { recursive: true });
    writeFileSync(DEV_SECRET_FILE, `${cached}\n`, { mode: 0o600 });
    console.warn("[auth] AUTH_SECRET is empty: generated a development secret in .local/dev-auth-secret. Set AUTH_SECRET in production.");
  }
  return cached;
}
