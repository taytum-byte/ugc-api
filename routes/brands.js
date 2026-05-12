const express = require('express');
const { getDb } = require('../db/schema');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', auth, requireRole('brand'), async (req, res) => {
  try {
    const db = getDb();
    const id = req.user.id;
    const q = async (sql, p) => (await db.query(sql, p))[0] || {};
    const totalJobs = parseInt((await q('SELECT COUNT(*) as c FROM jobs WHERE brand_id = $1', [id])).c || 0);
    const activeJobs = parseInt((await q("SELECT COUNT(*) as c FROM jobs WHERE brand_id = $1 AND status IN ('pending','in_progress','review')", [id])).c || 0);
    const completedJobs = parseInt((await q("SELECT COUNT(*) as c FROM jobs WHERE brand_id = $1 AND status = 'completed'", [id])).c || 0);
    const totalSpend = parseFloat((await q("SELECT COALESCE(SUM(amount),0) as s FROM invoices WHERE brand_id = $1 AND status = 'paid'", [id])).s || 0);
    const pendingInvoices = parseInt((await q("SELECT COUNT(*) as c FROM invoices WHERE brand_id = $1 AND status = 'sent'", [id])).c || 0);
    const totalUploads = parseInt((await q('SELECT COUNT(*) as c FROM uploads u JOIN jobs j ON u.job_id = j.id WHERE j.brand_id = $1', [id])).c || 0);
    res.json({ totalJobs, activeJobs, completedJobs, totalSpend, pendingInvoices, totalUploads });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs', auth, requireRole('brand'), async (req, res) => {
  try {
    const db = getDb();
    const jobs = await db.query('SELECT j.*, u.name as creator_name, u.email as creator_email FROM jobs j JOIN users u ON j.creator_id = u.id WHERE j.brand_id = $1 ORDER BY j.created_at DESC', [req.user.id]);
    for (const job of jobs) {
      job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1', [job.id]);
      job.uploads = await db.query('SELECT id, original_name, mimetype, size, description, created_at FROM uploads WHERE job_id = $1', [job.id]);
      job.invoices = await db.query('SELECT * FROM invoices WHERE job_id = $1 AND brand_id = $2', [job.id, req.user.id]);
    }
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id', auth, requireRole('brand'), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.query('SELECT j.*, u.name as creator_name, u.email as creator_email FROM jobs j JOIN users u ON j.creator_id = u.id WHERE j.id = $1 AND j.brand_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = rows[0];
    job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1', [job.id]);
    job.uploads = await db.query('SELECT * FROM uploads WHERE job_id = $1', [job.id]);
    job.invoices = await db.query('SELECT * FROM invoices WHERE job_id = $1 AND brand_id = $2', [job.id, req.user.id]);
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/creators', auth, requireRole('brand'), async (req, res) => {
  try {
    const db = getDb();
    const creators = await db.query('SELECT DISTINCT u.id, u.name, u.email, u.created_at FROM users u JOIN jobs j ON j.creator_id = u.id WHERE j.brand_id = $1', [req.user.id]);
    for (const c of creators) {
      const s = (await db.query('SELECT COUNT(*) as total, SUM(CASE WHEN status=\'completed\' THEN 1 ELSE 0 END) as completed, SUM(budget) as budget FROM jobs WHERE creator_id = $1 AND brand_id = $2', [c.id, req.user.id]))[0] || {};
      c.total_jobs = parseInt(s.total || 0); c.completed_jobs = parseInt(s.completed || 0); c.total_budget = parseFloat(s.budget || 0);
    }
    res.json(creators);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/invoices', auth, requireRole('brand'), async (req, res) => {
  try {
    const db = getDb();
    res.json(await db.query('SELECT i.*, j.title as job_title, u.name as creator_name, u.email as creator_email FROM invoices i JOIN jobs j ON i.job_id = j.id JOIN users u ON i.creator_id = u.id WHERE i.brand_id = $1 ORDER BY i.created_at DESC', [req.user.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
