import { Router } from 'express';
import Joi from 'joi';
import { prisma } from '../config/index.js';
import validate, { idSchema, paginationSchema } from '../middleware/validate.js';

const router = Router();
const fields = {
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254),
  name: Joi.string().trim().min(1).max(100),
  role: Joi.string().valid('USER', 'ADMIN'),
};
const createSchema = Joi.object({
  ...fields,
  email: fields.email.required(),
  name: fields.name.required(),
  role: fields.role.default('USER'),
}).required();
const updateSchema = Joi.object(fields).min(1).required();

router.get('/', validate(paginationSchema, 'query'), async (req, res) => {
  const { page, limit } = req.validated.query;
  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.user.count(),
  ]);
  res.json({ data, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
});

router.get('/:id', validate(idSchema, 'params'), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.validated.params.id },
    include: {
      posts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
    },
  });
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
});

router.post('/', validate(createSchema), async (req, res) => {
  const user = await prisma.user.create({ data: req.validated.body });
  res.location(`/api/users/${user.id}`).status(201).json(user);
});

router.patch('/:id', validate(idSchema, 'params'), validate(updateSchema), async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.validated.params.id },
    data: req.validated.body,
  });
  res.json(user);
});

router.delete('/:id', validate(idSchema, 'params'), async (req, res) => {
  await prisma.user.delete({ where: { id: req.validated.params.id } });
  res.status(204).end();
});

export default router;
