'use strict';
const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const auth = require('./auth');
const settings = require('./settings');
const { securityHeaders, sameOriginJson } = require('./security');
const { HttpError } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

async function createApp(opts = {}) {
  const db = opts.db || (await openDb(opts));
  await settings.load(db);

  const app = express();
  app.disable('x-powered-by');
  // Behind Render / Railway / nginx the real client IP + https come from the proxy.
  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

  app.use(securityHeaders);
  app.get('/healthz', async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true });
  });

  app.use('/api/admin/import', express.json({ limit: '60mb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', sameOriginJson);
  app.use(auth.authMiddleware(db));

  app.use(require('./routes/public')(db));
  app.use(require('./routes/admin')(db));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Unknown API route')));

  // Front-end
  app.get('/vendor/jsQR.js', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(require.resolve('jsqr/dist/jsQR.js'));
  });
  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (/sw\.js$|\.html$|\.webmanifest$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }));
  app.get(['/admin', '/admin/{*rest}'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
  app.get('/poster', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'poster.html')));
  app.get(['/c/:token', '/join'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // Errors
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'BAD_JSON', 'Malformed JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'TOO_LARGE', 'Request too large');
    const status = err.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (!req.originalUrl.startsWith('/api') && status === 404) {
      return res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
    }
    res.status(status).json({
      error: { code: err.code || 'SERVER_ERROR', message: status >= 500 ? 'Something went wrong. Please try again.' : err.message, ...(err.extra || {}) },
    });
  });

  return { app, db };
}

module.exports = { createApp };
