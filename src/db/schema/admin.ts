import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";

import { createdAt, fk, id } from "../columns";
import { user } from "./auth";
import { adminAction } from "./enums";

// =============================================================================
// ADMINISTRATION
// =============================================================================

/**
 * Append-only record of what admins did: plan edits, suspensions and
 * impersonation. The actor's email is copied in, so the record survives even
 * if the admin account is later deleted.
 */
export const adminAuditLog = pgTable(
  "AdminAuditLog",
  {
    id: id(),
    actorId: text(),
    actorEmail: text().notNull(),
    action: adminAction().notNull(),
    /** "club" | "coach" | "plan" */
    targetType: text().notNull(),
    targetId: text().notNull(),
    /** Human-readable target at the time, e.g. the club name. */
    targetLabel: text(),
    reason: varchar({ length: 500 }),
    /** Small structured details, e.g. a plan's before/after values. */
    details: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index("AdminAuditLog_createdAt_idx").on(t.createdAt.desc().nullsFirst()),
    index("AdminAuditLog_target_idx").on(t.targetType, t.targetId),
    fk("AdminAuditLog", [t.actorId], [user.id]).onDelete("set null"),
    check("AdminAuditLog_target_type", sql`"targetType" IN ('club', 'coach', 'plan')`),
  ],
);
