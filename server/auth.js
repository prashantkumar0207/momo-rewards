'use strict';
const crypto = require('crypto');
const { HttpError, now, randomToken, sha256 } = require('./util');

const SESSION_COOKIE = 'mr_sess';
const SESSION_DAYS = 30;

/* ---------- password / PIN hashing (scrypt, built into Node) ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(secret), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifySecret(secret, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(String(secret), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(key, expected);
  } catch (_) {
    return false;
  }
}
// Used to keep timing equal when the username does not exist.
const DUMMY_HASH = hashSecret('dummy-password-for-timing');

function validateSecret(role, secret) {
  const s = String(secret ?? '');
  if (role === 'owner') {
    if (s.length < 8 || s.length > 100) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be 8–100 characters');
  } else if (!/^\d{4,8}$/.test(s) && (s.length < 8 || s.length > 100)) {
    throw new HttpError(400, 'WEAK_PIN', 'Staff PIN must be 4–8 digits (or a password of 8+ characters)');
  }
  return s;
}

/* ---------- sessions ---------- */
async function createSession(db, staffId, userAgent) {
  const token = randomToken(32);
  const t = now();
  await db.run(
    'INSERT INTO sessions(token_hash, staff_id, created_at, expires_at, user_agent) VALUES(?,?,?,?,?)',
    [sha256(token), staffId, t, t + SESSION_DAYS * 86400000, String(userAgent || '').slice(0, 200)]
  );
  // housekeeping
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
  return token;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}
function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function authMiddleware(db) {
  return async (req, _res, next) => {
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) {
        const row = await db.get(
          `SELECT s.staff_id, s.expires_at, st.id, st.name, st.username, st.role, st.active
             FROM sessions s JOIN staff st ON st.id = s.staff_id
            WHERE s.token_hash = ?`,
          [sha256(token)]
        );
        if (row && row.expires_at > now() && row.active) {
          req.staff = { id: row.id, name: row.name, username: row.username, role: row.role };
          req.sessionTokenHash = sha256(token);
        }
      }
      next();
    } catch (e) { next(e); }
  };
}

const requireStaff = (req, _res, next) =>
  req.staff ? next() : next(new HttpError(401, 'LOGIN_REQUIRED', 'Please log in'));

const requireOwner = (req, _res, next) => {
  if (!req.staff) return next(new HttpError(401, 'LOGIN_REQUIRED', 'Please log in'));
  if (req.staff.role !== 'owner') return next(new HttpError(403, 'OWNER_ONLY', 'Only the owner can do this'));
  next();
};

module.exports = {
  hashSecret, verifySecret, DUMMY_HASH, validateSecret,
  createSession, setSessionCookie, clearSessionCookie, authMiddleware,
  requireStaff, requireOwner, readCookie, SESSION_COOKIE,
};
