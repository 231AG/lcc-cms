import { courseCodeKey } from "./courseCode";

/**
 * "Did you mean BSPH401?" -- catching the typo that would otherwise create
 * a second, nearly identical course.
 *
 * This exists because the Add-an-offering form can now create a course
 * that isn't on record. That removes four screens of work from the common
 * case and introduces exactly one new risk: an Admin mistypes a code, the
 * system faithfully creates the course they described, and the College
 * ends up with BSPH401 and BSPH4O1 both collecting registrations and
 * grades. A duplicate course is expensive to unpick afterwards -- the
 * registrations and grade records that accumulate under it are real -- so
 * the cheap moment to catch it is before the INSERT.
 *
 * Pure functions over plain strings, in their own module, so the matching
 * rules can be unit tested without a database.
 */

/**
 * The characters people actually confuse when typing a course code, folded
 * together: letter O and digit zero, letter I and lowercase L and digit
 * one, letter S and digit five, letter B and digit eight.
 *
 * This is the typo class that matters here, because a course code is
 * letters followed by digits and the boundary between them is exactly
 * where a hand slips. "BSPH4O1" and "BSPH401" differ by one character that
 * looks identical in most typefaces; catching that pair is most of this
 * function's value.
 */
function foldConfusables(key: string): string {
  return key.replace(/[oilsb]/g, (ch) => {
    switch (ch) {
      case "o":
        return "0";
      case "i":
      case "l":
        return "1";
      case "s":
        return "5";
      case "b":
        return "8";
      default:
        return ch;
    }
  });
}

/**
 * Levenshtein distance, capped: it stops as soon as the answer is known to
 * exceed `max`, because "very different" and "extremely different" are the
 * same answer to a caller asking whether two codes are near-misses.
 */
export function editDistanceAtMost(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    // Every remaining row can only add to the minimum, so once the best
    // cell in a row is already past the cap the answer cannot come back.
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

export interface CourseLike {
  code: string;
  title: string;
}

/**
 * Existing courses whose code is close enough to `code` that the Admin may
 * have meant one of them.
 *
 * Two rules, either of which is enough:
 *
 *   - one character apart after normalising (a slip, a doubled key, a
 *     missing digit); or
 *   - identical once the confusable characters above are folded together
 *     (the O-for-zero class, which reads as no difference at all).
 *
 * An exact match is never a suggestion: the caller only asks this when the
 * code resolved to nothing, and a course that IS the code would have been
 * found already.
 *
 * Deliberately narrow. A suggestion list that includes every course in the
 * same subject would be noise, and noise in a confirmation step is worse
 * than no confirmation -- people learn to click past it.
 */
export function findNearbyCourseCodes(code: string, courses: readonly CourseLike[], limit = 4): CourseLike[] {
  const key = courseCodeKey(code);
  if (!key) return [];
  const folded = foldConfusables(key);

  const scored: { course: CourseLike; distance: number }[] = [];
  for (const candidate of courses) {
    const candidateKey = courseCodeKey(candidate.code);
    if (candidateKey === key) continue;
    const distance = editDistanceAtMost(key, candidateKey, 1);
    if (distance <= 1) {
      scored.push({ course: candidate, distance });
      continue;
    }
    if (foldConfusables(candidateKey) === folded) {
      // Folded-equal is the strongest signal there is short of an exact
      // match, so it sorts ahead of a plain one-character difference.
      scored.push({ course: candidate, distance: 0 });
    }
  }

  return scored
    .sort((a, b) => a.distance - b.distance || a.course.code.localeCompare(b.course.code))
    .slice(0, limit)
    .map((s) => s.course);
}
