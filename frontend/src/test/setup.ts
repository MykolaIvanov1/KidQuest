import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(cleanup);
// The workspace also runs bcrypt and PostgreSQL integration tests concurrently.
// Allow asynchronous UI rendering to settle under that CPU load without fixed sleeps.
configure({ asyncUtilTimeout: 5_000 });
Object.defineProperty(window, 'scrollTo', { writable: true, value: () => {} });
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
