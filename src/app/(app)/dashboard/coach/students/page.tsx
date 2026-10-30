import type { Metadata } from "next";

import { EmptyState, formatDate, formatTime, PageHeader, Panel, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { parseListParams } from "@/lib/list-params";
import { adjustCredit, markAttendance } from "@/modules/coaching/actions/students";
import { getCoachProfile, requireCoach } from "@/modules/coaching/dal";
import { getAttendanceSheet, getRecentAdjustments, getStudentPasses, listStudents, type AttendanceSession } from "@/modules/coaching/queries/students";

export const metadata: Metadata = { title: "Students & Credits" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const attendanceButtons = [
  { status: "PRESENT", label: "Present" },
  { status: "LATE", label: "Late" },
  { status: "ABSENT", label: "Absent" },
] as const;

const attendanceBadge = { PRESENT: "success", LATE: "warning", ABSENT: "danger", EXCUSED: "neutral" } as const;

export default async function StudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const coach = await requireCoach();
  const profile = await getCoachProfile(coach);
  const tz = profile.timezone;
  const { q } = parseListParams(await searchParams);
  const [students, sheet, passes, adjustments] = await Promise.all([
    listStudents(coach.id, q),
    getAttendanceSheet(coach.id),
    getStudentPasses(coach.id),
    getRecentAdjustments(coach.id),
  ]);

  // Group the check-in sheet by session.
  const sessions = new Map<string, { title: string; startsAt: Date; clubName: string; rows: AttendanceSession[] }>();
  for (const r of sheet) {
    const s = sessions.get(r.sessionId) ?? { title: r.title, startsAt: r.startsAt, clubName: r.clubName, rows: [] };
    s.rows.push(r);
    sessions.set(r.sessionId, s);
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Students & credits" description="Everyone you coach across your clubs, today's check-ins, and their session passes." />

      <Panel title="Check-in: last 7 days">
        {sessions.size === 0 ? (
          <EmptyState>No sessions with students in the last 7 days. Check-in opens 30 minutes before a session starts.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {[...sessions.entries()].map(([id, s]) => (
              <li key={id} className="px-5 py-4">
                <p className="text-sm font-medium">
                  {s.title} <span className="font-normal text-muted-foreground">· {formatDate(s.startsAt, tz)} {formatTime(s.startsAt, tz)} · {s.clubName}</span>
                </p>
                <ul className="mt-2 space-y-2" aria-label={`Attendance for ${s.title}`}>
                  {s.rows.map((r) => (
                    <li key={r.participantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                      <span className="min-w-0 text-sm">
                        {r.studentName ?? r.studentEmail}{" "}
                        {r.attendance ? <Badge variant={attendanceBadge[r.attendance]}>{r.attendance.charAt(0) + r.attendance.slice(1).toLowerCase()}</Badge> : <Badge variant="outline">Not marked</Badge>}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {attendanceButtons.map((b) => (
                          <ActionButton
                            key={b.status}
                            action={markAttendance}
                            hidden={{ participantId: r.participantId, status: b.status }}
                            variant={r.attendance === b.status ? "primary" : "outline"}
                          >
                            {b.label}
                          </ActionButton>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Session passes">
        {passes.length === 0 ? (
          <EmptyState>None of your students has a pass at your clubs.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Student</th>
                  <th scope="col" className={th}>Pass</th>
                  <th scope="col" className={th}>Credits left</th>
                  <th scope="col" className={th}>Expires</th>
                  <th scope="col" className={th}><span className="sr-only">Adjust</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {passes.map((p) => {
                  const left = p.creditsTotal === null ? null : p.creditsTotal - p.creditsUsed;
                  return (
                    <tr key={p.passId} className={p.valid ? undefined : "opacity-60"}>
                      <td className={td}>
                        <p className="font-medium">{p.studentName ?? p.studentEmail}</p>
                        <p className="text-xs text-muted-foreground">{p.studentEmail}</p>
                      </td>
                      <td className={td}>
                        {p.planName}
                        <span className="block text-xs text-muted-foreground">{p.clubName}</span>
                      </td>
                      <td className={`${td} tabular-nums`}>
                        {left === null ? (
                          "Unlimited"
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-16 rounded-full bg-muted" aria-hidden>
                              <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(left / p.creditsTotal!) * 100}%` }} />
                            </span>
                            {left} of {p.creditsTotal}
                          </span>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap text-xs`}>{p.valid ? formatDate(p.expiresAt, tz) : <Badge variant="outline">Not valid</Badge>}</td>
                      <td className={`${td} text-right`}>
                        {p.valid && left !== null && (
                          <span className="inline-flex flex-wrap justify-end gap-1.5">
                            {left > 0 && (
                              <ActionButton action={adjustCredit} hidden={{ passId: p.passId, direction: "deduct" }} variant="primary">
                                −1 session
                              </ActionButton>
                            )}
                            {p.creditsUsed > 0 && (
                              <ActionButton action={adjustCredit} hidden={{ passId: p.passId, direction: "restore" }}>
                                +1 back
                              </ActionButton>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {adjustments.length > 0 && (
          <details className="border-t border-border px-5 py-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Your recent credit changes</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {adjustments.map((a) => (
                <li key={a.id}>
                  {formatDate(a.createdAt, tz)} · {a.delta > 0 ? "−1" : "+1"} {a.planName} · {a.studentEmail} · {a.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <section aria-labelledby="directory" className="space-y-3">
        <h2 id="directory" className="text-lg font-semibold">
          Student directory
        </h2>
        <form role="search" className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 basis-60">
            <span className="sr-only">Student name or email</span>
            <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Student name or email" className="h-10 w-full rounded-full border border-border bg-card px-4 text-sm" />
          </label>
          <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-foreground">
            Search
          </button>
        </form>
        <Panel title={`${students.length} ${students.length === 1 ? "student" : "students"}`}>
          {students.length === 0 ? (
            <EmptyState>{q ? "No students match." : "Students appear here once they join one of your sessions or a club assigns them to you."}</EmptyState>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className={th}>Student</th>
                    <th scope="col" className={th}>Clubs</th>
                    <th scope="col" className={th}>Sessions</th>
                    <th scope="col" className={th}>Attendance</th>
                    <th scope="col" className={th}>Last / next</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {students.map((s) => (
                    <tr key={s.userId}>
                      <td className={td}>
                        <p className="font-medium">{s.name ?? s.email}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </td>
                      <td className={`${td} text-xs`}>{s.clubs ?? "—"}</td>
                      <td className={`${td} tabular-nums`}>{s.sessions}</td>
                      <td className={`${td} tabular-nums`}>{s.marked ? `${Math.round((s.attended / s.marked) * 100)}% (${s.attended}/${s.marked})` : "—"}</td>
                      <td className={`${td} text-xs`}>
                        {s.lastSession ? formatDate(s.lastSession, tz) : "—"} / {s.nextSession ? formatDate(s.nextSession, tz) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </section>
    </div>
  );
}
