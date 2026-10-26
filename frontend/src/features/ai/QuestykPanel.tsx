import { useEffect, useId, useRef } from 'react';
import { BookOpen, Bot, Sparkles, X } from 'lucide-react';
import type { AiIntent } from '@kidquest/types';
import { useAuth } from '../../app/providers/AuthProvider';
import { useAdvice } from './useAdvice';
import { aiUk } from './i18n';
import '../../styles/ai.css';

export default function QuestykPanel({
  taskId,
  childId,
  onClose,
}: {
  taskId?: string;
  childId?: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { scope, online, advice, intent, busy, error, ask } = useAdvice({ taskId, childId });
  const initialScope = useRef(scope);
  const titleId = useId();
  useEffect(() => {
    if (scope !== initialScope.current) onClose();
  }, [scope, onClose]);
  const actions: AiIntent[] = taskId
    ? ['TASK_HELP']
    : user?.role === 'PARENT'
      ? ['PROGRESS', 'QUEST_IDEAS', 'REWARD_IDEAS']
      : ['GREETING', 'MOTIVATE', 'PRAISE'];
  const Heading = taskId ? 'h4' : 'h3';
  return (
    <section
      className="questyk-panel"
      aria-labelledby={titleId}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="questyk-panel-heading">
        <Heading id={titleId}>
          <Bot size={21} />
          {aiUk.panelTitle}
        </Heading>
        <button type="button" className="icon-button" aria-label={aiUk.close} onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <p className="questyk-intro">{taskId ? aiUk.taskChoose : aiUk.choose}</p>
      {!online && (
        <p className="questyk-offline" role="status">
          {aiUk.offline}
        </p>
      )}
      <div className="questyk-actions">
        {actions.map((action) => (
          <button
            type="button"
            className="button tonal"
            key={action}
            disabled={busy || !user}
            onClick={() => void ask(action)}
          >
            {aiUk.actions[action]}
          </button>
        ))}
      </div>
      {busy && (
        <p className="questyk-loading" role="status">
          <span className="spinner" />
          {aiUk.loading}
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="text-button"
            disabled={busy || !intent}
            onClick={() => {
              if (intent) void ask(intent);
            }}
          >
            {aiUk.retry}
          </button>
        </div>
      )}
      {advice && (
        <div className="questyk-answer" aria-live="polite">
          <span className="questyk-source">
            {advice.source === 'AI' ? <Sparkles size={15} /> : <BookOpen size={15} />}
            {advice.source === 'AI' ? aiUk.generated : aiUk.local}
          </span>
          <p>{advice.message}</p>
          {advice.tips.length > 0 && (
            <ol>
              {advice.tips.map((tip, index) => (
                <li key={index}>{tip}</li>
              ))}
            </ol>
          )}
          {advice.reason && (
            <small>
              {advice.reason === 'LOCAL_MODE' ? aiUk.localMode : aiUk.providerUnavailable}
            </small>
          )}
        </div>
      )}
      <p className="questyk-boundaries">{aiUk.boundaries}</p>
    </section>
  );
}
