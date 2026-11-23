'use strict';
/**
 * Core loyalty rules. Every balance change happens inside a DB transaction,
 * locks the customer row, and writes an audit row with before/after values,
 * so the history always explains the balance and undo is exact.
 */
const { HttpError, bad, now, randomCode, randomToken } = require('./util');
const settings = require('./settings');

const CUSTOMER_COLS = `id, code, card_token, phone, name, stamps, rewards_available, total_plates,
  total_rewards_earned, total_rewards_redeemed, visits, blocked, notes, source, created_at, last_visit_at`;

async function lockCustomer(t, id) {
  const c = await t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?${t.forUpdate}`, [id]);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  return c;
}

async function insertTx(t, row) {
  const r = await t.get(
    `INSERT INTO transactions(customer_id, staff_id, staff_name, type, plates, rewards_earned, rewards_redeemed,
       stamps_before, stamps_after, rewards_before, rewards_after, verified, note, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [
      row.customer_id, row.staff_id ?? null, row.staff_name ?? null, row.type, row.plates || 0,
      row.rewards_earned || 0, row.rewards_redeemed || 0, row.stamps_before, row.stamps_after,
      row.rewards_before, row.rewards_after, row.verified ? 1 : 0, row.note ?? null, row.created_at ?? now(),
    ]
  );
  return r.id;
}

/** Create a customer (self sign-up or at the counter). */
async function createCustomer(db, { name, phone, source, staff }) {
  const s = await settings.get(db);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.tx(async (t) => {
        const exists = await t.get('SELECT id FROM customers WHERE phone = ?', [phone]);
        if (exists) throw new HttpError(409, 'PHONE_EXISTS', 'This mobile number is already a member', { id: exists.id });
        const ts = now();
        const welcome = Math.min(s.welcome_stamps, s.stamps_required - 1);
        const row = await t.get(
          `INSERT INTO customers(code, card_token, phone, name, stamps, source, created_at)
           VALUES(?,?,?,?,?,?,?) RETURNING id`,
          [randomCode(6), randomToken(18), phone, name, welcome, source, ts]
        );
        if (welcome > 0) {
          await insertTx(t, {
            customer_id: row.id, staff_id: staff?.id, staff_name: staff?.name || 'Welcome bonus', type: 'welcome',
            stamps_before: 0, stamps_after: welcome, rewards_before: 0, rewards_after: 0,
            note: `Welcome bonus: ${welcome} stamp(s)`, created_at: ts,
          });
        }
        return t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?`, [row.id]);
      });
    } catch (e) {
      // Only retry the astronomically rare random code/token collision.
      const msg = String(e.message || '');
      if (e.status) throw e;
      if (!/unique|duplicate/i.test(msg)) throw e;
      if (/phone/i.test(msg)) throw new HttpError(409, 'PHONE_EXISTS', 'This mobile number is already a member');
      // otherwise: code/token collision → loop and try again
    }
  }
  throw new Error('Could not allocate a unique customer code');
}

/** Add purchased plates. Rolls over into free-plate rewards automatically. */
async function addPlates(db, customerId, { plates, force, note, staff, verified }) {
  const s = await settings.get(db);
  if (!Number.isInteger(plates) || plates < 1) throw bad('INVALID_PLATES', 'Plates must be at least 1');
  if (plates > s.max_plates_per_tx) {
    throw bad('TOO_MANY_PLATES', `Maximum ${s.max_plates_per_tx} plates per entry (change it in Settings)`);
  }
  return db.tx(async (t) => {
    const c = await lockCustomer(t, customerId);
    if (c.blocked) throw new HttpError(403, 'BLOCKED', 'This customer is blocked');
    const ts = now();
    if (!force && s.cooldown_minutes > 0) {
      const last = await t.get(
        "SELECT created_at, plates FROM transactions WHERE customer_id = ? AND type = 'stamp' AND voided = 0 ORDER BY id DESC LIMIT 1",
        [c.id]
      );
      if (last && ts - last.created_at < s.cooldown_minutes * 60000) {
        throw new HttpError(409, 'COOLDOWN', `Plates were already added for this customer ${Math.max(1, Math.round((ts - last.created_at) / 60000))} min ago`, {
          last_at: last.created_at, last_plates: last.plates,
        });
      }
    }
    const required = s.stamps_required;
    const total = c.stamps + plates;
    const earned = Math.floor(total / required);
    const stampsAfter = total % required;
    const rewardsAfter = c.rewards_available + earned;
    await t.run(
      `UPDATE customers SET stamps = ?, rewards_available = ?, total_plates = total_plates + ?,
         total_rewards_earned = total_rewards_earned + ?, visits = visits + 1, last_visit_at = ? WHERE id = ?`,
      [stampsAfter, rewardsAfter, plates, earned, ts, c.id]
    );
    const txId = await insertTx(t, {
      customer_id: c.id, staff_id: staff.id, staff_name: staff.name, type: 'stamp', plates,
      rewards_earned: earned, stamps_before: c.stamps, stamps_after: stampsAfter,
      rewards_before: c.rewards_available, rewards_after: rewardsAfter, verified, note, created_at: ts,
    });
    return { tx_id: txId, earned, customer: await t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?`, [c.id]) };
  });
}

/** Give out free plate(s). */
async function redeem(db, customerId, { count = 1, cardToken, staff, note }) {
  const s = await settings.get(db);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw bad('INVALID_COUNT', 'Invalid number of free plates');
  return db.tx(async (t) => {
    const c = await lockCustomer(t, customerId);
    if (c.blocked) throw new HttpError(403, 'BLOCKED', 'This customer is blocked');
    const verified = !!cardToken && cardToken === c.card_token;
    if (s.require_verified_redeem && !verified && staff.role !== 'owner') {
      throw new HttpError(403, 'VERIFY_REQUIRED', "Scan the customer's card QR to give a free plate");
    }
    if (c.rewards_available < count) {
      throw new HttpError(409, 'NO_REWARD', c.rewards_available ? `Only ${c.rewards_available} free plate(s) available` : 'No free plate available yet');
    }
    const after = c.rewards_available - count;
    const ts = now();
    await t.run(
      'UPDATE customers SET rewards_available = ?, total_rewards_redeemed = total_rewards_redeemed + ?, last_visit_at = ? WHERE id = ?',
      [after, count, ts, c.id]
    );
    const txId = await insertTx(t, {
      customer_id: c.id, staff_id: staff.id, staff_name: staff.name, type: 'redeem', rewards_redeemed: count,
      stamps_before: c.stamps, stamps_after: c.stamps, rewards_before: c.rewards_available, rewards_after: after,
      verified, note, created_at: ts,
    });
    return { tx_id: txId, verified, customer: await t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?`, [c.id]) };
  });
}

/** Owner-only manual correction. */
async function adjust(db, customerId, { stampsDelta = 0, rewardsDelta = 0, note, staff }) {
  const s = await settings.get(db);
  if (!note) throw bad('NOTE_REQUIRED', 'Please write a reason for the adjustment');
  if (!stampsDelta && !rewardsDelta) throw bad('NOTHING_TO_DO', 'Nothing to adjust');
  return db.tx(async (t) => {
    const c = await lockCustomer(t, customerId);
    let stamps = c.stamps + stampsDelta;
    let rewards = c.rewards_available + rewardsDelta;
    if (stamps < 0 || rewards < 0) throw bad('NEGATIVE', 'Balance cannot go below zero');
    let earned = Math.floor(stamps / s.stamps_required);
    stamps %= s.stamps_required;
    rewards += earned;
    await t.run(
      'UPDATE customers SET stamps = ?, rewards_available = ?, total_rewards_earned = total_rewards_earned + ? WHERE id = ?',
      [stamps, rewards, Math.max(0, rewardsDelta) + earned, c.id]
    );
    const txId = await insertTx(t, {
      customer_id: c.id, staff_id: staff.id, staff_name: staff.name, type: 'adjust',
      rewards_earned: Math.max(0, rewardsDelta) + earned,
      stamps_before: c.stamps, stamps_after: stamps, rewards_before: c.rewards_available, rewards_after: rewards, note,
    });
    return { tx_id: txId, customer: await t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?`, [c.id]) };
  });
}

/** Undo the customer's most recent entry (exactly restores the earlier balance). */
async function undoLast(db, customerId, { staff }) {
  const s = await settings.get(db);
  return db.tx(async (t) => {
    const c = await lockCustomer(t, customerId);
    const last = await t.get(
      'SELECT * FROM transactions WHERE customer_id = ? AND voided = 0 ORDER BY id DESC LIMIT 1',
      [c.id]
    );
    if (!last) throw new HttpError(409, 'NOTHING_TO_UNDO', 'Nothing to undo');
    if (staff.role !== 'owner') {
      if (last.staff_id !== staff.id) throw new HttpError(403, 'NOT_YOURS', 'Only the owner can undo an entry made by someone else');
      if (now() - last.created_at > s.staff_undo_minutes * 60000) {
        throw new HttpError(403, 'TOO_LATE', `Staff can undo only within ${s.staff_undo_minutes} minutes. Ask the owner.`);
      }
    }
    if (c.stamps !== last.stamps_after || c.rewards_available !== last.rewards_after) {
      throw new HttpError(409, 'CHANGED', 'Balance changed since this entry — use an adjustment instead');
    }
    const ts = now();
    await t.run(
      `UPDATE customers SET stamps = ?, rewards_available = ?, total_plates = total_plates - ?,
         total_rewards_earned = total_rewards_earned - ?, total_rewards_redeemed = total_rewards_redeemed - ?,
         visits = visits - ? WHERE id = ?`,
      [last.stamps_before, last.rewards_before, last.plates, last.rewards_earned, last.rewards_redeemed,
        last.type === 'stamp' ? 1 : 0, c.id]
    );
    await t.run('UPDATE transactions SET voided = 1, voided_by_name = ?, voided_at = ? WHERE id = ?', [staff.name, ts, last.id]);
    const lv = await t.get(
      "SELECT MAX(created_at) AS m FROM transactions WHERE customer_id = ? AND voided = 0 AND type IN ('stamp','redeem')",
      [c.id]
    );
    await t.run('UPDATE customers SET last_visit_at = ? WHERE id = ?', [lv?.m ?? null, c.id]);
    return { undone: last, customer: await t.get(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = ?`, [c.id]) };
  });
}

/**
 * When the owner lowers "plates needed", convert any card that is now over the
 * limit into free plates (logged), so nobody loses progress.
 */
async function normalizeAfterRuleChange(t, required, staff) {
  const over = await t.all(`SELECT id, stamps, rewards_available FROM customers WHERE stamps >= ?${t.forUpdate}`, [required]);
  for (const c of over) {
    const earned = Math.floor(c.stamps / required);
    const stamps = c.stamps % required;
    await t.run(
      'UPDATE customers SET stamps = ?, rewards_available = rewards_available + ?, total_rewards_earned = total_rewards_earned + ? WHERE id = ?',
      [stamps, earned, earned, c.id]
    );
    await insertTx(t, {
      customer_id: c.id, staff_id: staff.id, staff_name: staff.name, type: 'adjust', rewards_earned: earned,
      stamps_before: c.stamps, stamps_after: stamps, rewards_before: c.rewards_available,
      rewards_after: c.rewards_available + earned, note: `Rule change: free plate after ${required} plates`,
    });
  }
  return over.length;
}

module.exports = { CUSTOMER_COLS, createCustomer, addPlates, redeem, adjust, undoLast, normalizeAfterRuleChange, insertTx };
