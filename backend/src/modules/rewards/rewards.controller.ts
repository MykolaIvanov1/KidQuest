import type { Request, Response } from 'express';
import type { RewardsService } from './rewards.service.js';
import type { RewardRequestService } from '../reward-requests/reward-requests.service.js';
import {
  idSchema,
  rewardSchema,
  rewardUpdateSchema,
  rewardRequestSchema,
} from './rewards.validation.js';

export class RewardsController {
  constructor(
    private service: RewardsService,
    private requests: RewardRequestService,
  ) {}

  list = async (req: Request, res: Response) => {
    res.json({ success: true, data: await this.service.list(req.authUser!) });
  };

  create = async (req: Request, res: Response) => {
    const input = rewardSchema.parse(req.body);
    res.status(201).json({ success: true, data: await this.service.create(req.authUser!, input) });
  };

  update = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    const input = rewardUpdateSchema.parse(req.body);
    res.json({ success: true, data: await this.service.update(req.authUser!, id, input) });
  };

  remove = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await this.service.remove(req.authUser!, id) });
  };

  request = async (req: Request, res: Response) => {
    const id = idSchema.parse(req.params.id);
    const input = rewardRequestSchema.parse(req.body);
    const result = await this.requests.request(req.authUser!, id, input);
    res.status(result.created ? 201 : 200).json({ success: true, data: result.request });
  };
}
