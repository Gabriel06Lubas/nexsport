import "server-only";

import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";

import type { PrismaClient, User } from "@/generated/prisma/client";

import { capExpiry, hashSessionToken, isPastAbsoluteLifetime } from "./lib/session-policy";

// Auth.js adapter for nexport's Prisma schema. Compared with the stock
// @auth/prisma-adapter it:
//   * stores only a SHA-256 hash of each session token (the raw token lives
//     solely in the user's httpOnly cookie);
//   * enforces an absolute session lifetime on top of the idle timeout;
//   * records the device (user agent) so users can review and revoke sessions;
//   * never persists provider access/refresh/id tokens: we only need identity;
//   * treats soft-deleted users as non-existent.

function toAdapterUser(user: User): AdapterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role,
    activeClubId: user.activeClubId,
    onboardedAt: user.onboardedAt,
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

export function NexportAdapter(db: PrismaClient): Adapter {
  return {
    async createUser({ name, email, emailVerified, image }) {
      const user = await db.user.create({
        data: { name, email: email.toLowerCase(), emailVerified, image },
      });
      return toAdapterUser(user);
    },

    async getUser(id) {
      const user = await db.user.findFirst({ where: { id, deletedAt: null } });
      return user && toAdapterUser(user);
    },

    async getUserByEmail(email) {
      const user = await db.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
      return user && toAdapterUser(user);
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account && !account.user.deletedAt ? toAdapterUser(account.user) : null;
    },

    async updateUser({ id, name, email, emailVerified, image }) {
      const user = await db.user.update({
        where: { id },
        data: { name, email: email?.toLowerCase(), emailVerified, image },
      });
      return toAdapterUser(user);
    },

    async deleteUser(id) {
      await db.user.delete({ where: { id } });
    },

    async linkAccount(account: AdapterAccount) {
      // Only the identity link is stored. access_token, refresh_token and
      // id_token from the provider are intentionally discarded.
      await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db.account.delete({ where: { provider_providerAccountId: { provider, providerAccountId } } });
    },

    async createSession({ sessionToken, userId, expires }): Promise<AdapterSession> {
      const now = new Date();
      const [, session] = await db.$transaction([
        // Opportunistic cleanup of this user's dead sessions on every sign-in.
        db.session.deleteMany({ where: { userId, expires: { lt: now } } }),
        db.session.create({
          data: {
            tokenHash: hashSessionToken(sessionToken),
            userId,
            expires: capExpiry(expires, now),
            userAgent: await currentUserAgent(),
          },
        }),
      ]);
      // Auth.js writes the cookie from this return value, so it must carry
      // the raw token, never the hash.
      return { sessionToken, userId: session.userId, expires: session.expires };
    },

    async getSessionAndUser(sessionToken) {
      const session = await db.session.findUnique({
        where: { tokenHash: hashSessionToken(sessionToken) },
        include: { user: true },
      });
      if (!session) return null;
      if (session.user.deletedAt || isPastAbsoluteLifetime(session.createdAt)) {
        await db.session.deleteMany({ where: { id: session.id } });
        return null;
      }
      return {
        session: { sessionToken, userId: session.userId, expires: session.expires },
        user: toAdapterUser(session.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      const tokenHash = hashSessionToken(sessionToken);
      const existing = await db.session.findUnique({ where: { tokenHash } });
      if (!existing) return null;
      const session = await db.session.update({
        where: { tokenHash },
        data: {
          ...(expires && { expires: capExpiry(expires, existing.createdAt) }),
          lastSeenAt: new Date(),
        },
      });
      return { sessionToken, userId: session.userId, expires: session.expires };
    },

    async deleteSession(sessionToken) {
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(sessionToken) } });
    },
  };
}
