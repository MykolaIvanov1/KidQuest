import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../app/providers/ThemeProvider';
import { uk } from '../../lib/i18n';
export function ThemeButton() {
  const { dark, toggle } = useTheme();
  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggle}
      aria-label={dark ? uk.light : uk.dark}
      title={uk.theme}
    >
      {dark ? <Sun size={21} /> : <Moon size={21} />}
    </button>
  );
}
