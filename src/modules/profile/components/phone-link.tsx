import { formatPhone } from "../lib/personal";

/** A stored E.164 number as a tappable tel: link, or nothing. */
export function PhoneLink({ phone, className = "text-xs text-muted-foreground hover:underline" }: { phone: string | null | undefined; className?: string }) {
  const shown = formatPhone(phone);
  if (!phone || !shown) return null;
  return (
    <a href={`tel:${phone}`} className={className}>
      {shown}
    </a>
  );
}
