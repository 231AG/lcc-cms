/**
 * How a course code reads to a person: "ACCT 101", not "ACCT101".
 *
 * Display only. The stored code is the identifier -- it is what an Admin
 * typed, what the prerequisite form resolves against, and what a grade
 * record snapshots at the moment it is written. Rewriting it in the
 * database would mean a migration over live rows in service of a space,
 * and would break every place that matches a code against what someone
 * typed. So the space is put in on the way out and never on the way in.
 *
 * The split is at the first digit, which is the only rule a course code
 * here actually follows: letters name the subject, digits name the level.
 * A code that does not fit that shape is passed through untouched rather
 * than guessed at -- an imported historical record may hold anything, and
 * inventing a space inside it would misquote the record.
 */
export function formatCourseCode(code: string): string {
  const trimmed = code.trim();
  const match = /^([A-Za-z]+)\s*(\d.*)$/.exec(trimmed);
  return match ? `${match[1]} ${match[2]}` : trimmed;
}

/**
 * The form of a course code used for MATCHING -- lowercase, with every space
 * removed. Never displayed.
 *
 * "CECS 201", "cecs201" and "CECS  201" are the same course to a person, and
 * a person typing a code into a search box or a prerequisite form has no way
 * of knowing which spelling the database happens to hold. Comparing the
 * stored text directly meant the spelling had to be guessed exactly: a
 * course stored as "CECS201" could not be found by typing "CECS 201", and
 * the screen reported "No course with the code" -- which reads as "this
 * course does not exist" rather than "you put a space in".
 *
 * Display is the other half of the same problem and is handled by
 * formatCourseCode: everything is SHOWN spaced and MATCHED unspaced, so what
 * a reader sees can always be typed back in.
 */
export function courseCodeKey(code: string): string {
  return code.replace(/\s+/g, "").toLowerCase();
}

/**
 * Which code the Add-an-offering form is actually talking about.
 *
 * There are two boxes that can carry one: the Course box at the top, and
 * the code inside the "not on record yet" panel. The panel's is
 * pre-filled from the Course box, so they normally agree -- but when they
 * do not, the panel wins. It is the more specific statement of intent
 * (somebody opened the panel and typed a code into it), and nothing is
 * written until the confirmation step prints the exact code back.
 *
 * Blank does not win. A panel left empty falls through to the Course box
 * rather than blanking the code, which is what makes the panel optional.
 */
export function effectiveCourseCode(formCode: string, panelCode: string): string {
  return panelCode.trim() || formCode;
}
