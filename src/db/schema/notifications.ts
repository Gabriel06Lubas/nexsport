import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, fk, id, tstz } from "../columns";
import { user } from "./auth";
import { club } from "./clubs";
import { notificationType } from "./enums";
import { practiceSession } from "./scheduling";
import { comment, post } from "./social";

// =============================================================================
// NOTIFICATIONS
// =============================================================================

export const notification = pgTable(
  "Notification",
  {
    id: id(),
    recipientId: text().notNull(),
    actorId: text(),
    type: notificationType().notNull(),
    title: text().notNull(),
    body: text(),
    /** Deep link rendered by the client, e.g. "/sessions/clx...". */
    href: text(),
    /** Extra payload for the renderer (small, never secrets). */
    data: jsonb(),
    // Optional typed references so cascades clean up stale notifications.
    clubId: text(),
    sessionId: text(),
    postId: text(),
    commentId: text(),
    readAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    index("Notification_recipientId_createdAt_idx").on(t.recipientId, t.createdAt.desc().nullsFirst()),
    // Unread badge: WHERE "recipientId" = $1 AND "readAt" IS NULL.
    index("Notification_unread_by_recipient")
      .on(t.recipientId, t.createdAt.desc().nullsFirst())
      .where(sql`"readAt" IS NULL`),
    fk("Notification", [t.recipientId], [user.id]).onDelete("cascade"),
    fk("Notification", [t.actorId], [user.id]).onDelete("set null"),
    fk("Notification", [t.clubId], [club.id]).onDelete("cascade"),
    fk("Notification", [t.sessionId], [practiceSession.id]).onDelete("cascade"),
    fk("Notification", [t.postId], [post.id]).onDelete("cascade"),
    fk("Notification", [t.commentId], [comment.id]).onDelete("cascade"),
  ],
);
