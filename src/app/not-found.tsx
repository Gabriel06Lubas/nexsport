import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex max-w-7xl flex-col items-start px-4 py-28 sm:px-6">
        <p className="font-mono text-sm text-accent-text">404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Out of bounds.</h1>
        <p className="mt-4 max-w-md text-lg text-muted-foreground">This page doesn’t exist. Let’s get you back in play.</p>
        <ButtonLink href="/" className="mt-8">
          Back to home
        </ButtonLink>
      </main>
      <SiteFooter />
    </>
  );
}
