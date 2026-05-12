const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { auth } = require('../middleware/auth');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.jobId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

router.get('/job/:jobId', auth, async (req, res) => {
  try {
    const db = getDb();
    const jobs = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.jobId]);
    if (!jobs.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobs[0];
    if (job.creator_id !== req.user.id && job.brand_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await db.query('SELECT * FROM uploads WHERE job_id = $1 ORDER BY created_at DESC', [req.params.jobId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/job/:jobId', auth, upload.array('files', 20), async (req, res) => {
  try {
    const db = getDb();
    const jobs = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.jobId]);
    if (!jobs.length) return res.status(404).json({ error: 'Job not found' });
    if (jobs[0].creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const saved = [];
    for (const file of req.files) {
      const id = uuidv4();
      await db.query('INSERT INTO uploads (id, job_id, deliverable_id, creator_id, filename, original_name, mimetype, size, path, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [id, req.params.jobId, req.body.deliverable_id || null, req.user.id, file.filename, file.originalname, file.mimetype, file.size, file.path, req.body.description || null]);
      const rows = await db.query('SELECT * FROM uploads WHERE id = $1', [id]);
      saved.push(rows[0]);
    }
    res.status(201).json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:uploadId', auth, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.query('SELECT u.*, j.creator_id FROM uploads u JOIN jobs j ON u.job_id = j.id WHERE u.id = $1', [req.params.uploadId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (fs.existsSync(rows[0].path)) fs.unlinkSync(rows[0].path);
    await db.query('DELETE FROM uploads WHERE id = $1', [req.params.uploadId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/serve/:uploadId', auth, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.query('SELECT u.*, j.creator_id, j.brand_id FROM uploads u JOIN jobs j ON u.job_id = j.id WHERE u.id = $1', [req.params.uploadId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const u = rows[0];
    if (u.creator_id !== req.user.id && u.brand_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!fs.existsSync(u.path)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `inline; filename="${u.original_name}"`);
    res.sendFile(u.path);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
