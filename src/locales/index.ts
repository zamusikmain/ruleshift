import { en, type TextKey } from "./en";
import { ru } from "./ru";
export type Locale = "en" | "ru";
export type { TextKey };
export function detectLocale(saved: unknown, browserLanguage: string): Locale {
  return saved === "en" || saved === "ru"
    ? saved
    : browserLanguage.toLowerCase().startsWith("ru")
      ? "ru"
      : "en";
}
let stored: string | null = null;
try {
  stored = localStorage.getItem("ruleshift.language");
} catch {
  /* Storage is optional. */
}
let locale: Locale = detectLocale(
  stored,
  typeof navigator === "undefined" ? "en" : navigator.language,
);
export const getLocale = (): Locale => locale;
export function t(
  key: TextKey,
  values: Record<string, string | number> = {},
): string {
  return (locale === "ru" ? ru[key] : en[key]).replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? ""),
  );
}
export function setLocale(value: Locale): void {
  locale = value;
  try {
    localStorage.setItem("ruleshift.language", value);
  } catch {
    /* Storage is optional. */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("languagechange"));
}
