// Chat page: Socket.IO client, message rendering, image upload
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const token = localStorage.getItem('token');
const me = localStorage.getItem('username');

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  location.replace('/');
}
if (!token) logout();

const messagesEl = document.getElementById('messages');
const textEl = document.getElementById('text');
const fileEl = document.getElementById('file');
const toastEl = document.getElementById('toast');
const addBtn = document.getElementById('add');
const sendBtn = document.getElementById('send');
document.getElementById('me-name').textContent = me;
document.getElementById('logout').addEventListener('click', logout);

const socket = io({ auth: { token } });
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') logout(); // expired or invalid session
});

// Only auto-scroll when the user is already near the bottom
let stickToBottom = true;
messagesEl.addEventListener('scroll', () => {
  stickToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
});
const scrollToBottom = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

function showToast(text) {
  toastEl.textContent = text;
  setTimeout(() => { if (toastEl.textContent === text) toastEl.textContent = ''; }, 4000);
}

// Build a message with textContent only (prevents HTML injection)
function renderMessage(m) {
  const mine = m.username === me;
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (mine ? ' mine' : '');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = m.username;
  const time = document.createElement('span');
  time.textContent = new Date(m.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  meta.append(who, time);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (m.image) {
    const link = document.createElement('a');
    link.href = m.image;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = document.createElement('img');
    img.src = m.image;
    img.alt = 'รูปภาพจาก ' + m.username;
    img.addEventListener('load', () => { if (stickToBottom) scrollToBottom(); });
    link.append(img);
    bubble.append(link);
  }
  if (m.text) {
    const p = document.createElement('p');
    p.textContent = m.text;
    bubble.append(p);
  }

  wrap.append(meta, bubble);
  messagesEl.append(wrap);
}

socket.on('history', (list) => {
  messagesEl.replaceChildren();
  list.forEach(renderMessage);
  scrollToBottom();
});

socket.on('message', (m) => {
  renderMessage(m);
  if (stickToBottom || m.username === me) scrollToBottom();
});

function sendText() {
  const text = textEl.value.trim();
  if (!text) return;
  socket.emit('message', { text });
  textEl.value = '';
}

// Picking an image uploads it, then sends it as a message
async function sendImage(file) {
  if (file.size > MAX_IMAGE_BYTES) return showToast('ไฟล์ใหญ่เกิน 20MB');
  addBtn.disabled = true;
  try {
    const body = new FormData();
    body.append('image', file);
    const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    socket.emit('message', { text: '', image: data.url });
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
fileEl.addEventListener('change', () => { if (fileEl.files[0]) sendImage(fileEl.files[0]); });
