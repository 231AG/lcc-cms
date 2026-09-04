import { randomInt } from "node:crypto";

/**
 * The alphabet a student's temporary password is drawn from: lowercase
 * letters and the digits 1-9. No uppercase, no symbols, and **no zero** --
 * these credentials are written down and handed to a student, and 0/O is
 * the one pair that is regularly mistyped. Excluding "0" is exactly what
 * was asked for; nothing further was dropped on our own initiative, since
 * every character removed shrinks the keyspace.
 */
export const TEMP_PASSWORD_ALPHABET = "abcdefghijklmnopqrstuvwxyz123456789";
export const TEMP_PASSWORD_LENGTH = 10;

/**
 * A 10-character temporary password for a student account (35^10 ~= 2.8e15
 * combinations). Deliberately simpler than the 16-random-byte base64url
 * string it replaces, which mixed case, digits and "-"/"_" and was, in
 * practice, too complex for the students it is handed to. It stays
 * single-use: every path that issues one also sets must_change_password,
 * so it only ever has to survive one login.
 *
 * `randomInt` (a CSPRNG with internal rejection sampling) rather than
 * `randomBytes(n)[i] % 35`, which would bias the first 256 % 35 = 11
 * characters of the alphabet upward.
 *
 * Staff accounts keep their own, longer generator in lib/identity/
 * accounts.ts -- an Admin/Super Admin credential is not the one that
 * needed simplifying.
 */
export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}
