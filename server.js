const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, getDb } = require('./db/schema');
const { auth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/brand', require('./routes/brands'));

app.get('/api/stats', auth, async (req, res) => {
  try {
    const db = getDb();
    const id = req.user.id;
    const q = async (sql, p) => (await db.query(sql, p))[0] || {};
    const totalJobs = parseInt((await q('SELECT COUNT(*) as c FROM jobs WHERE creator_id = $1', [id])).c || 0);
    const activeJobs = parseInt((await q("SELECT COUNT(*) as c FROM jobs WHERE creator_id = $1 AND status IN ('pending','in_progress','review')", [id])).c || 0);
    const completedJobs = parseInt((await q("SELECT COUNT(*) as c FROM jobs WHERE creator_id = $1 AND status = 'completed'", [id])).c || 0);
    const totalEarned = parseFloat((await q("SELECT COALESCE(SUM(amount),0) as s FROM invoices WHERE creator_id = $1 AND status = 'paid'", [id])).s || 0);
    const pendingPayment = parseFloat((await q("SELECT COALESCE(SUM(amount),0) as s FROM invoices WHERE creator_id = $1 AND status = 'sent'", [id])).s || 0);
    const upcomingDeadlines = await db.query("SELECT title, deadline, status FROM jobs WHERE creator_id = $1 AND deadline >= CURRENT_DATE AND status NOT IN ('completed','cancelled') ORDER BY deadline ASC LIMIT 5", [id]);
    res.json({ totalJobs, activeJobs, completedJobs, totalEarned, pendingPayment, upcomingDeadlines });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    }
  });
}

initDb().then(() => {
  app.listen(PORT, () => console.log(`✅ UGC Studio API running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
