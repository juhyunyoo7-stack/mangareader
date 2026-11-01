import { en } from './en.ts';
import { ko } from './ko.ts';

type Widen<T> = T extends string
  ? string
  : T extends (...a: infer A) => string
    ? (...a: A) => string
    : { [K in keyof T]: Widen<T[K]> };

/** Shape every locale must satisfy: the key set of `en.ts`, with plain `string` values. */
export type Dict = Widen<typeof en>;

/**
 * To add a language: create `src/i18n/<code>.ts` exporting a `Dict`, register it here and add its
 * name to `LOCALE_NAMES`. The compiler lists every missing key.
 */
export const LOCALES = { ko, en } satisfies Record<string, Dict>;
export type LocaleCode = keyof typeof LOCALES;
export const LOCALE_NAMES: Record<LocaleCode, string> = { ko: '한국어', en: 'English' };
export const DEFAULT_LOCALE: LocaleCode = 'ko';
const KEY = 'mr.locale';

function pick(): LocaleCode {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (v && v in LOCALES) return v as LocaleCode;
  } catch {
    /* storage blocked: use the default */
  }
  return DEFAULT_LOCALE;
}

/** The active locale, fixed for the life of the page (changing it reloads). */
export const locale: LocaleCode = pick();
export const S: Dict = LOCALES[locale];

export function setLocale(code: LocaleCode): void {
  localStorage.setItem(KEY, code);
  location.reload();
}
