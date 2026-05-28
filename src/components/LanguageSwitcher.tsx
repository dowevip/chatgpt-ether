import React from 'react';

import { Globe } from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';
import type { AppLanguage } from '../utils/language';
import { Button } from './ui/button';

const POPUP_LANGUAGE_LABELS: Record<'zh' | 'en', string> = {
  zh: '中文',
  en: 'English',
};

function getNextPopupLanguage(language: AppLanguage): 'zh' | 'en' {
  return language === 'zh' ? 'en' : 'zh';
}

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const nextLanguage = getNextPopupLanguage(language);

  const toggleLanguage = () => {
    setLanguage(nextLanguage);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      title={`${language === 'zh' ? '切换到' : 'Switch to'} ${POPUP_LANGUAGE_LABELS[nextLanguage]}`}
      className="h-9 w-9"
    >
      <Globe className="h-4 w-4" />
      <span className="sr-only">{language === 'zh' ? '切换语言' : 'Toggle language'}</span>
    </Button>
  );
};
