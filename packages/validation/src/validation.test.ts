import { describe, expect, it } from 'vitest';
import {
  loginSchema,
  memberSchema,
  passwordSchema,
  registerSchema,
  taskSchema,
  taskUpdateSchema,
  changeEmailSchema,
  resetChildPasswordSchema,
  changeRoleSchema,
} from './index';

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

describe('валідація налаштувань акаунта', () => {
  it('нормалізує email та зберігає точний поточний пароль', () => {
    expect(
      changeEmailSchema.parse({ email: ' New@Example.com ', currentPassword: ' secret ' }),
    ).toEqual({ email: 'new@example.com', currentPassword: ' secret ' });
  });
  it('вимагає поточний пароль і захищає поле ролі від підміни', () => {
    expect(changeRoleSchema.safeParse({ role: 'ADMIN', currentPassword: 'secret' }).success).toBe(
      false,
    );
    expect(changeRoleSchema.safeParse({ role: 'CHILD', currentPassword: '' }).success).toBe(false);
    expect(
      changeEmailSchema.safeParse({
        email: 'a@example.com',
        currentPassword: 'secret',
        familyId: 'x',
      }).success,
    ).toBe(false);
  });
  it('дотримується обмежень нового пароля bcrypt', () => {
    expect(
      resetChildPasswordSchema.safeParse({ currentPassword: 'secret', newPassword: 'short' })
        .success,
    ).toBe(false);
    expect(
      resetChildPasswordSchema.safeParse({ currentPassword: 'secret', newPassword: 'я'.repeat(37) })
        .success,
    ).toBe(false);
    expect(
      resetChildPasswordSchema.safeParse({
        currentPassword: 'secret',
        newPassword: 'Довгий-надійний-пароль',
      }).success,
    ).toBe(true);
  });
});

const validTask = {
  title: 'Застелити постіль',
  description: 'Охайно скласти ковдру',
  categoryId: '11111111-1111-4111-8111-111111111111',
  icon: 'Bed',
  color: 'primary',
  points: 10,
  isRequired: true,
  photoRequired: false,
  startTime: '08:00',
  endTime: '20:00',
  isActive: true,
};

describe('щоденне повторення квесту', () => {
  it('приймає попередній контракт без repeatDaily без прихованого скидання режиму', () => {
    expect(taskSchema.parse(validTask)).not.toHaveProperty('repeatDaily');
    expect(taskUpdateSchema.parse({ title: 'Нова назва' })).not.toHaveProperty('repeatDaily');
  });

  it.each([true, false])(
    'зберігає явно вибране repeatDaily=%s у створенні та PATCH',
    (repeatDaily) => {
      expect(taskSchema.parse({ ...validTask, repeatDaily }).repeatDaily).toBe(repeatDaily);
      expect(taskUpdateSchema.parse({ repeatDaily })).toEqual({ repeatDaily });
    },
  );

  it.each(['true', 'false', 0, 1, null, [], {}])(
    'відхиляє не boolean repeatDaily=%j',
    (repeatDaily) => {
      expect(taskSchema.safeParse({ ...validTask, repeatDaily }).success).toBe(false);
      expect(taskUpdateSchema.safeParse({ repeatDaily }).success).toBe(false);
    },
  );

  it('не змінює перевірку дат і часу для одноразового квесту', () => {
    expect(
      taskSchema.safeParse({
        ...validTask,
        repeatDaily: false,
        startDate: '2026-11-01',
        endDate: '2026-10-31',
      }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({
        ...validTask,
        repeatDaily: false,
        startTime: '20:00',
        endTime: '08:00',
      }).success,
    ).toBe(false);
  });
});

describe('календарний період квесту', () => {
  it('залишається сумісним із квестами без календарних меж', () => {
    const parsed = taskSchema.parse(validTask);
    expect(parsed).not.toHaveProperty('startDate');
    expect(parsed).not.toHaveProperty('endDate');
    expect(taskSchema.parse({ ...validTask, startDate: null, endDate: null })).toMatchObject({
      startDate: null,
      endDate: null,
    });
  });

  it('дозволяє включні межі одного дня та межі різних місяців і років', () => {
    for (const [startDate, endDate] of [
      ['2026-10-22', '2026-10-22'],
      ['2026-10-31', '2026-11-01'],
      ['2026-12-31', '2027-01-01'],
    ]) {
      expect(taskSchema.safeParse({ ...validTask, startDate, endDate }).success).toBe(true);
    }
  });

  it.each(['2028-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])(
    'приймає реальну календарну дату %s',
    (startDate) => {
      expect(taskSchema.safeParse({ ...validTask, startDate }).success).toBe(true);
    },
  );

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2100-02-29',
    '2026-02-31',
    '2026-04-31',
    '2026-13-01',
    '2026-01-00',
    '0000-01-01',
    '22.10.2026',
    '2026-1-01',
    '2026-10-22T00:00:00Z',
    '',
  ])('відхиляє нереальну дату або неканонічний формат %s', (date) => {
    expect(taskSchema.safeParse({ ...validTask, startDate: date }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ endDate: date }).success).toBe(false);
  });

  it('відхиляє обернений діапазон під час створення та PATCH із двома межами', () => {
    const dates = { startDate: '2026-11-01', endDate: '2026-10-31' };
    const creation = taskSchema.safeParse({ ...validTask, ...dates });
    const patch = taskUpdateSchema.safeParse(dates);
    expect(creation.success).toBe(false);
    expect(patch.success).toBe(false);
    if (!patch.success) {
      expect(patch.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['endDate'],
          message: 'Дата завершення має бути не раніше дати початку',
        }),
      );
    }
  });

  it('дозволяє відкриту межу або очищення дат у частковому PATCH', () => {
    for (const dates of [
      { startDate: '2026-10-22' },
      { endDate: '2026-10-22' },
      { startDate: null },
      { endDate: null },
      { startDate: null, endDate: '2026-10-22' },
      { startDate: '2026-10-22', endDate: null },
    ]) {
      expect(taskSchema.safeParse({ ...validTask, ...dates }).success).toBe(true);
      expect(taskUpdateSchema.safeParse(dates).success).toBe(true);
    }
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('зберігає окрему перевірку щоденного часу виконання', () => {
    const dates = { startDate: '2026-10-22', endDate: '2026-11-22' };
    expect(
      taskSchema.safeParse({ ...validTask, ...dates, startTime: '20:00', endTime: '08:00' })
        .success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({ ...validTask, ...dates, startTime: null, endTime: null }).success,
    ).toBe(true);
  });
});
