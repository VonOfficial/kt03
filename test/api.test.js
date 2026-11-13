import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'kt03-'));
let server;
let prisma;
let baseUrl;

before(async () => {
  process.env.DATABASE_URL = `file:${join(temp, 'test.db').replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['scripts/setup-env.js'], { cwd: root, env: process.env });
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
  });
  const config = await import('../src/config/index.js');
  prisma = config.prisma;
  const { app } = await import('../src/index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.post.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (prisma) await prisma.$disconnect();
  rmSync(temp, { recursive: true, force: true });
});

async function request(method, path, data) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.status === 204 ? null : await response.json(),
  };
}

async function user(email = 'von@example.com') {
  const response = await request('POST', '/api/users', { name: 'Von', email });
  assert.equal(response.status, 201);
  return response.body;
}

async function post(authorId, extra = {}) {
  const response = await request('POST', '/api/posts', { title: 'Prisma Guide', authorId, ...extra });
  assert.equal(response.status, 201);
  return response.body;
}

test('создание пользователя: статус, нормализация, роль по умолчанию', async () => {
  const response = await request('POST', '/api/users', {
    name: ' Von ', email: 'VON@Example.com',
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.email, 'von@example.com');
  assert.equal(response.body.name, 'Von');
  assert.equal(response.body.role, 'USER');
  assert.equal(response.headers.get('location'), `/api/users/${response.body.id}`);
});

test('список пользователей: пагинация и meta', async () => {
  await user();
  const second = await user('second@example.com');
  const response = await request('GET', '/api/users?page=1&limit=1');
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].id, second.id);
  assert.deepEqual(response.body.meta, { total: 2, page: 1, limit: 1, pages: 2 });
  const page2 = await request('GET', '/api/users?page=2&limit=1');
  assert.equal(page2.body.data.length, 1);
  assert.notEqual(page2.body.data[0].id, second.id);
});

test('пользователь возвращается с постами в порядке createdAt DESC', async () => {
  const author = await user();
  const first = await post(author.id);
  await prisma.post.update({ where: { id: first.id }, data: { createdAt: new Date('2020-01-01') } });
  const second = await post(author.id);
  const response = await request('GET', `/api/users/${author.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.posts.map((item) => item.id), [second.id, first.id]);
});

test('PATCH пользователя меняет только переданные поля', async () => {
  const author = await user();
  const response = await request('PATCH', `/api/users/${author.id}`, { name: 'New name', role: 'ADMIN' });
  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'New name');
  assert.equal(response.body.role, 'ADMIN');
  assert.equal(response.body.email, author.email);
});

test('удаление пользователя без постов возвращает 204', async () => {
  const author = await user();
  const response = await request('DELETE', `/api/users/${author.id}`);
  assert.equal(response.status, 204);
  assert.equal((await request('GET', `/api/users/${author.id}`)).status, 404);
});

test('пользователя с постами нельзя удалить: 409, данные сохранены', async () => {
  const author = await user();
  const created = await post(author.id);
  assert.equal((await request('DELETE', `/api/users/${author.id}`)).status, 409);
  assert.equal((await request('GET', `/api/posts/${created.id}`)).status, 200);
});

test('дубликат email при создании и обновлении возвращает 409', async () => {
  await user();
  assert.equal((await request('POST', '/api/users', { name: 'Other', email: 'VON@example.com' })).status, 409);
  const second = await user('second@example.com');
  assert.equal((await request('PATCH', `/api/users/${second.id}`, { email: 'von@example.com' })).status, 409);
});

test('валидация пользователя: email, имя, роль, пустой PATCH, лишние поля', async () => {
  for (const body of [
    {}, { name: 'Von', email: 'broken' }, { name: ' ', email: 'v@example.com' },
    { name: 'Von', email: 'v@example.com', role: 'OWNER' },
    { name: 'Von', email: 'v@example.com', id: 1 },
  ]) {
    assert.equal((await request('POST', '/api/users', body)).status, 400);
  }
  assert.equal((await request('PATCH', '/api/users/1', {})).status, 400);
});

test('создание поста: значения по умолчанию, автор, теги, GET по id', async () => {
  const author = await user();
  const created = await post(author.id);
  assert.equal(created.published, false);
  assert.equal(created.content, null);
  assert.equal(created.author.id, author.id);
  assert.deepEqual(created.tags, []);
  const response = await request('GET', `/api/posts/${created.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.author.email, author.email);
});

test('connectOrCreate создает новые теги и повторно использует существующие', async () => {
  const author = await user();
  const first = await post(author.id, { tags: ['Prisma', 'Node.js', 'Prisma'] });
  const second = await post(author.id, { tags: ['Prisma'] });
  assert.equal(first.tags.length, 2);
  assert.equal(first.tags.find((tag) => tag.name === 'Prisma').id, second.tags[0].id);
  assert.equal(await prisma.tag.count(), 2);
});

test('POST с несуществующим автором возвращает 404 без создания поста и тегов', async () => {
  const response = await request('POST', '/api/posts', {
    title: 'Invalid author', authorId: 2147483647, tags: ['Rollback'],
  });
  assert.equal(response.status, 404);
  assert.equal(await prisma.post.count(), 0);
  assert.equal(await prisma.tag.count(), 0);
});

test('каждый фильтр и их сочетание, published=false и пагинация', async () => {
  const first = await user();
  const second = await user('second@example.com');
  await post(first.id, { title: 'Prisma Guide', published: false });
  const match = await post(first.id, { title: 'PRISMA Advanced', published: true });
  await post(second.id, { title: 'Prisma Other', published: true });
  await post(first.id, { title: 'Express Guide', published: true });

  const filtered = await request('GET', `/api/posts?search=pRiSmA&published=true&authorId=${first.id}&page=1&limit=1`);
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.data.map((item) => item.id), [match.id]);
  assert.deepEqual(filtered.body.meta, { total: 1, page: 1, limit: 1, pages: 1 });
  assert.equal((await request('GET', '/api/posts?search=PRISMA')).body.meta.total, 3);
  assert.equal((await request('GET', '/api/posts?published=false')).body.meta.total, 1);
  assert.equal((await request('GET', `/api/posts?authorId=${second.id}`)).body.meta.total, 1);
  const all = await request('GET', '/api/posts?page=2&limit=2');
  assert.equal(all.body.data.length, 2);
  assert.deepEqual(all.body.meta, { total: 4, page: 2, limit: 2, pages: 2 });
});

test('поиск по кириллице без учета регистра применяется до пагинации', async () => {
  const author = await user();
  await post(author.id, { title: 'Первый ПОСТ', published: true });
  await post(author.id, { title: 'Второй пост', published: true });
  await post(author.id, { title: 'Пост в черновиках', published: false });
  const response = await request('GET', '/api/posts?search=пОсТ&published=true&page=2&limit=1');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].title, 'Первый ПОСТ');
  assert.deepEqual(response.body.meta, { total: 2, page: 2, limit: 1, pages: 2 });
});

test('символы % и _ в поиске считаются обычным текстом', async () => {
  const author = await user();
  await post(author.id, { title: '100% ready_now' });
  await post(author.id, { title: 'Other post' });
  for (const search of ['%', '_']) {
    const response = await request('GET', `/api/posts?search=${encodeURIComponent(search)}`);
    assert.equal(response.body.meta.total, 1);
    assert.equal(response.body.data[0].title, '100% ready_now');
  }
});

test('пустой результат и страница за пределами списка', async () => {
  const empty = await request('GET', '/api/posts');
  assert.deepEqual(empty.body, { data: [], meta: { total: 0, page: 1, limit: 10, pages: 0 } });
  const author = await user();
  await post(author.id);
  const response = await request('GET', '/api/posts?page=3&limit=1');
  assert.deepEqual(response.body, { data: [], meta: { total: 1, page: 3, limit: 1, pages: 1 } });
});

test('PATCH поста меняет автора, публикацию, контент и набор тегов', async () => {
  const first = await user();
  const second = await user('second@example.com');
  const created = await post(first.id, { tags: ['Old', 'Shared'], content: 'Text' });
  const other = await post(first.id, { tags: ['Shared'] });
  const response = await request('PATCH', `/api/posts/${created.id}`, {
    title: 'Updated', content: null, published: true, authorId: second.id, tags: ['New', 'Shared'],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.author.id, second.id);
  assert.equal(response.body.content, null);
  assert.equal(response.body.published, true);
  assert.deepEqual(response.body.tags.map((tag) => tag.name), ['New', 'Shared']);
  assert.equal((await request('GET', `/api/posts/${other.id}`)).body.tags[0].name, 'Shared');
});

test('PATCH сохраняет неуказанные поля и очищает теги через []', async () => {
  const author = await user();
  const created = await post(author.id, { published: true, tags: ['Prisma'], content: 'Text' });
  const response = await request('PATCH', `/api/posts/${created.id}`, { title: 'Renamed' });
  assert.equal(response.body.published, true);
  assert.equal(response.body.content, 'Text');
  assert.equal(response.body.tags.length, 1);
  const cleared = await request('PATCH', `/api/posts/${created.id}`, { tags: [] });
  assert.deepEqual(cleared.body.tags, []);
});

test('неудачный PATCH с автором откатывает остальные изменения', async () => {
  const author = await user();
  const created = await post(author.id, { tags: ['Original'] });
  const response = await request('PATCH', `/api/posts/${created.id}`, {
    authorId: 2147483647, title: 'Changed', tags: ['Must rollback'],
  });
  assert.equal(response.status, 404);
  const unchanged = await request('GET', `/api/posts/${created.id}`);
  assert.equal(unchanged.body.title, created.title);
  assert.deepEqual(unchanged.body.tags.map((tag) => tag.name), ['Original']);
  assert.equal(await prisma.tag.count({ where: { name: 'Must rollback' } }), 0);
});

test('удаление поста очищает связи и позволяет удалить автора', async () => {
  const author = await user();
  const created = await post(author.id, { tags: ['Keep'] });
  assert.equal((await request('DELETE', `/api/posts/${created.id}`)).status, 204);
  assert.equal((await request('GET', `/api/posts/${created.id}`)).status, 404);
  assert.equal((await request('DELETE', `/api/users/${author.id}`)).status, 204);
  const tag = await prisma.tag.findUnique({ where: { name: 'Keep' }, include: { posts: true } });
  assert.deepEqual(tag.posts, []);
});

test('валидация поста: обязательные поля, типы, теги, пустой PATCH', async () => {
  for (const body of [
    {}, { title: 'Title' }, { authorId: 1 }, { title: ' ', authorId: 1 },
    { title: 'Title', authorId: '1' }, { title: 'Title', authorId: -1 },
    { title: 'Title', authorId: 1, published: 'false' },
    { title: 'Title', authorId: 1, tags: [''] },
    { title: 'Title', authorId: 1, tags: [1] },
    { title: 'Title', authorId: 1, unknown: true },
  ]) {
    assert.equal((await request('POST', '/api/posts', body)).status, 400);
  }
  assert.equal((await request('PATCH', '/api/posts/1', {})).status, 400);
});

test('неверные query-параметры и id возвращают 400', async () => {
  for (const path of [
    '/api/posts?page=0', '/api/posts?limit=101', '/api/posts?page=1.5',
    '/api/posts?published=maybe', '/api/posts?authorId=abc', '/api/posts?authorId=-1',
    '/api/posts?page=1&page=2', '/api/posts?unknown=1', '/api/users?limit=0',
    '/api/users/abc', '/api/posts/0', '/api/posts/2147483648',
  ]) {
    assert.equal((await request('GET', path)).status, 400, path);
  }
});

test('несуществующие записи и маршруты возвращают 404', async () => {
  for (const resource of ['users', 'posts']) {
    assert.equal((await request('GET', `/api/${resource}/2147483647`)).status, 404);
    assert.equal((await request('DELETE', `/api/${resource}/2147483647`)).status, 404);
    const body = resource === 'users' ? { name: 'Missing' } : { title: 'Missing' };
    assert.equal((await request('PATCH', `/api/${resource}/2147483647`, body)).status, 404);
  }
  assert.equal((await request('GET', '/api/missing')).status, 404);
});

test('некорректный JSON возвращает 400 в JSON-формате', async () => {
  const response = await fetch(`${baseUrl}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Некорректный JSON' });
});
