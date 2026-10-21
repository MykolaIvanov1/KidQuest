import type { Request, Response } from 'express';
import type { RewardRequestService } from './reward-requests.service.js';
import { idSchema, reviewSchema, rewardRequestQuerySchema } from './reward-requests.validation.js';

export class RewardRequestController {
  constructor(private service: RewardRequestService) {}

  list = async (req: Request, res: Response) => {
    const query = rewardRequestQuerySchema.parse(req.query);
    res.json({ success: true, data: await this.service.list(req.authUser!, query.childId) });
  };

  approve = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    reviewSchema.parse(req.body ?? {});
    res.json({ success: true, data: await this.service.approve(req.authUser!, id) });
  };

  reject = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    const input = reviewSchema.parse(req.body ?? {});
    res.json({ success: true, data: await this.service.reject(req.authUser!, id, input) });
  };

  issue = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    reviewSchema.parse(req.body ?? {});
    res.json({ success: true, data: await this.service.issue(req.authUser!, id) });
  };
}
