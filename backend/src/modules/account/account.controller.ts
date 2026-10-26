import type { Request, Response } from 'express';
import type { AccountMutationData } from '@kidquest/types';
import type { AuthConfig } from '../auth/auth.types.js';
import { REFRESH_COOKIE } from '../auth/auth.controller.js';
import type { AccountService } from './account.service.js';
import {
  accountId,
  profileQuery,
  changeEmailSchema,
  resetChildPasswordSchema,
  changeRoleSchema,
  loginJournalFilters,
} from './account.validation.js';

export class AccountController {
  constructor(
    private service: AccountService,
    private config: AuthConfig,
  ) {}

  profile = async (req: Request, res: Response) => {
    profileQuery.parse(req.query);
    res.json({ success: true, data: await this.service.profile(req.authUser!) });
  };
  changeEmail = async (req: Request, res: Response) => {
    const result = await this.service.changeEmail(
      req.authUser!,
      req.authUser!.id,
      changeEmailSchema.parse(req.body),
    );
    this.result(res, result);
  };
  changeMemberEmail = async (req: Request, res: Response) => {
    const result = await this.service.changeEmail(
      req.authUser!,
      accountId.parse(req.params.id),
      changeEmailSchema.parse(req.body),
    );
    this.result(res, result);
  };
  resetPassword = async (req: Request, res: Response) => {
    const result = await this.service.resetPassword(
      req.authUser!,
      accountId.parse(req.params.id),
      resetChildPasswordSchema.parse(req.body),
    );
    this.result(res, result);
  };
  changeRole = async (req: Request, res: Response) => {
    const result = await this.service.changeRole(
      req.authUser!,
      accountId.parse(req.params.id),
      changeRoleSchema.parse(req.body),
    );
    this.result(res, result);
  };
  journal = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.journal(req.authUser!, loginJournalFilters.parse(req.query)),
    });
  };

  private result(res: Response, data: AccountMutationData) {
    if (data.reauthenticate) {
      res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: this.config.production,
        sameSite: 'strict',
        path: '/api/v1/auth',
      });
    }
    res.json({ success: true, data });
  }
}
