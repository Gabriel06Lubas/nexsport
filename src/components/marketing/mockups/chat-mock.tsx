import { Send } from "lucide-react";

import { AppFrame } from "./app-frame";

const messages = [
  { from: "Coach Tom", me: false, text: "Tomorrow's session moves to Court 2, same time (18:00). Bring water, it's going to be hot!" },
  { from: "Sara", me: false, text: "Got it 👍 Can I bring my racket for restringing?" },
  { from: "You", me: true, text: "Same here, see you there!" },
  { from: "Coach Tom", me: false, text: "Sure Sara, drop it at the front desk." },
];

export function ChatMock() {
  return (
    <AppFrame title="Messages · U14 Padel squad (12)">
      <div className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.me ? "flex justify-end" : "flex"}>
            <div className={m.me ? "max-w-[80%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-ink-foreground" : "max-w-[80%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm"}>
              {!m.me && <p className="mb-0.5 text-xs font-semibold text-accent-text">{m.from}</p>}
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-full border border-border py-1.5 pl-4 pr-1.5">
        <span className="flex-1 text-sm text-muted-foreground">Message the squad…</span>
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-lime text-lime-foreground">
          <Send className="size-4" />
        </span>
      </div>
    </AppFrame>
  );
}
