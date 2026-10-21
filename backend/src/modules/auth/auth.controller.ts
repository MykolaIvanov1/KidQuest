import type { CookieOptions, Request, Response } from 'express';
import { publicUser, type AuthConfig } from './auth.types.js';
import type { AuthService } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.validation.js';

export const REFRESH_COOKIE = 'kq_refresh';

export class AuthController {
  private cookieOptions: CookieOptions;

  constructor(
    private service: AuthService,
    config: AuthConfig,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: config.refreshDays * 86_400_000,
    };
  }

  private metadata(req: Request) {
    return { ipAddress: req.ip ?? '', userAgent: req.header('user-agent') ?? '' };
  }

  register = async (req: Request, res: Response) => {
    const result = await this.service.register(registerSchema.parse(req.body), this.metadata(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions);
    res.status(201).json({ success: true, data: result.session });
  };

  login = async (req: Request, res: Response) => {
    const result = await this.service.login(loginSchema.parse(req.body), this.metadata(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions);
    res.json({ success: true, data: result.session });
  };

  refresh = async (req: Request, res: Response) => {
    const result = await this.service.refresh(
      (req.cookies as Record<string, unknown>)[REFRESH_COOKIE],
    );
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions);
    res.json({ success: true, data: result.session });
  };

  logout = async (req: Request, res: Response) => {
    await this.service.logout((req.cookies as Record<string, unknown>)[REFRESH_COOKIE]);
    const { maxAge: _maxAge, ...options } = this.cookieOptions;
    res.clearCookie(REFRESH_COOKIE, options);
    res.json({ success: true, data: null });
  };

  me = (req: Request, res: Response) => {
    res.json({ success: true, data: publicUser(req.authUser!) });
  };
}
