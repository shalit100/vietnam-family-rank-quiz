const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;
const DATA = path.join(__dirname, 'data');
const VOTES = path.join(DATA, 'votes.json');
const CATALOG = path.join(DATA, 'cities.json');

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

function listCityIds() {
  return fs
    .readdirSync(DATA)
    .filter((f) => f.endsWith('.json') && !['votes.json', 'cities.json'].includes(f))
    .map((f) => f.replace(/\.json$/, ''));
}

function loadCity(id) {
  const file = path.join(DATA, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCatalog() {
  if (fs.existsSync(CATALOG)) return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return listCityIds().map((id, i) => {
    const c = loadCity(id);
    return {
      id,
      name: c?.cityName || id,
      shortName: c?.cityName || id,
      dates: c?.dates || '',
      hotelName: c?.hotel?.name || '',
      region: 'vietnam',
      status: 'live',
      mapX: 50,
      mapY: 12 + i * 14,
    };
  });
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
    const payload = { message: `chore: sync family votes ${v.updatedAt}`, content, branch: 'main' };
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
      if (res.status === 409) votesSha = null;
    }
  } catch (err) {
    console.error('github writeVotes error', err);
  }
}

function countCityVotes(votes, voter, cityId) {
  const bag = votes.voters?.[voter] || {};
  const prefix = `${cityId}::`;
  return Object.keys(bag).filter((k) => k.startsWith(prefix)).length;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/cities', async (_req, res) => {
  const catalog = loadCatalog();
  const votes = await readVotes();
  const enriched = catalog.map((c) => {
    const city = loadCity(c.id);
    const total = city?.attractions?.length || 0;
    const rony = countCityVotes(votes, 'rony', c.id);
    const keren = countCityVotes(votes, 'keren', c.id);
    const live = !!city && total > 0;
    return {
      id: c.id,
      name: c.name || city?.cityName || c.id,
      shortName: c.shortName || c.name || c.id,
      dates: c.dates || city?.dates || '',
      hotelName: c.hotelName || city?.hotel?.name || '',
      region: c.region || '',
      status: live ? 'live' : (c.status || 'soon'),
      total,
      mapX: c.mapX ?? 50,
      mapY: c.mapY ?? 50,
      lat: c.lat,
      lng: c.lng,
      progress: {
        rony: { done: rony, total, complete: total > 0 && rony >= total },
        keren: { done: keren, total, complete: total > 0 && keren >= total },
      },
    };
  });
  res.json(enriched);
});

app.get('/api/city/:id', (req, res) => {
  const city = loadCity(req.params.id);
  if (!city) return res.status(404).json({ error: 'City not ready yet' });
  res.json(city);
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

if (!fs.existsSync(VOTES)) {
  try {
    fs.writeFileSync(VOTES, JSON.stringify(emptyVotes(), null, 2));
  } catch (_) {}
}

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Vietnam Rank quiz on http://0.0.0.0:${PORT}`));
}

module.exports = app;
