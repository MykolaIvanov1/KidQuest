import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  categorySchema,
  submitTaskSchema,
  taskSchema,
  taskUpdateSchema,
} from './task.validation.js';
import type { TaskService } from './task.service.js';

export class TaskController {
  constructor(private service: TaskService) {}
  list = async (req: Request, res: Response) => {
    res.json({ success: true, data: await this.service.list(req.authUser!) });
  };
  categories = async (req: Request, res: Response) => {
    res.json({ success: true, data: await this.service.categories(req.authUser!) });
  };
  createCategory = async (req: Request, res: Response) => {
    res
      .status(201)
      .json({
        success: true,
        data: await this.service.createCategory(req.authUser!, categorySchema.parse(req.body)),
      });
  };
  create = async (req: Request, res: Response) => {
    res
      .status(201)
      .json({
        success: true,
        data: await this.service.create(req.authUser!, taskSchema.parse(req.body)),
      });
  };
  update = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.update(
        req.authUser!,
        z.uuid().parse(req.params.id),
        taskUpdateSchema.parse(req.body),
      ),
    });
  };
  remove = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.remove(req.authUser!, z.uuid().parse(req.params.id)),
    });
  };
  submit = async (req: Request, res: Response) => {
    const input = submitTaskSchema.parse(req.body);
    const files = (req.files ?? []) as Express.Multer.File[];
    res.json({
      success: true,
      data: await this.service.submit(
        req.authUser!,
        z.uuid().parse(req.params.id),
        input.operationId,
        files,
      ),
    });
  };
}
