import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });

export const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT должен быть целым числом от 0 до 65535');
}

export const prisma = new PrismaClient();
