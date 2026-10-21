import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TaskDto } from '@kidquest/types';
import { Plus } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { TaskList } from '../features/quests/TaskList';
import { CategoryEditor, TaskEditor } from '../features/quests/TaskEditor';
import { DeleteAction, Feedback, useRefreshFamilyData } from '../features/workflows/common';
import { api } from '../services/api';
import { uk } from '../lib/i18n';

export default function QuestsPage() {
  const parent = useAuth().user?.role === 'PARENT';
  const [editing, setEditing] = useState<TaskDto | 'new' | null>(null);
  const refresh = useRefreshFamilyData();
  const remove = useMutation({
    mutationFn: (task: TaskDto) => api(`/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{parent ? uk.quests : uk.adventure}</h1>
          <p className="muted">{uk.questLead}</p>
        </div>
        {parent && (
          <button className="button primary" onClick={() => setEditing('new')}>
            <Plus size={18} />
            {uk.newTask}
          </button>
        )}
      </div>
      {parent && <CategoryEditor />}
      {parent && editing && (
        <TaskEditor
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
      <Feedback error={remove.error} success={remove.isSuccess ? uk.deleted : undefined} />
      <TaskList
        parent={parent}
        edit={setEditing}
        remove={(task) => (
          <DeleteAction pending={remove.isPending} remove={() => remove.mutate(task)} />
        )}
      />
    </AppShell>
  );
}
