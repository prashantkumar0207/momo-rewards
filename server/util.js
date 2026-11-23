'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (code, msg, extra) => new HttpError(400, code, msg, extra);

const now = () => Date.now();

// Unambiguous characters for codes people read out loud (no 0/O, 1/I/L).
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
// Codes always mix letters and digits so they can't be confused with a
// phone number or a name when typed into the counter search box.
function randomCode(len = 6) {
  for (;;) {
    const bytes = crypto.randomBytes(len);
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (/\d/.test(s) && /[A-Z]/.test(s)) return s;
  }
}
const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Normalise an Indian mobile number to its 10 digits.
 * Accepts "+91 98765 43210", "098765-43210", "9876543210" …
 */
function normalizePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return d;
}

function cleanName(input) {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 1 || s.length > 60) return null;
  return s;
}

function cleanText(input, max = 200) {
  if (input === undefined || input === null) return null;
  const s = String(input).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : null;
}

function int(v, { min = -Infinity, max = Infinity, def } = {}) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

const firstName = (name) => String(name || '').split(' ')[0];

const maskPhone = (p) => (p ? `${p.slice(0, 2)}******${p.slice(-2)}` : '');

/** Escape a value for CSV, also neutralising spreadsheet formula injection. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
const toCsv = (header, rows) =>
  '﻿' + [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';

module.exports = {
  HttpError, bad, now, randomCode, randomToken, sha256,
  normalizePhone, cleanName, cleanText, int, firstName, maskPhone, toCsv,
};
