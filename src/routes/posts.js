import { Router } from 'express';
import Joi from 'joi';
import { prisma } from '../config/index.js';
import validate, { idSchema, paginationSchema } from '../middleware/validate.js';

const router = Router();
const include = { author: true, tags: { orderBy: { name: 'asc' } } };
const fields = {
  title: Joi.string().trim().min(1).max(200),
  content: Joi.string().max(100000).allow('', null),
  published: Joi.boolean().strict(),
  authorId: Joi.number().integer().min(1).max(2147483647).strict(),
  tags: Joi.array().items(Joi.string().trim().min(1).max(50)).max(20),
};
const createSchema = Joi.object({
  ...fields,
  title: fields.title.required(),
  authorId: fields.authorId.required(),
  published: fields.published.default(false),
  tags: fields.tags.default([]),
}).required();
const updateSchema = Joi.object(fields).min(1).required();
const querySchema = paginationSchema.keys({
  search: Joi.string().trim().max(200).allow(''),
  published: Joi.boolean(),
  authorId: Joi.number().integer().min(1).max(2147483647),
});

function connectTags(tags) {
  return [...new Set(tags)].map((name) => ({
    where: { name },
    create: { name },
  }));
}

router.get('/', validate(querySchema, 'query'), async (req, res) => {
  const { page, limit, search, published, authorId } = req.validated.query;
  const result = await prisma.$transaction(async (tx) => {
    const where = {};
    if (published !== undefined) where.published = published;
    if (authorId !== undefined) where.authorId = authorId;

    if (search) {
      // SQLite LIKE не учитывает регистр ASCII. Для кириллицы нужна отдельная проверка.
      if (/[^\x00-\x7F]|[%_\\]/u.test(search)) {
        const candidates = await tx.post.findMany({
          where,
          select: { id: true, title: true },
        });
        const needle = search.toLowerCase();
        where.id = {
          in: candidates
            .filter((post) => post.title.toLowerCase().includes(needle))
            .map((post) => post.id),
        };
      } else {
        where.title = { contains: search };
      }
    }

    const data = await tx.post.findMany({
      where,
      include,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const total = await tx.post.count({ where });
    return { data, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  });
  res.json(result);
});

router.get('/:id', validate(idSchema, 'params'), async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.validated.params.id },
    include,
  });
  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  res.json(post);
});

router.post('/', validate(createSchema), async (req, res) => {
  const { authorId, tags, ...data } = req.validated.body;
  const post = await prisma.post.create({
    data: {
      ...data,
      author: { connect: { id: authorId } },
      tags: { connectOrCreate: connectTags(tags) },
    },
    include,
  });
  res.location(`/api/posts/${post.id}`).status(201).json(post);
});

router.patch('/:id', validate(idSchema, 'params'), validate(updateSchema), async (req, res) => {
  const { authorId, tags, ...data } = req.validated.body;
  if (authorId !== undefined) data.author = { connect: { id: authorId } };
  if (tags !== undefined) data.tags = { set: [], connectOrCreate: connectTags(tags) };

  const post = await prisma.post.update({
    where: { id: req.validated.params.id },
    data,
    include,
  });
  res.json(post);
});

router.delete('/:id', validate(idSchema, 'params'), async (req, res) => {
  await prisma.post.delete({ where: { id: req.validated.params.id } });
  res.status(204).end();
});

export default router;
