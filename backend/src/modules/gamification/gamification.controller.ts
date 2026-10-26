import type { Request, Response } from 'express';
import type { GamificationService } from './gamification.service.js';
import { achievementFilters, calendarFilters } from './gamification.validation.js';

export class GamificationController {
  constructor(private service: GamificationService) {}

  achievements = async (req: Request, res: Response) => {
    const filters = achievementFilters.parse(req.query);
    res.json({
      success: true,
      data: await this.service.achievements(req.authUser!, filters.childId),
    });
  };

  calendar = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.calendar(req.authUser!, calendarFilters.parse(req.query)),
    });
  };

  progress = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.progress(req.authUser!, calendarFilters.parse(req.query)),
    });
  };
}
