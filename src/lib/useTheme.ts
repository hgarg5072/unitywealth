import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'uw_theme';

function computeEffectiveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

function applyDomTheme(mode: ThemeMode): boolean {
  const isDark = computeEffectiveDark(mode);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.getElementById('uw-theme-color') || document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', isDark ? '#020617' : '#ffffff');
    }
  }
  return isDark;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {}
    return 'light';
  });

  const [isDark, setIsDark] = useState<boolean>(() => computeEffectiveDark(theme));

  useEffect(() => {
    const nextDark = applyDomTheme(theme);
    setIsDark(nextDark);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}

    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        setIsDark(applyDomTheme('system'));
      };
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
  }, [theme]);

  const cycleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'));
  };

  return { theme, setTheme: setThemeState, isDark, cycleTheme };
}
