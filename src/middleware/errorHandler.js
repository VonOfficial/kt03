import { Prisma } from '@prisma/client';

export default function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Запись с таким уникальным значением уже существует' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Запись или связанный автор не найдены' });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        error: 'Нарушение связи: проверьте автора. Перед удалением пользователя удалите его посты',
      });
    }
  }

  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}
