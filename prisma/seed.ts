import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

class SeedConfigurationError extends Error {}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim())
    throw new SeedConfigurationError(`Заповніть ${name} у локальному .env перед seed.`);
  return value;
}

function seedEmail(name: string): string {
  const email = requiredEnvironment(name).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new SeedConfigurationError(`Некоректний email у ${name}.`);
  }
  return email;
}

function seedPassword(name: string): string {
  const password = requiredEnvironment(name);
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new SeedConfigurationError(
      `${name}: пароль має містити щонайменше 12 символів і до 72 байтів UTF-8.`,
    );
  }
  return password;
}

async function main(): Promise<void> {
  const parentEmail = seedEmail('SEED_PARENT_EMAIL');
  const childEmail = seedEmail('SEED_CHILD_EMAIL');
  if (parentEmail === childEmail)
    throw new SeedConfigurationError('Email батьків і дитини мають відрізнятися.');

  const [parentPasswordHash, childPasswordHash] = await Promise.all([
    bcrypt.hash(seedPassword('SEED_PARENT_PASSWORD'), 12),
    bcrypt.hash(seedPassword('SEED_CHILD_PASSWORD'), 12),
  ]);
  const parentName = process.env.SEED_PARENT_NAME?.trim() || 'Мама';
  const childName = process.env.SEED_CHILD_NAME?.trim() || 'Богдан';

  await prisma.$transaction(async (tx) => {
    const existingParent = await tx.user.findUnique({
      where: { email: parentEmail },
      include: { family: true },
    });
    if (
      existingParent &&
      (existingParent.role !== Role.PARENT ||
        !existingParent.isActive ||
        existingParent.deletedAt ||
        existingParent.family.deletedAt)
    ) {
      throw new SeedConfigurationError(
        'SEED_PARENT_EMAIL уже належить несумісному обліковому запису.',
      );
    }

    const parent = await tx.user.upsert({
      where: { email: parentEmail },
      update: {},
      create: {
        email: parentEmail,
        passwordHash: parentPasswordHash,
        firstName: parentName,
        role: Role.PARENT,
        family: {
          create: {
            name: process.env.SEED_FAMILY_NAME?.trim() || 'Наша сім’я',
            timeZone: 'Europe/Kyiv',
          },
        },
      },
    });

    const existingChild = await tx.user.findUnique({ where: { email: childEmail } });
    if (
      existingChild &&
      (existingChild.role !== Role.CHILD ||
        !existingChild.isActive ||
        existingChild.familyId !== parent.familyId ||
        existingChild.deletedAt)
    ) {
      throw new SeedConfigurationError(
        'SEED_CHILD_EMAIL уже належить іншій сім’ї або несумісному обліковому запису.',
      );
    }
    const childUser = await tx.user.upsert({
      where: { email: childEmail },
      update: {},
      create: {
        email: childEmail,
        passwordHash: childPasswordHash,
        firstName: childName,
        role: Role.CHILD,
        familyId: parent.familyId,
      },
    });
    await tx.child.upsert({
      where: { userId: childUser.id },
      update: {},
      create: { userId: childUser.id, familyId: parent.familyId, firstName: childUser.firstName },
    });

    const achievements = [
      {
        code: 'STREAK_7',
        title: 'Тиждень пригод',
        description: 'Виконуй обов’язкові завдання 7 днів поспіль.',
        configuration: { type: 'STREAK', target: 7 },
      },
      {
        code: 'TASKS_30',
        title: '30 добрих справ',
        description: 'Отримай підтвердження 30 виконаних завдань.',
        configuration: { type: 'APPROVED_TASKS', target: 30 },
      },
      {
        code: 'POINTS_100',
        title: 'Перші 100 балів',
        description: 'Зароби 100 балів за підтверджені завдання.',
        configuration: { type: 'EARNED_POINTS', target: 100 },
      },
      {
        code: 'POINTS_500',
        title: '500 балів',
        description: 'Зароби 500 балів за підтверджені завдання.',
        configuration: { type: 'EARNED_POINTS', target: 500 },
      },
    ];
    for (const achievement of achievements) {
      await tx.achievement.upsert({
        where: { code: achievement.code },
        update: {},
        create: achievement,
      });
    }
  });
  console.info('Seed завершено: облікові записи сім’ї та довідник досягнень готові.');
}

main()
  .catch((error: unknown) => {
    // Database errors may include connection parameters; do not print raw errors or secrets.
    console.error(
      error instanceof SeedConfigurationError
        ? error.message
        : 'Seed не виконано. Перевірте доступність БД та міграції.',
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
