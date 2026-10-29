import "server-only";

import { and, eq, isNull, lt } from "drizzle-orm";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";

import type { Db } from "@/db";
import { account, session, user } from "@/db/schema";

import { capExpiry, hashSessionToken, isPastAbsoluteLifetime } from "./lib/session-policy";

// Auth.js adapter for nexport's Drizzle schema. Compared with the stock
// @auth/drizzle-adapter it:
//   * stores only a SHA-256 hash of each session token (the raw token lives
//     solely in the user's httpOnly cookie);
//   * enforces an absolute session lifetime on top of the idle timeout;
//   * records the device (user agent) so users can review and revoke sessions;
//   * never persists provider access/refresh/id tokens: we only need identity;
//   * treats soft-deleted users as non-existent.

type UserRow = typeof user.$inferSelect;

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
    activeClubId: row.activeClubId,
    onboardedAt: row.onboardedAt,
  };
}

async function currentUserAgent(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("user-agent")?.slice(0, 512) ?? null;
  } catch {
    return null; // called outside a request (e.g. a script)
  }
}

const activeUser = (where: ReturnType<typeof eq>) => and(where, isNull(user.deletedAt));

export function NexportAdapter(db: Db): Adapter {
  return {
    async createUser({ name, email, emailVerified, image }) {
      const [row] = await db
        .insert(user)
        .values({ name, email: email.toLowerCase(), emailVerified, image })
        .returning();
      return toAdapterUser(row!);
    },

    async getUser(id) {
      const row = await db.query.user.findFirst({ where: activeUser(eq(user.id, id)) });
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email) {
      const row = await db.query.user.findFirst({ where: activeUser(eq(user.email, email.toLowerCase())) });
      return row ? toAdapterUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const [row] = await db
        .select({ user })
        .from(account)
        .innerJoin(user, eq(account.userId, user.id))
        .where(and(eq(account.provider, provider), eq(account.providerAccountId, providerAccountId)))
        .limit(1);
      return row && !row.user.deletedAt ? toAdapterUser(row.user) : null;
    },

    async updateUser({ id, name, email, emailVerified, image }) {
      // Drizzle skips `undefined` values, so only fields Auth.js passed change.
      const [row] = await db
        .update(user)
        .set({ name, email: email?.toLowerCase(), emailVerified, image })
        .where(eq(user.id, id))
        .returning();
      return toAdapterUser(row!);
    },

    async deleteUser(id) {
      await db.delete(user).where(eq(user.id, id));
    },

    async linkAccount(linked: AdapterAccount) {
      // Only the identity link is stored. access_token, refresh_token and
      // id_token from the provider are intentionally discarded.
      await db.insert(account).values({
        userId: linked.userId,
        type: linked.type,
        provider: linked.provider,
        providerAccountId: linked.providerAccountId,
      });
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db
        .delete(account)
        .where(and(eq(account.provider, provider), eq(account.providerAccountId, providerAccountId)));
    },

    async createSession({ sessionToken, userId, expires }): Promise<AdapterSession> {
      const now = new Date();
      const userAgent = await currentUserAgent();
      const created = await db.transaction(async (tx) => {
        // Opportunistic cleanup of this user's dead sessions on every sign-in.
        await tx.delete(session).where(and(eq(session.userId, userId), lt(session.expires, now)));
        const [row] = await tx
          .insert(session)
          .values({ tokenHash: hashSessionToken(sessionToken), userId, expires: capExpiry(expires, now), userAgent })
          .returning();
        return row!;
      });
      // Auth.js writes the cookie from this return value, so it must carry
      // the raw token, never the hash.
      return { sessionToken, userId: created.userId, expires: created.expires };
    },

    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ session, user })
        .from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(eq(session.tokenHash, hashSessionToken(sessionToken)))
        .limit(1);
      if (!row) return null;
      if (row.user.deletedAt || isPastAbsoluteLifetime(row.session.createdAt)) {
        await db.delete(session).where(eq(session.id, row.session.id));
        return null;
      }
      return {
        session: { sessionToken, userId: row.session.userId, expires: row.session.expires },
        user: toAdapterUser(row.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      const tokenHash = hashSessionToken(sessionToken);
      const existing = await db.query.session.findFirst({ where: eq(session.tokenHash, tokenHash) });
      if (!existing) return null;
      const [row] = await db
        .update(session)
        .set({
          ...(expires && { expires: capExpiry(expires, existing.createdAt) }),
          lastSeenAt: new Date(),
        })
        .where(eq(session.tokenHash, tokenHash))
        .returning();
      if (!row) return null;
      return { sessionToken, userId: row.userId, expires: row.expires };
    },

    async deleteSession(sessionToken) {
      await db.delete(session).where(eq(session.tokenHash, hashSessionToken(sessionToken)));
    },
  };
}
