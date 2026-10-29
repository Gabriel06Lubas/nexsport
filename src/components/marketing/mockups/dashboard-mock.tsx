import { ArrowUpRight, CalendarDays, Euro, Gauge, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { AppFrame } from "./app-frame";
import { BarChart } from "./bar-chart";

const kpis = [
  { label: "Revenue (30d)", value: "€18,420", delta: "+12%", icon: Euro },
  { label: "Active members", value: "412", delta: "+28", icon: Users },
  { label: "Court utilisation", value: "74%", delta: "+6 pts", icon: Gauge },
  { label: "Sessions this week", value: "96", delta: "+9", icon: CalendarDays },
];

const utilisation = [
  { label: "Court 1", value: 88 },
  { label: "Court 2", value: 81 },
  { label: "Court 3", value: 69 },
  { label: "Court 4", value: 57 },
  { label: "Pitch A", value: 76 },
  { label: "Gym", value: 63 },
];

const staff = [
  { name: "Lucía Romero", role: "Head coach", sessions: 22, rating: "4.9" },
  { name: "Tom Becker", role: "Padel coach", sessions: 18, rating: "4.8" },
  { name: "Aisha Diallo", role: "Fitness coach", sessions: 15, rating: "4.9" },
];

export function DashboardMock({ compact = false }: { compact?: boolean }) {
  return (
    <AppFrame title="app.nexport.com / padel-central / dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs">{k.label}</span>
              <k.icon className="size-3.5" aria-hidden />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">{k.value}</p>
            <p className="mt-1 inline-flex items-center gap-0.5 text-xs text-success">
              <ArrowUpRight className="size-3" aria-hidden />
              {k.delta}
            </p>
          </div>
        ))}
      </div>
      <div className={compact ? "mt-4" : "mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]"}>
        <div className="rounded-xl border border-border p-4">
          <BarChart title="Utilisation by facility, last 30 days (%)" data={utilisation} max={100} suffix="%" />
        </div>
        {!compact && (
          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Coach output this month</p>
            <ul className="mt-3 divide-y divide-border">
              {staff.map((s) => (
                <li key={s.name} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
                    {s.name.split(" ").map((p) => p[0]).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{s.sessions}</p>
                    <p className="text-[10px] text-muted-foreground">sessions</p>
                  </div>
                  <Badge variant="neutral" className="tabular-nums">★ {s.rating}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
