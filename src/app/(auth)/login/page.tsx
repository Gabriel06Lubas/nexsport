import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signInWithProvider } from "@/modules/auth/actions";
import { AppleIcon, GoogleIcon } from "@/modules/auth/components/provider-icons";
import { getCurrentUser } from "@/modules/auth/dal";
import { safeCallbackUrl } from "@/modules/auth/lib/redirects";
import { configuredProviderIds } from "@/modules/auth/providers";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Auth.js reports failures as ?error=<code>. Codes are mapped to plain
// messages; unknown codes get a generic one (never echo the raw value).
const errorMessages: Record<string, string> = {
  AccessDenied: "We couldn't verify the email address on that account. Use an account with a verified email.",
  OAuthAccountNotLinked: "That account is already linked to a different nexport user.",
  Configuration: "Sign-in is temporarily unavailable. Please try again shortly.",
  Verification: "That sign-in link has expired. Please try again.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const callbackUrl = safeCallbackUrl(first(params.callbackUrl));

  const error = first(params.error);
  // Signed-in users skip the page, unless there is an error to show (e.g.
  // connecting a second provider that belongs to another account).
  if (!error && (await getCurrentUser())) redirect(callbackUrl as Route);

  const signedOut = first(params.signedOut);
  const providers = configuredProviderIds();

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_24px_60px_-30px_rgb(11_18_32/0.35)] sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to nexport</h1>
        <p className="mt-2 text-sm text-muted-foreground">New here? Signing in creates your account.</p>

        {error && (
          <p role="alert" className="mt-5 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {errorMessages[error] ?? "Something went wrong while signing you in. Please try again."}
          </p>
        )}
        {signedOut && !error && (
          <p role="status" className="mt-5 rounded-xl bg-success-soft p-3 text-sm text-success">
            {signedOut === "all" ? "You've been signed out on all your devices." : "You've been signed out."}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {providers.includes("google") && (
            <form action={signInWithProvider.bind(null, "google", callbackUrl)}>
              <button
                type="submit"
                className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f2f2f2]"
              >
                <GoogleIcon className="size-5" /> Continue with Google
              </button>
            </form>
          )}
          {providers.includes("apple") && (
            <form action={signInWithProvider.bind(null, "apple", callbackUrl)}>
              <button
                type="submit"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-black text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                <AppleIcon className="size-5" /> Continue with Apple
              </button>
            </form>
          )}
          {providers.length === 0 && (
            <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
              {process.env.NODE_ENV === "production"
                ? "Sign-in is temporarily unavailable."
                : "No sign-in providers are configured. Set AUTH_SECRET plus AUTH_GOOGLE_* and/or AUTH_APPLE_* in .env (see .env.example)."}
            </p>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          We only receive your name and verified email from Google or Apple. We never see or store your password.
        </p>
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}
