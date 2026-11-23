'use strict';
const { HttpError } = require('./util');

function securityHeaders(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/**
 * CSRF defence for the JSON API: state-changing requests must be JSON
 * (cross-site HTML forms cannot send that without a CORS pre-flight, which we
 * never grant) and, when the browser sends an Origin, it must be ours.
 */
function sameOriginJson(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch (_) { host = null; }
    if (host !== req.headers.host) return next(new HttpError(403, 'BAD_ORIGIN', 'Cross-site request blocked'));
  }
  const ct = String(req.headers['content-type'] || '');
  const hasBody = req.method !== 'DELETE' || Number(req.headers['content-length'] || 0) > 0;
  if (hasBody && !ct.startsWith('application/json')) {
    return next(new HttpError(415, 'JSON_REQUIRED', 'Content-Type must be application/json'));
  }
  next();
}

/**
 * Small in-memory fixed-window rate limiter (fine for a single server; put a
 * shared store behind it if you ever run several instances).
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests, please wait a bit' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, Math.min(windowMs, 60000));
  timer.unref();
  const mw = (req, res, next) => {
    const k = key(req);
    const t = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= t) { e = { count: 0, reset: t + windowMs }; hits.set(k, e); }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - t) / 1000));
      return next(new HttpError(429, 'RATE_LIMITED', message));
    }
    next();
  };
  mw.reset = (k) => hits.delete(k);
  return mw;
}

module.exports = { securityHeaders, sameOriginJson, rateLimit };
