import { describe, expect, it } from 'vitest';
import { loginSchema, memberSchema, passwordSchema, registerSchema } from './index';

describe('спільна валідація авторизації', () => {
  it('нормалізує email', () => {
    expect(loginSchema.parse({ email: 'PARENT@example.com', password: 'secret' }).email).toBe(
      'parent@example.com',
    );
  });
  it('відхиляє підміну ролі або сім’ї під час публічної реєстрації', () => {
    expect(
      registerSchema.safeParse({
        email: 'a@example.com',
        password: 'long-enough-pass',
        firstName: 'Мама',
        familyName: 'Родина',
        role: 'PARENT',
        familyId: 'another-family',
      }).success,
    ).toBe(false);
  });
  it('перевіряє ліміт bcrypt у байтах, включно з Unicode', () => {
    expect(passwordSchema.safeParse('я'.repeat(37)).success).toBe(false);
    expect(passwordSchema.safeParse('я'.repeat(20)).success).toBe(true);
    expect(passwordSchema.safeParse('short').success).toBe(false);
  });
  it('не допускає інших ролей', () => {
    expect(
      memberSchema.safeParse({
        email: 'a@example.com',
        password: 'long-enough-pass',
        firstName: 'Дитина',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
  });
});
