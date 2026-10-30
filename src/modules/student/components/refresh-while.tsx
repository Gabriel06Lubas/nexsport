"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page every 2 s (up to 30 s) while `active`, e.g. until a webhook confirms a payment. */
export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const timer = setInterval(() => (++n > 15 ? clearInterval(timer) : router.refresh()), 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
