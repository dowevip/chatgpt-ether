import React, { useEffect } from 'react';

import { Moon, Sun } from 'lucide-react';

import { useDarkMode } from '../hooks/useDarkMode';
import { Button } from './ui/button';

const DARK_MODE_STORAGE_KEY = 'darkMode';

function publishDarkModePreference(isDark: boolean): void {
  try {
    void chrome.storage?.local?.set({ [DARK_MODE_STORAGE_KEY]: String(isDark) });
  } catch {
    // The popup localStorage value remains the source of truth if extension storage is unavailable.
  }
}

export const DarkModeToggle: React.FC = () => {
  const { isDark, toggleDarkMode } = useDarkMode();

  useEffect(() => {
    publishDarkModePreference(isDark);
  }, [isDark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        publishDarkModePreference(!isDark);
        toggleDarkMode(e);
      }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="h-9 w-9"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="sr-only">Toggle dark mode</span>
    </Button>
  );
};
