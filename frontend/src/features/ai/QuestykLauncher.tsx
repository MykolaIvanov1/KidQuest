import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import type { Role } from '@kidquest/types';
import { aiUk } from './i18n';
import '../../styles/ai.css';

const QuestykPanel = lazy(() => import('./QuestykPanel'));
const openEvent = 'kidquest:questyk-open';
function Launcher({
  role = 'CHILD',
  taskId,
  childId,
}: {
  role?: Role;
  taskId?: string;
  childId?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== panelId) setOpen(false);
    };
    window.addEventListener(openEvent, closeOther);
    return () => window.removeEventListener(openEvent, closeOther);
  }, [panelId]);
  useEffect(() => {
    setOpen(false);
  }, [role, taskId, childId]);
  function toggle() {
    if (!open) window.dispatchEvent(new CustomEvent(openEvent, { detail: panelId }));
    setOpen(!open);
  }
  return (
    <div className={taskId ? 'questyk-task-help' : 'questyk-card panel'}>
      {!taskId && (
        <div className="questyk-card-heading">
          <span className="questyk-avatar">
            <Bot size={27} />
          </span>
          <div>
            <h2>{aiUk.name}</h2>
            <p>{role === 'PARENT' ? aiUk.parentLead : aiUk.childLead}</p>
          </div>
        </div>
      )}
      <button
        type="button"
        className={taskId ? 'text-button questyk-help-button' : 'button tonal questyk-open-button'}
        ref={trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {taskId ? <Bot size={18} /> : null}
        {taskId ? aiUk.taskHelp : aiUk.open}
        <ChevronDown size={17} className={open ? 'questyk-chevron open' : 'questyk-chevron'} />
      </button>
      {open && (
        <div id={panelId}>
          <Suspense
            fallback={
              <p className="questyk-loading" role="status">
                {aiUk.loadingPanel}
              </p>
            }
          >
            <QuestykPanel
              taskId={taskId}
              childId={childId}
              onClose={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
export function QuestykCard({ role, childId }: { role: Role; childId?: string }) {
  return <Launcher role={role} childId={childId} />;
}
export function QuestykTaskHelp({ taskId }: { taskId: string }) {
  return <Launcher taskId={taskId} />;
}
