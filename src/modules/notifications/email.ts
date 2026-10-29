import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

// Outgoing email over SMTP (works with Resend, Postmark, SES, Mailgun, Gmail…).
// Configure with SMTP_* and EMAIL_FROM in .env. In development without
// SMTP_HOST, messages are printed to the terminal instead of being sent; in
// production a missing configuration is an error, never a silent no-op.

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("EMAIL_FROM"));
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT") ?? 587),
    // true for port 465 (implicit TLS); otherwise STARTTLS is required below.
    secure: env("SMTP_SECURE") === "true",
    requireTLS: env("SMTP_SECURE") !== "true" && process.env.NODE_ENV === "production",
    auth: env("SMTP_USER") ? { user: env("SMTP_USER")!, pass: env("SMTP_PASSWORD") ?? "" } : undefined,
    // Defence in depth: never let message content pull in local files or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email is not configured: set SMTP_HOST and EMAIL_FROM.");
    }
    console.info(`\n[email] (SMTP not configured, printing instead of sending)\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
    return;
  }
  await getTransporter().sendMail({ from: env("EMAIL_FROM"), ...message });
}
