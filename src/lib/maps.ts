/** A Google Maps search for a place (opens the Maps app on phones). Empty parts are skipped; everything is URL-encoded. */
export function directionsUrl(parts: readonly (string | null | undefined)[]): string {
  const query = parts.filter((p): p is string => !!p && p.trim() !== "").join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
