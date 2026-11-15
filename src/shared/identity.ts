export const PALETTE = [
  0xb9fa6a, 0x65dce9, 0xff8acb, 0xffc65c, 0xc49bff, 0x7eaaff, 0xff9273,
  0xeff5ff,
] as const;
export function validateName(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.trim().normalize("NFC").replace(/ +/g, ' ');
  return /^[\p{Script=Latin}\p{Script=Cyrillic}0-9 _-]{3,16}$/u.test(name)
    ? name
    : null;
}
// Existing stored names remain readable; this policy applies to new choices.
export function validateNickname(value:unknown):string|null {
 const name=validateName(value);
 if(!name || /(?:^|[ _-])(admin(?:istrator)?|moderator|ruleshift|админ(?:истратор)?|модератор)(?:$|[ _-])/iu.test(name))return null;
 return name;
}
export const validColor = (value: unknown): value is number =>
  Number.isInteger(value) &&
  Number(value) >= 0 &&
  Number(value) < PALETTE.length;
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const validRoomCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value);
export function createRoomCode(bytes: Uint8Array): string {
  return Array.from(
    bytes.slice(0, 6),
    (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length],
  ).join("");
}
