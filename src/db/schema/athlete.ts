import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { createdAt, fk, idx, updatedAt } from "../columns";
import { user } from "./auth";
import { club } from "./clubs";

// =============================================================================
// ATHLETE PREFERENCES
// =============================================================================

/** Notification switches for a student (one row, created on first save). */
export const athleteSettings = pgTable(
  "AthleteSettings",
  {
    userId: text().primaryKey(),
    /** Email me when an open match at my level opens at a preferred club. */
    matchAlerts: boolean().notNull().default(true),
    /** Email me when a booking of mine is changed or cancelled. */
    bookingUpdates: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [fk("AthleteSettings", [t.userId], [user.id]).onDelete("cascade")],
);

/** Clubs a student prefers: the open-match board and match alerts focus on them. */
export const athletePreferredClub = pgTable(
  "AthletePreferredClub",
  {
    userId: text().notNull(),
    clubId: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "AthletePreferredClub_pkey", columns: [t.userId, t.clubId] }),
    idx("AthletePreferredClub", t.clubId),
    fk("AthletePreferredClub", [t.userId], [user.id]).onDelete("cascade"),
    fk("AthletePreferredClub", [t.clubId], [club.id]).onDelete("cascade"),
  ],
);
