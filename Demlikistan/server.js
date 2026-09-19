const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.DEMLIK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Railway PostgreSQL is required in production.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const adminTokens = new Set();
const allowedProfileFields = ['coins', 'sugar', 'bomb', 'potion', 'hasDiamond', 'diamondDurability', 'highScore', 'endlessRecord'];
const defaultContent = {
  locale: {
    TR: { title: 'Demlik', play: 'OYUNA BAŞLA', shop: 'MARKET', settings: 'AYARLAR', dev: 'GELİŞTİRİCİLER', close: 'KAPAT', paused: 'OYUN DURDURULDU', resume: 'DEVAM ET', mainMenu: 'ANA MENÜ', highscore: 'REKOR', endless: 'SONSUZLUK', coin: 'PARA', level: 'SEVİYE', score: 'SKOR', target: 'HEDEF', time: 'SÜRE', music: 'MÜZİK', sfx: 'SES EFECTI', lang: 'DİL', shopTitleMenu: 'KARABORSAYA HOŞGELDİN', shopTitleGame: 'HIZLI SATIN ALIM' },
    EN: { title: 'Demlik', play: 'START GAME', shop: 'SHOP', settings: 'SETTINGS', dev: 'DEVELOPERS', close: 'CLOSE', paused: 'GAME PAUSED', resume: 'RESUME', mainMenu: 'MAIN MENU', highscore: 'RECORD', endless: 'ENDLESS', coin: 'COINS', level: 'LEVEL', score: 'SCORE', target: 'TARGET', time: 'TIME', music: 'MUSIC', sfx: 'SFX', lang: 'LANG', shopTitleMenu: 'WELCOME TO BLACK MARKET', shopTitleGame: 'QUICK BUY' }
  },
  randomMessages: ['iso yaptı bu oyunu', 'çay sevmeyen poh içsin', 'CMS Team adamdır', 'Oshi bir dahi', 'İsocuk yaptı', 'selam isocuk'],
  shopNames: { bomb: '3x Patlayıcı', diamond: 'Elmas Katana', potion: 'Bergamot', sugar: '5x Şeker' }
};

async function initDatabase() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demlik_players (
      player_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS demlik_sessions (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES demlik_players(player_id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'MENU',
      score INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      is_playing BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ,
      last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS demlik_sessions_active_idx
      ON demlik_sessions (last_heartbeat_at DESC) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS demlik_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES demlik_players(player_id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 240),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS demlik_chat_messages_created_idx ON demlik_chat_messages (created_at DESC);
    CREATE TABLE IF NOT EXISTS demlik_content (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query("ALTER TABLE demlik_players ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''");
  await pool.query('INSERT INTO demlik_content (id, content) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(defaultContent)]);
}

function cleanProfile(profile) {
  const clean = {};
  for (const field of allowedProfileFields) {
    if (Object.prototype.hasOwnProperty.call(profile || {}, field)) clean[field] = profile[field];
  }
  return clean;
}

function requireDatabase(res) {
  if (!process.env.DATABASE_URL) {
    res.status(503).json({ error: 'DATABASE_URL gerekli' });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: 'Yetkisiz' });
  next();
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'günceldata.html')));

app.get('/health', async (req, res) => {
  if (!requireDatabase(res)) return;
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (error) { res.status(503).json({ ok: false, error: error.message }); }
});

app.get('/api/game/content', async (req, res) => {
  if (!requireDatabase(res)) return;
  try { const result = await pool.query('SELECT content FROM demlik_content WHERE id = 1'); res.json(result.rows[0]?.content || defaultContent); }
  catch (error) { res.status(500).json({ error: 'Oyun içeriği alınamadı' }); }
});

app.post('/api/game/player', async (req, res) => {
  if (!requireDatabase(res)) return;
  const { playerId, profile, displayName } = req.body || {};
  if (!playerId || !/^DEM-[A-Z0-9]{4,20}$/.test(playerId)) return res.status(400).json({ error: 'Geçersiz oyuncu kimliği' });
  try {
    await pool.query(`
      INSERT INTO demlik_players (player_id, display_name, profile) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (player_id) DO UPDATE SET display_name = CASE WHEN $2 <> '' THEN $2 ELSE demlik_players.display_name END, profile = demlik_players.profile || EXCLUDED.profile, last_seen_at = NOW()
    `, [playerId, cleanDisplayName(displayName, playerId), JSON.stringify(cleanProfile(profile))]);
    res.json({ ok: true, playerId, displayName: cleanDisplayName(displayName, playerId) });
  } catch (error) { res.status(500).json({ error: 'Oyuncu kaydedilemedi' }); }
});

function cleanDisplayName(value, playerId) {
  const fallback = String(playerId || '').replace(/^DEM-/i, '') || 'Oyuncu';
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  return name || fallback;
}

app.get('/api/game/chat', async (req, res) => {
  if (!requireDatabase(res)) return;
  const after = Number(req.query.after) || 0;
  try {
    const result = await pool.query(`SELECT id, player_id, display_name, message, created_at FROM demlik_chat_messages WHERE id > $1 ORDER BY id ASC LIMIT 100`, [after]);
    res.json({ messages: result.rows });
  } catch (error) { res.status(500).json({ error: 'Sohbet alınamadı' }); }
});

app.post('/api/game/chat', async (req, res) => {
  if (!requireDatabase(res)) return;
  const { playerId, displayName, message } = req.body || {};
  const text = String(message || '').trim().slice(0, 240);
  if (!playerId || !text) return res.status(400).json({ error: 'Oyuncu ve mesaj gerekli' });
  try {
    const name = cleanDisplayName(displayName, playerId);
    await pool.query(`INSERT INTO demlik_players (player_id, display_name) VALUES ($1, $2) ON CONFLICT (player_id) DO UPDATE SET display_name = $2, last_seen_at = NOW()`, [playerId, name]);
    const result = await pool.query(`INSERT INTO demlik_chat_messages (player_id, display_name, message) VALUES ($1, $2, $3) RETURNING id, player_id, display_name, message, created_at`, [playerId, name, text]);
    res.json({ ok: true, message: result.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Mesaj gönderilemedi' }); }
});

app.post('/api/game/heartbeat', async (req, res) => {
  if (!requireDatabase(res)) return;
  const { playerId, profile, state, score, level, isPlaying, sessionId } = req.body || {};
  if (!playerId) return res.status(400).json({ error: 'Oyuncu kimliği gerekli' });
  try {
    await pool.query(`
      INSERT INTO demlik_players (player_id, profile, last_seen_at) VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (player_id) DO UPDATE SET profile = demlik_players.profile || EXCLUDED.profile, last_seen_at = NOW()
    `, [playerId, JSON.stringify(cleanProfile(profile))]);
    let result;
    if (sessionId) {
      result = await pool.query(`UPDATE demlik_sessions SET state=$1, score=$2, level=$3, is_playing=$4, last_heartbeat_at=NOW(), ended_at=CASE WHEN $4 THEN NULL ELSE COALESCE(ended_at, NOW()) END WHERE id=$5 AND player_id=$6 RETURNING id`, [state || 'MENU', Number(score) || 0, Number(level) || 1, Boolean(isPlaying), sessionId, playerId]);
    }
    if (!result || result.rowCount === 0) {
      result = await pool.query(`INSERT INTO demlik_sessions (player_id, state, score, level, is_playing, started_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NOW() ELSE NULL END) RETURNING id`, [playerId, state || 'MENU', Number(score) || 0, Number(level) || 1, Boolean(isPlaying)]);
    }
    res.json({ ok: true, sessionId: result.rows[0].id });
  } catch (error) { res.status(500).json({ error: 'Oturum güncellenemedi' }); }
});

app.post('/api/admin/login', (req, res) => {
  if (!adminPassword || req.body?.password !== adminPassword) return res.status(401).json({ error: 'Hatalı admin parolası' });
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ ok: true, token });
});

app.get('/api/admin/players', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(`
      SELECT p.player_id, p.display_name, p.profile, p.first_seen_at, p.last_seen_at,
        s.id AS session_id, s.state, s.score, s.level, s.is_playing, s.started_at, s.last_heartbeat_at,
        (s.last_heartbeat_at > NOW() - INTERVAL '30 seconds') AS online
      FROM demlik_players p
      LEFT JOIN LATERAL (SELECT * FROM demlik_sessions WHERE player_id=p.player_id ORDER BY last_heartbeat_at DESC LIMIT 1) s ON TRUE
      ORDER BY p.last_seen_at DESC
    `);
    res.json({ players: result.rows });
  } catch (error) { res.status(500).json({ error: 'Oyuncular alınamadı' }); }
});

app.get('/api/admin/content', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  try { const result = await pool.query('SELECT content, updated_at FROM demlik_content WHERE id = 1'); res.json({ content: result.rows[0]?.content || defaultContent, updatedAt: result.rows[0]?.updated_at }); }
  catch (error) { res.status(500).json({ error: 'İçerik alınamadı' }); }
});

app.put('/api/admin/content', requireAdmin, async (req, res) => {
  if (!requireDatabase(res)) return;
  const content = req.body?.content;
  if (!content || typeof content !== 'object' || !content.locale?.TR || !content.locale?.EN) return res.status(400).json({ error: 'Geçerli içerik yapısı gerekli' });
  try {
    await pool.query('UPDATE demlik_content SET content = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(content)]);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'İçerik kaydedilemedi' }); }
});

initDatabase().then(() => app.listen(port, () => console.log(`Demlik online server listening on ${port}`))).catch(error => { console.error(error); process.exit(1); });
