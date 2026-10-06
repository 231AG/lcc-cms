/**
 * A stored calendar day ("2001-03-14") as the College prints it: "Mar 14, 2001".
 *
 * Read as a day, not an instant -- formatted at noon UTC so no time zone
 * can move it to the day before. One formatter for the transcript and the
 * profile, so the same date never reads two ways.
 */
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export function formatDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return DAY.format(new Date(Date.UTC(y, m - 1, d, 12)));
}
