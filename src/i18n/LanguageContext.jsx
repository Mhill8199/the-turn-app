import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SUPPORTED_LANGS, TRANSLATIONS, translate } from './translations';

const STORAGE_KEY = 'the-turn-lang';
const LanguageContext = createContext(null);

function detectNavigatorLang() {
  if (typeof navigator === 'undefined') return 'en';
  const tags = [];
  if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
  if (navigator.language) tags.push(navigator.language);
  for (const tag of tags) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (SUPPORTED_LANGS.includes(base)) return base;
  }
  return 'en';
}

function readInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch {
    /* private mode or blocked storage */
  }
  return detectNavigatorLang();
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readInitialLang);

  const setLang = useCallback((next) => {
    if (!SUPPORTED_LANGS.includes(next)) return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((key) => translate(lang, key), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

export function LanguageSelector() {
  const { lang, setLang, t } = useLanguage();

  return (
    <select
      aria-label={t('chooseLanguage')}
      value={lang}
      onChange={(event) => setLang(event.target.value)}
      className="min-h-[44px] text-xs rounded-lg border px-1.5 max-w-[6.5rem]"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--bg-elevated)',
        color: 'inherit',
      }}
    >
      {SUPPORTED_LANGS.map((code) => (
        <option key={code} value={code}>
          {TRANSLATIONS[code].languageName}
        </option>
      ))}
    </select>
  );
}
