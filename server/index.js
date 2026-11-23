'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);

(async () => {
  const { app, db } = await createApp();
  const server = app.listen(PORT, () => {
    console.log(`Momo Rewards running on http://localhost:${PORT}`);
    console.log(`  Customers:     http://localhost:${PORT}/`);
    console.log(`  Owner / staff: http://localhost:${PORT}/admin`);
    console.log(`  Database:      ${db.dialect === 'pg' ? 'PostgreSQL (DATABASE_URL)' : db.file}`);
  });
  const shutdown = async (sig) => {
    console.log(`${sig} received, shutting down…`);
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
