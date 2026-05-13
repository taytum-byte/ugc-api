const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Submit suggestion
router.post('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const { category, title, description } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Title and description required' });

    await db.query(
      'INSERT INTO suggestions (id, user_id, category, title, description) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), req.user.id, category || 'other', title, description]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all suggestions (admin view)
router.get('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const suggestions = await db.query(`
      SELECT s.*, u.name, u.email 
      FROM suggestions s 
      JOIN users u ON s.user_id = u.id 
      ORDER BY s.created_at DESC
    `);
    res.json(suggestions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
