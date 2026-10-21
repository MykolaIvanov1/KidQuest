import { Bot, Sparkle } from 'lucide-react';
import { uk } from '../../lib/i18n';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Bot size={26} strokeWidth={2.2} />
        <Sparkle size={12} className="brand-star" />
      </span>
      {uk.app}
      <span className="brand-dot">.</span>
    </span>
  );
}
