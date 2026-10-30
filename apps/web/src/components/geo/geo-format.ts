/** "85 m", "1,2 km": the distance in the API's whole metres, written for a seller. */
export function formatDistance(m: number, locale = 'fr-DZ'): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}
