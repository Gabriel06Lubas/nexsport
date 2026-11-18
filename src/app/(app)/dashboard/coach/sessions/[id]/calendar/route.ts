import { idSchema } from "@/lib/validation";
import { requireCoach } from "@/modules/coaching/dal";
import { sessionIcs } from "@/modules/coaching/lib/session-detail";
import { getCoachSessionDetail } from "@/modules/coaching/queries/schedule";
import { appUrl } from "@/modules/payments/stripe";

// GET /dashboard/coach/sessions/<id>/calendar: the session as an .ics file
// (Add to calendar), with a reminder 30 minutes before. Only the coach who
// runs it can download it; anyone else gets a 404.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const coach = await requireCoach();
  const { id } = await params;
  const session = idSchema.safeParse(id).success ? await getCoachSessionDetail(coach.id, id) : null;
  if (!session) return new Response("Not found", { status: 404 });

  const athletes = session.athletes.filter((a) => a.status === "ACCEPTED").map((a) => a.name ?? a.email);
  const location = [session.clubName, session.facilityName, session.addressLine1, session.city].filter(Boolean).join(", ");
  const body = sessionIcs({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    location,
    description: [`${session.sportName} · ${session.facilityName}`, athletes.length ? `Athletes: ${athletes.join(", ")}` : "No athletes yet"].join("\n"),
    url: appUrl(`/dashboard/coach/sessions/${session.id}`),
    cancelled: session.status === "CANCELLED",
  });
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="nexport-session-${session.startsAt.toISOString().slice(0, 10)}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
