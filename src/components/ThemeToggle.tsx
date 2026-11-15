import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeMode } from '../lib/useTheme';

interface ThemeToggleProps {
  theme: ThemeMode;
  isDark: boolean;
  onChange: (next: ThemeMode) => void;
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme,
  isDark,
  onChange,
  compact = false
}) => {
  if (compact) {
    const nextMode: ThemeMode = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    const label =
      theme === 'light' ? 'Light theme (click for Dark)' : theme === 'dark' ? 'Dark theme (click for Auto)' : 'System theme (click for Light)';
    return (
      <button
        type="button"
        onClick={() => onChange(nextMode)}
        aria-label={label}
        title={label}
        className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors relative"
      >
        {theme === 'system' ? (
          <Monitor size={18} />
        ) : isDark ? (
          <Moon size={18} className="text-indigo-400" />
        ) : (
          <Sun size={18} className="text-amber-500" />
        )}
      </button>
    );
  }

  const options: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: 'Light', icon: <Sun size={13} /> },
    { id: 'dark', label: 'Dark', icon: <Moon size={13} /> },
    { id: 'system', label: 'Auto', icon: <Monitor size={13} /> }
  ];

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 gap-0.5"
    >
      {options.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
              active
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};
