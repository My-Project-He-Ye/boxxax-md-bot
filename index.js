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
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

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

// Logout endpoint ki hifazat ke liye random admin token (sirf server logs mein)
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');

// --- WhatsApp connection ------------------------------------
async function connectWA() {
  if (starting) return;
  starting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
    authState = state;
    const { version } = await fetchLatestBaileysVersion();

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

    sock.ev.on('connection.update', (u) => {
      const { connection, lastDisconnect } = u;
      log.info({ connection }, '[wa] connection.update');
      if (connection === 'open') {
        log.info(`[wa] Connected as ${sock.user?.id}`);
        lastPairingCode = null;
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        log.warn({ code, loggedOut }, '[wa] connection closed');
        sock = null;
        starting = false;
        if (loggedOut) {
          // Session khatam — purani session saaf karo taake dobara pair ho sake
          try { fs.rmSync(config.sessionDir, { recursive: true, force: true }); } catch {}
          authState = null;
          log.warn('[wa] Logged out — session cleared. Pair dobara karein.');
        } else {
          setTimeout(connectWA, 3000); // auto-reconnect
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
app.get('/api/status', (req, res) => {
  const connected = !!(sock && sock.user);
  res.json({
    connected,
    user: sock?.user?.id || null,
    botName: config.botName,
    needsPairing: !connected,
    hasOwner: !!config.owner,
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
    if (!sock) await connectWA();
    for (let i = 0; i < 20 && !sock; i++) await new Promise((r) => setTimeout(r, 500));
    if (!sock) return res.status(500).json({ error: 'WhatsApp se connect nahi ho saka, dobara try karein.' });

    if (authState?.creds?.registered) return res.json({ alreadyConnected: true });

    const code = await sock.requestPairingCode(number);
    lastPairingCode = code;
    log.info({ number: number.slice(0, 4) + '***' }, '[wa] pairing code issued');
    res.json({ code });
  } catch (e) {
    log.error(e, '[wa] pairing failed');
    res.status(500).json({ error: 'Pairing code nahi mil saka: ' + (e.message || 'unknown error') });
  }
});

// Logout — sirf admin token ke saath (server logs mein milta hai)
app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Admin token ghalat hai.' });
  try { if (sock) await sock.logout(); } catch {}
  try { fs.rmSync(config.sessionDir, { recursive: true, force: true }); } catch {}
  sock = null;
  authState = null;
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, bot: config.botName }));

// --- boot ----------------------------------------------------
app.listen(config.port, () => {
  log.info(`[web] Pairing page: http://localhost:${config.port}`);
  log.info('[web] ADMIN TOKEN (logout ke liye — kisi ko na dein): ' + ADMIN_TOKEN);
  connectWA();
});
