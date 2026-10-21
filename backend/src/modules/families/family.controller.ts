import type { Request, Response } from 'express';
import type { FamilyService } from './family.service.js';
import { memberSchema } from './family.validation.js';

export class FamilyController {
  constructor(private service: FamilyService) {}

  createMember = async (req: Request, res: Response) => {
    const member = await this.service.createMember(req.authUser!, memberSchema.parse(req.body));
    res.status(201).json({ success: true, data: member });
  };

  listMembers = async (req: Request, res: Response) => {
    const members = await this.service.listMembers(req.authUser!);
    res.json({ success: true, data: members });
  };
}
