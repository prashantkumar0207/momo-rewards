'use strict';
/**
 * End-to-end API tests. Run against SQLite by default, or Postgres when
 * TEST_DATABASE_URL is set:  node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let base, server, db, tmp;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (_) { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  get(u, h) { return this.req('GET', u, undefined, h); }
  post(u, b = {}, h) { return this.req('POST', u, b, h); }
  put(u, b) { return this.req('PUT', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u); }
}

const owner = new Client();
const staff = new Client();
const anon = new Client();

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'momo-test-'));
  const { createApp } = require('../server/app');
  const out = await createApp({ dataDir: tmp, databaseUrl: process.env.TEST_DATABASE_URL || '' });
  db = out.db;
  if (db.dialect === 'pg') {
    await db.exec('TRUNCATE transactions, customers, sessions, staff RESTART IDENTITY CASCADE');
    await db.exec("DELETE FROM settings WHERE key <> 'schema_version'");
    require('../server/settings').invalidate();
  }
  await new Promise((r) => { server = out.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let custA, tokenA;

test('first-run setup creates the owner exactly once', async () => {
  let r = await anon.get('/api/admin/setup-status');
  assert.equal(r.body.needs_setup, true);
  r = await owner.post('/api/admin/setup', { shop_name: 'Tashi Momos', owner_name: 'Prashant', username: 'owner', password: 'short' });
  assert.equal(r.status, 400);
  r = await owner.post('/api/admin/setup', { shop_name: 'Tashi Momos', owner_name: 'Prashant', username: 'owner', password: 'momo-secret-1' });
  assert.equal(r.status, 201);
  r = await anon.post('/api/admin/setup', { shop_name: 'Evil', owner_name: 'X', username: 'evil', password: 'evil-pass-123' });
  assert.equal(r.status, 409);
  r = await owner.get('/api/admin/me');
  assert.equal(r.body.staff.role, 'owner');
  assert.equal(r.body.settings.shop_name, 'Tashi Momos');
});

test('owner adds a staff member who can log in with a PIN', async () => {
  let r = await owner.post('/api/admin/staff', { name: 'Ravi', username: 'ravi', secret: '12' });
  assert.equal(r.status, 400);
  r = await owner.post('/api/admin/staff', { name: 'Ravi', username: 'ravi', secret: '4821' });
  assert.equal(r.status, 201);
  r = await staff.post('/api/admin/login', { username: 'ravi', secret: '0000' });
  assert.equal(r.status, 401);
  r = await staff.post('/api/admin/login', { username: 'RAVI', secret: '4821' });
  assert.equal(r.status, 200);
  r = await staff.get('/api/admin/me');
  assert.equal(r.body.staff.role, 'staff');
});

test('staff cannot reach owner-only areas; anonymous cannot reach admin', async () => {
  for (const u of ['/api/admin/settings', '/api/admin/stats', '/api/admin/staff', '/api/admin/export/customers.csv', '/api/admin/transactions']) {
    assert.equal((await staff.get(u)).status, 403, u);
    assert.equal((await anon.get(u)).status, 401, u);
  }
  assert.equal((await anon.get('/api/admin/lookup?q=98')).status, 401);
});

test('customer self sign-up validates input and normalises phone', async () => {
  let r = await anon.post('/api/public/join', { name: 'Asha', phone: '12345', consent: true });
  assert.equal(r.body.error.code, 'INVALID_PHONE');
  r = await anon.post('/api/public/join', { name: 'Asha', phone: '9876543210' });
  assert.equal(r.body.error.code, 'CONSENT_REQUIRED');
  r = await anon.post('/api/public/join', { name: '  Asha   Verma ', phone: '+91 98765-43210', consent: true });
  assert.equal(r.status, 201);
  tokenA = r.body.token;
  assert.match(r.body.card_url, /\/c\//);
  r = await anon.post('/api/public/join', { name: 'Someone else', phone: '09876543210', consent: true });
  assert.equal(r.status, 409);
  r = await anon.get('/api/public/card/' + tokenA);
  assert.equal(r.body.customer.name, 'Asha Verma');
  assert.equal(r.body.customer.stamps, 0);
  assert.equal(r.body.shop.stamps_required, 5);
});

test('public phone lookup reveals progress but never the card link', async () => {
  const r = await anon.get('/api/public/lookup?phone=9876543210');
  assert.equal(r.body.found, true);
  assert.equal(r.body.first_name, 'Asha');
  assert.equal(JSON.stringify(r.body).includes(tokenA), false);
  assert.equal(r.body.card_url, undefined);
  assert.equal((await anon.get('/api/public/lookup?phone=9000000000')).body.found, false);
});

test('staff finds customer by phone digits (unverified) and by scanned QR (verified)', async () => {
  let r = await staff.get('/api/admin/lookup?q=43210');
  assert.equal(r.body.kind, 'phone');
  assert.equal(r.body.verified, false);
  assert.equal(r.body.card_token, undefined);
  custA = r.body.results[0];
  assert.equal(custA.name, 'Asha Verma');
  r = await staff.get('/api/admin/lookup?q=' + encodeURIComponent(`https://shop.example/c/${tokenA}`));
  assert.equal(r.body.verified, true);
  assert.equal(r.body.card_token, tokenA);
  r = await staff.get('/api/admin/lookup?q=' + custA.code.toLowerCase());
  assert.equal(r.body.verified, true);
  r = await staff.get('/api/admin/lookup?q=asha');
  assert.equal(r.body.results.length, 1);
});

test('5 plates earn 1 free plate, with rollover across multiple plates', async () => {
  let r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.stamps, 3);
  assert.equal(r.body.earned, 0);
  // cooldown protects against accidental double entry
  r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 4 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'COOLDOWN');
  r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 4, force: true });
  assert.equal(r.body.earned, 1);
  assert.equal(r.body.customer.stamps, 2);            // 3 + 4 = 7 → 1 free, 2 carried over
  assert.equal(r.body.customer.rewards_available, 1);
  assert.equal(r.body.customer.total_plates, 7);
  r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 11, force: true });
  assert.equal(r.body.error.code, 'TOO_MANY_PLATES');
  r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 0 });
  assert.equal(r.status, 400);
  const card = await anon.get('/api/public/card/' + tokenA);
  assert.equal(card.body.customer.rewards_available, 1);
  assert.equal(card.body.history.length, 2);
});

test('redeem: verification rule, balance checks, and undo', async () => {
  // owner turns on "card scan required"
  let r = await owner.put('/api/admin/settings', { require_verified_redeem: true });
  assert.equal(r.status, 200);
  r = await staff.post(`/api/admin/customers/${custA.id}/redeem`, {});
  assert.equal(r.body.error.code, 'VERIFY_REQUIRED');
  r = await staff.post(`/api/admin/customers/${custA.id}/redeem`, { card_token: 'wrong-token-wrong-token1' });
  assert.equal(r.body.error.code, 'VERIFY_REQUIRED');
  r = await staff.post(`/api/admin/customers/${custA.id}/redeem`, { card_token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, true);
  assert.equal(r.body.customer.rewards_available, 0);
  assert.equal(r.body.customer.total_rewards_redeemed, 1);
  r = await staff.post(`/api/admin/customers/${custA.id}/redeem`, { card_token: tokenA });
  assert.equal(r.body.error.code, 'NO_REWARD');
  // staff undoes their own last entry → free plate restored
  r = await staff.post(`/api/admin/customers/${custA.id}/undo`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.rewards_available, 1);
  assert.equal(r.body.customer.total_rewards_redeemed, 0);
  assert.equal(r.body.history[0].voided, 1);
  // undo again → reverses the 4-plate stamp
  r = await staff.post(`/api/admin/customers/${custA.id}/undo`, {});
  assert.equal(r.body.customer.stamps, 3);
  assert.equal(r.body.customer.rewards_available, 0);
  assert.equal(r.body.customer.total_plates, 3);
  await owner.put('/api/admin/settings', { require_verified_redeem: false });
});

test('staff cannot undo an entry made by the owner', async () => {
  let r = await owner.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 1, force: true });
  assert.equal(r.body.customer.stamps, 4);
  r = await staff.post(`/api/admin/customers/${custA.id}/undo`, {});
  assert.equal(r.body.error.code, 'NOT_YOURS');
  r = await owner.post(`/api/admin/customers/${custA.id}/undo`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.stamps, 3);
});

test('counter registration, duplicate protection, owner-only edits', async () => {
  let r = await staff.post('/api/admin/customers', { name: 'Bunty', phone: '9123456780' });
  assert.equal(r.status, 201);
  const b = r.body.customer;
  r = await staff.post('/api/admin/customers', { name: 'Bunty 2', phone: '9123456780' });
  assert.equal(r.status, 409);
  r = await staff.patch(`/api/admin/customers/${b.id}`, { name: 'Bunty Singh', notes: 'Likes extra chutney' });
  assert.equal(r.body.customer.name, 'Bunty Singh');
  r = await staff.patch(`/api/admin/customers/${b.id}`, { blocked: true });
  assert.equal(r.status, 403);
  r = await owner.patch(`/api/admin/customers/${b.id}`, { blocked: true });
  assert.equal(r.body.customer.blocked, true);
  r = await staff.post(`/api/admin/customers/${b.id}/stamp`, { plates: 1 });
  assert.equal(r.body.error.code, 'BLOCKED');
  await owner.patch(`/api/admin/customers/${b.id}`, { blocked: false });
  r = await owner.post(`/api/admin/customers/${b.id}/adjust`, { stamps_delta: 2 });
  assert.equal(r.body.error.code, 'NOTE_REQUIRED');
  r = await owner.post(`/api/admin/customers/${b.id}/adjust`, { stamps_delta: 6, note: 'Paper card migration' });
  assert.equal(r.body.customer.stamps, 1);
  assert.equal(r.body.customer.rewards_available, 1);
});

test('concurrent stamping keeps balances exact (no lost updates)', async () => {
  const r0 = await owner.post('/api/admin/customers', { name: 'Rush Hour', phone: '9988776655' });
  const id = r0.body.customer.id;
  const N = 25;
  const results = await Promise.all(
    Array.from({ length: N }, () => staff.post(`/api/admin/customers/${id}/stamp`, { plates: 1, force: true }))
  );
  assert.ok(results.every((r) => r.status === 200));
  const d = await owner.get(`/api/admin/customers/${id}`);
  assert.equal(d.body.customer.total_plates, N);
  assert.equal(d.body.customer.rewards_available, Math.floor(N / 5));
  assert.equal(d.body.customer.stamps, N % 5);
  assert.equal(d.body.customer.total_rewards_earned, Math.floor(N / 5));
});

test('lowering "plates needed" converts over-full cards into free plates', async () => {
  const c = (await owner.post('/api/admin/customers', { name: 'Rule Test', phone: '9811111111' })).body.customer;
  await owner.post(`/api/admin/customers/${c.id}/stamp`, { plates: 4 });
  let r = await owner.put('/api/admin/settings', { stamps_required: 3 });
  assert.ok(r.body.converted_cards >= 1);
  r = await owner.get(`/api/admin/customers/${c.id}`);
  assert.equal(r.body.customer.stamps, 1);
  assert.equal(r.body.customer.rewards_available, 1);
  r = await owner.put('/api/admin/settings', { stamps_required: 1 });
  assert.equal(r.status, 400);
  await owner.put('/api/admin/settings', { stamps_required: 5 });
});

test('dashboard stats, lists, CSV export', async () => {
  let r = await owner.get('/api/admin/stats');
  assert.equal(r.status, 200);
  assert.equal(r.body.series.length, 30);
  assert.ok(r.body.customers.customers >= 4);
  assert.ok(r.body.today.plates >= 25);
  assert.ok(r.body.top.length >= 1);
  // today's bucket in the daily chart must contain today's plates
  assert.equal(r.body.series[29].plates, r.body.today.plates);
  assert.equal(r.body.hours.reduce((a, x) => a + x.plates, 0), r.body.last30.plates);
  r = await staff.get('/api/admin/customers?filter=ready');
  assert.ok(r.body.results.every((c) => c.rewards_available > 0));
  r = await staff.get('/api/admin/customers?sort=plates&per=2&page=1');
  assert.equal(r.body.results.length, 2);
  assert.ok(r.body.total >= 4);
  r = await owner.get('/api/admin/transactions?type=redeem');
  assert.ok(r.body.results.every((t) => t.type === 'redeem'));
  r = await owner.get('/api/admin/export/customers.csv');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.body, /Asha Verma/);
});

test('CSV export neutralises spreadsheet formulas in names', async () => {
  await owner.post('/api/admin/customers', { name: '=HYPERLINK("x")', phone: '9822222222' });
  const r = await owner.get('/api/admin/export/customers.csv');
  assert.match(r.body, /'=HYPERLINK/);
});

test('backup and restore round-trip', async () => {
  const before = await owner.get('/api/admin/customers?per=200');
  const backup = (await owner.get('/api/admin/export/backup.json')).body;
  assert.equal(backup.app, 'momo-rewards');
  await owner.del(`/api/admin/customers/${custA.id}`);
  assert.equal((await anon.get('/api/public/card/' + tokenA)).status, 404);
  let r = await owner.post('/api/admin/import/backup', backup);
  assert.equal(r.status, 400); // missing confirm
  r = await owner.post('/api/admin/import/backup?confirm=REPLACE', backup);
  assert.equal(r.status, 200);
  const after = await owner.get('/api/admin/customers?per=200');
  assert.equal(after.body.total, before.body.total);
  assert.equal((await anon.get('/api/public/card/' + tokenA)).status, 200);
  // new rows still get fresh ids after restore
  r = await owner.post('/api/admin/customers', { name: 'After Restore', phone: '9833333333' });
  assert.equal(r.status, 201);
});

test('security: cross-site and non-JSON writes are rejected', async () => {
  let r = await staff.post(`/api/admin/customers/${custA.id}/stamp`, { plates: 1 }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const res = await fetch(base + `/api/admin/customers/${custA.id}/stamp`, {
    method: 'POST', headers: { cookie: staff.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'plates=5',
  });
  assert.equal(res.status, 415);
  const h = (await anon.get('/')).headers;
  assert.match(h.get('content-security-policy'), /default-src 'self'/);
});

test('deactivated staff are logged out immediately', async () => {
  const list = (await owner.get('/api/admin/staff')).body;
  const ravi = list.find((s) => s.username === 'ravi');
  await owner.patch(`/api/admin/staff/${ravi.id}`, { active: false });
  assert.equal((await staff.get('/api/admin/me')).status, 401);
  assert.equal((await staff.post('/api/admin/login', { username: 'ravi', secret: '4821' })).status, 401);
});

test('login is rate-limited per username', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/admin/login', { username: 'owner', secret: 'wrong-' + i });
  assert.equal(last.status, 429);
});

test('QR endpoint returns SVG', async () => {
  const r = await anon.get('/qr.svg?d=' + encodeURIComponent('https://example.com/c/abc'));
  assert.match(r.headers.get('content-type'), /svg/);
  assert.match(r.body, /<svg/);
});
