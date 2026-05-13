const express = require('express');
const { getDb } = require('../db/schema');
const router = express.Router();

// Simple admin key auth
const ADMIN_KEY = process.env.ADMIN_KEY || 'drew2026admin';

const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Get all stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const [users, jobs, suggestions] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM jobs'),
      db.query('SELECT COUNT(*) as count FROM suggestions'),
    ]);
    res.json({
      users: parseInt(users[0].count),
      jobs: parseInt(jobs[0].count),
      suggestions: parseInt(suggestions[0].count),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const users = await db.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all suggestions
router.get('/suggestions', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const suggestions = await db.query(`
      SELECT s.*, u.name as user_name, u.email as user_email
      FROM suggestions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);
    res.json(suggestions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
