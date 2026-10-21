import type { Request, Response } from 'express';
import type { PointsService } from './points.service.js';
import { pointsQuerySchema } from './points.validation.js';

export class PointsController {
  constructor(private service: PointsService) {}

  balance = async (req: Request, res: Response) => {
    const query = pointsQuerySchema.parse(req.query);
    res.json({
      success: true,
      data: await this.service.balance(req.authUser!, query.childId),
    });
  };

  history = async (req: Request, res: Response) => {
    const query = pointsQuerySchema.parse(req.query);
    res.json({
      success: true,
      data: await this.service.history(req.authUser!, query.childId),
    });
  };
}
