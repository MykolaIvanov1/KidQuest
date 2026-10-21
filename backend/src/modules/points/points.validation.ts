import { z } from 'zod';

export const pointsQuerySchema = z.object({ childId: z.uuid().optional() }).strict();
