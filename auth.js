/**
 * Unveil - 인증 모듈
 * 외부 의존성 없이 Node.js crypto 사용
 */
const crypto = require('crypto');
const db     = require('./db');

const SALT = 'unveil_salt_2024_secure';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

// ── 해시 / ID / 토큰 생성 ────────────────────────────────────
function hashPw(pw)  { return crypto.createHmac('sha256', SALT).update(pw).digest('hex'); }
function genId()     { return crypto.randomBytes(8).toString('hex'); }
function genToken()  { return crypto.randomBytes(32).toString('hex'); }

// ── 회원가입 ─────────────────────────────────────────────────
function register({ username, email, password }) {
  if (!username || !email || !password) return { ok: false, error: '모든 필드를 입력해주세요.' };
  if (password.length < 6)              return { ok: false, error: '비밀번호는 6자 이상이어야 합니다.' };

  const users = db.getUsers();
  if (Object.values(users).some(u => u.email === email))
    return { ok: false, error: '이미 사용 중인 이메일입니다.' };
  if (Object.values(users).some(u => u.username === username))
    return { ok: false, error: '이미 사용 중인 사용자명입니다.' };

  const id = genId();
  users[id] = {
    id, username, email,
    passwordHash:   hashPw(password),
    faceDescriptor: null,   // Float32Array serialized as Array
    telegramChatId: null,
    createdAt:      new Date().toISOString()
  };
  db.saveUsers(users);
  return { ok: true, userId: id, username };
}

// ── 로그인 ───────────────────────────────────────────────────
function login({ email, password }) {
  const users = db.getUsers();
  const user  = Object.values(users).find(u => u.email === email);
  if (!user || user.passwordHash !== hashPw(password))
    return { ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };

  const token    = genToken();
  const sessions = db.getSessions();
  // 만료된 세션 정리
  const now = Date.now();
  for (const [k, s] of Object.entries(sessions)) if (s.exp < now) delete sessions[k];
  sessions[token] = { uid: user.id, exp: now + SESSION_TTL };
  db.saveSessions(sessions);

  return { ok: true, token, user: safeUser(user) };
}

// ── 로그아웃 ─────────────────────────────────────────────────
function logout(token) {
  const sessions = db.getSessions();
  delete sessions[token];
  db.saveSessions(sessions);
}

// ── 세션 검증 ────────────────────────────────────────────────
function validate(token) {
  if (!token) return null;
  const sessions = db.getSessions();
  const s        = sessions[token];
  if (!s || s.exp < Date.now()) return null;
  const users = db.getUsers();
  return users[s.uid] || null;
}

// ── 요청에서 토큰 추출 ───────────────────────────────────────
function getToken(req) {
  const m = (req.headers.cookie || '').match(/unveil_session=([^;]+)/);
  if (m) return m[1];
  const a = req.headers.authorization || '';
  return a.startsWith('Bearer ') ? a.slice(7) : null;
}

// ── 민감 정보 제거 ───────────────────────────────────────────
function safeUser(u) {
  return {
    id:             u.id,
    username:       u.username,
    email:          u.email,
    hasFace:        !!u.faceDescriptor,
    telegramLinked: !!u.telegramChatId,
    createdAt:      u.createdAt
  };
}

module.exports = { register, login, logout, validate, getToken, safeUser, genId };
