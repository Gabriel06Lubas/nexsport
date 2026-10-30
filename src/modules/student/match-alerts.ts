import "server-only";

import { sql } from "drizzle-orm";

import { formatMoney } from "@/lib/utils";
import { rows } from "@/modules/clubs/queries/shared";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { sendEmail } from "@/modules/notifications/email";
import { appUrl } from "@/modules/payments/stripe";

// "Match alerts": when an open match is posted, email the students who
// switched alerts on, picked that club as a preferred club, and whose level
// for the sport fits the match. Best effort: a failed email is logged, never
// surfaced to the coach who posted the match.

export async function notifyMatchAlerts(sessionId: string) {
  try {
    const [match] = await rows<{ title: string; startsAt: Date; clubName: string; timezone: string; sportName: string; priceAmount: number; currency: string; minLevel: number | null; maxLevel: number | null }>(sql`
      SELECT s.title, s."startsAt", c.name AS "clubName", c.timezone, sp.name AS "sportName", s."priceAmount", s.currency,
             s."minLevel"::float8 AS "minLevel", s."maxLevel"::float8 AS "maxLevel"
        FROM "PracticeSession" s JOIN "Club" c ON c.id = s."clubId" JOIN "Sport" sp ON sp.id = s."sportId"
       WHERE s.id = ${sessionId} AND s.kind = 'OPEN_MATCH'`);
    if (!match) {
      console.warn(`[match-alerts] open match ${sessionId} not found`);
      return;
    }
    const recipients = await rows<{ email: string; name: string | null }>(sql`
      SELECT DISTINCT u.email, u.name
        FROM "AthletePreferredClub" ap
        JOIN "User" u ON u.id = ap."userId" AND u.role = 'STUDENT' AND u."deletedAt" IS NULL AND u."suspendedAt" IS NULL
        LEFT JOIN "AthleteSettings" st ON st."userId" = u.id
        JOIN "PracticeSession" s ON s.id = ${sessionId} AND s."clubId" = ap."clubId"
        LEFT JOIN "Profile" pr ON pr."userId" = u.id
        LEFT JOIN "ProfileSport" ps ON ps."profileId" = pr.id AND ps."sportId" = s."sportId"
       WHERE COALESCE(st."matchAlerts", true)
         AND u.id <> s."coachId"
         AND ((s."minLevel" IS NULL AND s."maxLevel" IS NULL)
              OR (ps."levelRating" IS NOT NULL AND ps."levelRating" >= COALESCE(s."minLevel", 0) AND ps."levelRating" <= COALESCE(s."maxLevel", 10)))
       LIMIT 500`);
    console.info(`[match-alerts] ${recipients.length} recipient(s) for ${sessionId}`);
    const start = new Date(match.startsAt);
    const when = `${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${zonedParts(start, match.timezone).dateKey}T12:00:00Z`))} at ${new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: match.timezone }).format(start)}`;
    const level = match.minLevel === null && match.maxLevel === null ? "all levels" : `level ${match.minLevel ?? 0}–${match.maxLevel ?? 10}`;
    const link = appUrl("/dashboard/student/open-matches");
    for (const r of recipients) {
      const subject = `Open ${match.sportName.toLowerCase()} match at ${match.clubName}, ${level}`;
      const text = `Hi ${r.name?.split(" ")[0] ?? "there"},\n\nA new open match is looking for players: ${match.title}, ${when}, at ${match.clubName} (${level}). Your share: ${formatMoney(match.priceAmount, match.currency)}.\n\nJoin it: ${link}\n\nYou get these because match alerts are on in your nexport account settings.`;
      await sendEmail({ to: r.email, subject, text, html: text.split("\n\n").map((p) => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`).join("") });
    }
  } catch (error) {
    console.error("[match-alerts] failed", error);
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
