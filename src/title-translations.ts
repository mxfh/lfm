import type { Lang } from "./i18n";
import { TITLE_TRANSLATIONS } from "./title-translations.generated";

export function titleTranslationsFor(stableId: string, title: string): Partial<Record<Lang, string>> {
  return TITLE_TRANSLATIONS[stableId] ?? TITLE_TRANSLATIONS[title] ?? {};
}
