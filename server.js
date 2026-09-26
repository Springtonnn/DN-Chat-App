// Public chat server: Express + Socket.IO + SQLite
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file
const HISTORY_LIMIT = 30; // only keep the latest 30 messages in the client view
const ALLOWED_FILES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};
const SESSION_MS = 30 * 24 * 3600 * 1000;
// 3-20 chars: English letters, digits, underscore, Thai characters
const USERNAME_RE = /^[A-Za-z0-9_\u0E00-\u0E7F]{3,20}$/;
const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Database ----------
const db = new Database(path.join(DATA_DIR, 'chat.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    image TEXT,
    file_name TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Backward-compatible migration for existing chat.db files.
try { db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT'); } catch {}

const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const insertSession = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
const sessionUser = db.prepare(
  'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
);
const insertMessage = db.prepare('INSERT INTO messages (username, text, image, file_name, created_at) VALUES (?, ?, ?, ?, ?)');
const recentMessages = db.prepare(
  'SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC'
);

const userFromToken = (token) => (token ? sessionUser.get(String(token), Date.now()) : null);

// ---------- HTTP ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));

// Live check while the user is typing a username
app.get('/api/check-username', (req, res) => {
  const name = String(req.query.u || '').trim();
  if (!USERNAME_RE.test(name)) return res.json({ valid: false });
  res.json({ valid: true, exists: !!findUser.get(name) });
});

// Login. If the username is new, the account is created with this password.
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'ชื่อผู้ใช้ไม่ถูกต้อง' });
  if (password.length < 6 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }

  let user = findUser.get(username);
  let created = false;
  if (!user) {
    try {
      const info = insertUser.run(username, bcrypt.hashSync(password, 10));
      user = { id: info.lastInsertRowid, username };
      created = true;
    } catch {
      return res.status(409).json({ error: 'ชื่อนี้ถูกใช้ไปแล้ว' });
    }
  } else if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  insertSession.run(token, user.id, Date.now() + SESSION_MS);
  if (created) announceNewAccount.add(token);
  res.json({ token, username: user.username, created });
});

// File upload (max 20 MB). Files are stored under generated names so the original
// filename can never become part of a filesystem path.
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = ALLOWED_FILES[file.mimetype];
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOWED_FILES[file.mimetype]),
}).single('file');

app.post('/api/upload', (req, res) => {
  const token = (req.get('authorization') || '').replace('Bearer ', '');
  if (!userFromToken(token)) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
  upload(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 20MB' : 'รองรับเฉพาะไฟล์ประเภทที่กำหนด';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'ไม่รองรับไฟล์ชนิดนี้' });
    res.json({
      url: '/uploads/' + req.file.filename,
      name: String(req.file.originalname || 'ไฟล์แนบ').slice(0, 180),
      type: req.file.mimetype,
    });
  });
});

// ---------- WebSocket ----------
io.use((socket, next) => {
  const user = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

const toClient = (m) => ({ id: m.id, username: m.username, text: m.text, image: m.image, fileName: m.file_name || null, time: m.created_at });

const onlineUsers = new Map();
const announceNewAccount = new Set();

function getOnlineMembers() {
  // A user may have more than one open tab. Keep the earliest connection time
  // for that account so the list remains ordered by who joined the room first.
  const members = new Map();
  for (const user of onlineUsers.values()) {
    const existing = members.get(user.id);
    if (!existing || user.joinedAt < existing.joinedAt) members.set(user.id, user);
  }
  return [...members.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ id, username }) => ({ id, username }));
}

function broadcastMembers() {
  io.emit('members', getOnlineMembers());
}

io.on('connection', (socket) => {
  socket.emit('history', recentMessages.all(HISTORY_LIMIT).map(toClient));

  onlineUsers.set(socket.id, { id: socket.user.id, username: socket.user.username, joinedAt: Date.now() });
  broadcastMembers();
  const loginToken = String(socket.handshake.auth && socket.handshake.auth.token || '');
  if (announceNewAccount.delete(loginToken)) {
    io.emit('system', { text: `${socket.user.username} เข้าร่วมแชทสาธารณะ` });
  }

  let lastSent = 0;
  socket.on('message', (payload) => {
    const now = Date.now();
    if (now - lastSent < 300) return; // simple flood guard
    lastSent = now;

    const text = String((payload && payload.text) || '').trim().slice(0, 2000);
    const image = payload && /^\/uploads\/[a-f0-9]{32}\.(jpg|png|gif|webp|avif|pdf|txt|csv|zip|doc|docx|xlsx|pptx)$/.test(payload.image) ? payload.image : null;
    const fileName = image && typeof payload.fileName === 'string' ? payload.fileName.slice(0, 180) : null;
    if (!text && !image) return;

    const info = insertMessage.run(socket.user.username, text, image, fileName, now);
    io.emit('message', toClient({ id: info.lastInsertRowid, username: socket.user.username, text, image, file_name: fileName, created_at: now }));
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastMembers();
  });
});

server.listen(PORT, () => console.log(`Chat running on http://localhost:${PORT}`));
