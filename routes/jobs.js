const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function generateOccurrences(job) {
  const { start_date, recurrence_day, times_per_month, recurrence, repeat_count, contract_term } = job;
  if (!start_date) return [];
  const occurrences = [];
  const isIndefinite = contract_term === 'Ongoing' || !repeat_count;
  const maxOccurrences = isIndefinite ? (times_per_month ? times_per_month * 24 : 24) : parseInt(repeat_count);

  if (recurrence === 'weekly' && recurrence_day !== null && recurrence_day !== undefined) {
    const dayOfWeek = parseInt(recurrence_day);
    let current = new Date(start_date);
    while (current.getDay() !== dayOfWeek) current.setDate(current.getDate() + 1);
    for (let i = 0; i < maxOccurrences; i++) {
      occurrences.push(new Date(current).toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }
  } else if (recurrence === 'monthly' && times_per_month) {
    const count = parseInt(times_per_month);
    let monthStart = new Date(new Date(start_date).getFullYear(), new Date(start_date).getMonth(), 1);
    const totalMonths = isIndefinite ? 24 : Math.ceil(maxOccurrences / count);
    for (let m = 0; m < totalMonths; m++) {
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      for (let t = 0; t < count; t++) {
        const day = Math.round((t / count) * daysInMonth) + 1;
        occurrences.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, daysInMonth)).toISOString().split('T')[0]);
      }
      monthStart.setMonth(monthStart.getMonth() + 1);
    }
  } else if (recurrence === 'weekly') {
    let current = new Date(start_date);
    for (let i = 0; i < maxOccurrences; i++) {
      occurrences.push(new Date(current).toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }
  } else if (recurrence === 'monthly') {
    let current = new Date(start_date);
    for (let i = 0; i < maxOccurrences; i++) {
      occurrences.push(new Date(current).toISOString().split('T')[0]);
      current.setMonth(current.getMonth() + 1);
    }
  }
  return occurrences;
}

router.get('/calendar/events', auth, async (req, res) => {
  try {
    const db = getDb();
    const jobs = await db.query(`
      SELECT j.id, j.title, j.status, j.type, j.budget, j.has_budget,
             j.deadline, j.start_date, j.end_date, j.recurrence, j.recurrence_day,
             j.times_per_month, j.repeat_count, j.contract_term, j.color, j.content_types
      FROM jobs j WHERE j.creator_id = $1`, [req.user.id]);

    const deliverables = await db.query(`
      SELECT d.*, j.title as job_title, j.color as job_color
      FROM deliverables d JOIN jobs j ON d.job_id = j.id
      WHERE j.creator_id = $1 AND d.completed = 0`, [req.user.id]);

    const calendarEvents = [];
    for (const job of jobs) {
      if (job.type === 'recurring') {
        const dates = generateOccurrences(job);
        dates.forEach((date, i) => calendarEvents.push({
          ...job, deadline: date, _occurrence_index: i + 1,
          _total_occurrences: dates.length, _is_occurrence: true
        }));
      } else {
        calendarEvents.push(job);
      }
    }
    res.json({ jobs: calendarEvents, deliverables, rawJobs: jobs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const { status, type } = req.query;
    let q = `SELECT j.*, u.name as brand_name, u.company as brand_company
             FROM jobs j LEFT JOIN users u ON j.brand_id = u.id
             WHERE j.creator_id = $1`;
    const params = [req.user.id];
    if (status) { q += ` AND j.status = $${params.length+1}`; params.push(status); }
    if (type) { q += ` AND j.type = $${params.length+1}`; params.push(type); }
    q += ' ORDER BY j.created_at DESC';
    const jobs = await db.query(q, params);
    const today = new Date().toISOString().split('T')[0];
    for (const job of jobs) {
      job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1 ORDER BY created_at ASC', [job.id]);
      const uc = await db.query('SELECT COUNT(*) as c FROM uploads WHERE job_id = $1', [job.id]);
      job.uploads_count = parseInt(uc[0]?.c || 0);
      if (job.type === 'recurring') {
        const occs = generateOccurrences(job);
        job.next_occurrence = occs.find(d => d >= today) || null;
        job.total_occurrences = occs.length;
      }
    }
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.query(`
      SELECT j.*, u.name as brand_name, u.email as brand_email, u.company as brand_company
      FROM jobs j LEFT JOIN users u ON j.brand_id = u.id
      WHERE j.id = $1 AND (j.creator_id = $2 OR j.brand_id = $2)`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = rows[0];
    job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1 ORDER BY created_at ASC', [job.id]);
    job.uploads = await db.query('SELECT * FROM uploads WHERE job_id = $1 ORDER BY created_at DESC', [job.id]);
    job.invoices = await db.query('SELECT * FROM invoices WHERE job_id = $1 ORDER BY created_at DESC', [job.id]);
    if (job.type === 'recurring') {
      job.occurrences = generateOccurrences(job);
      job.next_occurrence = job.occurrences.find(d => d >= new Date().toISOString().split('T')[0]) || null;
    }
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, requireRole('creator'), async (req, res) => {
  try {
    const db = getDb();
    const { title, description, type, recurrence, recurrence_day, times_per_month, budget, has_budget,
      currency, deadline, start_date, brand_id, notes, deliverables, repeat_count, contract_term, color, content_types } = req.body;
    if (!title || !type) return res.status(400).json({ error: 'title and type are required' });

    let resolvedEndDate = null;
    if (start_date && repeat_count && recurrence && contract_term !== 'Ongoing') {
      const occs = generateOccurrences({ start_date, recurrence, recurrence_day, times_per_month, repeat_count, contract_term });
      if (occs.length) resolvedEndDate = occs[occs.length - 1];
    }

    const id = uuidv4();
    await db.query(`
      INSERT INTO jobs (id, creator_id, brand_id, title, description, type, recurrence,
        recurrence_day, times_per_month, budget, has_budget, currency, deadline,
        start_date, end_date, notes, repeat_count, contract_term, color, content_types)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, req.user.id, brand_id || null, title, description || null, type,
       recurrence || null, recurrence_day !== undefined ? recurrence_day : null,
       times_per_month ? parseInt(times_per_month) : null,
       has_budget ? (parseFloat(budget) || 0) : 0, has_budget ? 1 : 0,
       currency || 'AUD', deadline || null, start_date || null, resolvedEndDate,
       notes || null, repeat_count ? parseInt(repeat_count) : null,
       contract_term || null, color || '#ff1a6e',
       content_types ? JSON.stringify(content_types) : null]);

    if (deliverables && Array.isArray(deliverables)) {
      for (const d of deliverables) {
        await db.query('INSERT INTO deliverables (id, job_id, title, description, due_date, flexible_due, due_month) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uuidv4(), id, d.title, d.description || null, d.due_date || null, d.flexible_due ? 1 : 0, d.due_month || null]);
      }
    }

    const rows = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
    const job = rows[0];
    job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1', [id]);
    if (job.type === 'recurring') {
      job.occurrences = generateOccurrences(job);
      job.next_occurrence = job.occurrences.find(d => d >= new Date().toISOString().split('T')[0]) || null;
      job.total_occurrences = job.occurrences.length;
    }
    res.status(201).json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const existing = await db.query('SELECT * FROM jobs WHERE id = $1 AND creator_id = $2', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'Job not found' });
    const fields = ['title','description','type','recurrence','recurrence_day','times_per_month',
      'status','budget','has_budget','currency','deadline','start_date','end_date',
      'brand_id','notes','repeat_count','contract_term','color','content_types'];
    const updates = []; const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${values.length + 1}`);
        values.push(f === 'content_types' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (updates.length) {
      updates.push(`updated_at = NOW()`);
      values.push(req.params.id);
      await db.query(`UPDATE jobs SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    }
    const rows = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    const job = rows[0];
    job.deliverables = await db.query('SELECT * FROM deliverables WHERE job_id = $1', [req.params.id]);
    if (job.type === 'recurring') {
      job.occurrences = generateOccurrences(job);
      job.next_occurrence = job.occurrences.find(d => d >= new Date().toISOString().split('T')[0]) || null;
      job.total_occurrences = job.occurrences.length;
    }
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, requireRole('creator'), async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.query('SELECT * FROM jobs WHERE id = $1 AND creator_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    await db.query('DELETE FROM deliverables WHERE job_id = $1', [req.params.id]);
    await db.query('DELETE FROM uploads WHERE job_id = $1', [req.params.id]);
    await db.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/deliverables', auth, async (req, res) => {
  try {
    const db = getDb();
    const { title, description, due_date, flexible_due, due_month } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    await db.query('INSERT INTO deliverables (id, job_id, title, description, due_date, flexible_due, due_month) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, req.params.id, title, description || null, due_date || null, flexible_due ? 1 : 0, due_month || null]);
    const rows = await db.query('SELECT * FROM deliverables WHERE id = $1', [id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:jobId/deliverables/:delId', auth, async (req, res) => {
  try {
    const db = getDb();
    const { completed, title, description, due_date, flexible_due, due_month } = req.body;
    const updates = []; const values = [];
    if (title !== undefined) { updates.push(`title = $${values.length+1}`); values.push(title); }
    if (description !== undefined) { updates.push(`description = $${values.length+1}`); values.push(description); }
    if (due_date !== undefined) { updates.push(`due_date = $${values.length+1}`); values.push(due_date); }
    if (flexible_due !== undefined) { updates.push(`flexible_due = $${values.length+1}`); values.push(flexible_due ? 1 : 0); }
    if (due_month !== undefined) { updates.push(`due_month = $${values.length+1}`); values.push(due_month); }
    if (completed !== undefined) {
      updates.push(`completed = $${values.length+1}`); values.push(completed ? 1 : 0);
      updates.push(`completed_at = $${values.length+1}`); values.push(completed ? new Date().toISOString() : null);
    }
    if (updates.length) {
      values.push(req.params.delId);
      await db.query(`UPDATE deliverables SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    }
    const rows = await db.query('SELECT * FROM deliverables WHERE id = $1', [req.params.delId]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:jobId/deliverables/:delId', auth, async (req, res) => {
  try {
    const db = getDb();
    await db.query('DELETE FROM deliverables WHERE id = $1', [req.params.delId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
