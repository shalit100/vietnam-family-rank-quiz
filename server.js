const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;
const DATA = path.join(__dirname, 'data');
const VOTES = path.join(DATA, 'votes.json');
const CITIES = {
  hanoi: path.join(DATA, 'hanoi.json'),
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let memoryVotes = null;

function readVotes() {
  if (memoryVotes) return JSON.parse(JSON.stringify(memoryVotes));
  try {
    memoryVotes = JSON.parse(fs.readFileSync(VOTES, 'utf8'));
    return JSON.parse(JSON.stringify(memoryVotes));
  } catch {
    memoryVotes = { tripId: 'vietnam-2026', voters: { rony: {}, keren: {} }, updatedAt: null };
    return JSON.parse(JSON.stringify(memoryVotes));
  }
}

function writeVotes(v) {
  v.updatedAt = new Date().toISOString();
  memoryVotes = v;
  try {
    fs.writeFileSync(VOTES, JSON.stringify(v, null, 2));
  } catch (_) {
    // serverless / read-only FS — keep memory for warm instance
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/cities', (_req, res) => {
  res.json([
    { id: 'hanoi', name: 'Hanoi', status: 'live', dates: '14–16 Dec 2026' },
    { id: 'ninh-binh', name: 'Ninh Binh / Tam Coc', status: 'soon', dates: '16–19 Dec' },
    { id: 'ha-long', name: 'Ha Long (Celina)', status: 'soon', dates: '19–20 Dec' },
    { id: 'hoi-an', name: 'Hoi An', status: 'soon', dates: '20–25 Dec' },
    { id: 'da-nang', name: 'Da Nang', status: 'soon', dates: '25–27 Dec' },
    { id: 'phu-quoc', name: 'Phu Quoc', status: 'soon', dates: '27 Dec–1 Jan' },
  ]);
});

app.get('/api/city/:id', (req, res) => {
  const file = CITIES[req.params.id];
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'City not ready yet' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.get('/api/votes', (_req, res) => res.json(readVotes()));

app.post('/api/votes', (req, res) => {
  const body = req.body || {};
  const voter = body.voter;
  const attractionId = body.attractionId || body.id;
  const rank = body.rank;
  const cityId = body.cityId || body.city || 'hanoi';
  if (!['rony', 'keren'].includes(voter)) return res.status(400).json({ error: 'voter must be rony|keren' });
  if (!attractionId) return res.status(400).json({ error: 'attractionId required' });
  if (!['must', 'possible', 'pass', null].includes(rank)) return res.status(400).json({ error: 'bad rank' });
  const votes = readVotes();
  if (!votes.voters[voter]) votes.voters[voter] = {};
  const key = `${cityId}::${attractionId}`;
  if (rank === null) delete votes.voters[voter][key];
  else votes.voters[voter][key] = { rank, at: new Date().toISOString() };
  writeVotes(votes);
  res.json(votes);
});

app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!fs.existsSync(VOTES)) writeVotes({ tripId: 'vietnam-2026', voters: { rony: {}, keren: {} }, updatedAt: null });

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Hanoi quiz on http://0.0.0.0:${PORT}`));
}

module.exports = app;
