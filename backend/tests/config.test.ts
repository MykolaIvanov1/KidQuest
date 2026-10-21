import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEnvironment } from '../src/config/env.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Startup configuration', () => {
  it('refuses the tracked JWT placeholder', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('JWT_SECRET', 'REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES');
    expect(() => readEnvironment()).toThrow('JWT_SECRET');
  });

  it('rejects unsafe expiration values', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('JWT_SECRET', 'valid-test-only-random-string-123456789');
    vi.stubEnv('JWT_EXPIRATION', '10000m');
    expect(() => readEnvironment()).toThrow('JWT_EXPIRATION');
  });
});
