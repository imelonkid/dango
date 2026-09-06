const $ = (selector) => document.querySelector(selector);

const loginEl = $('#login');
const dashboardEl = $('#dashboard');
const tokenInput = $('#admin-token');
const loginError = $('#login-error');
const roomsEl = $('#rooms');
const refreshText = $('#refresh-text');
const toastEl = $('#toast');

const STORAGE = 'dango.admin';
let token = sessionStorage.getItem(STORAGE) || '';
let events = null;
let toastTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 401) {
    logout();
    throw new Error('管理员口令错误');
  }
  return response;
}

/* ---------- 渲染 ---------- */

function render(data) {
  const rooms = data.rooms || [];
  let members = 0;
  let messages = 0;
  let files = 0;
  for (const room of rooms) {
    members += room.memberCount;
    messages += room.messageCount;
    files += room.fileCount;
  }
  $('#stat-rooms').textContent = rooms.length;
  $('#stat-members').textContent = members;
  $('#stat-messages').textContent = messages;
  $('#stat-files').textContent = files;

  roomsEl.replaceChildren();
  if (!rooms.length) {
    roomsEl.append(el('div', 'empty', '还没有人建房间'));
    return;
  }
  for (const room of rooms) roomsEl.append(renderRoom(room));
}

function renderRoom(room) {
  const card = el('div', 'room');

  const head = el('div', 'room-head');
  head.append(el('span', 'room-title', room.name));
  const badges = el('div', 'room-badges');
  badges.append(
    el('span', 'badge', `口令 ${room.code}`),
    el('span', 'badge', `${room.memberCount} 人在线`),
    el('span', 'badge', `${room.messageCount} 条消息`),
    el('span', 'badge', `${room.fileCount} 个文件`),
    el('span', 'badge', `建于 ${fmtTime(room.createdAt)}`),
    el('span', 'badge', `活跃 ${fmtTime(room.lastActivity)}`),
  );
  head.append(badges);
  const actions = el('div', 'room-actions');
  const del = el('button', 'btn-danger', '删除房间');
  del.addEventListener('click', () => deleteRoom(room));
  actions.append(del);
  head.append(actions);
  card.append(head);

  if (!room.members.length) {
    card.append(el('div', 'empty-members', '当前无人在线'));
    return card;
  }

  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  ['昵称', 'IP 地址', '加入时间', '操作'].forEach((t) => hr.append(el('th', '', t)));
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const member of room.members) {
    const tr = el('tr');
    tr.append(el('td', '', member.sender));
    tr.append(el('td', 'ip', member.ip));
    tr.append(el('td', '', fmtTime(member.connectedAt)));
    const opCell = el('td');
    const kick = el('button', 'kick', '踢出');
    kick.addEventListener('click', () => kickMember(room, member));
    opCell.append(kick);
    tr.append(opCell);
    tbody.append(tr);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

/* ---------- 操作 ---------- */

async function deleteRoom(room) {
  if (!confirm(`删除房间「${room.name}」？房间内的消息和文件会被清除，在线成员会被断开。`)) return;
  try {
    await api('/api/admin/rooms/delete', { method: 'POST', body: JSON.stringify({ roomId: room.id }) });
    toast(`已删除房间「${room.name}」`);
  } catch (error) {
    toast(error.message);
  }
}

async function kickMember(room, member) {
  if (!confirm(`把「${member.sender}」（${member.ip}）移出房间「${room.name}」？`)) return;
  try {
    await api('/api/admin/members/kick', { method: 'POST', body: JSON.stringify({ memberId: member.id }) });
    toast(`已移出 ${member.sender}`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- 连接 ---------- */

function startStream() {
  events?.close();
  events = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`);
  events.onmessage = (event) => {
    refreshText.textContent = `实时刷新中 · 最后更新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    render(JSON.parse(event.data));
  };
  events.onerror = () => { refreshText.textContent = '连接中断，正在重试…'; };
}

function showDashboard() {
  loginEl.hidden = true;
  dashboardEl.hidden = false;
  startStream();
}

function logout() {
  events?.close();
  token = '';
  sessionStorage.removeItem(STORAGE);
  dashboardEl.hidden = true;
  loginEl.hidden = false;
  tokenInput.value = '';
  tokenInput.focus();
}

async function login() {
  const value = tokenInput.value.trim();
  if (!value) return;
  token = value;
  loginError.textContent = '';
  try {
    const response = await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('管理员口令错误');
    sessionStorage.setItem(STORAGE, token);
    render(await response.json());
    showDashboard();
  } catch (error) {
    token = '';
    loginError.textContent = error.message;
  }
}

$('#login-btn').addEventListener('click', login);
tokenInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
$('#logout').addEventListener('click', logout);

/* ---------- 启动 ---------- */

if (token) {
  fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      if (!response.ok) throw new Error('过期');
      return response.json();
    })
    .then((data) => { render(data); showDashboard(); })
    .catch(() => logout());
} else {
  loginEl.hidden = false;
  tokenInput.focus();
}
