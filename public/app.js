// Single-page app: login screen + chat screen, sliding between them in one stage.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RENDERED_MESSAGES = 30;
const SCREEN_SLIDE_MS = 600;

const stage = document.getElementById('stage');
const form = document.getElementById('form');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const hintEl = document.getElementById('hint');
const errorEl = document.getElementById('error');
const loginBtn = document.getElementById('btn');
const passwordLabelEl = document.getElementById('password-label');

const meNameEl = document.getElementById('me-name');
const memberListEl = document.getElementById('member-list');
const logoutBtn = document.getElementById('logout');
const messagesEl = document.getElementById('messages');
const textEl = document.getElementById('text');
const fileEl = document.getElementById('file');
const toastEl = document.getElementById('toast');
const addBtn = document.getElementById('add');
const sendBtn = document.getElementById('send');

let socket = null;

// Reveal the stage once layout is ready, then allow the slide transition on later state changes
requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('no-anim')));

function goToChat(username) {
  meNameEl.textContent = username;
  stage.classList.add('chat-active');
  connectChat();
}

function logout() {
  // Hard reset (used when a session turns out to be invalid) — no animation.
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  location.reload();
}

function animatedLogout() {
  if (logoutBtn.disabled) return;
  logoutBtn.disabled = true;
  logoutBtn.classList.add('confirming'); // fades the pill to #ff7f57

  // Removing chat-active reverses the same tween used to enter: both screens slide DOWN,
  // the login screen reappearing from above. Triggered immediately so it starts just as
  // fast as the slide-up on login, instead of waiting for the button color first.
  stage.classList.remove('chat-active');

  setTimeout(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    if (socket) { socket.disconnect(); socket = null; }
    messagesEl.replaceChildren();
    errorEl.textContent = '';
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
    logoutBtn.classList.remove('confirming');
    // username/password fields are left as-is on purpose; only cleared if the user retypes the username
  }, SCREEN_SLIDE_MS + 20);
}
logoutBtn.addEventListener('click', animatedLogout);

// Resume an existing session without animating (page just loaded)
const savedToken = localStorage.getItem('token');
const savedName = localStorage.getItem('username');
if (savedToken && savedName) {
  stage.classList.add('no-anim');
  goToChat(savedName);
}

// ---------- Login screen ----------
let checkTimer;
let checkId = 0;

function setHint(text, cls) {
  hintEl.textContent = text;
  hintEl.className = 'hint ' + cls;
}

function setPasswordLabel(isNewUser) {
  passwordLabelEl.textContent = isNewUser ? 'ตั้งรหัสผ่าน' : 'รหัสผ่าน';
}

// The user is about to (re)type a username, so any password typed for a
// previous name no longer applies — wipe it.
usernameEl.addEventListener('focus', () => {
  passwordEl.value = '';
  setPasswordLabel(false);
});

usernameEl.addEventListener('input', () => {
  clearTimeout(checkTimer);
  const name = usernameEl.value.trim();
  if (!name) { setPasswordLabel(false); return setHint('', ''); }

  checkTimer = setTimeout(async () => {
    const id = ++checkId;
    try {
      const res = await fetch('/api/check-username?u=' + encodeURIComponent(name));
      const data = await res.json();
      if (id !== checkId) return;
      if (!data.valid) { setHint('ใช้ได้เฉพาะ ก-ฮ, a-z, 0-9 และ _ (3-20 ตัวอักษร)', 'bad'); setPasswordLabel(false); }
      else if (data.exists) { setHint('ชื่อนี้มีอยู่แล้ว โปรดใส่รหัสผ่านได้เลย', 'exists'); setPasswordLabel(false); }
      else { setHint('ชื่อผู้ใช้นี้สามารถใช้ได้', 'ok'); setPasswordLabel(true); }
    } catch {
      setHint('', '');
    }
  }, 250);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  loginBtn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameEl.value.trim(), password: passwordEl.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    goToChat(data.username); // triggers the tween: login slides up out, chat slides up in
  } catch (err) {
    errorEl.textContent = err.message;
    loginBtn.disabled = false;
  }
});

// ---------- Chat screen ----------
const personIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6"/></svg>';

let stickToBottom = true;
messagesEl.addEventListener('scroll', () => {
  stickToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
});
const scrollToBottom = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

function showToast(text) {
  toastEl.textContent = text;
  setTimeout(() => { if (toastEl.textContent === text) toastEl.textContent = ''; }, 4000);
}

// Build a message with textContent only (prevents HTML injection); avatar/name row above the bubble
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  return window.__chatAudioCtx || (window.__chatAudioCtx = new AudioCtx());
}

function unlockChatAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  } catch {}
}

window.addEventListener('pointerdown', unlockChatAudio, { passive: true });
window.addEventListener('keydown', unlockChatAudio);

function playPopSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(760, ctx.currentTime + 0.055);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {}
}

function renderMessage(m, animate = false) {
  const mine = m.username === localStorage.getItem('username');
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (mine ? ' mine' : '') + (animate ? ' msg-enter' : '');

  const metaRow = document.createElement('div');
  metaRow.className = 'meta-row';
  const avatar = document.createElement('span');
  avatar.className = 'avatar-sm';
  avatar.innerHTML = personIcon;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = m.username;
  metaRow.append(...(mine ? [who, avatar] : [avatar, who]));

  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (m.image ? ' has-image' : '');
  if (m.image) {
    const isImage = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(m.image);
    const link = document.createElement('a');
    link.href = m.image;
    link.target = '_blank';
    link.rel = 'noopener';
    if (isImage) {
      const img = document.createElement('img');
      img.src = m.image;
      img.alt = 'รูปภาพจาก ' + m.username;
      img.addEventListener('load', () => { if (stickToBottom) scrollToBottom(); });
      link.append(img);
    } else {
      link.className = 'file-attachment';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = (m.fileName || m.image).split('.').pop().toUpperCase();
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = m.fileName || 'ไฟล์แนบ';
      const hint = document.createElement('span');
      hint.className = 'file-hint';
      hint.textContent = 'เปิดไฟล์';
      link.append(icon, name, hint);
    }
    bubble.append(link);
  }
  if (m.text) {
    const p = document.createElement('p');
    p.textContent = m.text;
    bubble.append(p);
  }

  wrap.append(metaRow, bubble);
  messagesEl.append(wrap);
  while (messagesEl.querySelectorAll('.msg').length > MAX_RENDERED_MESSAGES) {
    const first = messagesEl.querySelector('.msg');
    if (!first) break;
    first.remove();
  }
}

// Centered brown "so-and-so joined" notice, Messenger/Line style
function renderSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  messagesEl.append(el);
}

// Sidebar member list: server sends it already sorted, most recently
// active (joined or just sent a message) first. The signed-in user's own
// name is shown separately in the highlighted box below, so skip it here.
function renderMembers(list) {
  // Keep the server's order: the member who joined the room first stays at the top.
  // The current user is included here as well; the highlighted account card below
  // is still shown separately.
  memberListEl.replaceChildren(...list.map((m) => {
    const item = document.createElement('div');
    item.className = 'member-item';

    const icon = document.createElement('span');
    icon.className = 'member-icon';
    icon.innerHTML = personIcon;

    const status = document.createElement('span');
    status.className = 'member-status';
    status.setAttribute('aria-label', 'ออนไลน์');
    status.innerHTML = '<span></span>';
    icon.append(status);

    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = m.username;

    item.append(icon, name);
    return item;
  }));
}

function connectChat() {
  if (socket) return;
  const token = localStorage.getItem('token');
  socket = io({ auth: { token } });
  socket.on('connect_error', (err) => { if (err.message === 'unauthorized') logout(); });

  socket.on('history', (list) => {
    messagesEl.replaceChildren();
    list.slice(-MAX_RENDERED_MESSAGES).forEach(renderMessage);
    scrollToBottom();
  });

  socket.on('message', (m) => {
    renderMessage(m, true);
    playPopSound();
    if (stickToBottom || m.username === localStorage.getItem('username')) scrollToBottom();
  });

  socket.on('members', renderMembers);

  socket.on('system', (m) => {
    if (!m || !m.text) return;
    renderSystemMessage(m.text);
    if (stickToBottom) scrollToBottom();
  });
}

function sendText() {
  const text = textEl.value.trim();
  if (!text || !socket) return;
  socket.emit('message', { text });
  textEl.value = '';
}

async function sendFile(file) {
  if (file.size > MAX_FILE_BYTES) return showToast('ไฟล์ใหญ่เกิน 20MB');
  addBtn.disabled = true;
  try {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
      body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    socket.emit('message', { text: '', image: data.url, fileName: data.name });
  } catch (err) {
    showToast(err.message || 'อัปโหลดไม่สำเร็จ');
  } finally {
    addBtn.disabled = false;
    fileEl.value = '';
  }
}

sendBtn.addEventListener('click', sendText);
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) sendText(); // isComposing: don't send while typing with an IME
});
addBtn.addEventListener('click', () => fileEl.click());
fileEl.addEventListener('change', () => { if (fileEl.files[0]) sendFile(fileEl.files[0]); });
