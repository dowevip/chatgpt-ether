export const APP_LANGUAGES = ['zh', 'en'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const APP_LANGUAGE_LABELS: Record<AppLanguage, string> = {
  zh: '简体中文',
  en: 'English',
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

export function normalizeLanguage(lang: string | undefined | null): AppLanguage {
  if (!lang) return 'zh';
  const lower = lang.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  return 'en';
}

export function getNextLanguage(current: AppLanguage): AppLanguage {
  const idx = APP_LANGUAGES.indexOf(current);
  if (idx < 0) return 'zh';
  return APP_LANGUAGES[(idx + 1) % APP_LANGUAGES.length];
}
