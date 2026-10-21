import bcrypt from 'bcrypt';
import type { MemberInput } from '@kidquest/validation';
import type { AuthRepository, UserRecord } from '../auth/auth.types.js';
import { logger } from '../../utils/logger.js';

export class FamilyService {
  constructor(private repository: Pick<AuthRepository, 'createMember' | 'listMembers'>) {}

  async createMember(user: UserRecord, input: MemberInput) {
    const hash = await bcrypt.hash(input.password, 12);
    const member = await this.repository.createMember(user.familyId, input, hash);
    logger.info('family.member_created', { userId: member.id, familyId: user.familyId });
    return member;
  }

  listMembers(user: UserRecord) {
    return this.repository.listMembers(user.familyId);
  }
}
