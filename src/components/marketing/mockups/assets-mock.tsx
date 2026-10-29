import { Lightbulb } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { AppFrame } from "./app-frame";

const facilities = [
  { name: "Court 1", type: "Padel court", surface: "Synthetic", indoor: true, lit: true, rate: "€24/h" },
  { name: "Court 2", type: "Padel court", surface: "Synthetic", indoor: false, lit: true, rate: "€20/h" },
  { name: "Main pitch", type: "Football pitch", surface: "Artificial turf", indoor: false, lit: true, rate: "€90/h" },
  { name: "Studio A", type: "Studio", surface: "Wood", indoor: true, lit: false, rate: "€35/h" },
];

export function FacilitiesMock() {
  return (
    <AppFrame title="Facilities">
      <ul className="divide-y divide-border">
        {facilities.map((f) => (
          <li key={f.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">
                {f.type} · {f.surface}
              </p>
            </div>
            <Badge variant="outline">{f.indoor ? "Indoor" : "Outdoor"}</Badge>
            {f.lit && (
              <Badge variant="outline">
                <Lightbulb className="size-3" aria-hidden /> Lit
              </Badge>
            )}
            <span className="w-14 text-right text-sm tabular-nums">{f.rate}</span>
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}

const inventory = [
  { name: "Ball tubes", stock: 40, reserved: 28, condition: "Good" },
  { name: "Ball machine", stock: 2, reserved: 2, condition: "Good" },
  { name: "Rental rackets", stock: 16, reserved: 5, condition: "Fair" },
  { name: "Training cones", stock: 60, reserved: 0, condition: "New" },
  { name: "Rowing machine", stock: 1, reserved: 0, condition: "Needs repair" },
];

export function EquipmentMock() {
  return (
    <AppFrame title="Equipment · reserved today">
      <ul className="space-y-3">
        {inventory.map((i) => {
          const free = i.stock - i.reserved;
          return (
            <li key={i.name}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{i.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {i.reserved}/{i.stock} reserved · <span className={free === 0 ? "font-semibold text-foreground" : ""}>{free} free</span>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(i.reserved / i.stock) * 100}%` }} />
                </div>
                <Badge variant={i.condition === "Needs repair" ? "warning" : "neutral"} className="w-24 justify-center">
                  {i.condition}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </AppFrame>
  );
}

const permissions = ["Schedule", "Facilities", "Members", "Billing", "Analytics"] as const;
const staff: { name: string; role: string; grants: (typeof permissions)[number][] }[] = [
  { name: "Elena Vidal", role: "Owner", grants: [...permissions] },
  { name: "Marc Soler", role: "Staff · Manager", grants: ["Schedule", "Facilities", "Members", "Analytics"] },
  { name: "Julia Park", role: "Staff · Front desk", grants: ["Schedule", "Members"] },
  { name: "Lucía Romero", role: "Coach", grants: ["Schedule"] },
];

export function PermissionsMock() {
  return (
    <AppFrame title="People · roles & permissions">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">
                Member
              </th>
              {permissions.map((p) => (
                <th key={p} scope="col" className="pb-2 text-center font-medium">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((s) => (
              <tr key={s.name}>
                <th scope="row" className="py-2.5 text-left font-normal">
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.role}</span>
                </th>
                {permissions.map((p) => (
                  <td key={p} className="text-center">
                    {s.grants.includes(p) ? (
                      <span className="inline-block size-4 rounded-full bg-chart-1" role="img" aria-label="Allowed" />
                    ) : (
                      <span className="inline-block size-4 rounded-full border border-border" role="img" aria-label="Not allowed" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppFrame>
  );
}
