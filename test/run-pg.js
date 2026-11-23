'use strict';
// Runs the same API test-suite against a throw-away local PostgreSQL.
// Usage: npm run test:pg   (needs the dev dependency "embedded-postgres")
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The project's .npmrc disables install scripts (safer, and avoids native
// compiles). embedded-postgres needs one small post-install step: run it here.
function hydrateEmbeddedPostgres() {
  const dir = path.join(__dirname, '..', 'node_modules', '@embedded-postgres', `${process.platform}-${process.arch}`);
  const script = path.join(dir, 'scripts', 'hydrate-symlinks.js');
  if (fs.existsSync(script)) spawnSync(process.execPath, [script], { cwd: dir, stdio: 'ignore' });
}

(async () => {
  hydrateEmbeddedPostgres();
  const EmbeddedPostgres = require('embedded-postgres').default;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'momo-pg-'));
  fs.chmodSync(parent, 0o777); // embedded-postgres drops to a 'postgres' user when run as root
  const dir = path.join(parent, 'data');
  const port = 54329;
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'momo', password: 'momo', port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('momo_test');
  const url = `postgres://momo:momo@localhost:${port}/momo_test`;
  const r = spawnSync(process.execPath, ['--test', path.join(__dirname, 'api.test.js')], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url },
  });
  await pg.stop();
  fs.rmSync(parent, { recursive: true, force: true });
  process.exit(r.status ?? 1);
})().catch((e) => { console.error(e); process.exit(1); });
