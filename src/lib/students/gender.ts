/**
 * How a stored gender is written on screen.
 *
 * One map, used by the profile, the listing, the exports and the prints, so
 * "MALE" is never spelled one way in a table and another on a printed roll.
 * The empty key covers a student enrolled before the field existed: the
 * column is nullable on purpose, and "—" says "not recorded" without
 * pretending to know.
 */
export const GENDER_LABEL: Record<string, string> = {
  MALE: "Male",
  FEMALE: "Female",
  "": "—",
};

/** The display value for a possibly-absent stored gender. */
export function genderLabel(gender: string | null | undefined): string {
  return GENDER_LABEL[gender ?? ""] ?? "—";
}
