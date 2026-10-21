import type { UserRecord } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: UserRecord;
    }
  }
}

export {};
