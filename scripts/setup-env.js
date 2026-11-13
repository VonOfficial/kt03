import { closeSync, copyFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envPath = new URL('../.env', import.meta.url);
if (!existsSync(envPath)) {
  copyFileSync(new URL('../.env.example', import.meta.url), envPath);
  console.log('Создан файл .env');
}

dotenv.config({ path: envPath, quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('file:')) {
  throw new Error('DATABASE_URL должен указывать на файл SQLite, например file:./dev.db');
}
const databasePath = resolve(
  fileURLToPath(new URL('../prisma/', import.meta.url)),
  databaseUrl.slice('file:'.length),
);
mkdirSync(dirname(databasePath), { recursive: true });
closeSync(openSync(databasePath, 'a'));
