'use strict';
const express = require('express');
const QRCode = require('qrcode');
const settings = require('../settings');
const loyalty = require('../loyalty');
const { rateLimit } = require('../security');
const { HttpError, bad, normalizePhone, cleanName, firstName } = require('../util');

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const cardUrl = (req, token) => `${baseUrl(req)}/c/${token}`;

module.exports = function publicRoutes(db) {
  const r = express.Router();
  const joinLimit = rateLimit({ windowMs: 60 * 60000, max: 15, message: 'Too many sign-ups from this network. Please ask at the counter.' });
  const lookupLimit = rateLimit({ windowMs: 15 * 60000, max: 30 });
  const cardLimit = rateLimit({ windowMs: 60000, max: 60 });
  const qrLimit = rateLimit({ windowMs: 60000, max: 120 });

  r.get('/api/public/config', async (_req, res) => {
    res.json(settings.publicView(await settings.get(db)));
  });

  r.post('/api/public/join', joinLimit, async (req, res) => {
    const s = await settings.get(db);
    if (!s.allow_self_signup) throw new HttpError(403, 'SIGNUP_CLOSED', 'Please ask at the counter to join');
    const name = cleanName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    if (!name) throw bad('INVALID_NAME', 'Please enter your name');
    if (!phone) throw bad('INVALID_PHONE', 'Please enter a valid 10-digit mobile number');
    if (req.body?.consent !== true) throw bad('CONSENT_REQUIRED', 'Please agree to the terms to join');
    const c = await loyalty.createCustomer(db, { name, phone, source: 'self' });
    res.status(201).json({ token: c.card_token, card_url: cardUrl(req, c.card_token) });
  });

  // Phone lookup shows progress ONLY — never the card link/QR, so knowing
  // someone's number is not enough to claim their free plate.
  r.get('/api/public/lookup', lookupLimit, async (req, res) => {
    const phone = normalizePhone(req.query.phone);
    if (!phone) throw bad('INVALID_PHONE', 'Please enter a valid 10-digit mobile number');
    const s = await settings.get(db);
    const c = await db.get('SELECT name, stamps, rewards_available FROM customers WHERE phone = ?', [phone]);
    if (!c) return res.json({ found: false });
    res.json({
      found: true,
      first_name: firstName(c.name),
      stamps: Math.min(c.stamps, s.stamps_required),
      stamps_required: s.stamps_required,
      rewards_available: c.rewards_available,
    });
  });

  r.get('/api/public/card/:token', cardLimit, async (req, res) => {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, 'NOT_FOUND', 'Card not found');
    const c = await db.get(
      `SELECT id, code, name, stamps, rewards_available, total_plates, total_rewards_redeemed, blocked,
              created_at, last_visit_at FROM customers WHERE card_token = ?`,
      [token]
    );
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Card not found');
    const s = await settings.get(db);
    const history = await db.all(
      `SELECT type, plates, rewards_earned, rewards_redeemed, created_at FROM transactions
        WHERE customer_id = ? AND voided = 0 ORDER BY id DESC LIMIT 15`,
      [c.id]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      shop: settings.publicView(s),
      customer: {
        name: c.name,
        code: c.code,
        stamps: Math.min(c.stamps, s.stamps_required),
        rewards_available: c.rewards_available,
        total_plates: c.total_plates,
        total_rewards_redeemed: c.total_rewards_redeemed,
        blocked: !!c.blocked,
        member_since: c.created_at,
        last_visit_at: c.last_visit_at,
      },
      history,
      card_url: cardUrl(req, token),
    });
  });

  r.get('/qr.svg', qrLimit, async (req, res) => {
    const data = String(req.query.d || '');
    if (!data || data.length > 300) throw bad('INVALID_QR', 'Bad QR data');
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d1410', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  });

  return r;
};

module.exports.cardUrl = cardUrl;
module.exports.baseUrl = baseUrl;
