import type { Request, Response } from 'express';
import type { NotificationService } from './notification.service.js';
import {
  deviceInput,
  emptyNotificationBody,
  notificationFilters,
  notificationId,
} from './notification.validation.js';

export class NotificationController {
  constructor(
    private service: NotificationService,
    private pushConfigured: boolean,
  ) {}

  list = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.list(req.authUser!, notificationFilters.parse(req.query)),
    });
  };

  status = (_req: Request, res: Response) => {
    res.json({ success: true, data: { pushConfigured: this.pushConfigured } });
  };

  read = async (req: Request, res: Response) => {
    emptyNotificationBody.parse(req.body ?? {});
    res.json({
      success: true,
      data: await this.service.read(req.authUser!, notificationId.parse(req.params.id)),
    });
  };

  readAll = async (req: Request, res: Response) => {
    emptyNotificationBody.parse(req.body ?? {});
    res.json({ success: true, data: await this.service.readAll(req.authUser!) });
  };

  registerDevice = async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await this.service.registerDevice(req.authUser!, deviceInput.parse(req.body)),
    });
  };

  revokeDevice = async (req: Request, res: Response) => {
    emptyNotificationBody.parse(req.body ?? {});
    res.json({
      success: true,
      data: await this.service.revokeDevice(req.authUser!, notificationId.parse(req.params.id)),
    });
  };
}
