import { Injectable } from "@nestjs/common";
import el from "../i18n/el.json";
import en from "../i18n/en.json";

export type Locale = "el" | "en";

const CATALOGUES: Record<Locale, Record<string, unknown>> = { el, en };

/**
 * Error bodies in Greek and English (R43, R46). Greek is the default: a
 * request with no Accept-Language, or one asking for a language we do not
 * have, gets Greek.
 */
@Injectable()
export class I18nService {
  constructor(private readonly defaultLocale: Locale = "el") {}

  /** First language in the header we can serve, else the default. */
  resolve(acceptLanguage: string | undefined): Locale {
    if (!acceptLanguage) return this.defaultLocale;
    const tags = acceptLanguage
      .split(",")
      .map((part) => {
        const [tag, ...rest] = part.trim().split(";");
        const q = rest.find((r) => r.trim().startsWith("q="));
        return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split("=")[1]) : 1 };
      })
      .filter((t) => t.tag)
      .sort((a, b) => b.q - a.q);

    for (const { tag } of tags) {
      const base = tag.split("-")[0];
      if (base === "el" || base === "en") return base;
      if (tag === "*") return this.defaultLocale;
    }
    return this.defaultLocale;
  }

  /**
   * Look a key up. A key with no translation comes back as the key itself,
   * which is ugly on purpose — the i18n parity check catches it in CI before
   * a user ever sees it.
   */
  translate(key: string, locale: Locale, params: Record<string, string> = {}): string {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        CATALOGUES[locale],
      );
    if (typeof value !== "string") return key;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  }
}
