/**
 * "criminal justice" -> "Criminal Justice", for the transcript's personal,
 * academic and admission boxes.
 *
 * Only the first letter of each word is raised; the rest of the word is
 * left exactly as typed, so "LCC", "McGee" and "St. John's" survive. The
 * short joining words stay lower case unless they open the value -- the
 * College writes its own department as "International Business and
 * Management", and "And" there would read as a typo. A hyphenated name
 * is two words ("Wleh-Kpanbaye").
 *
 * The degree is NOT passed through this: "BSc" and "BA" are abbreviations
 * with their own casing, and the transcript prints them as entered.
 */
const JOINING_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

export function titleCase(value: string): string {
  let index = 0;
  return value.replace(/[^\s-]+/g, (word) => {
    const first = index++ === 0;
    if (!first && JOINING_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}
