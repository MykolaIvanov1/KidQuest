import { z } from 'zod';

const email = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const phone = /(?<!\d)(?:\+?\d[\s().-]*){7,}(?!\d)/gu;
const url =
  /(?:https?:\/\/|www\.)[^\s<>]+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|ua|io|dev|app|info|me|co)(?:\/[^\s<>]*)?/giu;
const uuid = /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu;
const secret =
  /(?:password|пароль|token|токен|api[_ -]?key|authorization|bearer|jwt)\s*[:=]?\s*[^\s,;]+/giu;

export function scrubTaskText(value: string, limit: number, privateTerms: string[] = []) {
  let text = value
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(email, '[контакт вилучено]')
    .replace(url, '[посилання вилучено]')
    .replace(uuid, '[ідентифікатор вилучено]')
    .replace(phone, '[контакт вилучено]')
    .replace(secret, '[секрет вилучено]')
    .replace(/<[^>]*>/g, ' ');
  for (const term of privateTerms.filter((item) => item.trim().length >= 2)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      '[дані вилучено]',
    );
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

const unsafe = (value: string) =>
  /(?![\n\r\t])\p{Cc}/u.test(value) ||
  new RegExp(email.source, 'iu').test(value) ||
  new RegExp(url.source, 'iu').test(value) ||
  /[<>\u202a-\u202e\u2066-\u2069]|https?:\/\/|www\.|(?:mailto|tel|javascript|data):|\[[^\]]*\]\([^)]*\)|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){7,}|\b(?:stupid|idiot|lazy)\b|(?:дурн|ледар|нікчем|ганьб)/iu.test(
    value,
  );
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !unsafe(text));
const providerAdviceSchema = z
  .object({ message: safeText(1000), tips: z.array(safeText(240)).max(5) })
  .strict();
export function parseProviderAdvice(value: unknown) {
  return providerAdviceSchema.parse(value);
}
