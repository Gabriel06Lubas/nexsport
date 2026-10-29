import { Heart, MessageCircle, Share2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { AppFrame } from "./app-frame";

export function FeedMock() {
  return (
    <AppFrame title="Feed">
      <article className="rounded-xl border border-border">
        <header className="flex items-center gap-3 p-4">
          <span aria-hidden className="grid size-10 place-items-center rounded-full bg-lime text-sm font-bold text-lime-foreground">PC</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              Padel Central <Badge variant="outline" className="ml-1 align-middle">Club</Badge>
            </p>
            <p className="text-xs text-muted-foreground">@padelcentral · 2h</p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold">Following</span>
        </header>
        <p className="px-4 text-sm">
          Our U14 squad just won the regional league 🏆 Huge effort from everyone. Thanks to coaches Lucía and Tom for an amazing season!
        </p>
        <div aria-hidden className="mx-4 mt-3 grid h-40 grid-cols-3 gap-1 overflow-hidden rounded-lg">
          <div className="col-span-2 bg-[linear-gradient(135deg,#1f3a2b,#2f6b46_60%,#c8f031)]" />
          <div className="grid gap-1">
            <div className="bg-[linear-gradient(135deg,#0b1220,#24405f)]" />
            <div className="bg-[linear-gradient(135deg,#3b2f63,#7a5cc7)]" />
          </div>
        </div>
        <footer className="flex items-center gap-5 px-4 py-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-danger">
            <Heart className="size-4 fill-current" aria-hidden /> 248
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="size-4" aria-hidden /> 31
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Share2 className="size-4" aria-hidden /> Share
          </span>
        </footer>
        <div className="border-t border-border px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">marta.plays</span> So proud of these kids 👏
          </p>
          <p className="mt-1.5 pl-4 text-sm">
            <span className="font-semibold">coach.lucia</span> They earned every point. Next stop: nationals!
          </p>
        </div>
      </article>
    </AppFrame>
  );
}
