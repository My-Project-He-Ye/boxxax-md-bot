// ─── BOXXAXMD · WhatsApp MD bot with web pairing ──────
// Flow: page par apna number dalo → 8-digit pairing code milega →
// WhatsApp > Linked devices > "Link a device" > "Link with phone number instead"
// mein code dalo → bot active. Session save rehti hai, dobara pair nahi karna.

const express = require('express');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const { handleMessage } = require('./lib/commands');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { useRedisAuthState, makeRedisClient, redisConfigured } = require('./lib/redis-auth');

const log = pino({ level: 'info' });

// Proxy support: sandboxed networks block direct WSS — route the WA socket
// through the HTTPS proxy when one is configured (Baileys `agent` option).
let proxyAgent = null;
try {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    proxyAgent = new HttpsProxyAgent(proxyUrl);
    log.info('[net] using HTTPS proxy for WhatsApp socket');
  }
} catch (e) { log.warn({ err: String(e) }, '[net] proxy agent unavailable'); }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sock = null;
let authState = null; // creds/state module scope mein — /api/pair yahi se check karega
let starting = false;
let lastPairingCode = null;
let lastCodeAt = 0;        // aakhri code kab issue hua (tez dobara-click guard)
let cooldownUntil = 0;     // 401 block ke baad WhatsApp temp-block khatam hone ka waqt
let blockCount = 0;        // 401 blocks ki ginti — har block par cooldown double
let lastCloseAt = 0;
let failStreak = 0;        // lagatar quick closes (reconnect storm guard)
let socketOpenedAt = 0;    // WS kab se musalsal open hai — pairing ke liye stability gate

// Har second WS ki asal haalat note karo (Baileys 'open' unpaired socket par
// kabhi fire nahi hota, is liye ws.isOpen hi sab se saccha signal hai).
setInterval(() => {
  if (sock?.ws?.isOpen) { if (!socketOpenedAt) socketOpenedAt = Date.now(); }
  else socketOpenedAt = 0;
}, 1000);

// Logout endpoint ki hifazat ke liye random admin token (sirf server logs mein)
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');

let clearAuthState = null; // session saaf karne wala fn (redis ya file — jo active ho)

// Auth state: Upstash Redis (Render, persistent) preferred —
// UPSTASH_REDIS_REST_URL/TOKEN na hon to local file auth fallback (default).
async function getAuthState() {
  if (redisConfigured()) {
    log.info('[auth] using Upstash Redis auth state');
    const { state, saveCreds, clearAll } = await useRedisAuthState(makeRedisClient());
    clearAuthState = clearAll;
    return { state, saveCreds };
  }
  log.info('[auth] using local file auth state');
  clearAuthState = async () => {
    try { fs.rmSync(config.sessionDir, { recursive: true, force: true }); } catch {}
  };
  return useMultiFileAuthState(config.sessionDir);
}

// Session saaf karo (logout / 401 par) — redis keys bhi delete hon.
async function clearSession() {
  try { if (clearAuthState) await clearAuthState(); }
  catch (e) { log.warn({ err: String(e) }, '[auth] session clear failed'); }
  authState = null;
}

// --- WhatsApp connection ------------------------------------
async function connectWA() {
  if (starting) return;
  starting = true;
  try {
    const { state, saveCreds } = await getAuthState();
    authState = state;
    // NOTE: fetchLatestWaWebVersion (asal current WA Web version) istemal karo —
    // fetchLatestBaileysVersion purana version deta hai jis par WhatsApp
    // "Couldn't link device" keh kar pairing refuse kar deta hai.
    const { version } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: [config.botName, 'Chrome', '1.0.0'],
      markOnlineOnConnect: true,
      ...(proxyAgent ? { agent: proxyAgent } : {}),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect } = u;
      log.info({ connection }, '[wa] connection.update');
      if (connection === 'open') {
        log.info(`[wa] Connected as ${sock.user?.id}`);
        lastPairingCode = null;
        failStreak = 0;
        blockCount = 0;
        cooldownUntil = 0;
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        log.warn({ code, loggedOut }, '[wa] connection closed');
        sock = null;
        starting = false;
        const now = Date.now();
        const quickClose = now - lastCloseAt < 15000;
        lastCloseAt = now;
        failStreak = quickClose ? failStreak + 1 : 0;
        if (loggedOut) {
          // Session khatam — purani session saaf karo taake dobara pair ho sake
          // (redis par ho to redis keys bhi delete hoti hain)
          await clearSession();
          // WhatsApp ne pairing attempts par TEMPORARY BLOCK lagaya (401).
          // Foran dobara try karne se block LAMBA hota hai — is liye cooldown.
          blockCount += 1;
          const mins = Math.min(20 * Math.pow(2, blockCount - 1), 80);
          cooldownUntil = now + mins * 60 * 1000;
          log.warn(`[wa] 401 block #${blockCount} — ${mins} min cooldown. Us se pehle pair mat karein.`);
          setTimeout(() => { if (Date.now() >= cooldownUntil - 1000) connectWA(); }, mins * 60 * 1000 + 5000);
        } else if (Date.now() < cooldownUntil) {
          // Cooldown ke dauran socket ko bilkul haath mat lagao — WhatsApp
          // dobara connect dekh kar block LAMBA kar sakta hai. Sirf cooldown
          // khatam hone par ek baar reconnect karo.
          const wait = cooldownUntil - Date.now() + 5000;
          log.warn(`[wa] cooldown active — reconnect ${Math.ceil(wait / 60000)} min baad`);
          setTimeout(() => { if (Date.now() >= cooldownUntil - 1000) connectWA(); }, wait);
        } else {
          // Unpaired socket ka idle-close (408) normal hai — lekin code issue
          // ke foran baad ya lagatar failures par WhatsApp ko spam mat karo.
          const sinceCode = now - lastCodeAt;
          let delay = 3000;
          if (sinceCode < 3 * 60 * 1000) delay = 30000;
          if (failStreak >= 3) delay = Math.max(delay, 30000);
          setTimeout(connectWA, delay);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) handleMessage(sock, m); // fromMe bhi — owner apne phone se command de sakta hai
    });
  } catch (e) {
    log.error(e, '[wa] connect failed');
    sock = null;
  } finally {
    starting = false;
  }
}

// --- API -----------------------------------------------------

// Socket tab tak wait karo jab tak WhatsApp ka WS waqai OPEN na ho.
// Pairing code sirf live socket par mangwana chahiye — warna "Connection Closed".
async function waitForOpenSocket(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (sock?.ws?.isOpen) return sock;
    // Cooldown mein reconnect bilkul nahi — warna block lamba hota hai.
    if (!sock && !starting && Date.now() >= cooldownUntil) connectWA();
    await new Promise((r) => setTimeout(r, 1000));
  }
  return sock?.ws?.isOpen ? sock : null;
}

function cooldownInfo() {
  const ms = Math.max(0, cooldownUntil - Date.now());
  return { cooldownSeconds: Math.ceil(ms / 1000), coolingDown: ms > 0 };
}

app.get('/api/status', (req, res) => {
  const connected = !!(sock && sock.user);
  const cd = cooldownInfo();
  res.json({
    connected,
    user: sock?.user?.id || null,
    botName: config.botName,
    needsPairing: !connected,
    hasOwner: !!config.owner,
    canPair: !connected && !cd.coolingDown,
    cooldownSeconds: cd.cooldownSeconds,
    socketLive: !!(sock?.ws?.isOpen),
    socketStable: !!(sock?.ws?.isOpen && socketOpenedAt && Date.now() - socketOpenedAt >= 10000),
  });
});

// Pairing code — body: { number: "923001234567" }
app.post('/api/pair', async (req, res) => {
  try {
    const number = String(req.body?.number || '').replace(/\D/g, '');
    if (number.length < 10 || number.length > 15) {
      return res.status(400).json({ error: 'Sahi number likhein (country code ke saath, bina + ke). Masalan: 923001234567' });
    }
    // Agar OWNER_NUMBER set hai to sirf wahi number pair ho sakta hai (hijack protection)
    if (config.owner) {
      const a = number.slice(-10);
      const b = String(config.owner).replace(/\D/g, '').slice(-10);
      if (a !== b) return res.status(403).json({ error: 'Ye bot sirf owner number se pair ho sakta hai.' });
    }
    if (sock && sock.user) return res.json({ alreadyConnected: true, user: sock.user.id });

    // WhatsApp temp-block (401) ke baad cooldown — is dauran code mangwana
    // block ko AUR lamba karta hai. UI countdown dikhayega.
    const now = Date.now();
    const cd = cooldownInfo();
    if (cd.coolingDown) {
      const mins = Math.ceil(cd.cooldownSeconds / 60);
      return res.status(429).json({
        error: `WhatsApp ne temporary rok lagayi hai (tez koshishon ki wajah se). ${mins} min ruk kar SIRF EK BAAR try karein.`,
        cooldownSeconds: cd.cooldownSeconds,
      });
    }

    // 90 second ke andar dobara click — pehla code abhi valid hai, wahi do
    // (code 75 second chalta hai; is dauran naya code = naya 401 khatra)
    if (lastPairingCode && now - lastCodeAt < 90000) {
      return res.json({ code: lastPairingCode, reused: true, expiresIn: 75 });
    }

    if (!sock && !starting && Date.now() >= cooldownUntil) connectWA();
    const ready = await waitForOpenSocket(25000);
    if (!ready) {
      return res.status(503).json({ error: 'WhatsApp link abhi tayar nahi ho saka — 15 second ruk kar dobara dabayein (button ko baar-baar mat dabayein).' });
    }

    // STABILITY GATE (v2.2): socket kam-se-kam 10 second se musalsal open ho —
    // flapping socket par code issue karne se phone par "could not link" aata
    // hai aur WhatsApp 401 block laga deta hai. Yahi pichli baar hua tha.
    {
      const t1 = Date.now();
      let stable = false;
      while (Date.now() - t1 < 30000) {
        const sf = socketOpenedAt ? Date.now() - socketOpenedAt : 0;
        if (sock?.ws?.isOpen && sf >= 10000) { stable = true; break; }
        if (!sock?.ws?.isOpen) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!stable) {
        return res.status(503).json({ error: 'WhatsApp link abhi stable nahi — 15 second ruk kar dobara dabayein (button ko baar-baar mat dabayein).' });
      }
    }

    if (authState?.creds?.registered) return res.json({ alreadyConnected: true });

    const code = await sock.requestPairingCode(number);
    lastPairingCode = code;
    lastCodeAt = Date.now();
    log.info({ number: number.slice(0, 4) + '***' }, '[wa] pairing code issued');
    res.json({ code, expiresIn: 75 });
  } catch (e) {
    log.error(e, '[wa] pairing failed');
    const m = e.message || '';
    const friendly = /Connection Closed|428|Precondition/i.test(m)
      ? 'WhatsApp link abhi tayar nahi — 10 second ruk kar dobara dabayein (button ko baar-baar mat dabayein).'
      : 'Pairing code nahi mil saka: ' + (m || 'unknown error');
    res.status(500).json({ error: friendly });
  }
});

// Logout — sirf admin token ke saath (server logs mein milta hai)
app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Admin token ghalat hai.' });
  try { if (sock) await sock.logout(); } catch {}
  await clearSession();
  sock = null;
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, bot: config.botName }));

// --- boot ----------------------------------------------------
// Restart ke baad bhi pichli 401 block ka cooldown + blockCount lagu rahe.
// v2.2: naya format "[wa] 401 block #2 — 40 min cooldown" parse karo (purana
// format bhi support). Agar ye seed na ho to restart ke baad bot cooldown
// bhool kar foran pair karwayega = agla 401 block DOUBLE (80 min)!
try {
  const logTxt = fs.readFileSync(path.join(__dirname, 'bot.log'), 'utf8');
  const lines = logTxt.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (!o || !o.msg || !o.time) continue;
      const m = /401 block #(\d+)\D+(\d+) min cooldown/.exec(o.msg);
      if (m) {
        blockCount = Math.max(blockCount, parseInt(m[1], 10));
        cooldownUntil = Math.max(cooldownUntil, o.time + parseInt(m[2], 10) * 60 * 1000);
      } else if (o.msg === '[wa] Logged out — session cleared. Pair dobara karein.') {
        blockCount = Math.max(blockCount, 1);
        cooldownUntil = Math.max(cooldownUntil, o.time + 20 * 60 * 1000);
      } else continue;
      if (cooldownUntil > Date.now()) {
        log.warn(`[wa] pichli 401 block #${blockCount} — cooldown ${new Date(cooldownUntil).toLocaleString()} tak`);
        setTimeout(() => { if (Date.now() >= cooldownUntil - 1000) connectWA(); }, cooldownUntil - Date.now() + 5000);
      }
      break;
    } catch {}
  }
} catch {}

app.listen(config.port, () => {
  log.info(`[web] Pairing page: http://localhost:${config.port}`);
  log.info('[web] ADMIN TOKEN (logout ke liye — kisi ko na dein): ' + ADMIN_TOKEN);
  if (Date.now() >= cooldownUntil) connectWA(); // cooldown chal raha ho to socket baad mein khud jud jayega
});
