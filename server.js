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
let votesSha = null;
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GH_REPO = process.env.VOTES_GITHUB_REPO || 'shalit100/vietnam-family-rank-quiz';
const GH_PATH = process.env.VOTES_GITHUB_PATH || 'data/votes.json';

function emptyVotes() {
  return { tripId: 'vietnam-2026', voters: { rony: {}, keren: {} }, updatedAt: null };
}

async function readVotes() {
  if (GH_TOKEN) {
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`, {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vietnam-family-rank-quiz',
        },
      });
      if (res.ok) {
        const body = await res.json();
        votesSha = body.sha;
        const parsed = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        memoryVotes = parsed;
        return JSON.parse(JSON.stringify(parsed));
      }
    } catch (err) {
      console.error('github readVotes failed', err);
    }
  }
  if (memoryVotes) return JSON.parse(JSON.stringify(memoryVotes));
  try {
    memoryVotes = JSON.parse(fs.readFileSync(VOTES, 'utf8'));
    return JSON.parse(JSON.stringify(memoryVotes));
  } catch {
    memoryVotes = emptyVotes();
    return JSON.parse(JSON.stringify(memoryVotes));
  }
}

async function writeVotes(v) {
  v.updatedAt = new Date().toISOString();
  memoryVotes = v;
  try {
    fs.writeFileSync(VOTES, JSON.stringify(v, null, 2));
  } catch (_) {}
  if (!GH_TOKEN) return;
  try {
    const content = Buffer.from(JSON.stringify(v, null, 2)).toString('base64');
    const payload = {
      message: `chore: sync family votes ${v.updatedAt}`,
      content,
      branch: 'main',
    };
    if (votesSha) payload.sha = votesSha;
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vietnam-family-rank-quiz',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body = await res.json();
      votesSha = body.content && body.content.sha;
    } else {
      const text = await res.text();
      console.error('github writeVotes failed', res.status, text);
      // retry once without stale sha
      if (res.status === 409) {
        votesSha = null;
      }
    }
  } catch (err) {
    console.error('github writeVotes error', err);
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

app.get('/api/votes', async (_req, res) => res.json(await readVotes()));

app.post('/api/votes', async (req, res) => {
  const body = req.body || {};
  const voter = body.voter;
  const attractionId = body.attractionId || body.id;
  const rank = body.rank;
  const cityId = body.cityId || body.city || 'hanoi';
  if (!['rony', 'keren'].includes(voter)) return res.status(400).json({ error: 'voter must be rony|keren' });
  if (!attractionId) return res.status(400).json({ error: 'attractionId required' });
  if (!['must', 'possible', 'pass', null].includes(rank)) return res.status(400).json({ error: 'bad rank' });
  const votes = await readVotes();
  if (!votes.voters[voter]) votes.voters[voter] = {};
  const key = `${cityId}::${attractionId}`;
  if (rank === null) delete votes.voters[voter][key];
  else votes.voters[voter][key] = { rank, at: new Date().toISOString() };
  await writeVotes(votes);
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
