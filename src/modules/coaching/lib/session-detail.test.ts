import { describe, expect, it } from "vitest";

import { checkInOpen, historyLabel, initials, mailtoAll, sessionIcs, sessionTiming, whatsappUrl } from "./session-detail";

const start = new Date("2026-11-19T12:00:00Z");
const end = new Date("2026-11-19T13:00:00Z");
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

describe("sessionTiming", () => {
  it("counts down, then shows it live, then ended", () => {
    expect(sessionTiming(start, end, minutes(-135))).toEqual({ phase: "upcoming", label: "Starts in 2 h 15 min" });
    expect(sessionTiming(start, end, minutes(-20))).toEqual({ phase: "soon", label: "Starts in 20 min" });
    expect(sessionTiming(start, end, minutes(15))).toEqual({ phase: "live", label: "Happening now · ends in 45 min" });
    expect(sessionTiming(start, end, minutes(240))).toEqual({ phase: "ended", label: "Ended 3 h ago" });
    expect(sessionTiming(start, end, minutes(-3 * 24 * 60)).label).toBe("Starts in 3 days");
  });
});

describe("checkInOpen", () => {
  it("opens 30 minutes before the start", () => {
    expect(checkInOpen(start, minutes(-31))).toBe(false);
    expect(checkInOpen(start, minutes(-30))).toBe(true);
    expect(checkInOpen(start, minutes(90))).toBe(true);
  });
});

describe("contact links", () => {
  it("opens WhatsApp with a ready message, only for a valid E.164 number", () => {
    expect(whatsappUrl("+351912345678", "Hi Ana, see you at 12:00")).toBe("https://wa.me/351912345678?text=Hi%20Ana%2C%20see%20you%20at%2012%3A00");
    expect(whatsappUrl("912345678", "x")).toBeNull();
    expect(whatsappUrl("+351 912 345 678", "x")).toBeNull();
  });

  it("emails everyone in Bcc, and nothing can add headers", () => {
    expect(mailtoAll(["a@x.com", "b@y.org", "a@x.com"], "Backhand Clinic, Thu 19 Nov")).toBe("mailto:?bcc=a%40x.com,b%40y.org&subject=Backhand%20Clinic%2C%20Thu%2019%20Nov");
    expect(mailtoAll(["evil@x.com\r\nBcc: all@x.com", "a@x.com?cc=b@y.org", "ok@x.com"], "s")).toBe("mailto:?bcc=ok%40x.com&subject=s");
    expect(mailtoAll([], "s")).toBeNull();
  });
});

describe("initials and history", () => {
  it("makes avatar initials", () => {
    expect(initials("Demo Athlete 1")).toBe("DA");
    expect(initials("Lucía")).toBe("L");
    expect(initials("  ana   maria  costa ")).toBe("AC");
  });
  it("says how often the athlete has trained with the coach", () => {
    expect(historyLabel(0, null)).toBe("First session with you");
    expect(historyLabel(1, "12 Nov")).toBe("2nd session with you · last on 12 Nov");
    expect(historyLabel(2, "12 Nov")).toBe("3rd session with you · last on 12 Nov");
    expect(historyLabel(10, null)).toBe("11th session with you");
    expect(historyLabel(20, null)).toBe("21st session with you");
  });
});

describe("sessionIcs", () => {
  const ics = sessionIcs({
    id: "s1",
    title: "Backhand Clinic; level 3",
    startsAt: start,
    endsAt: end,
    location: "Padel Central, Rua A 1, Porto",
    description: "With Demo Athlete 1\nBring water",
    url: "https://nexport.app/dashboard/coach/sessions/s1",
    now: new Date("2026-11-18T10:00:00Z"),
  });
  it("is a valid calendar event with a 30-minute reminder", () => {
    expect(ics).toContain("BEGIN:VEVENT\r\nUID:session-s1@nexport");
    expect(ics).toContain("DTSTART:20261119T120000Z\r\nDTEND:20261119T130000Z");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("escapes text, so a title can't break out of its field", () => {
    expect(ics).toContain("SUMMARY:Backhand Clinic\\; level 3");
    expect(ics).toContain("LOCATION:Padel Central\\, Rua A 1\\, Porto");
    expect(ics).toContain("DESCRIPTION:With Demo Athlete 1\\nBring water");
  });
  it("folds long lines at 75 octets", () => {
    const long = sessionIcs({ id: "s2", title: "Ç".repeat(100), startsAt: start, endsAt: end, location: "x", description: "y", url: "u" });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain("\r\n Ç");
  });
});
