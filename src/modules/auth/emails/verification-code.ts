import type { OutgoingEmail } from "@/modules/notifications/email";

import { CODE_TTL_SECONDS } from "../lib/email-code-policy";

// The email carries nothing the user typed except the address it is sent to,
// so there is no user content to inject into the HTML. The code itself is
// always exactly 6 digits (validated before this is called).

export function verificationCodeEmail(to: string, code: string, purpose: "SIGN_IN" | "VERIFY_EMAIL"): OutgoingEmail {
  if (!/^\d{6}$/.test(code)) throw new Error("Refusing to email a malformed code");
  const minutes = CODE_TTL_SECONDS / 60;
  const intro = purpose === "SIGN_IN" ? "Use this code to sign in to nexport:" : "Use this code to confirm your email address on nexport:";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  return {
    to,
    subject: `${spaced} is your nexport code`,
    text: `${intro}\n\n${spaced}\n\nThe code expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email: nobody can sign in without the code.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 8px;font-weight:600;font-size:18px">nexport</p>
<p style="margin:0 0 20px;font-size:15px">${intro}</p>
<p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace">${spaced}</p>
<p style="margin:0;font-size:13px;color:#586172">The code expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email: nobody can sign in without the code.</p>
</td></tr></table></body></html>`,
  };
}
