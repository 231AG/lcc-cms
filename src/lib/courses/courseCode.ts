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
