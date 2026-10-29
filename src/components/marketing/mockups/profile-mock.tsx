import { Lock, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { AppFrame } from "./app-frame";

export function ProfileMock() {
  return (
    <AppFrame title="Profile · @sara.ortiz">
      <div aria-hidden className="h-24 rounded-xl bg-[linear-gradient(120deg,#0b1220,#24405f_55%,#5a7d00)]" />
      <div className="-mt-8 flex items-end justify-between px-2">
        <span aria-hidden className="grid size-16 place-items-center rounded-full border-4 border-card bg-lime text-lg font-bold text-lime-foreground">
          SO
        </span>
        <span className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-ink-foreground">Follow</span>
      </div>
      <div className="px-2 pt-3">
        <p className="flex items-center gap-1.5 font-semibold">
          Sara Ortiz <Lock className="size-3.5 text-muted-foreground" aria-label="Private profile" />
        </p>
        <p className="text-sm text-muted-foreground">@sara.ortiz</p>
        <p className="mt-2 text-sm">U14 padel at Padel Central. Lefty. Working on my bandeja 🎾</p>
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> Valencia, ES
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="lime">Padel · Intermediate</Badge>
          <Badge variant="neutral">Tennis · Beginner</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-3 border-t border-border pt-3 text-center">
          {[
            ["Posts", "38"],
            ["Followers", "214"],
            ["Following", "180"],
          ].map(([k, v]) => (
            <div key={k}>
              <dd className="font-semibold tabular-nums">{v}</dd>
              <dt className="text-xs text-muted-foreground">{k}</dt>
            </div>
          ))}
        </dl>
      </div>
    </AppFrame>
  );
}
