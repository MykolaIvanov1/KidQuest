import type {
  CategoryInput,
  TaskInput,
  TaskUpdateInput,
  SubmitTaskInput,
} from '@kidquest/validation';
import type { UserRecord } from '../auth/auth.types.js';
import type { CompletionService } from '../task-completions/completion.service.js';
import type { TaskRepository } from './task.repository.js';

export class TaskService {
  constructor(
    private repository: TaskRepository,
    private completions: CompletionService,
  ) {}
  list(user: UserRecord) {
    return this.repository.list(user);
  }
  categories(user: UserRecord) {
    return this.repository.categories(user);
  }
  createCategory(user: UserRecord, input: CategoryInput) {
    return this.repository.createCategory(user, input);
  }
  create(user: UserRecord, input: TaskInput) {
    return this.repository.create(user, input);
  }
  update(user: UserRecord, id: string, input: TaskUpdateInput) {
    return this.repository.update(user, id, input);
  }
  remove(user: UserRecord, id: string) {
    return this.repository.remove(user, id);
  }
  submit(user: UserRecord, id: string, input: SubmitTaskInput, files: Express.Multer.File[]) {
    return this.completions.submit(user, id, input, files);
  }
}
