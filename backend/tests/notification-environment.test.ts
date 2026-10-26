import { describe, expect, it } from 'vitest';
import { readEnvironment } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SECRET: 'configuration-test-secret-never-used-in-production',
};
const firebase = {
  FIREBASE_PROJECT_ID: 'kidquest-test',
  FIREBASE_CLIENT_EMAIL: 'push@kidquest-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nnot-a-live-key\\n-----END PRIVATE KEY-----',
};

describe('optional Firebase configuration', () => {
  it('allows no credentials or entirely blank example values so the inbox works locally', () => {
    expect(readEnvironment(base).FIREBASE_PROJECT_ID).toBeUndefined();
    expect(
      readEnvironment({
        ...base,
        FIREBASE_PROJECT_ID: '',
        FIREBASE_CLIENT_EMAIL: ' ',
        FIREBASE_PRIVATE_KEY: '',
      }).FIREBASE_PRIVATE_KEY,
    ).toBeUndefined();
  });

  it('normalizes escaped PEM newlines with a complete configuration', () => {
    const env = readEnvironment({ ...base, ...firebase });
    expect(env.FIREBASE_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nnot-a-live-key\n-----END PRIVATE KEY-----',
    );
    expect(env.FIREBASE_PROJECT_ID).toBe('kidquest-test');
  });

  it.each(['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const)(
    'rejects a partial configuration missing %s',
    (field) => {
      const partial: NodeJS.ProcessEnv = { ...base, ...firebase };
      delete partial[field];
      expect(() => readEnvironment(partial)).toThrow(field);
    },
  );

  it('reports invalid configuration names without including secret values', () => {
    try {
      readEnvironment({
        ...base,
        ...firebase,
        FIREBASE_PRIVATE_KEY: 'a-private-invalid-key-do-not-print',
      });
      throw new Error('Expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('FIREBASE_PRIVATE_KEY');
      expect((error as Error).message).not.toContain('a-private-invalid-key-do-not-print');
    }
  });
});
