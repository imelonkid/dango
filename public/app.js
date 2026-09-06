const $ = (selector) => document.querySelector(selector);

const messagesEl = $('#messages');
const scrollEl = $('#scroll');
const composer = $('#composer');
const messageInput = $('#message');
const sendButton = composer.querySelector('.send');
const fileInput = $('#file');
const connEl = $('#conn');
const connLabel = $('#conn-label');
const roomNameEl = $('#room-name');
const railOverlay = $('#rail-overlay');
const railRooms = $('#rail-rooms');
const roomsToggle = $('#rooms-toggle');
const roomsUnread = $('#rooms-unread');
const leaveButton = $('#leave-room');
const newPill = $('#new-pill');
const newPillLabel = $('#new-pill-label');
const emojiPicker = $('#emoji-picker');
const membersOverlay = $('#members-overlay');
const lightbox = $('#lightbox');
const lightboxImg = $('#lightbox-img');
const lightboxDownload = $('#lightbox-download');
const dialog = $('#identity-dialog');
const identityForm = $('#identity-form');
const identityTitle = $('#identity-title');
const identitySubmit = $('#identity-submit');
const modeSeg = $('#mode-seg');
const modeHint = $('#mode-hint');
const fieldRoom = $('#field-room');
const roomInput = $('#room');
const nicknameInput = $('#nickname');
const codeInput = $('#code');
const codeLabel = $('#code-label');
const regenBtn = $('#regen');
const identityError = $('#identity-error');
const toastEl = $('#toast');
const fileTemplate = $('#tpl-file');

const STORE_ROOMS = 'dango.rooms';
const STORE_ACTIVE = 'dango.active';
const STORE_NAME = 'dango.nickname';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const MAX_ROOM_MESSAGES = 500;
const EMOJIS = ['😀', '😂', '😊', '😉', '👍', '🙏', '🎉', '🔥', '😅', '🤔', '😭', '😴', '👌', '❤️', '✅', '⏳'];

const params = new URLSearchParams(location.search);
const codeParam = (params.get('code') || '').trim();

// code -> { code, name, sender, session, events, connected, messages, members, unread, seen, lastItem }
const joined = new Map();
let activeCode = null;
let defaultNick = localStorage.getItem(STORE_NAME) || '';
let mode = 'join'; // 加入弹窗当前模式
let scrollbackUnread = 0; // 当前房间未读（滚动条不在底部时）
let atBottom = true;
let toastTimer = null;

/* ---------- 工具 ---------- */

function activeRoom() {
  return activeCode ? joined.get(activeCode) : null;
}

function fileUrl(item, inline = false) {
  const room = activeRoom();
  const session = room ? room.session : '';
  return `/api/files/${encodeURIComponent(item.fileId)}?session=${encodeURIComponent(session)}${inline ? '&inline=1' : ''}`;
}

function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (dayKey(iso) === dayKey(today)) return `今天 · ${monthDay}`;
  if (dayKey(iso) === dayKey(yesterday)) return `昨天 · ${monthDay}`;
  return `${date.getFullYear()}年${monthDay}`;
}

function initial(name) {
  return (name.trim()[0] || '?').toUpperCase();
}

function isImage(item) {
  return item.type === 'file' && IMAGE_RE.test(item.fileName);
}

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
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

function setConnection(state, label, detail = '') {
  connEl.dataset.state = state;
  connLabel.replaceChildren(label);
  if (detail) connLabel.append(el('span', 'conn-detail', ` · ${detail}`));
}

function scrollToBottom() {
  requestAnimationFrame(() => { scrollEl.scrollTop = scrollEl.scrollHeight; });
}

function persist() {
  const list = [...joined.values()].map((r) => ({ code: r.code, name: r.name, sender: r.sender, session: r.session }));
  localStorage.setItem(STORE_ROOMS, JSON.stringify(list));
  if (activeCode) localStorage.setItem(STORE_ACTIVE, activeCode);
  else localStorage.removeItem(STORE_ACTIVE);
}

/* ---------- 消息渲染（针对当前房间） ---------- */

function buildFileCard(item, { pending = false } = {}) {
  const card = fileTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.file-name').textContent = item.fileName;
  const meta = card.querySelector('.file-meta');
  const progress = card.querySelector('.file-progress');
  const download = card.querySelector('.file-download');
  if (pending) {
    meta.textContent = `${formatSize(item.size)} · 传输中 0%`;
    progress.hidden = false;
  } else {
    meta.textContent = formatSize(item.size);
    download.hidden = false;
    download.href = fileUrl(item);
    download.setAttribute('download', item.fileName);
  }
  return card;
}

function buildImage(item) {
  const button = el('button', 'image-bubble');
  button.type = 'button';
  button.title = item.fileName;
  const img = el('img');
  img.src = fileUrl(item, true);
  img.alt = item.fileName;
  img.loading = 'lazy';
  img.addEventListener('load', () => { if (atBottom) scrollToBottom(); });
  button.append(img);
  button.addEventListener('click', () => openLightbox(item));
  return button;
}

function buildMessage(room, item, { pending = false } = {}) {
  const mine = item.sender === room.sender;
  const wrapper = el('div', `msg${mine ? ' mine' : ''}`);
  const cont = !pending && room.lastItem && room.lastItem.sender === item.sender && formatTime(room.lastItem.time) === formatTime(item.time);
  if (cont) wrapper.classList.add('cont');
  else {
    const meta = el('div', 'msg-meta');
    meta.append(el('b', '', item.sender), el('span', '', formatTime(item.time)));
    wrapper.append(meta);
  }
  if (item.type === 'file') {
    wrapper.append(isImage(item) && !pending ? buildImage(item) : buildFileCard(item, { pending }));
  } else {
    wrapper.append(el('div', 'bubble', item.text));
  }
  return wrapper;
}

// 把一条消息追加进当前房间的 DOM
function domAppend(room, item) {
  if (!room.lastItem || dayKey(room.lastItem.time) !== dayKey(item.time)) {
    const divider = el('div', 'divider');
    divider.append(el('span', '', dayLabel(item.time)));
    messagesEl.append(divider);
  }
  const node = buildMessage(room, item);
  node.dataset.id = item.id;
  messagesEl.append(node);
  room.lastItem = item;
}

function renderActive() {
  const room = activeRoom();
  messagesEl.replaceChildren();
  room.lastItem = null;
  for (const item of room.messages) domAppend(room, item);
  scrollbackUnread = 0;
  newPill.hidden = true;
  atBottom = true;
  scrollToBottom();
  renderMembers(room.members, room.sender);
  setHeader(room);
}

scrollEl.addEventListener('scroll', () => {
  atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
  if (atBottom && scrollbackUnread) {
    scrollbackUnread = 0;
    newPill.hidden = true;
  }
});

newPill.addEventListener('click', () => {
  scrollbackUnread = 0;
  newPill.hidden = true;
  scrollToBottom();
});

/* ---------- 收到新消息 ---------- */

function onRoomMessage(room, item) {
  if (room.seen.has(item.id)) return;
  room.seen.add(item.id);
  room.messages.push(item);
  if (room.messages.length > MAX_ROOM_MESSAGES) room.messages.shift();

  if (room.code === activeCode) {
    const wasBottom = atBottom;
    domAppend(room, item);
    if (wasBottom || item.sender === room.sender) {
      scrollToBottom();
    } else {
      scrollbackUnread += 1;
      newPillLabel.textContent = `${scrollbackUnread} 条新消息`;
      newPill.hidden = false;
    }
  } else {
    room.unread += 1;
    renderRail();
  }
}

/* ---------- 在线成员 ---------- */

function renderMembers(members, sender) {
  const others = members.filter((name) => name !== sender);
  const list = sender ? [sender, ...others] : others;
  document.querySelectorAll('.member-count').forEach((node) => { node.textContent = list.length; });
  for (const container of [$('#members'), $('#members-drawer')]) {
    container.replaceChildren();
    if (!list.length) {
      container.append(el('li', 'members-empty', '暂无成员'));
      continue;
    }
    list.forEach((name, index) => {
      const li = el('li', 'member');
      const me = index === 0 && name === sender;
      const avatar = el('span', `avatar ${me ? 'avatar-me' : index % 2 ? 'avatar-tint' : ''}`, initial(name));
      li.append(avatar, el('span', 'member-name', me ? `${name}（我）` : name), el('span', 'member-dot'));
      container.append(li);
    });
  }
}

$('#members-toggle').addEventListener('click', () => { membersOverlay.hidden = false; });
membersOverlay.addEventListener('click', (event) => {
  if (!event.target.closest('.drawer')) membersOverlay.hidden = true;
});

/* ---------- 图片灯箱 ---------- */

function openLightbox(item) {
  lightboxImg.src = fileUrl(item, true);
  lightboxDownload.href = fileUrl(item);
  lightboxDownload.setAttribute('download', item.fileName);
  lightbox.hidden = false;
}

lightbox.addEventListener('click', (event) => {
  if (event.target === lightboxDownload) return;
  lightbox.hidden = true;
  lightboxImg.removeAttribute('src');
});

/* ---------- 房间栏与顶栏 ---------- */

function renderRail() {
  railRooms.replaceChildren();
  let otherUnread = 0;
  for (const room of joined.values()) {
    if (room.code !== activeCode) otherUnread += room.unread;
    const btn = el('button', `rail-room${room.code === activeCode ? ' is-active' : ''}`);
    btn.type = 'button';
    btn.append(el('span', 'avatar', initial(room.name)));
    const main = el('div', 'rail-room-main');
    main.append(el('div', 'rail-room-name', room.name), el('div', 'rail-room-code', `口令 ${room.code}`));
    btn.append(main);
    if (room.unread) btn.append(el('span', 'unread', room.unread > 99 ? '99+' : String(room.unread)));
    btn.addEventListener('click', () => { setActive(room.code); closeRail(); });
    railRooms.append(btn);
  }
  roomsToggle.hidden = joined.size === 0;
  roomsUnread.hidden = otherUnread === 0;
  roomsUnread.textContent = otherUnread > 99 ? '99+' : String(otherUnread);
}

function openRail() {
  renderRail();
  railOverlay.hidden = false;
}

function closeRail() {
  railOverlay.hidden = true;
}

roomsToggle.addEventListener('click', openRail);
railOverlay.addEventListener('click', (event) => {
  if (!event.target.closest('.rail')) closeRail();
});

function setHeader(room) {
  if (!room) {
    roomNameEl.hidden = true;
    leaveButton.hidden = true;
    $('#my-initial').textContent = '?';
    $('#my-name').textContent = defaultNick || '未登录';
    document.title = '团子 Dango';
    return;
  }
  roomNameEl.textContent = `${room.name} · 口令 ${room.code}`;
  roomNameEl.hidden = false;
  leaveButton.hidden = false;
  $('#my-initial').textContent = initial(room.sender);
  $('#my-name').textContent = room.sender;
  document.title = `${room.name} · 团子`;
  setConnection(room.connected ? 'connected' : 'connecting', room.connected ? '已连接' : '正在连接…', `口令 ${room.code}`);
}

function setActive(code) {
  if (code !== activeCode) clearPending();
  activeCode = code;
  const room = joined.get(code);
  room.unread = 0;
  renderActive();
  renderRail();
  persist();
  messageInput.focus();
}

function clearChatUI() {
  messagesEl.replaceChildren();
  renderMembers([], '');
  setHeader(null);
  setConnection('connecting', '未加入房间');
}

/* ---------- 连接房间 ---------- */

function connectRoom(room) {
  return new Promise((resolve, reject) => {
    fetch('/api/history', { headers: { Authorization: `Bearer ${room.session}` } })
      .then(async (response) => {
        if (response.status === 401) throw Object.assign(new Error('会话已失效'), { expired: true });
        if (!response.ok) throw new Error((await response.json()).error || '连接失败');
        const data = await response.json();
        room.name = data.room.name;
        room.code = data.room.code;
        room.sender = data.sender;
        room.messages = data.messages;
        room.seen = new Set(data.messages.map((m) => m.id));
        if (room.code === activeCode) renderActive();
        room.events = new EventSource(`/api/events?session=${encodeURIComponent(room.session)}`);
        room.events.onopen = () => {
          room.connected = true;
          if (room.code === activeCode) setHeader(room);
          resolve();
        };
        room.events.onmessage = (event) => onRoomMessage(room, JSON.parse(event.data));
        room.events.addEventListener('presence', (event) => {
          room.members = JSON.parse(event.data).members;
          if (room.code === activeCode) renderMembers(room.members, room.sender);
        });
        room.events.addEventListener('kicked', () => removeRoom(room.code, `你已被移出房间「${room.name}」`));
        room.events.addEventListener('closed', () => removeRoom(room.code, `房间「${room.name}」已被管理员关闭`));
        room.events.onerror = () => {
          room.connected = false;
          if (room.code === activeCode) setConnection('error', '连接中断，正在重试…', `口令 ${room.code}`);
        };
      })
      .catch(reject);
  });
}

// 本地移除一个房间（被踢 / 被关 / 主动退出后调用）
function removeRoom(code, message) {
  const room = joined.get(code);
  if (!room) return;
  room.events?.close();
  joined.delete(code);
  persist();
  if (message) toast(message);
  if (activeCode === code) {
    const next = [...joined.keys()][0];
    activeCode = null;
    if (next) setActive(next);
    else { clearChatUI(); openIdentity(); }
  }
  renderRail();
}

async function leaveActiveRoom() {
  const room = activeRoom();
  if (!room) return;
  if (!confirm(`退出房间「${room.name}」？该房间的未读会清空，重新进入需要再输入口令。`)) return;
  room.events?.close(); // 先断开，避免收到自己退出触发的事件
  try {
    await fetch('/api/leave', { method: 'POST', headers: { Authorization: `Bearer ${room.session}` } });
  } catch { /* 网络错误也照常本地移除 */ }
  removeRoom(room.code);
}

leaveButton.addEventListener('click', leaveActiveRoom);

/* ---------- 加入 / 创建房间 ---------- */

function applyMode(next) {
  mode = next;
  for (const btn of modeSeg.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  }
  const creating = mode === 'create';
  fieldRoom.hidden = !creating;
  regenBtn.hidden = !creating;
  codeLabel.textContent = creating ? '房间口令（4 位数字，可改）' : '房间口令';
  codeInput.placeholder = creating ? '' : '4 位数字口令';
  modeHint.textContent = creating
    ? '系统已分配一个口令，可自己改成任意 4 位数字。把口令告诉要加入的人。'
    : '输入房间口令和昵称即可加入。';
  identitySubmit.textContent = creating ? '创建' : '加入';
  if (creating && !/^\d{4}$/.test(codeInput.value)) codeInput.value = randomCode();
}

for (const btn of modeSeg.querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => {
    identityError.textContent = '';
    if (mode !== btn.dataset.mode) codeInput.value = btn.dataset.mode === 'create' ? randomCode() : '';
    applyMode(btn.dataset.mode);
    (mode === 'create' ? nicknameInput : codeInput).focus();
  });
}

regenBtn.addEventListener('click', () => {
  codeInput.value = randomCode();
  identityError.textContent = '';
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
});

function openIdentity() {
  identityError.textContent = '';
  nicknameInput.value = defaultNick;
  roomInput.value = '';
  identityTitle.textContent = joined.size ? '加入 / 创建房间' : '进入团子';
  if (codeParam && !joined.has(codeParam)) {
    applyMode('join');
    codeInput.value = codeParam;
  } else {
    applyMode(mode);
  }
  $('#identity-cancel').hidden = joined.size === 0;
  if (!dialog.open) dialog.showModal();
  (mode === 'create' || !defaultNick ? nicknameInput : codeInput).focus();
}

identityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nextName = nicknameInput.value.trim();
  const nextCode = codeInput.value.trim();
  const nextRoom = roomInput.value.trim();
  if (!nextName) { identityError.textContent = '请填写昵称'; return; }
  if (mode === 'join' && !/^\d{4}$/.test(nextCode)) { identityError.textContent = '请输入 4 位数字口令'; return; }
  if (mode === 'create' && nextCode && !/^\d{4}$/.test(nextCode)) { identityError.textContent = '口令必须是 4 位数字'; return; }
  identitySubmit.disabled = true;
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, sender: nextName, code: nextCode, room: mode === 'create' ? nextRoom : undefined }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');

    defaultNick = data.sender;
    localStorage.setItem(STORE_NAME, defaultNick);

    // 已在该房间：替换旧会话，避免重复
    const existing = joined.get(data.room.code);
    if (existing) existing.events?.close();

    const room = {
      code: data.room.code,
      name: data.room.name,
      sender: data.sender,
      session: data.session,
      events: null,
      connected: false,
      messages: [],
      members: [],
      unread: 0,
      seen: new Set(),
      lastItem: null,
    };
    joined.set(room.code, room);
    activeCode = room.code;
    renderRail();
    await connectRoom(room);
    setHeader(room);
    persist();
    if (location.search) history.replaceState(null, '', location.pathname);
    dialog.close();
    if (mode === 'create') toast(`房间已创建，口令 ${room.code}，把它告诉要加入的人`);
    messageInput.focus();
  } catch (error) {
    identityError.textContent = error.message;
  } finally {
    identitySubmit.disabled = false;
  }
});

$('#identity-cancel').addEventListener('click', () => dialog.close());
identityForm.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.isComposing) {
    event.preventDefault();
    identityForm.requestSubmit();
  }
});
dialog.addEventListener('cancel', (event) => {
  if (joined.size === 0) event.preventDefault();
});
$('#identity').addEventListener('click', openIdentity);
$('#rail-add').addEventListener('click', () => { closeRail(); openIdentity(); });

/* ---------- 发送文本 ---------- */

function autosize() {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const room = activeRoom();
  if (!room) return;
  const text = messageInput.value.trim();
  const files = pending.map((p) => p.file);
  if (!text && !files.length) return;

  // 先发暂存的附件
  for (const file of files) uploadFile(room, file);
  clearPending();

  if (!text) {
    messageInput.focus();
    return;
  }
  sendButton.disabled = true;
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${room.session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (response.status === 401) return removeRoom(room.code, '会话已失效，请重新加入房间');
    if (!response.ok) throw new Error((await response.json()).error || '发送失败');
    messageInput.value = '';
    autosize();
    emojiPicker.hidden = true;
  } catch (error) {
    toast(error.message);
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

messageInput.addEventListener('input', autosize);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

/* ---------- 表情 ---------- */

for (const char of EMOJIS) {
  const button = el('button', '', char);
  button.type = 'button';
  button.addEventListener('click', () => {
    const { selectionStart: start, selectionEnd: end, value } = messageInput;
    messageInput.value = value.slice(0, start) + char + value.slice(end);
    messageInput.selectionStart = messageInput.selectionEnd = start + char.length;
    emojiPicker.hidden = true;
    autosize();
    messageInput.focus();
  });
  emojiPicker.append(button);
}

$('#emoji-toggle').addEventListener('click', (event) => {
  event.stopPropagation();
  emojiPicker.hidden = !emojiPicker.hidden;
});
document.addEventListener('click', (event) => {
  if (!emojiPicker.hidden && !event.target.closest('.emoji-picker')) emojiPicker.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  emojiPicker.hidden = true;
  membersOverlay.hidden = true;
  closeRail();
  if (!lightbox.hidden) lightbox.click();
});

/* ---------- 发送文件 ---------- */

function uploadFile(room, file) {
  const pendingItem = { sender: room.sender, time: new Date().toISOString(), type: 'file', fileName: file.name, size: file.size };
  const node = buildMessage(room, pendingItem, { pending: true });
  const meta = node.querySelector('.file-meta');
  const bar = node.querySelector('.file-progress-bar');
  messagesEl.append(node);
  scrollToBottom();

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.setRequestHeader('Authorization', `Bearer ${room.session}`);
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    bar.style.width = `${percent}%`;
    meta.textContent = `${formatSize(file.size)} · 传输中 ${percent}%`;
  };
  xhr.onload = () => {
    node.remove(); // 真实消息会经 SSE 回传并渲染
    if (xhr.status >= 400) {
      let message = '上传失败';
      try { message = JSON.parse(xhr.responseText).error || message; } catch { /* ignore */ }
      toast(message);
    }
  };
  xhr.onerror = () => {
    node.remove();
    toast('上传失败');
  };
  xhr.send(file);
}

/* ---------- 暂存待发送的附件（粘贴 / 选择 / 拖拽） ---------- */

const attachStrip = $('#attach-strip');
const pending = []; // { file, key, url }
let pendingKey = 0;

function renderAttachStrip() {
  attachStrip.replaceChildren();
  attachStrip.hidden = pending.length === 0;
  for (const item of pending) {
    const box = el('div', 'attach');
    if (item.url) {
      const img = el('img');
      img.src = item.url;
      img.alt = item.file.name;
      box.append(img);
    } else {
      box.classList.add('attach-file');
      const icon = el('span', 'attach-icon');
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
      box.append(icon, el('span', 'attach-name', item.file.name));
    }
    const remove = el('button', 'attach-x', '×');
    remove.type = 'button';
    remove.title = '移除';
    remove.addEventListener('click', () => removePending(item.key));
    box.append(remove);
    attachStrip.append(box);
  }
}

function addPending(file) {
  const item = { file, key: ++pendingKey, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' };
  pending.push(item);
  renderAttachStrip();
}

function removePending(key) {
  const index = pending.findIndex((p) => p.key === key);
  if (index === -1) return;
  if (pending[index].url) URL.revokeObjectURL(pending[index].url);
  pending.splice(index, 1);
  renderAttachStrip();
}

function clearPending() {
  for (const item of pending) if (item.url) URL.revokeObjectURL(item.url);
  pending.length = 0;
  renderAttachStrip();
}

// 回形针：选中文件后暂存，不立即上传
fileInput.addEventListener('change', () => {
  if (!activeRoom()) return;
  [...fileInput.files].forEach(addPending);
  fileInput.value = '';
  messageInput.focus();
});

// 在输入框粘贴图片（或文件）：暂存缩略图，回车再发送
messageInput.addEventListener('paste', (event) => {
  if (!activeRoom()) return;
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  files.forEach(addPending);
});

// 把图片 / 文件拖到聊天区也暂存
const chatMain = document.querySelector('.chat');
chatMain.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
chatMain.addEventListener('drop', (event) => {
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length || !activeRoom()) return;
  event.preventDefault();
  files.forEach(addPending);
  messageInput.focus();
});

/* ---------- 启动 ---------- */

const narrow = window.matchMedia('(max-width: 720px)');
function applyPlaceholder() {
  messageInput.placeholder = narrow.matches ? '输入消息或粘贴图片' : '输入消息或粘贴图片，Enter 发送，Shift + Enter 换行';
}
narrow.addEventListener('change', applyPlaceholder);
applyPlaceholder();

async function restore() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(STORE_ROOMS) || '[]'); } catch { stored = []; }
  if (!Array.isArray(stored) || !stored.length) {
    setHeader(null);
    openIdentity();
    return;
  }
  const wantedActive = localStorage.getItem(STORE_ACTIVE);
  for (const entry of stored) {
    joined.set(entry.code, {
      code: entry.code,
      name: entry.name,
      sender: entry.sender,
      session: entry.session,
      events: null,
      connected: false,
      messages: [],
      members: [],
      unread: 0,
      seen: new Set(),
      lastItem: null,
    });
  }
  activeCode = joined.has(wantedActive) ? wantedActive : [...joined.keys()][0];
  renderRail();
  setHeader(activeRoom());
  for (const room of [...joined.values()]) {
    try {
      await connectRoom(room);
    } catch (error) {
      joined.delete(room.code);
      if (!error.expired) toast(error.message);
    }
  }
  persist();
  if (joined.size === 0) {
    activeCode = null;
    clearChatUI();
    openIdentity();
    return;
  }
  if (!joined.has(activeCode)) activeCode = [...joined.keys()][0];
  renderRail();
  setActive(activeCode);
}

restore();
