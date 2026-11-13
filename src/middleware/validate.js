import Joi from 'joi';

export const idSchema = Joi.object({
  id: Joi.number().integer().min(1).max(2147483647).required(),
});

export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).max(1000000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

export default function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      allowUnknown: false,
    });

    if (error) {
      return res.status(400).json({
        error: 'Ошибка валидации',
        details: error.details.map((item) => ({
          field: item.path.join('.'),
          message: item.message,
        })),
      });
    }

    req.validated = { ...req.validated, [source]: value };
    next();
  };
}
