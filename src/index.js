import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { port, prisma } from './config/index.js';
import usersRouter from './routes/users.js';
import postsRouter from './routes/posts.js';
import errorHandler from './middleware/errorHandler.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ message: 'Blog API', users: '/api/users', posts: '/api/posts' });
});
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
app.use(errorHandler);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prisma.$connect();
    const server = app.listen(port, () => {
      console.log(`API запущено: http://localhost:${server.address().port}`);
    });
    server.on('error', async (err) => {
      console.error('Ошибка запуска сервера:', err.message);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
    const shutdown = () => {
      server.close(async () => {
        await prisma.$disconnect();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (err) {
    console.error('Не удалось подключиться к базе:', err.message);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
}
