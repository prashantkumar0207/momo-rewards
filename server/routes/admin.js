'use strict';
const express = require('express');
const settings = require('../settings');
const loyalty = require('../loyalty');
const auth = require('../auth');
const { rateLimit } = require('../security');
const { cardUrl, baseUrl } = require('./public');
const {
  HttpError, bad, now, normalizePhone, cleanName, cleanText, int, toCsv,
} = require('../util');

const { requireStaff, requireOwner } = auth;
const DAY = 86400000;

function customerOut(req, c, { full = false } = {}) {
  if (!c) return null;
  const out = {
    id: c.id, code: c.code, name: c.name, phone: c.phone, stamps: c.stamps,
    rewards_available: c.rewards_available, total_plates: c.total_plates,
    total_rewards_earned: c.total_rewards_earned, total_rewards_redeemed: c.total_rewards_redeemed,
    visits: c.visits, blocked: !!c.blocked, notes: c.notes, source: c.source,
    created_at: c.created_at, last_visit_at: c.last_visit_at,
  };
  if (full) out.card_url = cardUrl(req, c.card_token);
  return out;
}

/** Work out what a scanned QR / typed code refers to. */
function parseLookup(q) {
  const s = String(q || '').trim();
  const m = s.match(/\/c\/([A-Za-z0-9_-]{16,64})/);
  if (m) return { kind: 'token', value: m[1] };
  if (/^[A-Za-z0-9_-]{24}$/.test(s) && /[a-z]/.test(s)) return { kind: 'token', value: s };
  const code = s.toUpperCase().replace(/^M-?/, '');
  if (/^[2-9A-HJ-NP-Z]{6}$/.test(code) && /[A-Z]/.test(code) && /\d/.test(code)) return { kind: 'code', value: code, raw: s };
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === s.replace(/[\s+\-()]/g, '').length) {
    return { kind: 'phone', value: digits.length > 10 ? digits.slice(-10) : digits };
  }
  return { kind: 'name', value: s.toLowerCase() };
}

function dayStart(ts, tzMin) {
  const off = tzMin * 60000;
  return Math.floor((ts + off) / DAY) * DAY - off;
}

module.exports = function adminRoutes(db) {
  const r = express.Router();
  const loginIpLimit = rateLimit({ windowMs: 15 * 60000, max: 30, message: 'Too many login attempts. Wait 15 minutes.' });
  const loginUserLimit = rateLimit({
    windowMs: 15 * 60000, max: 8, key: (req) => 'u:' + String(req.body?.username || '').toLowerCase(),
    message: 'Too many wrong attempts for this user. Wait 15 minutes.',
  });

  /* ---------------- setup & session ---------------- */
  r.get('/api/admin/setup-status', async (_req, res) => {
    const o = await db.get("SELECT COUNT(*) AS n FROM staff WHERE role = 'owner'");
    res.json({ needs_setup: o.n === 0, setup_code_required: !!process.env.SETUP_CODE });
  });

  r.post('/api/admin/setup', loginIpLimit, async (req, res) => {
    const b = req.body || {};
    if (process.env.SETUP_CODE && String(b.setup_code || '') !== process.env.SETUP_CODE) {
      throw new HttpError(403, 'BAD_SETUP_CODE', 'Setup code is wrong');
    }
    const name = cleanName(b.owner_name);
    const username = String(b.username || '').trim().toLowerCase();
    const shop = cleanText(b.shop_name, 60);
    if (!name) throw bad('INVALID_NAME', 'Enter your name');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('INVALID_USERNAME', 'Username: 3–30 letters/numbers');
    if (!shop) throw bad('INVALID_SHOP', 'Enter the shop name');
    const secret = auth.validateSecret('owner', b.password);
    const hash = auth.hashSecret(secret);
    const staffId = await db.tx(async (t) => {
      const o = await t.get("SELECT COUNT(*) AS n FROM staff WHERE role = 'owner'");
      if (o.n > 0) throw new HttpError(409, 'ALREADY_SETUP', 'Setup is already done — please log in');
      const clean = settings.validate({
        shop_name: shop,
        ...(b.stamps_required !== undefined ? { stamps_required: b.stamps_required } : {}),
        ...(b.reward_name ? { reward_name: b.reward_name } : {}),
      });
      await settings.save(t, clean);
      const row = await t.get(
        "INSERT INTO staff(name, username, role, secret_hash, active, created_at) VALUES(?,?,'owner',?,1,?) RETURNING id",
        [name, username, hash, now()]
      );
      return row.id;
    });
    const token = await auth.createSession(db, staffId, req.headers['user-agent']);
    auth.setSessionCookie(req, res, token);
    res.status(201).json({ ok: true });
  });

  r.post('/api/admin/login', loginIpLimit, loginUserLimit, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const secret = String(req.body?.secret || '');
    const st = await db.get('SELECT id, secret_hash, active FROM staff WHERE username = ?', [username]);
    const ok = auth.verifySecret(secret, st ? st.secret_hash : auth.DUMMY_HASH);
    if (!st || !ok || !st.active) throw new HttpError(401, 'BAD_LOGIN', 'Wrong username or PIN/password');
    loginUserLimit.reset('u:' + username);
    await db.run('UPDATE staff SET last_login_at = ? WHERE id = ?', [now(), st.id]);
    const token = await auth.createSession(db, st.id, req.headers['user-agent']);
    auth.setSessionCookie(req, res, token);
    res.json({ ok: true });
  });

  r.post('/api/admin/logout', async (req, res) => {
    if (req.sessionTokenHash) await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.sessionTokenHash]);
    auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  r.get('/api/admin/me', requireStaff, async (req, res) => {
    const s = await settings.get(db);
    res.json({ staff: req.staff, settings: s, join_url: `${baseUrl(req)}/` });
  });

  r.post('/api/admin/password', requireStaff, async (req, res) => {
    const st = await db.get('SELECT secret_hash, role FROM staff WHERE id = ?', [req.staff.id]);
    if (!auth.verifySecret(String(req.body?.current || ''), st.secret_hash)) {
      throw new HttpError(403, 'BAD_CURRENT', 'Current password/PIN is wrong');
    }
    const next = auth.validateSecret(st.role, req.body?.next);
    await db.run('UPDATE staff SET secret_hash = ? WHERE id = ?', [auth.hashSecret(next), req.staff.id]);
    await db.run('DELETE FROM sessions WHERE staff_id = ? AND token_hash <> ?', [req.staff.id, req.sessionTokenHash]);
    res.json({ ok: true });
  });

  /* ---------------- counter: find, register, stamp, redeem ---------------- */
  r.get('/api/admin/lookup', requireStaff, async (req, res) => {
    const p = parseLookup(req.query.q);
    const cols = loyalty.CUSTOMER_COLS;
    let rows = [];
    let verified = false;
    if (p.kind === 'token') {
      rows = await db.all(`SELECT ${cols} FROM customers WHERE card_token = ?`, [p.value]);
      verified = rows.length === 1;
    } else if (p.kind === 'code') {
      rows = await db.all(`SELECT ${cols} FROM customers WHERE code = ?`, [p.value]);
      verified = rows.length === 1;
      if (!rows.length) rows = await db.all(`SELECT ${cols} FROM customers WHERE LOWER(name) LIKE ? ORDER BY last_visit_at DESC LIMIT 20`, [`%${p.raw.toLowerCase()}%`]);
    } else if (p.kind === 'phone') {
      rows = await db.all(
        `SELECT ${cols} FROM customers WHERE phone LIKE ? ORDER BY CASE WHEN phone = ? THEN 0 ELSE 1 END, last_visit_at DESC LIMIT 20`,
        [`%${p.value}%`, p.value]
      );
    } else if (p.value.length >= 2) {
      rows = await db.all(
        `SELECT ${cols} FROM customers WHERE LOWER(name) LIKE ? ORDER BY last_visit_at DESC LIMIT 20`,
        [`%${p.value}%`]
      );
    }
    res.json({
      kind: p.kind,
      verified,
      // Only a scanned card / its code proves the customer is holding their card.
      card_token: verified ? rows[0].card_token : undefined,
      results: rows.map((c) => customerOut(req, c)),
    });
  });

  async function detail(req, id) {
    const c = await db.get(`SELECT ${loyalty.CUSTOMER_COLS} FROM customers WHERE id = ?`, [id]);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    const history = await db.all(
      `SELECT id, type, plates, rewards_earned, rewards_redeemed, stamps_before, stamps_after, rewards_before, rewards_after,
              staff_id, staff_name, verified, note, voided, voided_by_name, voided_at, created_at
         FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 30`,
      [id]
    );
    return { customer: customerOut(req, c, { full: true }), history };
  }

  const idParam = (req) => {
    const id = int(req.params.id, { min: 1 });
    if (!id) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    return id;
  };

  r.get('/api/admin/customers/:id', requireStaff, async (req, res) => {
    res.json(await detail(req, idParam(req)));
  });

  r.post('/api/admin/customers', requireStaff, async (req, res) => {
    const name = cleanName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    if (!name) throw bad('INVALID_NAME', 'Enter the customer name');
    if (!phone) throw bad('INVALID_PHONE', 'Enter a valid 10-digit mobile number');
    const c = await loyalty.createCustomer(db, { name, phone, source: 'counter', staff: req.staff });
    res.status(201).json(await detail(req, c.id));
  });

  r.post('/api/admin/customers/:id/stamp', requireStaff, async (req, res) => {
    const plates = int(req.body?.plates, { min: 1, max: 1000 });
    if (!plates) throw bad('INVALID_PLATES', 'Enter number of plates');
    const out = await loyalty.addPlates(db, idParam(req), {
      plates, force: req.body?.force === true, note: cleanText(req.body?.note, 200), staff: req.staff,
      verified: false,
    });
    res.json({ earned: out.earned, tx_id: out.tx_id, ...(await detail(req, out.customer.id)) });
  });

  r.post('/api/admin/customers/:id/redeem', requireStaff, async (req, res) => {
    const count = int(req.body?.count, { min: 1, max: 20, def: 1 });
    const out = await loyalty.redeem(db, idParam(req), {
      count, cardToken: typeof req.body?.card_token === 'string' ? req.body.card_token : null,
      staff: req.staff, note: cleanText(req.body?.note, 200),
    });
    res.json({ verified: out.verified, tx_id: out.tx_id, ...(await detail(req, out.customer.id)) });
  });

  r.post('/api/admin/customers/:id/undo', requireStaff, async (req, res) => {
    const out = await loyalty.undoLast(db, idParam(req), { staff: req.staff });
    res.json({ undone: { id: out.undone.id, type: out.undone.type }, ...(await detail(req, out.customer.id)) });
  });

  r.patch('/api/admin/customers/:id', requireStaff, async (req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (b.name !== undefined) {
      const n = cleanName(b.name);
      if (!n) throw bad('INVALID_NAME', 'Enter a valid name');
      sets.push('name = ?'); vals.push(n);
    }
    if (b.notes !== undefined) { sets.push('notes = ?'); vals.push(cleanText(b.notes, 300)); }
    if (b.phone !== undefined || b.blocked !== undefined) {
      if (req.staff.role !== 'owner') throw new HttpError(403, 'OWNER_ONLY', 'Only the owner can change phone or block');
      if (b.phone !== undefined) {
        const p = normalizePhone(b.phone);
        if (!p) throw bad('INVALID_PHONE', 'Enter a valid 10-digit mobile number');
        const other = await db.get('SELECT id FROM customers WHERE phone = ? AND id <> ?', [p, id]);
        if (other) throw new HttpError(409, 'PHONE_EXISTS', 'Another customer already has this number');
        sets.push('phone = ?'); vals.push(p);
      }
      if (b.blocked !== undefined) { sets.push('blocked = ?'); vals.push(b.blocked ? 1 : 0); }
    }
    if (!sets.length) throw bad('NOTHING_TO_DO', 'Nothing to update');
    const r2 = await db.run(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    if (!r2.changes) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    res.json(await detail(req, id));
  });

  r.post('/api/admin/customers/:id/adjust', requireOwner, async (req, res) => {
    const stampsDelta = int(req.body?.stamps_delta, { min: -1000, max: 1000, def: 0 });
    const rewardsDelta = int(req.body?.rewards_delta, { min: -1000, max: 1000, def: 0 });
    if (stampsDelta === undefined || rewardsDelta === undefined) throw bad('INVALID', 'Invalid numbers');
    const out = await loyalty.adjust(db, idParam(req), {
      stampsDelta, rewardsDelta, note: cleanText(req.body?.note, 200), staff: req.staff,
    });
    res.json(await detail(req, out.customer.id));
  });

  // Right to erasure: removes the customer and their history permanently.
  r.delete('/api/admin/customers/:id', requireOwner, async (req, res) => {
    const id = idParam(req);
    await db.tx(async (t) => {
      await t.run('DELETE FROM transactions WHERE customer_id = ?', [id]);
      const x = await t.run('DELETE FROM customers WHERE id = ?', [id]);
      if (!x.changes) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
    });
    res.json({ ok: true });
  });

  /* ---------------- lists ---------------- */
  r.get('/api/admin/customers', requireStaff, async (req, res) => {
    const page = int(req.query.page, { min: 1, max: 100000, def: 1 }) || 1;
    const per = int(req.query.per, { min: 1, max: 200, def: 25 }) || 25;
    const s = await settings.get(db);
    const where = [];
    const vals = [];
    const q = String(req.query.q || '').trim();
    if (q) {
      const p = parseLookup(q);
      if (p.kind === 'phone') { where.push('phone LIKE ?'); vals.push(`%${p.value}%`); }
      else if (p.kind === 'code') { where.push('(code = ? OR LOWER(name) LIKE ?)'); vals.push(p.value, `%${q.toLowerCase()}%`); }
      else { where.push('LOWER(name) LIKE ?'); vals.push(`%${q.toLowerCase()}%`); }
    }
    const f = String(req.query.filter || 'all');
    if (f === 'ready') where.push('rewards_available > 0');
    else if (f === 'close') { where.push('stamps >= ?'); vals.push(Math.max(1, s.stamps_required - 1)); }
    else if (f === 'inactive') { where.push('visits >= 2 AND last_visit_at < ?'); vals.push(now() - 21 * DAY); }
    else if (f === 'blocked') where.push('blocked = 1');
    const orders = {
      recent: 'CASE WHEN last_visit_at IS NULL THEN 1 ELSE 0 END, last_visit_at DESC, id DESC',
      plates: 'total_plates DESC, id DESC',
      name: 'LOWER(name) ASC, id ASC',
      new: 'created_at DESC, id DESC',
    };
    const order = orders[req.query.sort] || orders.recent;
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await db.get(`SELECT COUNT(*) AS n FROM customers ${w}`, vals)).n;
    const rows = await db.all(
      `SELECT ${loyalty.CUSTOMER_COLS} FROM customers ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...vals, per, (page - 1) * per]
    );
    res.json({ total, page, per, results: rows.map((c) => customerOut(req, c)) });
  });

  function txFilters(req) {
    const where = [];
    const vals = [];
    const type = String(req.query.type || '');
    if (['stamp', 'redeem', 'adjust', 'welcome'].includes(type)) { where.push('t.type = ?'); vals.push(type); }
    const staffId = int(req.query.staff_id, { min: 1 });
    if (staffId) { where.push('t.staff_id = ?'); vals.push(staffId); }
    const from = int(req.query.from, { min: 0 });
    const to = int(req.query.to, { min: 0 });
    if (from) { where.push('t.created_at >= ?'); vals.push(from); }
    if (to) { where.push('t.created_at < ?'); vals.push(to); }
    if (req.query.voided === '1') where.push('t.voided = 1');
    if (req.query.unverified === '1') { where.push("t.type = 'redeem' AND t.verified = 0"); }
    return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
  }

  r.get('/api/admin/transactions', requireOwner, async (req, res) => {
    const page = int(req.query.page, { min: 1, max: 100000, def: 1 }) || 1;
    const per = 50;
    const { w, vals } = txFilters(req);
    const total = (await db.get(`SELECT COUNT(*) AS n FROM transactions t ${w}`, vals)).n;
    const rows = await db.all(
      `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone
         FROM transactions t JOIN customers c ON c.id = t.customer_id ${w}
        ORDER BY t.id DESC LIMIT ? OFFSET ?`,
      [...vals, per, (page - 1) * per]
    );
    res.json({ total, page, per, results: rows });
  });

  /* ---------------- dashboard ---------------- */
  r.get('/api/admin/stats', requireOwner, async (_req, res) => {
    const s = await settings.get(db);
    const t = now();
    const off = s.tz_offset_minutes * 60000;
    const today = dayStart(t, s.tz_offset_minutes);
    const d30 = today - 29 * DAY;
    const one = async (sql, p = []) => (await db.get(sql, p)) || {};

    const cust = await one(
      `SELECT COUNT(*) AS customers,
              COALESCE(SUM(rewards_available),0) AS rewards_pending,
              COALESCE(SUM(CASE WHEN visits >= 1 THEN 1 ELSE 0 END),0) AS active_ever,
              COALESCE(SUM(CASE WHEN visits >= 2 THEN 1 ELSE 0 END),0) AS repeaters,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END),0) AS new_7d,
              COALESCE(SUM(CASE WHEN rewards_available > 0 THEN 1 ELSE 0 END),0) AS customers_with_reward
         FROM customers`,
      [t - 7 * DAY]
    );
    const win = async (from) => one(
      `SELECT COALESCE(SUM(CASE WHEN type='stamp' THEN plates ELSE 0 END),0) AS plates,
              COALESCE(SUM(CASE WHEN type='redeem' THEN rewards_redeemed ELSE 0 END),0) AS redeemed,
              COALESCE(SUM(CASE WHEN type='stamp' THEN rewards_earned ELSE 0 END),0) AS earned,
              COUNT(DISTINCT CASE WHEN type='stamp' THEN customer_id END) AS visitors,
              COALESCE(SUM(CASE WHEN type='redeem' AND verified = 0 THEN rewards_redeemed ELSE 0 END),0) AS unverified_redeems
         FROM transactions WHERE voided = 0 AND created_at >= ?`,
      [from]
    );
    const [todayW, w7, w30] = [await win(today), await win(t - 7 * DAY), await win(d30)];

    const daily = await db.all(
      `SELECT (created_at + CAST(? AS INTEGER)) / ${DAY} AS day,
              COALESCE(SUM(CASE WHEN type='stamp' THEN plates ELSE 0 END),0) AS plates,
              COALESCE(SUM(CASE WHEN type='redeem' THEN rewards_redeemed ELSE 0 END),0) AS redeemed
         FROM transactions WHERE voided = 0 AND created_at >= ? GROUP BY 1 ORDER BY 1`,
      [off, d30]
    );
    const byDay = new Map(daily.map((d) => [Number(d.day), d]));
    const series = [];
    for (let i = 0; i < 30; i++) {
      const ds = d30 + i * DAY;
      const key = Math.floor((ds + off) / DAY);
      const d = byDay.get(key);
      series.push({ day: ds, plates: d ? Number(d.plates) : 0, redeemed: d ? Number(d.redeemed) : 0 });
    }
    const hours = await db.all(
      `SELECT ((created_at + CAST(? AS INTEGER)) % ${DAY}) / 3600000 AS hour, COALESCE(SUM(plates),0) AS plates
         FROM transactions WHERE voided = 0 AND type = 'stamp' AND created_at >= ? GROUP BY 1 ORDER BY 1`,
      [off, d30]
    );
    const top = await db.all(
      'SELECT id, name, phone, total_plates, visits, rewards_available, last_visit_at FROM customers ORDER BY total_plates DESC, id ASC LIMIT 10'
    );
    const winback = await db.all(
      `SELECT id, name, phone, total_plates, visits, stamps, last_visit_at FROM customers
        WHERE visits >= 2 AND blocked = 0 AND last_visit_at < ? ORDER BY total_plates DESC LIMIT 15`,
      [t - 21 * DAY]
    );
    const staffRows = await db.all(
      `SELECT staff_name, COALESCE(SUM(CASE WHEN type='stamp' THEN plates ELSE 0 END),0) AS plates,
              COALESCE(SUM(CASE WHEN type='redeem' THEN rewards_redeemed ELSE 0 END),0) AS redeemed,
              COALESCE(SUM(CASE WHEN type='redeem' AND verified = 0 THEN rewards_redeemed ELSE 0 END),0) AS unverified,
              COALESCE(SUM(voided),0) AS undone
         FROM transactions WHERE created_at >= ? GROUP BY staff_name ORDER BY 2 DESC`,
      [d30]
    );
    res.json({
      settings: { stamps_required: s.stamps_required, reward_name: s.reward_name },
      customers: cust,
      repeat_rate: cust.active_ever ? cust.repeaters / cust.active_ever : 0,
      today: todayW, last7: w7, last30: w30,
      series,
      hours: hours.map((h) => ({ hour: Number(h.hour), plates: Number(h.plates) })),
      top, winback, staff: staffRows,
    });
  });

  /* ---------------- settings & staff ---------------- */
  r.get('/api/admin/settings', requireOwner, async (_req, res) => {
    res.json(await settings.get(db));
  });

  r.put('/api/admin/settings', requireOwner, async (req, res) => {
    const clean = settings.validate(req.body);
    let converted = 0;
    await db.tx(async (t) => {
      await settings.save(t, clean);
      if (clean.stamps_required) converted = await loyalty.normalizeAfterRuleChange(t, clean.stamps_required, req.staff);
    });
    settings.invalidate();
    res.json({ settings: await settings.get(db), converted_cards: converted });
  });

  r.get('/api/admin/staff', requireOwner, async (_req, res) => {
    res.json(await db.all('SELECT id, name, username, role, active, created_at, last_login_at FROM staff ORDER BY role DESC, name'));
  });

  r.post('/api/admin/staff', requireOwner, async (req, res) => {
    const name = cleanName(req.body?.name);
    const username = String(req.body?.username || '').trim().toLowerCase();
    const role = req.body?.role === 'owner' ? 'owner' : 'staff';
    if (!name) throw bad('INVALID_NAME', 'Enter the staff name');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('INVALID_USERNAME', 'Username: 3–30 letters/numbers, no spaces');
    const secret = auth.validateSecret(role, req.body?.secret);
    const exists = await db.get('SELECT id FROM staff WHERE username = ?', [username]);
    if (exists) throw new HttpError(409, 'USERNAME_TAKEN', 'That username is taken');
    await db.run(
      'INSERT INTO staff(name, username, role, secret_hash, active, created_at) VALUES(?,?,?,?,1,?)',
      [name, username, role, auth.hashSecret(secret), now()]
    );
    res.status(201).json({ ok: true });
  });

  r.patch('/api/admin/staff/:id', requireOwner, async (req, res) => {
    const id = int(req.params.id, { min: 1 });
    const st = id && (await db.get('SELECT id, role FROM staff WHERE id = ?', [id]));
    if (!st) throw new HttpError(404, 'NOT_FOUND', 'Staff not found');
    const b = req.body || {};
    if (b.name !== undefined) {
      const n = cleanName(b.name);
      if (!n) throw bad('INVALID_NAME', 'Enter a valid name');
      await db.run('UPDATE staff SET name = ? WHERE id = ?', [n, id]);
    }
    if (b.secret !== undefined) {
      const sec = auth.validateSecret(st.role, b.secret);
      await db.run('UPDATE staff SET secret_hash = ? WHERE id = ?', [auth.hashSecret(sec), id]);
      await db.run('DELETE FROM sessions WHERE staff_id = ?', [id]);
    }
    if (b.active !== undefined) {
      if (id === req.staff.id) throw bad('SELF', "You can't deactivate yourself");
      await db.run('UPDATE staff SET active = ? WHERE id = ?', [b.active ? 1 : 0, id]);
      if (!b.active) await db.run('DELETE FROM sessions WHERE staff_id = ?', [id]);
    }
    res.json({ ok: true });
  });

  /* ---------------- exports, backup & restore ---------------- */
  const stamp = () => new Date().toISOString().slice(0, 10);
  const iso = (ts) => (ts ? new Date(Number(ts)).toISOString() : '');

  r.get('/api/admin/export/customers.csv', requireOwner, async (_req, res) => {
    const rows = await db.all(`SELECT ${loyalty.CUSTOMER_COLS} FROM customers ORDER BY id`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${stamp()}.csv"`);
    res.send(toCsv(
      ['ID', 'Code', 'Name', 'Mobile', 'Current stamps', 'Free plates ready', 'Total plates', 'Free plates earned',
        'Free plates redeemed', 'Visits', 'Blocked', 'Joined via', 'Joined', 'Last visit', 'Notes'],
      rows.map((c) => [c.id, c.code, c.name, c.phone, c.stamps, c.rewards_available, c.total_plates, c.total_rewards_earned,
        c.total_rewards_redeemed, c.visits, c.blocked ? 'yes' : '', c.source, iso(c.created_at), iso(c.last_visit_at), c.notes])
    ));
  });

  r.get('/api/admin/export/transactions.csv', requireOwner, async (req, res) => {
    const { w, vals } = txFilters(req);
    const rows = await db.all(
      `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone FROM transactions t
         JOIN customers c ON c.id = t.customer_id ${w} ORDER BY t.id`,
      vals
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-${stamp()}.csv"`);
    res.send(toCsv(
      ['ID', 'Time', 'Type', 'Customer', 'Mobile', 'Plates', 'Free earned', 'Free given', 'Stamps before', 'Stamps after',
        'Free before', 'Free after', 'Card scanned', 'By', 'Note', 'Undone', 'Undone by'],
      rows.map((x) => [x.id, iso(x.created_at), x.type, x.customer_name, x.customer_phone, x.plates, x.rewards_earned,
        x.rewards_redeemed, x.stamps_before, x.stamps_after, x.rewards_before, x.rewards_after, x.verified ? 'yes' : '',
        x.staff_name, x.note, x.voided ? 'yes' : '', x.voided_by_name])
    ));
  });

  r.get('/api/admin/export/backup.json', requireOwner, async (_req, res) => {
    const data = {
      app: 'momo-rewards',
      format: 1,
      exported_at: new Date().toISOString(),
      settings: await settings.get(db),
      customers: await db.all('SELECT * FROM customers ORDER BY id'),
      transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="momo-backup-${stamp()}.json"`);
    res.send(JSON.stringify(data));
  });

  r.post('/api/admin/import/backup', requireOwner, async (req, res) => {
    const b = req.body || {};
    if (b.app !== 'momo-rewards' || b.format !== 1 || !Array.isArray(b.customers) || !Array.isArray(b.transactions)) {
      throw bad('BAD_BACKUP', 'This is not a Momo Rewards backup file');
    }
    if (req.query.confirm !== 'REPLACE') throw bad('CONFIRM', 'Confirmation missing');
    const custCols = ['id', 'code', 'card_token', 'phone', 'name', 'stamps', 'rewards_available', 'total_plates',
      'total_rewards_earned', 'total_rewards_redeemed', 'visits', 'blocked', 'notes', 'source', 'created_at', 'last_visit_at'];
    const txCols = ['id', 'customer_id', 'staff_id', 'staff_name', 'type', 'plates', 'rewards_earned', 'rewards_redeemed',
      'stamps_before', 'stamps_after', 'rewards_before', 'rewards_after', 'verified', 'note', 'voided', 'voided_by_name',
      'voided_at', 'created_at'];
    await db.tx(async (t) => {
      const staffIds = new Set((await t.all('SELECT id FROM staff')).map((x) => x.id));
      await t.run('DELETE FROM transactions');
      await t.run('DELETE FROM customers');
      const ph = (n) => Array(n).fill('?').join(',');
      for (const c of b.customers) {
        await t.run(`INSERT INTO customers(${custCols.join(',')}) VALUES(${ph(custCols.length)})`, custCols.map((k) => c[k] ?? null));
      }
      for (const x of b.transactions) {
        const row = { ...x, staff_id: staffIds.has(x.staff_id) ? x.staff_id : null };
        await t.run(`INSERT INTO transactions(${txCols.join(',')}) VALUES(${ph(txCols.length)})`, txCols.map((k) => row[k] ?? null));
      }
      if (b.settings) await settings.save(t, settings.validate(b.settings));
      await db.resetSequence(t, 'customers');
      await db.resetSequence(t, 'transactions');
    });
    settings.invalidate();
    res.json({ ok: true, customers: b.customers.length, transactions: b.transactions.length });
  });

  return r;
};

module.exports.parseLookup = parseLookup;
