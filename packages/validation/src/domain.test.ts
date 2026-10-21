import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  categorySchema,
  rewardRequestSchema,
  rewardSchema,
  rewardUpdateSchema,
  reviewSchema,
  submitTaskSchema,
  taskSchema,
  taskUpdateSchema,
} from './index';

const task = {
  title: 'Застелити постіль',
  description: '',
  categoryId: randomUUID(),
  icon: 'Bed',
  color: 'primary',
  points: 10,
  isRequired: true,
  photoRequired: false,
  startTime: null,
  endTime: null,
  isActive: true,
};
const reward = {
  title: 'Прогулянка',
  description: '',
  icon: 'Gift',
  imageUrl: null,
  cost: 15,
  type: 'ACTIVITY' as const,
  isActive: true,
};
describe('Валідація квестів і нагород', () => {
  it('не допускає підміни сім’ї в CRUD або запиті нагороди', () => {
    expect(taskSchema.safeParse({ ...task, familyId: randomUUID() }).success).toBe(false);
    expect(rewardSchema.safeParse({ ...reward, familyId: randomUUID() }).success).toBe(false);
    expect(
      rewardRequestSchema.safeParse({ operationId: randomUUID(), childId: randomUUID() }).success,
    ).toBe(false);
  });
  it('відхиляє від’ємні, дробові й нульові нарахування та вартості', () => {
    for (const amount of [-10, 1.5, 0]) {
      expect(taskSchema.safeParse({ ...task, points: amount }).success).toBe(false);
      expect(rewardSchema.safeParse({ ...reward, cost: amount }).success).toBe(false);
    }
  });
  it('перевіряє часовий проміжок без приймання неіснуючого часу', () => {
    expect(taskSchema.safeParse({ ...task, startTime: '25:30' }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, startTime: '18:00', endTime: '08:00' }).success).toBe(
      false,
    );
    expect(taskSchema.safeParse({ ...task, startTime: '08:00', endTime: '10:00' }).success).toBe(
      true,
    );
  });
  it('вимагає UUID операції для повторюваних запитів', () => {
    expect(submitTaskSchema.safeParse({}).success).toBe(false);
    expect(rewardRequestSchema.safeParse({ operationId: 'guess' }).success).toBe(false);
    expect(submitTaskSchema.safeParse({ operationId: randomUUID() }).success).toBe(true);
  });
  it('блокує порожні PATCH і сторонні поля перевірки', () => {
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
    expect(rewardUpdateSchema.safeParse({}).success).toBe(false);
    expect(reviewSchema.safeParse({ points: 10000 }).success).toBe(false);
  });
  it('обмежує текст і небезпечні адреси зображень', () => {
    expect(categorySchema.safeParse({ name: ' '.repeat(10) }).success).toBe(false);
    expect(rewardSchema.safeParse({ ...reward, imageUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(rewardSchema.safeParse({ ...reward, description: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });
});
