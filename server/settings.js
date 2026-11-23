'use strict';
const { bad, cleanText } = require('./util');

/**
 * Every owner-editable setting, its default and its validation.
 * Values are stored as strings in the `settings` table.
 */
const SCHEMA = {
  shop_name:          { type: 'text', def: 'Momo Point', max: 60, required: true },
  tagline:            { type: 'text', def: 'Steaming hot momos, made fresh', max: 100 },
  shop_address:       { type: 'text', def: '', max: 160 },
  shop_phone:         { type: 'text', def: '', max: 20 },
  stamps_required:    { type: 'int', def: 5, min: 2, max: 50 },
  reward_name:        { type: 'text', def: '1 plate of momos FREE', max: 60, required: true },
  max_plates_per_tx:  { type: 'int', def: 10, min: 1, max: 100 },
  cooldown_minutes:   { type: 'int', def: 2, min: 0, max: 1440 },
  welcome_stamps:     { type: 'int', def: 0, min: 0, max: 10 },
  require_verified_redeem: { type: 'bool', def: false },
  allow_self_signup:  { type: 'bool', def: true },
  staff_undo_minutes: { type: 'int', def: 15, min: 0, max: 1440 },
  tz_offset_minutes:  { type: 'int', def: 330, min: -720, max: 840 },
};

let cache = null;

function parse(key, raw) {
  const s = SCHEMA[key];
  if (raw === undefined || raw === null) return s.def;
  if (s.type === 'int') return Number(raw);
  if (s.type === 'bool') return raw === 'true';
  return raw;
}

async function load(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const k of Object.keys(SCHEMA)) out[k] = parse(k, map[k]);
  cache = out;
  return out;
}

async function get(db) {
  return cache || load(db);
}

function validate(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    const s = SCHEMA[k];
    if (!s) continue;
    if (s.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < s.min || n > s.max) {
        throw bad('INVALID_SETTING', `${k} must be a whole number between ${s.min} and ${s.max}`);
      }
      clean[k] = n;
    } else if (s.type === 'bool') {
      clean[k] = v === true || v === 'true';
    } else {
      const t = cleanText(v, s.max) || '';
      if (s.required && !t) throw bad('INVALID_SETTING', `${k} cannot be empty`);
      clean[k] = t;
    }
  }
  return clean;
}

async function save(t, clean) {
  for (const [k, v] of Object.entries(clean)) {
    await t.run(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [k, String(v)]
    );
  }
  cache = null;
}

const invalidate = () => { cache = null; };

/** The subset that is safe to show to the public. */
function publicView(s) {
  return {
    shop_name: s.shop_name,
    tagline: s.tagline,
    shop_address: s.shop_address,
    shop_phone: s.shop_phone,
    stamps_required: s.stamps_required,
    reward_name: s.reward_name,
    allow_self_signup: s.allow_self_signup,
    welcome_stamps: s.welcome_stamps,
  };
}

module.exports = { SCHEMA, get, load, validate, save, invalidate, publicView };
