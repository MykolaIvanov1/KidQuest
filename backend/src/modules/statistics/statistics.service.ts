import type { AuthRepository, UserRecord } from '../auth/auth.types.js';

export class StatisticsService {
  constructor(private repository: Pick<AuthRepository, 'dashboard'>) {}
  dashboard(user: UserRecord) {
    return this.repository.dashboard(user);
  }
}
