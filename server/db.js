'use strict';
/**
 * Database layer.
 *  - SQLite (default, zero-config): a single file at DATA_DIR/momo.db
 *  - PostgreSQL: set DATABASE_URL (e.g. a free Neon / Supabase / Render database)
 *
 * All SQL in the app is written once with `?` placeholders and runs on both.
 * Every method is async so callers don't care which engine is underneath.
 */
const fs = require('fs');
const path = require('path');

const PK_SQLITE = 'INTEGER PRIMARY KEY AUTOINCREMENT';
const PK_PG = 'BIGSERIAL PRIMARY KEY';

// Schema migrations. Append new entries; never edit an old one once shipped.
const MIGRATIONS = [
  // v1 — initial schema
  (pk) => [
    `CREATE TABLE IF NOT EXISTS settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS staff (
       id            ${pk},
       name          TEXT NOT NULL,
       username      TEXT NOT NULL UNIQUE,
       role          TEXT NOT NULL,
       secret_hash   TEXT NOT NULL,
       active        INTEGER NOT NULL DEFAULT 1,
       created_at    BIGINT NOT NULL,
       last_login_at BIGINT
     )`,
    `CREATE TABLE IF NOT EXISTS sessions (
       token_hash TEXT PRIMARY KEY,
       staff_id   BIGINT NOT NULL REFERENCES staff(id),
       created_at BIGINT NOT NULL,
       expires_at BIGINT NOT NULL,
       user_agent TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS customers (
       id                     ${pk},
       code                   TEXT NOT NULL UNIQUE,
       card_token             TEXT NOT NULL UNIQUE,
       phone                  TEXT NOT NULL UNIQUE,
       name                   TEXT NOT NULL,
       stamps                 INTEGER NOT NULL DEFAULT 0,
       rewards_available      INTEGER NOT NULL DEFAULT 0,
       total_plates           INTEGER NOT NULL DEFAULT 0,
       total_rewards_earned   INTEGER NOT NULL DEFAULT 0,
       total_rewards_redeemed INTEGER NOT NULL DEFAULT 0,
       visits                 INTEGER NOT NULL DEFAULT 0,
       blocked                INTEGER NOT NULL DEFAULT 0,
       notes                  TEXT,
       source                 TEXT,
       created_at             BIGINT NOT NULL,
       last_visit_at          BIGINT
     )`,
    `CREATE TABLE IF NOT EXISTS transactions (
       id               ${pk},
       customer_id      BIGINT NOT NULL REFERENCES customers(id),
       staff_id         BIGINT,
       staff_name       TEXT,
       type             TEXT NOT NULL,
       plates           INTEGER NOT NULL DEFAULT 0,
       rewards_earned   INTEGER NOT NULL DEFAULT 0,
       rewards_redeemed INTEGER NOT NULL DEFAULT 0,
       stamps_before    INTEGER NOT NULL,
       stamps_after     INTEGER NOT NULL,
       rewards_before   INTEGER NOT NULL,
       rewards_after    INTEGER NOT NULL,
       verified         INTEGER NOT NULL DEFAULT 0,
       note             TEXT,
       voided           INTEGER NOT NULL DEFAULT 0,
       voided_by_name   TEXT,
       voided_at        BIGINT,
       created_at       BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_tx_customer ON transactions(customer_id, id)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_cust_last_visit ON customers(last_visit_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id)`,
  ],
];

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/* ---------------- SQLite ---------------- */
class SqliteDb {
  constructor(file) {
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.raw = new Database(file);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('busy_timeout = 5000');
    this.raw.pragma('synchronous = NORMAL');
    this.dialect = 'sqlite';
    this.forUpdate = '';
    this._stmts = new Map();
    this._chain = Promise.resolve();
  }
  _stmt(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.raw.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }
  // Serialise every operation so an open transaction is never interleaved
  // with another request's statements (Node awaits inside a transaction).
  _lock(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(() => {}, () => {});
    return run;
  }
  _direct() {
    return {
      dialect: this.dialect,
      forUpdate: this.forUpdate,
      all: async (sql, p = []) => this._stmt(sql).all(...p),
      get: async (sql, p = []) => this._stmt(sql).get(...p),
      run: async (sql, p = []) => { const r = this._stmt(sql).run(...p); return { changes: r.changes }; },
    };
  }
  all(sql, p) { return this._lock(() => this._direct().all(sql, p)); }
  get(sql, p) { return this._lock(() => this._direct().get(sql, p)); }
  run(sql, p) { return this._lock(() => this._direct().run(sql, p)); }
  tx(fn) {
    return this._lock(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this._direct());
        this.raw.exec('COMMIT');
        return out;
      } catch (e) {
        if (this.raw.inTransaction) this.raw.exec('ROLLBACK');
        throw e;
      }
    });
  }
  async exec(sql) { return this._lock(() => this.raw.exec(sql)); }
  async resetSequence() { /* AUTOINCREMENT follows MAX(id) automatically */ }
  async close() { this.raw.close(); }
}

/* ---------------- PostgreSQL ---------------- */
class PgDb {
  constructor(url) {
    const pg = require('pg');
    // BIGINT / COUNT(*) / SUM() come back as strings by default — make them numbers.
    pg.types.setTypeParser(20, (v) => parseInt(v, 10));
    pg.types.setTypeParser(1700, (v) => parseFloat(v));
    const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
    this.pool = new pg.Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_SIZE || 10),
      idleTimeoutMillis: 30000,
    });
    this.dialect = 'pg';
    this.forUpdate = ' FOR UPDATE';
  }
  _wrap(q) {
    return {
      dialect: this.dialect,
      forUpdate: this.forUpdate,
      all: async (sql, p = []) => (await q.query(toPg(sql), p)).rows,
      get: async (sql, p = []) => (await q.query(toPg(sql), p)).rows[0],
      run: async (sql, p = []) => ({ changes: (await q.query(toPg(sql), p)).rowCount }),
    };
  }
  all(sql, p) { return this._wrap(this.pool).all(sql, p); }
  get(sql, p) { return this._wrap(this.pool).get(sql, p); }
  run(sql, p) { return this._wrap(this.pool).run(sql, p); }
  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(this._wrap(client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }
  async exec(sql) { await this.pool.query(sql); }
  async resetSequence(t, table) {
    await t.run(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
  }
  async close() { await this.pool.end(); }
}

async function migrate(db) {
  const pk = db.dialect === 'pg' ? PK_PG : PK_SQLITE;
  await db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = await db.get("SELECT value FROM settings WHERE key = 'schema_version'");
  let version = row ? Number(row.value) : 0;
  for (let v = version; v < MIGRATIONS.length; v++) {
    await db.tx(async (t) => {
      for (const stmt of MIGRATIONS[v](pk)) await t.run(stmt);
      await t.run(
        "INSERT INTO settings(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(v + 1)]
      );
    });
    version = v + 1;
  }
  return version;
}

async function openDb(opts = {}) {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  let db;
  if (url) {
    db = new PgDb(url);
  } else {
    const dir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    db = new SqliteDb(path.join(dir, 'momo.db'));
  }
  await migrate(db);
  return db;
}

module.exports = { openDb };
