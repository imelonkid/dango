import { newKeyString, importKey, encryptText, decryptText, encryptBytes, decryptBytes, cryptoReady } from './crypto.js';

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
const inviteButton = $('#invite');
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
const fieldLink = $('#field-link');
const roomInput = $('#room');
const inviteLinkInput = $('#invite-link');
const nicknameInput = $('#nickname');
const identityError = $('#identity-error');
const toastEl = $('#toast');
const fileTemplate = $('#tpl-file');
const shareDialog = $('#share-dialog');

const STORE_ROOMS = 'dango.rooms';
const STORE_ACTIVE = 'dango.active';
const STORE_NAME = 'dango.nickname';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const MAX_ROOM_MESSAGES = 500;
const ENC_MAX_FILE = 30 * 1024 * 1024; // 加密模式下单文件上限（内存所限）
const EMOJIS = ['😀', '😂', '😊', '😉', '👍', '🙏', '🎉', '🔥', '😅', '🤔', '😭', '😴', '👌', '❤️', '✅', '⏳'];

const params = new URLSearchParams(location.search);
const codeParam = (params.get('code') || '').trim();
const keyParam = (new URLSearchParams(location.hash.slice(1)).get('k') || '').trim();

// code -> { code, name, sender, session, key, keyStr, events, connected, messages, members, unread, seen, lastItem }
const joined = new Map();
const fileCache = new Map(); // 消息 id -> 已解密内容的 objectURL
let activeCode = null;
let defaultNick = localStorage.getItem(STORE_NAME) || '';
let mode = 'join';
let scrollbackUnread = 0;
let atBottom = true;
let toastTimer = null;

/* ---------- 工具 ---------- */

function activeRoom() {
  return activeCode ? joined.get(activeCode) : null;
}

function fileUrl(item) {
  const room = activeRoom();
  const session = room ? room.session : '';
  return `/api/files/${encodeURIComponent(item.fileId)}?session=${encodeURIComponent(session)}`;
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

function isImageName(name) {
  return IMAGE_RE.test(name || '');
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
  const list = [...joined.values()].map((r) => ({ code: r.code, name: r.name, sender: r.sender, session: r.session, keyStr: r.keyStr, muted: !!r.muted }));
  localStorage.setItem(STORE_ROOMS, JSON.stringify(list));
  if (activeCode) localStorage.setItem(STORE_ACTIVE, activeCode);
  else localStorage.removeItem(STORE_ACTIVE);
}

function saveBlobAs(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.append(a);
  a.click();
  a.remove();
}

// 取回密文文件、解密、缓存成 objectURL
async function decryptedObjectUrl(room, item) {
  if (fileCache.has(item.id)) return fileCache.get(item.id);
  const res = await fetch(fileUrl(item), { headers: { Authorization: `Bearer ${room.session}` } });
  if (!res.ok) throw new Error('下载失败');
  const buf = new Uint8Array(await res.arrayBuffer());
  const plain = decryptBytes(room.key, item.sender, buf);
  const url = URL.createObjectURL(new Blob([plain]));
  fileCache.set(item.id, url);
  return url;
}

// 解密文件的元信息（原始文件名与大小），失败返回 null
function decryptFileMeta(room, item) {
  try {
    const meta = JSON.parse(decryptText(room.key, item.sender, item.fileName));
    return { name: String(meta.n || 'file'), size: Number(meta.s) || 0 };
  } catch {
    return null;
  }
}

/* ---------- 消息渲染（针对某个房间，含解密） ---------- */

function undecryptableBubble(label) {
  return el('div', 'bubble undecryptable', label || '🔒 无法解密（密钥不匹配）');
}

function buildFileCard(room, item) {
  const meta = decryptFileMeta(room, item);
  const card = fileTemplate.content.firstElementChild.cloneNode(true);
  const nameEl = card.querySelector('.file-name');
  const metaEl = card.querySelector('.file-meta');
  const download = card.querySelector('.file-download');
  if (!meta) {
    nameEl.textContent = '🔒 无法解密的文件';
    metaEl.textContent = formatSize(item.size);
    return card;
  }
  nameEl.textContent = meta.name;
  metaEl.textContent = formatSize(meta.size);
  download.hidden = false;
  download.href = '#';
  download.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      const url = await decryptedObjectUrl(room, item);
      saveBlobAs(url, meta.name);
    } catch { toast('下载或解密失败'); }
  });
  return card;
}

function buildImageBubble(room, item, name) {
  const button = el('button', 'image-bubble');
  button.type = 'button';
  button.title = name;
  const img = el('img');
  img.alt = name;
  button.append(img);
  decryptedObjectUrl(room, item)
    .then((url) => {
      img.src = url;
      img.addEventListener('load', () => { if (atBottom) scrollToBottom(); });
    })
    .catch(() => { button.replaceWith(undecryptableBubble('🔒 图片无法解密')); });
  button.addEventListener('click', () => openLightbox(room, item, name));
  return button;
}

function buildMessage(room, item) {
  const mine = item.sender === room.sender;
  const wrapper = el('div', `msg${mine ? ' mine' : ''}`);
  const cont = room.lastItem && room.lastItem.sender === item.sender && formatTime(room.lastItem.time) === formatTime(item.time);
  if (cont) wrapper.classList.add('cont');
  else {
    const meta = el('div', 'msg-meta');
    meta.append(el('b', '', item.sender), el('span', '', formatTime(item.time)));
    wrapper.append(meta);
  }
  if (item.type === 'file') {
    const meta = decryptFileMeta(room, item);
    if (meta && isImageName(meta.name)) wrapper.append(buildImageBubble(room, item, meta.name));
    else wrapper.append(buildFileCard(room, item));
  } else {
    let text;
    try { text = decryptText(room.key, item.sender, item.text); } catch { text = null; }
    wrapper.append(text === null ? undecryptableBubble() : el('div', 'bubble', text));
  }
  return wrapper;
}

// 上传中的本地占位卡（明文，未加密前）
function buildPendingCard(room, file) {
  const wrapper = el('div', 'msg mine');
  const meta = el('div', 'msg-meta');
  meta.append(el('b', '', room.sender), el('span', '', formatTime(new Date().toISOString())));
  wrapper.append(meta);
  const card = fileTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.file-name').textContent = file.name;
  card.querySelector('.file-meta').textContent = `${formatSize(file.size)} · 加密上传中 0%`;
  card.querySelector('.file-progress').hidden = false;
  wrapper.append(card);
  return wrapper;
}

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

/* ---------- 消息通知 ---------- */

const muteToggle = $('#mute-toggle');
const moreToggle = $('#more-toggle');
const moreMenu = $('#more-menu');
let baseTitle = '团子 Dango';
let audioCtx = null;

function pageActive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function totalUnread() {
  let n = scrollbackUnread;
  for (const room of joined.values()) n += room.unread;
  return n;
}

function faviconLink() {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  return link;
}

function drawFavicon(n) {
  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#3a9bb0';
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 34px -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('团', 32, 35);
    if (n > 0) {
      g.fillStyle = '#e5484d';
      g.beginPath();
      g.arc(49, 15, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px -apple-system, sans-serif';
      g.fillText(n > 9 ? '9+' : String(n), 49, 16);
    }
    faviconLink().href = c.toDataURL('image/png');
  } catch { /* canvas 不可用则忽略 */ }
}

function updateBadges() {
  const n = totalUnread();
  document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
  drawFavicon(n);
}

function playBlip(room) {
  if (room?.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch { /* ignore */ }
}

function askNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function decryptPreview(room, item) {
  try {
    if (item.type === 'file') {
      const meta = decryptFileMeta(room, item);
      return meta ? `[文件] ${meta.name}` : '[文件]';
    }
    return decryptText(room.key, item.sender, item.text);
  } catch {
    return '新消息';
  }
}

function showSystemNotification(room, item) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || room.muted) return;
  try {
    const note = new Notification(`${item.sender} · ${room.name}`, {
      body: decryptPreview(room, item).slice(0, 120),
      tag: `dango-${room.code}`,
      renotify: true,
    });
    note.onclick = () => { window.focus(); setActive(room.code); note.close(); };
  } catch { /* ignore */ }
}

// 收到别人消息、且你没在专心看这个房间时才提醒
function alertNewMessage(room, item) {
  if (item.sender === room.sender) return;
  if (room.code === activeCode && pageActive()) return;
  playBlip(room);
  if (!pageActive()) showSystemNotification(room, item);
}

function refreshMuteButton() {
  const room = activeRoom();
  if (!room) return;
  const muted = !!room.muted;
  muteToggle.querySelector('.icon-bell').hidden = muted;
  muteToggle.querySelector('.icon-bell-off').hidden = !muted;
  muteToggle.title = muted ? '已静音（点击开启通知）' : '通知开启（点击静音本房间）';
  muteToggle.classList.toggle('muted', muted);
  $('#menu-mute-label').textContent = muted ? '开启通知' : '静音本房间';
}

function toggleMute() {
  const room = activeRoom();
  if (!room) return;
  room.muted = !room.muted;
  persist();
  refreshMuteButton();
  toast(room.muted ? `已静音「${room.name}」` : `已开启「${room.name}」通知`);
}

muteToggle.addEventListener('click', toggleMute);

// 回到前台：清掉当前房间未读，刷新角标
function onPageActive() {
  const room = activeRoom();
  if (room) {
    room.unread = 0;
    scrollbackUnread = 0;
    newPill.hidden = true;
    renderRail();
  }
  updateBadges();
}
document.addEventListener('visibilitychange', () => { if (pageActive()) onPageActive(); });
window.addEventListener('focus', onPageActive);

/* ---------- 收到新消息 ---------- */

function onRoomMessage(room, item) {
  if (room.seen.has(item.id)) return;
  room.seen.add(item.id);
  room.messages.push(item);
  if (room.messages.length > MAX_ROOM_MESSAGES) room.messages.shift();

  if (room.code === activeCode) {
    const wasBottom = atBottom;
    domAppend(room, item);
    if (item.sender === room.sender || (pageActive() && wasBottom)) {
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
  alertNewMessage(room, item);
  updateBadges();
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

membersOverlay.addEventListener('click', (event) => {
  if (!event.target.closest('.drawer')) membersOverlay.hidden = true;
});

/* ---------- 顶栏"更多"菜单（手机端收纳次级操作） ---------- */

function closeMore() { moreMenu.hidden = true; }

moreToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  moreMenu.hidden = !moreMenu.hidden;
});
document.addEventListener('click', (event) => {
  if (!moreMenu.hidden && !event.target.closest('#more-menu') && !event.target.closest('#more-toggle')) closeMore();
});
$('#menu-members').addEventListener('click', () => { closeMore(); membersOverlay.hidden = false; });
$('#menu-mute').addEventListener('click', () => { closeMore(); toggleMute(); });
$('#menu-add').addEventListener('click', () => { closeMore(); openIdentity(); });
$('#menu-leave').addEventListener('click', () => { closeMore(); leaveActiveRoom(); });

/* ---------- 图片灯箱 ---------- */

async function openLightbox(room, item, name) {
  try {
    const url = await decryptedObjectUrl(room, item);
    lightboxImg.src = url;
    lightboxDownload.href = url;
    lightboxDownload.setAttribute('download', name || 'image');
    lightbox.hidden = false;
  } catch { toast('图片解密失败'); }
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
  const actionButtons = [leaveButton, inviteButton, muteToggle, moreToggle, $('#identity')];
  if (!room) {
    roomNameEl.hidden = true;
    for (const btn of actionButtons) btn.hidden = true;
    closeMore();
    $('#my-initial').textContent = '?';
    $('#my-name').textContent = defaultNick || '未登录';
    $('#menu-nick').textContent = defaultNick || '—';
    baseTitle = '团子 Dango';
    updateBadges();
    return;
  }
  roomNameEl.textContent = `${room.name} · 口令 ${room.code}`;
  roomNameEl.hidden = false;
  for (const btn of actionButtons) btn.hidden = false;
  $('#my-initial').textContent = initial(room.sender);
  $('#my-name').textContent = room.sender;
  $('#menu-nick').textContent = room.sender;
  baseTitle = `${room.name} · 团子`;
  refreshMuteButton();
  updateBadges();
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

/* ---------- 邀请（二维码 + 复制链接） ---------- */

// 邀请码 = 4 位房间码 + '.' + 密钥（base64url，不含 '.'）。一个字符串带齐进房所需的一切。
function inviteCode(room) {
  return `${room.code}.${room.keyStr}`;
}

function openShare(room) {
  if (!room) return;
  const code = inviteCode(room);
  $('#share-room').textContent = room.name;
  $('#share-link').value = code;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(code);
    qr.make();
    $('#share-qr').innerHTML = qr.createImgTag(5, 8);
  } catch {
    $('#share-qr').textContent = '二维码生成失败';
  }
  shareDialog.showModal();
}

inviteButton.addEventListener('click', () => openShare(activeRoom()));
$('#share-close').addEventListener('click', () => shareDialog.close());
$('#share-copy').addEventListener('click', async () => {
  const code = $('#share-link').value;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(code);
    } else {
      const inp = $('#share-link');
      inp.focus();
      inp.select();
      if (!document.execCommand('copy')) throw new Error('copy failed');
    }
    toast('邀请码已复制');
  } catch {
    toast('复制失败，请手动选择复制');
  }
});

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
  if (!confirm(`退出房间「${room.name}」？该房间的未读会清空，重新进入需要邀请链接。`)) return;
  room.events?.close();
  try {
    await fetch('/api/leave', { method: 'POST', headers: { Authorization: `Bearer ${room.session}` } });
  } catch { /* 忽略网络错误 */ }
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
  fieldLink.hidden = creating;
  modeHint.textContent = creating
    ? '填个昵称即可创建，创建后会给你二维码和邀请码分享给别人。'
    : '粘贴好友发来的邀请码，填个昵称即可加入。';
  identitySubmit.textContent = creating ? '创建' : '加入';
}

for (const btn of modeSeg.querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => {
    identityError.textContent = '';
    applyMode(btn.dataset.mode);
    (mode === 'create' ? nicknameInput : inviteLinkInput).focus();
  });
}

function parseInvite(str) {
  const text = (str || '').trim();
  // 新式邀请码：4 位房间码 + '.' + 密钥
  const dot = text.indexOf('.');
  if (dot > 0 && !/[:/?#]/.test(text.slice(0, dot))) {
    const code = text.slice(0, dot);
    const key = text.slice(dot + 1);
    if (/^\d{4}$/.test(code) && key) return { code, key };
  }
  // 兼容旧的完整链接
  let code = '';
  let key = '';
  try {
    const u = new URL(text);
    code = u.searchParams.get('code') || '';
    key = new URLSearchParams(u.hash.slice(1)).get('k') || '';
  } catch {
    const m = text.match(/code=(\d{4})/);
    if (m) code = m[1];
    const h = text.match(/[#&]k=([A-Za-z0-9_-]+)/);
    if (h) key = h[1];
  }
  return { code, key };
}

function openIdentity() {
  identityError.textContent = '';
  nicknameInput.value = defaultNick;
  roomInput.value = '';
  identityTitle.textContent = joined.size ? '加入 / 创建房间' : '进入团子';
  if (codeParam && keyParam && !joined.has(codeParam)) {
    applyMode('join');
    inviteLinkInput.value = `${codeParam}.${keyParam}`;
  } else {
    applyMode(mode);
    inviteLinkInput.value = '';
  }
  $('#identity-cancel').hidden = joined.size === 0;
  if (!dialog.open) dialog.showModal();
  (mode === 'create' || !defaultNick ? nicknameInput : inviteLinkInput).focus();
}

identityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nextName = nicknameInput.value.trim();
  if (!nextName) { identityError.textContent = '请填写昵称'; return; }

  let payload;
  let keyStr;
  if (mode === 'create') {
    keyStr = newKeyString();
    payload = { mode: 'create', sender: nextName, room: roomInput.value.trim() };
  } else {
    const { code, key } = parseInvite(inviteLinkInput.value);
    if (!/^\d{4}$/.test(code) || !key) { identityError.textContent = '邀请码无效，请粘贴完整邀请码'; return; }
    try { importKey(key); } catch { identityError.textContent = '邀请码里的密钥无效'; return; }
    keyStr = key;
    payload = { mode: 'join', sender: nextName, code };
  }

  identitySubmit.disabled = true;
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');

    defaultNick = data.sender;
    localStorage.setItem(STORE_NAME, defaultNick);

    const existing = joined.get(data.room.code);
    if (existing) existing.events?.close();

    const room = {
      code: data.room.code,
      name: data.room.name,
      sender: data.sender,
      session: data.session,
      key: importKey(keyStr),
      keyStr,
      muted: false,
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
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    dialog.close();
    messageInput.focus();
    if (mode === 'create') openShare(room); // 建好房间立刻给二维码 + 邀请码
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
  askNotifyPermission(); // 借用户点发送这个手势申请通知权限

  for (const file of files) uploadFile(room, file);
  clearPending();

  if (!text) {
    messageInput.focus();
    return;
  }
  sendButton.disabled = true;
  try {
    const cipher = encryptText(room.key, room.sender, text);
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${room.session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cipher }),
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
  closeMore();
  if (!lightbox.hidden) lightbox.click();
});

/* ---------- 发送文件（加密后上传） ---------- */

async function uploadFile(room, file) {
  if (file.size > ENC_MAX_FILE) {
    toast(`加密模式下单文件请小于 ${Math.floor(ENC_MAX_FILE / 1024 / 1024)} MB`);
    return;
  }
  const node = buildPendingCard(room, file);
  const meta = node.querySelector('.file-meta');
  const bar = node.querySelector('.file-progress-bar');
  messagesEl.append(node);
  scrollToBottom();

  let cipherBytes;
  let encName;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    cipherBytes = encryptBytes(room.key, room.sender, bytes);
    encName = encryptText(room.key, room.sender, JSON.stringify({ n: file.name, s: file.size }));
  } catch {
    node.remove();
    toast('加密失败');
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.setRequestHeader('Authorization', `Bearer ${room.session}`);
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(encName));
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    bar.style.width = `${percent}%`;
    meta.textContent = `${formatSize(file.size)} · 加密上传中 ${percent}%`;
  };
  xhr.onload = () => {
    node.remove(); // 真实消息经 SSE 回传后渲染
    if (xhr.status >= 400) {
      let message = '上传失败';
      try { message = JSON.parse(xhr.responseText).error || message; } catch { /* ignore */ }
      toast(message);
    }
  };
  xhr.onerror = () => { node.remove(); toast('上传失败'); };
  xhr.send(cipherBytes);
}

/* ---------- 暂存待发送的附件 ---------- */

const attachStrip = $('#attach-strip');
const pending = [];
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

fileInput.addEventListener('change', () => {
  if (!activeRoom()) return;
  [...fileInput.files].forEach(addPending);
  fileInput.value = '';
  messageInput.focus();
});

messageInput.addEventListener('paste', (event) => {
  if (!activeRoom()) return;
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  files.forEach(addPending);
});

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
  if (!cryptoReady()) {
    toast('当前环境不支持加密，无法使用');
    return;
  }
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(STORE_ROOMS) || '[]'); } catch { stored = []; }
  if (!Array.isArray(stored) || !stored.length) {
    setHeader(null);
    openIdentity();
    return;
  }
  const wantedActive = localStorage.getItem(STORE_ACTIVE);
  for (const entry of stored) {
    let key;
    try { key = importKey(entry.keyStr); } catch { continue; } // 没有有效密钥的房间跳过
    joined.set(entry.code, {
      code: entry.code,
      name: entry.name,
      sender: entry.sender,
      session: entry.session,
      key,
      keyStr: entry.keyStr,
      muted: !!entry.muted,
      events: null,
      connected: false,
      messages: [],
      members: [],
      unread: 0,
      seen: new Set(),
      lastItem: null,
    });
  }
  if (joined.size === 0) { setHeader(null); openIdentity(); return; }
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
