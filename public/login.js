// Login page: live username check + login request
if (localStorage.getItem('token')) location.replace('/chat.html');

const form = document.getElementById('form');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const hintEl = document.getElementById('hint');
const errorEl = document.getElementById('error');
const btn = document.getElementById('btn');

let timer;
let checkId = 0; // used to ignore out-of-date responses

function setHint(text, cls) {
  hintEl.textContent = text;
  hintEl.className = 'hint ' + cls;
}

// Check the username on every keystroke (debounced by 250 ms)
usernameEl.addEventListener('input', () => {
  clearTimeout(timer);
  const name = usernameEl.value.trim();
  if (!name) return setHint('', '');

  timer = setTimeout(async () => {
    const id = ++checkId;
    try {
      const res = await fetch('/api/check-username?u=' + encodeURIComponent(name));
      const data = await res.json();
      if (id !== checkId) return;
      if (!data.valid) setHint('ใช้ได้เฉพาะ ก-ฮ, a-z, 0-9 และ _ (3-20 ตัวอักษร)', 'bad');
      else if (data.exists) setHint('ชื่อนี้มีอยู่แล้ว โปรดใส่รหัสผ่านได้เลย', 'exists');
      else setHint('ชื่อผู้ใช้นี้สามารถใช้ได้', 'ok');
    } catch {
      setHint('', '');
    }
  }, 250);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  btn.disabled = true;
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
    location.href = '/chat.html';
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false;
  }
});
