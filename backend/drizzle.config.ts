import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env['DB_PATH'] ?? './data/audiovault.db';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
} satisfies Config;
