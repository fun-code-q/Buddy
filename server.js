/* Local dev server for Buddy AI */
const path = require('path');
const express = require('express');
const cors = require('cors');
try { require('dotenv').config(); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files (index.html etc.) from this directory
app.use(express.static(__dirname));

// Wire serverless handler for local use
const buddyHandler = require('./api/buddy.js');

app.options('/api/buddy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).send('');
});

app.post('/api/buddy', (req, res) => buddyHandler(req, res));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Buddy AI local server running at http://localhost:${PORT}`);
});


