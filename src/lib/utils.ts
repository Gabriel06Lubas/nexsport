import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats minor units (cents) as currency, e.g. 3000 → "€30.00". */
export function formatMoney(minor: number, currency = "eur", locale = "en-IE") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
}
