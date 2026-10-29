import type { Metadata } from "next";

import { ContactForm } from "@/components/marketing/contact-form";
import { PageHero } from "@/components/marketing/section";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact & demo",
  description: "Book a nexport demo or ask us anything.",
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="See nexport with your own club."
        description="Tell us a little about your club and we’ll set up a walkthrough with your sports, facilities and pricing."
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <ContactForm />
        <aside className="space-y-6 text-sm">
          <div>
            <h2 className="font-semibold">Prefer email?</h2>
            <a href={`mailto:${siteConfig.contactEmail}`} className="mt-1 inline-block text-accent-text hover:underline">
              {siteConfig.contactEmail}
            </a>
          </div>
          <div>
            <h2 className="font-semibold">In a demo we’ll cover</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Setting up your facilities, kit and sports</li>
              <li>Inviting staff and coaches with the right access</li>
              <li>Scheduling, invites and attendance</li>
              <li>Payments, payouts and cancellation policies</li>
              <li>Moving your members across</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
