import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename, stat, unlink, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data', 'rooms');
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES = 500;
const MAX_ROOMS = 100;
const MAX_NAME_LENGTH = 40;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天无更新则销毁房间
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 每小时扫一次过期房间

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// 可在聊天流里直接预览的图片类型（SVG 可携带脚本，故不做内联预览）
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

// 虚拟隧道 / 点对点接口，不是别人能访问的局域网地址
const IGNORED_INTERFACES = /^(utun|tun|tap|ipsec|ppp|awdl|llw|gif|stf)/;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function safeName(value) {
  return basename(String(value || 'file'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .slice(0, 180) || 'file';
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return '';
  }
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function clientIp(req) {
  const ip = req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

function bearer(req, url, param) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return url.searchParams.get(param) || '';
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON 格式无效'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function getLanAddresses(port, interfaces = networkInterfaces()) {
  const result = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (IGNORED_INTERFACES.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        result.push({ name, url: `http://${address.address}:${port}` });
      }
    }
  }
  return result;
}

function describeInterface(name) {
  if (name.startsWith('bridge')) return '雷电网桥 Thunderbolt Bridge';
  return name;
}

export async function createApp(options = {}) {
  const adminToken = options.adminToken || process.env.ADMIN_TOKEN || randomBytes(6).toString('hex');
  const maxFileSize = Number(options.maxFileSize || process.env.MAX_FILE_SIZE || DEFAULT_MAX_FILE_SIZE);
  const dataDir = options.dataDir || DATA_DIR;
  const retentionMs = Number(
    options.retentionMs
    ?? (process.env.RETENTION_DAYS ? Number(process.env.RETENTION_DAYS) * 24 * 60 * 60 * 1000 : DEFAULT_RETENTION_MS),
  );

  const rooms = new Map(); // roomId -> room
  const roomByCode = new Map(); // 4位口令 -> roomId
  const sessions = new Map(); // sessionToken -> session
  const sessionsFile = join(dataDir, '_sessions.json');
  await mkdir(dataDir, { recursive: true });

  // 原子写：先写临时文件再改名，避免写一半损坏
  async function writeJsonAtomic(path, data) {
    const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, path);
  }

  function persistRoom(room) {
    const snapshot = {
      id: room.id,
      code: room.code,
      name: room.name,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      messages: room.messages,
    };
    writeJsonAtomic(join(room.dir, 'room.json'), snapshot).catch(() => {});
  }

  function persistSessions() {
    const list = [...sessions.values()];
    writeJsonAtomic(sessionsFile, list).catch(() => {});
  }

  function generateCode() {
    for (let i = 0; i < 2000; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!roomByCode.has(code)) return code;
    }
    return null;
  }

  function broadcast(room, payload) {
    for (const res of room.clients.keys()) res.write(payload);
  }

  function publish(room, message) {
    const item = { id: randomUUID(), time: new Date().toISOString(), ...message };
    room.messages.push(item);
    if (room.messages.length > MAX_MESSAGES) room.messages.shift();
    room.lastActivity = item.time;
    broadcast(room, `data: ${JSON.stringify(item)}\n\n`);
    persistRoom(room);
    return item;
  }

  // 房间内当前在线的会话（按会话去重，一个人开多个标签只算一次）
  function roomSessions(room) {
    const seen = new Set();
    const result = [];
    for (const token of room.clients.values()) {
      if (seen.has(token)) continue;
      seen.add(token);
      const session = sessions.get(token);
      if (session) result.push(session);
    }
    return result;
  }

  function publishPresence(room) {
    const members = [...new Set(roomSessions(room).map((s) => s.sender))].sort((a, b) => a.localeCompare(b, 'zh'));
    broadcast(room, `event: presence\ndata: ${JSON.stringify({ members })}\n\n`);
  }

  function closeSessionStreams(room, token, { notify = true } = {}) {
    for (const [res, resToken] of [...room.clients.entries()]) {
      if (resToken === token) {
        if (notify) res.write('event: kicked\ndata: {}\n\n');
        room.clients.delete(res);
        res.end();
      }
    }
  }

  async function deleteRoom(room) {
    for (const res of [...room.clients.keys()]) {
      res.write('event: closed\ndata: {}\n\n');
      res.end();
    }
    let removed = false;
    for (const [token, session] of [...sessions.entries()]) {
      if (session.roomId === room.id) { sessions.delete(token); removed = true; }
    }
    rooms.delete(room.id);
    roomByCode.delete(room.code);
    await rm(room.dir, { recursive: true, force: true }).catch(() => {});
    if (removed) persistSessions();
  }

  // 从磁盘恢复房间与会话，并清理已过期的房间
  async function loadState() {
    const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(dataDir, entry.name);
      const snapshot = await readFile(join(dir, 'room.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (!snapshot?.id || !snapshot.code) continue;
      const room = {
        id: snapshot.id,
        code: snapshot.code,
        name: snapshot.name,
        messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
        clients: new Map(),
        dir,
        createdAt: snapshot.createdAt || new Date().toISOString(),
        lastActivity: snapshot.lastActivity || snapshot.createdAt || new Date().toISOString(),
      };
      rooms.set(room.id, room);
      roomByCode.set(room.code, room.id);
    }
    const saved = await readFile(sessionsFile, 'utf8').then(JSON.parse).catch(() => []);
    if (Array.isArray(saved)) {
      for (const s of saved) {
        if (s?.token && rooms.has(s.roomId)) sessions.set(s.token, s);
      }
    }
    await sweepExpired();
  }

  // 销毁超过保留期没有更新的房间
  async function sweepExpired() {
    const cutoff = Date.now() - retentionMs;
    for (const room of [...rooms.values()]) {
      if (new Date(room.lastActivity).getTime() < cutoff) await deleteRoom(room);
    }
  }

  function resolveSession(req, url) {
    const token = bearer(req, url, 'session');
    const session = token && sessions.get(token);
    if (!session) return null;
    const room = rooms.get(session.roomId);
    if (!room) return null;
    session.lastSeen = new Date().toISOString();
    return { session, room, token };
  }

  function requireAdmin(req, url) {
    return safeEqual(bearer(req, url, 'token'), adminToken);
  }

  async function adminOverview() {
    const list = await Promise.all(
      [...rooms.values()].map(async (room) => {
        const files = (await readdir(room.dir).catch(() => [])).filter((f) => f !== 'room.json');
        const members = roomSessions(room).map((s) => ({
          id: s.id,
          sender: s.sender,
          ip: s.ip,
          connectedAt: s.createdAt,
          lastSeen: s.lastSeen,
        }));
        return {
          id: room.id,
          name: room.name,
          code: room.code,
          createdAt: room.createdAt,
          lastActivity: room.lastActivity,
          memberCount: members.length,
          messageCount: room.messages.length,
          fileCount: files.length,
          members,
        };
      }),
    );
    list.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
    return { rooms: list, totalRooms: list.length };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    try {
      // ---------- 加入 / 创建房间（口令即房间身份） ----------
      if (req.method === 'POST' && path === '/api/join') {
        const body = await readJson(req);
        const sender = String(body.sender || '').trim().slice(0, MAX_NAME_LENGTH);
        const code = String(body.code || '').trim();
        const mode = String(body.mode || 'join'); // 'create' | 'join'
        if (!sender) return json(res, 400, { error: '昵称不能为空' });

        let room;
        if (mode === 'create') {
          if (rooms.size >= MAX_ROOMS) return json(res, 400, { error: '房间数量已达上限' });
          let roomCode = code;
          if (roomCode) {
            if (!/^\d{4}$/.test(roomCode)) return json(res, 400, { error: '口令必须是 4 位数字' });
            if (roomByCode.has(roomCode)) return json(res, 409, { error: '该口令已被占用，请换一个' });
          } else {
            roomCode = generateCode();
            if (!roomCode) return json(res, 400, { error: '暂时无法分配口令，请稍后再试' });
          }
          const name = String(body.room || '').trim().slice(0, MAX_NAME_LENGTH) || `房间 ${roomCode}`;
          const id = randomUUID();
          room = {
            id,
            code: roomCode,
            name,
            messages: [],
            clients: new Map(),
            dir: join(dataDir, id),
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          };
          await mkdir(room.dir, { recursive: true });
          rooms.set(id, room);
          roomByCode.set(roomCode, id);
          persistRoom(room);
        } else {
          if (!/^\d{4}$/.test(code)) return json(res, 400, { error: '请输入 4 位数字口令' });
          room = rooms.get(roomByCode.get(code));
          if (!room) return json(res, 404, { error: '口令不存在，请检查后重试，或改用“创建房间”' });
        }

        const token = randomBytes(24).toString('hex');
        const session = {
          token,
          id: randomUUID(),
          roomId: room.id,
          sender,
          ip: clientIp(req),
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        sessions.set(token, session);
        persistSessions();
        return json(res, 200, { session: token, room: { id: room.id, name: room.name, code: room.code }, sender });
      }

      // ---------- 管理接口（管理员口令，仅元信息） ----------
      if (path.startsWith('/api/admin/')) {
        if (!requireAdmin(req, url)) return json(res, 401, { error: '管理员口令错误' });

        if (req.method === 'GET' && path === '/api/admin/overview') {
          return json(res, 200, await adminOverview());
        }

        if (req.method === 'GET' && path === '/api/admin/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(': connected\n\n');
          let closed = false;
          const push = async () => {
            if (closed) return;
            res.write(`data: ${JSON.stringify(await adminOverview())}\n\n`);
          };
          await push();
          const timer = setInterval(push, 2000);
          req.on('close', () => { closed = true; clearInterval(timer); });
          return;
        }

        if (req.method === 'POST' && path === '/api/admin/rooms/delete') {
          const { roomId } = await readJson(req);
          const room = rooms.get(String(roomId));
          if (!room) return json(res, 404, { error: '房间不存在' });
          await deleteRoom(room);
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && path === '/api/admin/members/kick') {
          const { memberId } = await readJson(req);
          for (const [token, session] of [...sessions.entries()]) {
            if (session.id === String(memberId)) {
              const room = rooms.get(session.roomId);
              sessions.delete(token);
              persistSessions();
              if (room) {
                closeSessionStreams(room, token);
                publishPresence(room);
              }
              return json(res, 200, { ok: true });
            }
          }
          return json(res, 404, { error: '成员不存在或已离线' });
        }

        return json(res, 404, { error: '接口不存在' });
      }

      // ---------- 房间数据接口（会话令牌） ----------
      if (path.startsWith('/api/')) {
        const context = resolveSession(req, url);
        if (!context) return json(res, 401, { error: '请重新加入房间' });
        const { session, room, token } = context;

        if (req.method === 'GET' && path === '/api/history') {
          return json(res, 200, { room: { id: room.id, name: room.name, code: room.code }, sender: session.sender, messages: room.messages });
        }

        if (req.method === 'GET' && path === '/api/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(': connected\n\n');
          room.clients.set(res, token);
          publishPresence(room);
          const timer = setInterval(() => res.write(': ping\n\n'), 20000);
          req.on('close', () => {
            clearInterval(timer);
            room.clients.delete(res);
            if (rooms.has(room.id)) publishPresence(room);
          });
          return;
        }

        if (req.method === 'POST' && path === '/api/messages') {
          const body = await readJson(req);
          const text = String(body.text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
          if (!text) return json(res, 400, { error: '消息不能为空' });
          return json(res, 201, publish(room, { type: 'text', sender: session.sender, text }));
        }

        if (req.method === 'POST' && path === '/api/files') {
          const length = Number(req.headers['content-length'] || 0);
          if (!length) return json(res, 400, { error: '文件为空' });
          if (length > maxFileSize) return json(res, 413, { error: `文件不能超过 ${Math.floor(maxFileSize / 1024 / 1024)} MB` });
          const originalName = safeName(decodeHeader(req.headers['x-file-name']) || 'file');
          const fileId = randomUUID();
          const storedName = `${fileId}${extname(originalName).slice(0, 16)}`;
          const destination = join(room.dir, storedName);
          let received = 0;
          req.on('data', (chunk) => {
            received += chunk.length;
            if (received > maxFileSize) req.destroy(Object.assign(new Error('文件过大'), { status: 413 }));
          });
          try {
            await pipeline(req, createWriteStream(destination, { flags: 'wx' }));
          } catch (error) {
            await unlink(destination).catch(() => {});
            throw error;
          }
          return json(res, 201, publish(room, { type: 'file', sender: session.sender, fileId, fileName: originalName, size: received, storedName }));
        }

        if (req.method === 'GET' && path.startsWith('/api/files/')) {
          const fileId = path.slice('/api/files/'.length);
          const item = [...room.messages].reverse().find((m) => m.type === 'file' && m.fileId === fileId);
          if (!item) return json(res, 404, { error: '文件不存在' });
          const filePath = join(room.dir, item.storedName);
          const info = await stat(filePath).catch(() => null);
          if (!info) return json(res, 404, { error: '文件已被删除' });
          const imageType = IMAGE_TYPES[extname(item.fileName).toLowerCase()];
          const inline = url.searchParams.has('inline') && imageType;
          res.writeHead(200, {
            'Content-Type': inline ? imageType : 'application/octet-stream',
            'Content-Length': info.size,
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
          });
          return createReadStream(filePath).pipe(res);
        }

        if (req.method === 'POST' && path === '/api/leave') {
          sessions.delete(token);
          persistSessions();
          closeSessionStreams(room, token, { notify: false });
          publishPresence(room);
          return json(res, 200, { ok: true });
        }

        return json(res, 404, { error: '接口不存在' });
      }

      // ---------- 静态文件 ----------
      if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求方法' });
      const requestPath = path === '/' ? '/index.html' : path === '/admin' ? '/admin.html' : path;
      const normalized = requestPath.replace(/^\/+/, '');
      if (normalized.includes('..')) return json(res, 400, { error: '路径无效' });
      const filePath = join(PUBLIC_DIR, normalized);
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) return json(res, 404, { error: '页面不存在' });
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.message || '服务器错误' });
      else res.destroy();
    }
  });

  await loadState();

  // 定时销毁过期房间；unref 保证不阻止进程退出（测试友好）
  const sweepTimer = setInterval(() => { sweepExpired().catch(() => {}); }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  server.on('close', () => clearInterval(sweepTimer));

  return { server, adminToken, rooms, sessions, sweepExpired };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const { server, adminToken } = await createApp();
  server.listen(port, host, () => {
    console.log('\n团子 Dango 已启动');
    console.log(`管理员口令: ${adminToken}`);
    console.log(`本机访问: http://localhost:${port}`);
    console.log(`管理页面: http://localhost:${port}/admin`);
    for (const { name, url } of getLanAddresses(port)) {
      console.log(`局域网访问 [${describeInterface(name)}]: ${url}`);
    }
    const retentionDays = Math.round(Number(process.env.RETENTION_DAYS || 30));
    console.log('\n用户打开地址后，自己填房间名和口令即可建房或加入。');
    console.log(`聊天记录持久化保存，超过 ${retentionDays} 天无更新的房间会自动销毁。`);
    console.log('按 Ctrl+C 停止服务。\n');
  });
}
