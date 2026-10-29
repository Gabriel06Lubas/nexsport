import { Bell, CalendarCheck, CalendarX, CreditCard, Heart, UserPlus } from "lucide-react";

import { AppFrame } from "./app-frame";

const items = [
  { icon: CalendarCheck, text: "Coach Lucía invited you to U14 Drills · Sat 10:00", time: "now", unread: true },
  { icon: CreditCard, text: "Payment of €18.00 for Padel Clinic received", time: "12m", unread: true },
  { icon: CalendarX, text: "Thursday Fitness was cancelled. Full refund issued.", time: "1h", unread: false },
  { icon: UserPlus, text: "marta.plays started following you", time: "3h", unread: false },
  { icon: Heart, text: "Padel Central and 41 others liked your post", time: "5h", unread: false },
];

export function NotificationsMock() {
  return (
    <AppFrame title="Notifications">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Bell className="size-4" aria-hidden /> 2 unread
      </div>
      <ul className="space-y-1">
        {items.map((n) => (
          <li key={n.text} className={n.unread ? "flex items-start gap-3 rounded-lg bg-muted p-2.5" : "flex items-start gap-3 rounded-lg p-2.5"}>
            <n.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="flex-1 text-sm">{n.text}</p>
            <span className="text-xs text-muted-foreground">{n.time}</span>
            {n.unread && <span className="mt-1.5 size-2 rounded-full bg-chart-1" aria-label="Unread" />}
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}
