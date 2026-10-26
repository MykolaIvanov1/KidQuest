import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '../.local/test-db.env'), quiet: true });

// Concurrent HTTP scenarios should exercise transactions without exhausting a small test DB.
// This only changes the dedicated test URL; the application's DATABASE_URL is untouched.
if (process.env.DATABASE_TEST_URL) {
  const testUrl = new URL(process.env.DATABASE_TEST_URL);
  if (!testUrl.searchParams.has('connection_limit')) {
    testUrl.searchParams.set('connection_limit', '4');
    process.env.DATABASE_TEST_URL = testUrl.toString();
  }
}
