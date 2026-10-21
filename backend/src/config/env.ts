import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith('REPLACE_'), 'Створіть власний випадковий JWT secret'),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  STORAGE_PATH: z.string().min(1).default('./storage'),
  JWT_EXPIRATION: z
    .string()
    .regex(/^([1-9]|[1-5][0-9]|60)m$/)
    .default('15m'),
  REFRESH_TOKEN_EXPIRATION: z
    .string()
    .regex(/^([1-9]|[1-8][0-9]|90)d$/)
    .default('30d'),
});

export function readEnvironment() {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Некоректна конфігурація: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Перевірте кореневий .env.`,
    );
  }
  return result.data;
}
