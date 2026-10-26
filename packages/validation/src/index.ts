import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Максимум 254 символи')
  .pipe(z.email('Введіть коректну електронну адресу'));
export const passwordSchema = z
  .string()
  .min(10, 'Пароль має містити щонайменше 10 символів')
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    'Пароль має містити не більше 72 байтів',
  );
const nameSchema = z.string().trim().min(1, 'Вкажіть ім’я').max(80, 'Максимум 80 символів');
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Введіть пароль').max(200, 'Пароль занадто довгий'),
  })
  .strict();
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: nameSchema,
    lastName: z.string().trim().max(80, 'Максимум 80 символів').optional(),
    familyName: z.string().trim().min(1, 'Вкажіть назву сім’ї').max(100, 'Максимум 100 символів'),
  })
  .strict();
export const memberSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: nameSchema,
    lastName: z.string().trim().max(80, 'Максимум 80 символів').optional(),
    role: z.enum(['PARENT', 'CHILD'], { error: 'Оберіть роль: батьки або дитина' }),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type MemberInput = z.infer<typeof memberSchema>;

const currentPasswordSchema = z
  .string()
  .min(1, 'Введіть поточний пароль')
  .max(200, 'Пароль занадто довгий');
export const changeEmailSchema = z
  .object({ email: emailSchema, currentPassword: currentPasswordSchema })
  .strict();
export const resetChildPasswordSchema = z
  .object({ currentPassword: currentPasswordSchema, newPassword: passwordSchema })
  .strict();
export const changeRoleSchema = z
  .object({
    role: z.enum(['PARENT', 'CHILD'], { error: 'Оберіть роль: батьки або дитина' }),
    currentPassword: currentPasswordSchema,
  })
  .strict();
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ResetChildPasswordInput = z.infer<typeof resetChildPasswordSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const idSchema = z.uuid('Некоректний ідентифікатор');
const titleSchema = z.string().trim().min(1, 'Вкажіть назву').max(160, 'Максимум 160 символів');
const descriptionSchema = z.string().trim().max(2000, 'Максимум 2000 символів');
const iconSchema = z.string().trim().min(1).max(60, 'Максимум 60 символів');
const colorSchema = z.string().trim().min(1).max(30, 'Максимум 30 символів');
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Вкажіть час у форматі ГГ:ХХ')
  .nullable();
const taskDateSchema = z.iso
  .date('Вкажіть коректну дату у форматі РРРР-ММ-ДД')
  .refine((value) => !value.startsWith('0000-'), 'Рік має бути від 0001 до 9999')
  .nullable();
const taskFields = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    categoryId: idSchema,
    icon: iconSchema,
    color: colorSchema,
    points: z
      .number()
      .int('Вкажіть ціле число')
      .min(1, 'Щонайменше 1 бал')
      .max(100000, 'Максимум 100000 балів'),
    isRequired: z.boolean(),
    repeatDaily: z.boolean().optional(),
    photoRequired: z.boolean(),
    startDate: taskDateSchema.optional(),
    endDate: taskDateSchema.optional(),
    startTime: timeSchema,
    endTime: timeSchema,
    isActive: z.boolean(),
  })
  .strict();
function validPeriod(value: { startTime?: string | null; endTime?: string | null }) {
  return !value.startTime || !value.endTime || value.startTime < value.endTime;
}
function validDatePeriod(value: { startDate?: string | null; endDate?: string | null }) {
  return !value.startDate || !value.endDate || value.startDate <= value.endDate;
}
export const taskSchema = taskFields
  .refine(validPeriod, {
    message: 'Час завершення має бути пізнішим за час початку',
    path: ['endTime'],
  })
  .refine(validDatePeriod, {
    message: 'Дата завершення має бути не раніше дати початку',
    path: ['endDate'],
  });
export const taskUpdateSchema = taskFields
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Вкажіть зміни')
  .refine(validPeriod, {
    message: 'Час завершення має бути пізнішим за час початку',
    path: ['endTime'],
  })
  .refine(validDatePeriod, {
    message: 'Дата завершення має бути не раніше дати початку',
    path: ['endDate'],
  });
export const categorySchema = z
  .object({
    name: z.string().trim().min(1, 'Вкажіть назву категорії').max(80, 'Максимум 80 символів'),
    icon: iconSchema.optional(),
    color: colorSchema.optional(),
  })
  .strict();
export const submitTaskSchema = z
  .object({
    operationId: idSchema,
    completedAt: z.iso.datetime({ offset: true }).optional(),
    taskVersion: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.completedAt) === Boolean(input.taskVersion), {
    message: 'Час офлайн-виконання та версію квесту потрібно передати разом',
    path: ['completedAt'],
  });
export const reviewSchema = z
  .object({ reason: z.string().trim().max(1000, 'Максимум 1000 символів').optional() })
  .strict();
export const completionReviewSchema = reviewSchema.extend({ operationId: idSchema }).strict();
export const rewardTypes = ['SCREEN_TIME', 'FOOD', 'TV', 'ACTIVITY', 'MATERIAL', 'OTHER'] as const;
const rewardFields = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    icon: iconSchema,
    imageUrl: z
      .url('Вкажіть коректну адресу')
      .refine((value) => value.startsWith('https://'), 'Дозволено лише HTTPS')
      .nullable(),
    cost: z
      .number()
      .int('Вкажіть ціле число')
      .min(1, 'Щонайменше 1 бал')
      .max(1000000, 'Максимум 1000000 балів'),
    type: z.enum(rewardTypes, { error: 'Оберіть тип нагороди' }),
    isActive: z.boolean(),
  })
  .strict();
export const rewardSchema = rewardFields;
export const rewardUpdateSchema = rewardFields
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Вкажіть зміни');
export const rewardRequestSchema = z.object({ operationId: idSchema }).strict();
export type TaskInput = z.infer<typeof taskSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CompletionReviewInput = z.infer<typeof completionReviewSchema>;
export type RewardInput = z.infer<typeof rewardSchema>;
export type RewardUpdateInput = z.infer<typeof rewardUpdateSchema>;
export type RewardRequestInput = z.infer<typeof rewardRequestSchema>;

export const aiIntents = [
  'GREETING',
  'MOTIVATE',
  'PRAISE',
  'TASK_HELP',
  'PROGRESS',
  'QUEST_IDEAS',
  'REWARD_IDEAS',
] as const;
export const aiAdviceSchema = z
  .object({
    intent: z.enum(aiIntents, { error: 'Оберіть, із чим допомогти.' }),
    taskId: idSchema.optional(),
    childId: idSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.intent === 'TASK_HELP') !== (input.taskId !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['taskId'],
        message: 'Квест потрібно обрати лише для підказки до завдання.',
      });
    }
    if (
      input.childId !== undefined &&
      !['PROGRESS', 'QUEST_IDEAS', 'REWARD_IDEAS'].includes(input.intent)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['childId'],
        message: 'Вибір дитини доступний лише для батьківських підказок.',
      });
    }
  });
export type AiAdviceInput = z.infer<typeof aiAdviceSchema>;
