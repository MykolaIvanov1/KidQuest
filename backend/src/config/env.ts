import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const optionalFirebaseValue = (schema: z.ZodType<string>) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url().startsWith('postgresql://'),
    JWT_SECRET: z
      .string()
      .min(32)
      .refine((value) => !value.startsWith('REPLACE_'), 'Створіть власний випадковий JWT secret'),
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    STORAGE_PATH: z.string().min(1).default('./storage'),
    TRUST_PROXY: z
      .enum(['0', '1'])
      .default('0')
      .transform((value) => value === '1'),
    JWT_EXPIRATION: z
      .string()
      .regex(/^([1-9]|[1-5][0-9]|60)m$/)
      .default('15m'),
    REFRESH_TOKEN_EXPIRATION: z
      .string()
      .regex(/^([1-9]|[1-8][0-9]|90)d$/)
      .default('30d'),
    FIREBASE_PROJECT_ID: optionalFirebaseValue(z.string().trim().min(1).max(120)),
    FIREBASE_CLIENT_EMAIL: optionalFirebaseValue(z.email()),
    FIREBASE_PRIVATE_KEY: optionalFirebaseValue(
      z
        .string()
        .transform((value) => value.replace(/\\n/g, '\n').trim())
        .refine(
          (value) =>
            value.startsWith('-----BEGIN PRIVATE KEY-----') &&
            value.endsWith('-----END PRIVATE KEY-----'),
          'Потрібен приватний ключ Firebase у форматі PEM',
        ),
    ),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production' && !values.FRONTEND_URL.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'Для production потрібен HTTPS.',
      });
    }
    const fields = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
    ] as const;
    if (fields.some((field) => values[field] !== undefined)) {
      for (const field of fields) {
        if (values[field] === undefined)
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'Заповніть усі налаштування Firebase або залиште їх порожніми',
          });
      }
    }
  });

export function readEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Некоректна конфігурація: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Перевірте кореневий .env.`,
    );
  }
  return result.data;
}
