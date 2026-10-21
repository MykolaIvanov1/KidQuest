import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CompletionRepository } from './completion.repository.js';
import type { CompletionService } from './completion.service.js';
import { completionFilters, reviewSchema } from './completion.validation.js';

export class CompletionController {
  constructor(
    private repository: CompletionRepository,
    private service: CompletionService,
  ) {}
  list = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.repository.list(req.authUser!, completionFilters.parse(req.query)),
    });
  };
  approve = async (req: Request, res: Response) => {
    reviewSchema.parse(req.body ?? {});
    res.json({
      success: true,
      data: await this.service.review(req.authUser!, z.uuid().parse(req.params.id), 'APPROVED'),
    });
  };
  reject = async (req: Request, res: Response) => {
    const input = reviewSchema.parse(req.body ?? {});
    res.json({
      success: true,
      data: await this.service.review(
        req.authUser!,
        z.uuid().parse(req.params.id),
        'REJECTED',
        input.reason,
      ),
    });
  };
}
