import type { Request, Response } from 'express';
import { aiAdviceSchema } from './ai.validation.js';
import type { AiService } from './ai.service.js';

export class AiController {
  constructor(private service: AiService) {}
  advice = async (req: Request, res: Response) => {
    const input = aiAdviceSchema.parse(req.body);
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', disconnect);
    try {
      const data = await this.service.advice(req.authUser!, input, controller.signal);
      if (!res.destroyed) res.json({ success: true, data });
    } finally {
      res.off('close', disconnect);
    }
  };
}
