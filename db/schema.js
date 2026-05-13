const { Pool } = require('pg');

let pool;

function getDb() {
  if (!pool) throw new Error('DB not initialized. Call initDb() first.');
  return pool;
}

// Postgres-compatible wrapper that mimics the synchronous sql.js API
// using async under the hood but exposed synchronously via a queue
function makeDb(pgPool) {
  return {
    _pool: pgPool,

    prepare(sql) {
      // Convert ? placeholders to $1, $2... for postgres
      const pgSql = sql.replace(/\?/g, (_, i) => {
        // count how many ? have appeared so far
        return '?'; // we'll convert at call time
      });

      const convertPlaceholders = (s) => {
        let i = 0;
        return s.replace(/\?/g, () => `$${++i}`);
      };

      return {
        _sql: sql,
        run(...params) {
          // Fire and forget for writes — we store a promise on the pool
          const converted = convertPlaceholders(sql);
          pgPool.query(converted, params.map(p => p === undefined ? null : p))
            .catch(err => console.error('DB run error:', err.message, '\nSQL:', converted, '\nParams:', params));
          return { changes: 1 };
        },
        async runAsync(...params) {
          const converted = convertPlaceholders(sql);
          await pgPool.query(converted, params.map(p => p === undefined ? null : p));
          return { changes: 1 };
        },
        get(...params) {
          // Synchronous is not possible with pg — we throw and use getAsync
          throw new Error('Use getAsync() with Postgres');
        },
        async getAsync(...params) {
          const converted = convertPlaceholders(sql);
          const result = await pgPool.query(converted, params.map(p => p === undefined ? null : p));
          return result.rows[0] || undefined;
        },
        all(...params) {
          throw new Error('Use allAsync() with Postgres');
        },
        async allAsync(...params) {
          const converted = convertPlaceholders(sql);
          const result = await pgPool.query(converted, params.map(p => p === undefined ? null : p));
          return result.rows;
        }
      };
    },

    async query(sql, params = []) {
      const convertPlaceholders = (s) => {
        let i = 0;
        return s.replace(/\?/g, () => `$${++i}`);
      };
      const result = await pgPool.query(convertPlaceholders(sql), params);
      return result.rows;
    },

    async exec(sql) {
      await pgPool.query(sql);
    }
  };
}

async function initDb() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const db = makeDb(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      company TEXT,
      avatar TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      brand_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      recurrence TEXT,
      recurrence_day INTEGER,
      times_per_month INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      budget NUMERIC DEFAULT 0,
      has_budget INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'AUD',
      deadline TEXT,
      start_date TEXT,
      end_date TEXT,
      invoice_sent INTEGER DEFAULT 0,
      invoice_paid INTEGER DEFAULT 0,
      repeat_count INTEGER,
      contract_term TEXT,
      color TEXT DEFAULT '#ff1a6e',
      content_types TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      completed INTEGER DEFAULT 0,
      completed_at TIMESTAMPTZ,
      flexible_due INTEGER DEFAULT 0,
      due_month TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      deliverable_id TEXT,
      creator_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT,
      size INTEGER,
      path TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      brand_id TEXT,
      invoice_number TEXT UNIQUE NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT DEFAULT 'AUD',
      status TEXT DEFAULT 'draft',
      due_date TEXT,
      paid_at TIMESTAMPTZ,
      notes TEXT,
      pdf_path TEXT,
      share_token TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
await pool.query(`
  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
  console.log('✅ Database tables ready');
  return db;
}

module.exports = { initDb, getDb: () => makeDb(pool) };
