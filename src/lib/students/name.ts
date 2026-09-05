/**
 * How a student's name is assembled, in one place.
 *
 * A middle name is optional (and, for most records, absent), so every
 * display site would otherwise carry its own `middleName ? ... : ...`
 * branch and they would drift. These two functions are the only sanctioned
 * ways to turn the three name columns into text -- one for running prose
 * ("MAMAI Z. GBORZEE"), one for an alphabetical list ("Gborzee, Mamai Z.").
 *
 * Pure string functions over the three columns, so they work equally on a
 * full student row, a joined projection, or a fixture.
 */

export interface NameParts {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}

/** The middle name as it appears inside a name: an initial, not the whole word. */
function middleInitial(middleName?: string | null): string {
  const trimmed = middleName?.trim();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}.` : "";
}

/** "Mamai Z. Gborzee" -- the natural reading order, for headings and prose. */
export function fullName(parts: NameParts): string {
  return [parts.firstName, middleInitial(parts.middleName), parts.lastName].filter(Boolean).join(" ");
}

/** "Gborzee, Mamai Z." -- surname first, for anything sorted by last name. */
export function listName(parts: NameParts): string {
  const given = [parts.firstName, middleInitial(parts.middleName)].filter(Boolean).join(" ");
  return `${parts.lastName}, ${given}`;
}

/** First + last initials. The middle name is deliberately left out: an avatar
 * chip has room for two letters, and the pair people recognise is F/L. */
export function initials(parts: NameParts): string {
  return `${parts.firstName.charAt(0)}${parts.lastName.charAt(0)}`.toUpperCase();
}
