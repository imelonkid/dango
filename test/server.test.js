import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp, getLanAddresses } from '../server.js';

async function startServer(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'mk-inner-net-'));
  const app = await createApp({ adminToken: 'admin-secret', dataDir, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); return new Promise((resolve) => app.server.close(resolve)); });
  return { ...app, dataDir, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function joinRoom(base, payload) {
  const response = await fetch(`${base}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function createRoom(base, sender, code, room) {
  return joinRoom(base, { mode: 'create', sender, code, room });
}

test('create assigns/accepts a 4-digit code, join needs only code + nickname', async (t) => {
  const { base } = await startServer(t);

  // 不指定口令时系统分配 4 位数字
  const auto = await createRoom(base, '电脑 A');
  assert.equal(auto.status, 200);
  assert.match(auto.body.room.code, /^\d{4}$/);
  assert.equal(auto.body.room.name, `房间 ${auto.body.room.code}`);

  // 指定口令并起名
  const made = await createRoom(base, '电脑 A', '1234', '项目组');
  assert.equal(made.status, 200);
  assert.equal(made.body.room.code, '1234');
  assert.equal(made.body.room.name, '项目组');

  // 同口令再创建 -> 冲突
  const dup = await createRoom(base, '别人', '1234', '别的');
  assert.equal(dup.status, 409);

  // 加入只需口令 + 昵称
  const joined = await joinRoom(base, { mode: 'join', sender: '电脑 B', code: '1234' });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.name, '项目组');
  assert.notEqual(joined.body.session, made.body.session);

  // 口令不存在
  assert.equal((await joinRoom(base, { mode: 'join', sender: 'x', code: '9999' })).status, 404);
  // 非法口令
  assert.equal((await createRoom(base, 'x', '12')).status, 400);
  assert.equal((await joinRoom(base, { mode: 'join', sender: 'x', code: 'abcd' })).status, 400);
  // 昵称必填
  assert.equal((await joinRoom(base, { mode: 'join', sender: '', code: '1234' })).status, 400);
});

test('chat and file flow is scoped to a session and works end to end', async (t) => {
  const { base, dataDir } = await startServer(t);
  const { body: a } = await createRoom(base, '电脑 A', '1111', '房间1');
  const auth = { Authorization: `Bearer ${a.session}` };

  assert.equal((await fetch(`${base}/api/history`)).status, 401);

  const sent = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '你好' }),
  });
  assert.equal(sent.status, 201);
  assert.equal((await sent.json()).sender, '电脑 A');

  const upload = await fetch(`${base}/api/files`, {
    method: 'POST',
    headers: { ...auth, 'X-File-Name': encodeURIComponent('测试.txt') },
    body: Buffer.from('file-content'),
  });
  assert.equal(upload.status, 201);
  const fileMessage = await upload.json();

  const history = await (await fetch(`${base}/api/history`, { headers: auth })).json();
  assert.equal(history.room.name, '房间1');
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[0].text, '你好');
  assert.equal(history.messages[1].fileName, '测试.txt');

  const download = await fetch(`${base}/api/files/${fileMessage.fileId}`, { headers: auth });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'file-content');
  assert.equal(await readFile(join(dataDir, history.room.id, fileMessage.storedName), 'utf8'), 'file-content');
});

test('rooms are isolated: one room cannot see another room messages or files', async (t) => {
  const { base } = await startServer(t);
  const { body: a } = await createRoom(base, 'a', '1010', 'A房');
  const { body: b } = await createRoom(base, 'b', '2020', 'B房');

  const posted = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.session}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '只在A房可见' }),
  });
  const msg = await posted.json();

  const bHistory = await (await fetch(`${base}/api/history`, { headers: { Authorization: `Bearer ${b.session}` } })).json();
  assert.equal(bHistory.messages.length, 0);

  const cross = await fetch(`${base}/api/files/${msg.id}`, { headers: { Authorization: `Bearer ${b.session}` } });
  assert.equal(cross.status, 404);
});

test('presence events list connected nicknames per room', async (t) => {
  const { base } = await startServer(t);
  const { body: a } = await createRoom(base, '电脑 A', '3030', '房间X');

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events?session=${a.session}`, { signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  let buffer = '';
  while (!buffer.includes('event: presence')) buffer += new TextDecoder().decode((await reader.read()).value);
  assert.match(buffer, /"members":\["电脑 A"\]/);
  controller.abort();
});

test('admin overview exposes metadata and ip, kick removes member, delete removes room', async (t) => {
  const { base } = await startServer(t);
  const { body: a } = await createRoom(base, '成员甲', '4040', '监控房');
  const adminAuth = { Authorization: 'Bearer admin-secret' };

  // 建立一个在线连接，让成员出现在在线列表里
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events?session=${a.session}`, { signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/overview`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);

  let overview = await (await fetch(`${base}/api/admin/overview`, { headers: adminAuth })).json();
  assert.equal(overview.rooms.length, 1);
  const room = overview.rooms[0];
  assert.equal(room.name, '监控房');
  assert.equal(room.members.length, 1);
  assert.equal(room.members[0].sender, '成员甲');
  assert.equal(room.members[0].ip, '127.0.0.1');
  // 元信息里不含消息正文
  assert.equal('messages' in room, false);
  const memberId = room.members[0].id;

  const kick = await fetch(`${base}/api/admin/members/kick`, {
    method: 'POST',
    headers: { ...adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId }),
  });
  assert.equal(kick.status, 200);

  // 被踢后会话失效
  assert.equal((await fetch(`${base}/api/history`, { headers: { Authorization: `Bearer ${a.session}` } })).status, 401);
  controller.abort();

  const del = await fetch(`${base}/api/admin/rooms/delete`, {
    method: 'POST',
    headers: { ...adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: room.id }),
  });
  assert.equal(del.status, 200);
  overview = await (await fetch(`${base}/api/admin/overview`, { headers: adminAuth })).json();
  assert.equal(overview.rooms.length, 0);
});

test('LAN address list skips tunnel interfaces and keeps the Thunderbolt bridge', () => {
  const addresses = getLanAddresses(3000, {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.1.23', internal: false }],
    bridge0: [{ family: 'IPv4', address: '169.254.10.5', internal: false }],
    utun8: [{ family: 'IPv4', address: '198.18.0.1', internal: false }],
  });
  assert.deepEqual(addresses, [
    { name: 'en0', url: 'http://192.168.1.23:3000' },
    { name: 'bridge0', url: 'http://169.254.10.5:3000' },
  ]);
});

test('rooms and messages persist across restart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dango-'));
  // 第一个实例：建房发消息
  const app1 = await createApp({ adminToken: 'a', dataDir });
  await new Promise((r) => app1.server.listen(0, '127.0.0.1', r));
  const base1 = `http://127.0.0.1:${app1.server.address().port}`;
  const { body: a } = await joinRoom(base1, { mode: 'create', sender: '甲', code: '4321', room: '持久化房' });
  await fetch(`${base1}/api/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.session}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '重启也要在' }),
  });
  await new Promise((r) => setTimeout(r, 50)); // 等落盘
  await new Promise((r) => app1.server.close(r));

  // 第二个实例：同 dataDir，应恢复房间、消息与会话
  const app2 = await createApp({ adminToken: 'a', dataDir });
  await new Promise((r) => app2.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => app2.server.close(r)));
  const base2 = `http://127.0.0.1:${app2.server.address().port}`;

  // 旧会话仍然有效，历史仍在
  const hist = await fetch(`${base2}/api/history`, { headers: { Authorization: `Bearer ${a.session}` } });
  assert.equal(hist.status, 200);
  const data = await hist.json();
  assert.equal(data.room.name, '持久化房');
  assert.equal(data.messages.at(-1).text, '重启也要在');

  // 别人用同口令加入也能看到历史
  const { body: b } = await joinRoom(base2, { mode: 'join', sender: '乙', code: '4321' });
  assert.equal(b.room.name, '持久化房');
});

test('rooms with no activity beyond retention are destroyed', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dango-'));
  const app = await createApp({ adminToken: 'a', dataDir, retentionMs: 30 * 24 * 60 * 60 * 1000 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => app.server.close(r)));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const { body: a } = await joinRoom(base, { mode: 'create', sender: '甲', code: '7777', room: '旧房' });
  assert.equal(app.rooms.size, 1);

  // 把最后活跃时间调到 31 天前，触发清理
  const room = [...app.rooms.values()][0];
  room.lastActivity = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  await app.sweepExpired();

  assert.equal(app.rooms.size, 0);
  // 房间没了，旧会话失效、口令也进不去
  assert.equal((await fetch(`${base}/api/history`, { headers: { Authorization: `Bearer ${a.session}` } })).status, 401);
  assert.equal((await joinRoom(base, { mode: 'join', sender: 'x', code: '7777' })).status, 404);
});
