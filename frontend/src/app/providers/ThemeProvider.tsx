import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('kidquest-theme');
      return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('kidquest-theme', dark ? 'dark' : 'light');
    } catch {
      /* Storage can be disabled. */
    }
  }, [dark]);
  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark((value) => !value) }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
