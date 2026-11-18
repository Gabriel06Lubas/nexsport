// Helpers for a coach's session page: when it is, how to reach the athletes,
// and the calendar file. Pure, so they're unit tested.

/** Check-in (attendance) opens this long before a session starts; markAttendance enforces the same. */
export const CHECK_IN_MINUTES = 30;

export type SessionPhase = "upcoming" | "soon" | "live" | "ended";

const span = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.round(hours / 24)} days`;
};

/** Where the session is in time, as a short phrase: "Starts in 2 h 15 min", "Happening now", "Ended 3 h ago". */
export function sessionTiming(startsAt: Date, endsAt: Date, now: Date = new Date()): { phase: SessionPhase; label: string } {
  const t = now.getTime();
  if (t >= endsAt.getTime()) return { phase: "ended", label: `Ended ${span(t - endsAt.getTime())} ago` };
  if (t >= startsAt.getTime()) return { phase: "live", label: `Happening now · ends in ${span(endsAt.getTime() - t)}` };
  const until = startsAt.getTime() - t;
  return { phase: until <= CHECK_IN_MINUTES * 60_000 ? "soon" : "upcoming", label: `Starts in ${span(until)}` };
}

export const checkInOpen = (startsAt: Date, now: Date = new Date()) => now.getTime() >= startsAt.getTime() - CHECK_IN_MINUTES * 60_000;

/** A WhatsApp chat with a stored E.164 number, with a message ready to send. */
export function whatsappUrl(phone: string, message: string): string | null {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
}

/**
 * One email to every athlete. Addresses go in Bcc, so athletes don't see
 * each other's. Only addresses that look like addresses are used; they're
 * encoded, so nothing can add headers.
 */
export function mailtoAll(emails: readonly string[], subject: string): string | null {
  const valid = [...new Set(emails.filter((e) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(e)))];
  if (valid.length === 0) return null;
  return `mailto:?bcc=${valid.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(subject)}`;
}

/** Initials for an avatar: "Demo Athlete 1" → "DA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
}

/** "First session with you" / "3rd session with you · last on 12 Nov". */
export function historyLabel(previous: number, lastLabel: string | null): string {
  if (previous <= 0) return "First session with you";
  const n = previous + 1;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix} session with you${lastLabel ? ` · last on ${lastLabel}` : ""}`;
}

// --- Calendar file (RFC 5545) --------------------------------------------------

const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 octets are folded (CRLF + space), as the format requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function sessionIcs(input: { id: string; title: string; startsAt: Date; endsAt: Date; location: string; description: string; url: string; cancelled?: boolean; now?: Date }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//nexport//sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:session-${input.id}@nexport`,
    `DTSTAMP:${icsDate(input.now ?? new Date())}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${icsText(input.title)}`,
    `LOCATION:${icsText(input.location)}`,
    `DESCRIPTION:${icsText(input.description)}`,
    `URL:${input.url}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(input.title)}`,
    "TRIGGER:-PT30M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
