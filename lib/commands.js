// ─── BOXXAXMD · command handlers ────────────────────────
// Har command: { desc, admin?, owner?, run(sock, msg, args, ctx) }
// Sirf working commands — koi padding nahi.

const sharp = require('sharp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('../config');

const COBALT = 'https://co.otomir23.me/'; // cobalt v11 API (POST /)
let MODE = 'public'; // public | self (owner-only runtime mode)

// ─── helpers ───────────────────────────────────────────
const num = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function isOwner(jid) {
  if (!config.owner) return false;
  const a = num(jid).slice(-10);
  const b = String(config.owner).replace(/\D/g, '').slice(-10);
  return a.length >= 7 && a === b;
}

function getText(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}

function ctxOf(msg) {
  return msg.message?.extendedTextMessage?.contextInfo || null;
}

async function reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

// cobalt v11: POST /  → {status:'tunnel'|'redirect'|'picker', url...} ya {status:'error', error:{code}}
async function cobalt(url, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(COBALT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...extra }),
      signal: ctrl.signal,
    });
    const j = await res.json();
    if (j.status === 'error') throw new Error(j.error?.code || 'unknown');
    return j;
  } finally {
    clearTimeout(t);
  }
}

function cobaltErr(code) {
  const map = {
    'error.api.content.post.unavailable': 'Is link ka content nahi mila (deleted / private / ghalat link).',
    'error.api.link.invalid': 'Link sahi nahi hai, dobara check karein.',
    'error.api.youtube.login': 'YouTube ne download block kiya hua hai — TikTok / IG / FB link try karein.',
    'error.api.rate_limit': 'Thoda zyada use ho gaya, 1 minute baad try karein.',
  };
  return map[code] || 'Download nahi ho saka, thodi der baad dobara try karein.';
}

// Group admin check — LID aur PN dono handle karta hai
async function requireAdmin(sock, msg, sender) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return '❌ Ye command sirf group mein chalti hai.';
  const meta = await sock.groupMetadata(jid);
  const sNum = num(sender);
  const meNum = num(sock.user?.id);
  let senderAdmin = false, botAdmin = false;
  for (const p of meta.participants) {
    if (!p.admin) continue;
    const pNums = [num(p.id), num(p.phoneNumber)];
    if (pNums.includes(sNum)) senderAdmin = true;
    if (pNums.includes(meNum)) botAdmin = true;
  }
  if (!senderAdmin && !isOwner(sender)) return '❌ Sirf group admin ye command chala sakta hai.';
  if (!botAdmin) return '❌ Pehle bot ko group admin banayein.';
  return null;
}

// Text → stylish PNG (logo commands ke liye, local — hamesha kaam karega)
function textImage(text, style) {
  const t = esc(text.slice(0, 40) || 'BOXXAXMD');
  const styles = {
    neon: { glow: '#50E8F4', c1: '#02181b', c2: '#06333a' },
    glow: { glow: '#ff6ef5', c1: '#1a0b2e', c2: '#2b0f4d' },
  };
  const st = styles[style] || styles.neon;
  const svg =
    `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${st.c1}"/><stop offset="1" stop-color="${st.c2}"/>` +
    `</linearGradient><filter id="gl" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter></defs>` +
    `<rect width="800" height="400" rx="28" fill="url(#bg)"/>` +
    `<text x="400" y="222" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="66" font-weight="bold" fill="${st.glow}" filter="url(#gl)">${t}</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Text → sticker (attp)
function attpBuffer(text) {
  const t = esc(text.slice(0, 30) || 'BOXXAXMD');
  const svg =
    `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="256" y="286" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="72" font-weight="bold" fill="#ffffff" stroke="#0b2b30" stroke-width="2">${t}</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
}

async function sendDownload(sock, jid, msg, url, label, emoji) {
  await reply(sock, jid, msg, '⏳ Video nikal raha hoon...');
  try {
    const r = await cobalt(url);
    let fileUrl = r.url, kind = 'video';
    if (r.status === 'picker' && Array.isArray(r.picker) && r.picker.length) {
      const pick = r.picker.find((p) => p.type === 'video') || r.picker[0];
      fileUrl = pick.url; kind = pick.type === 'photo' ? 'image' : 'video';
    }
    if (!fileUrl) throw new Error('no-url');
    const caption = `${emoji} *${label}* — via ${config.botName}`;
    if (kind === 'image') await sock.sendMessage(jid, { image: { url: fileUrl }, caption }, { quoted: msg });
    else await sock.sendMessage(jid, { video: { url: fileUrl }, caption }, { quoted: msg });
  } catch (e) {
    await reply(sock, jid, msg, `❌ ${cobaltErr(e.message)}`);
  }
}

// ─── fun content (local — koi API nahi, hamesha chalega) ──
const JOKES = [
  'Teacher: "Agar tumhare paas 10 aam hon aur tum 3 kha lo to kitne bache?"\nStudent: "Sir, 10 hi... mujhe aam se allergy hai!" 😄',
  'Dost: "Yaar tu itna khush kyun hai?"\nMain: "Bijli ka bill kam aaya hai... kyunke light hi nahi aati!" 😂',
  'Biwi: "Tum mujhe kabhi surprise nahi dete!"\nShohar: "Deta hoon... tumhein pata hi nahi chalta!" 😅',
  'Doctor: "Tumhein aaram ki zaroorat hai."\nPatient: "Kitna aaram, doctor sahab?"\nDoctor: "Jitna office se milta hai!" 🤣',
  'Ammi: "Beta, parhai kaisi chal rahi hai?"\nBeta: "Bilkul bijli ki tarah... aati jaati rehti hai!" ⚡😄',
  'Dost: "Teri salary kitni hai?"\nMain: "Itni ke month ke end mein main aur salary dono ro lete hain!" 💸😂',
  'Teacher: "Kal test hai, sab yaad karke aana."\nStudent: "Sir, yaad to main roz karta hoon... bhool jaata hoon!" 📚😅',
  'Girlfriend: "Tum mujhse kitna pyaar karte ho?"\nBoyfriend: "Jitna WiFi se... signal kam ho to bhi connect rehta hoon!" 📶😄',
  'Boss: "Tum late kyun aaye?"\nEmployee: "Sir, traffic tha!"\nBoss: "Toh jaldi nikla karo!"\nEmployee: "Sir, neend bhi to traffic mein phansi thi!" 😴🤣',
  'Dost: "Yaar dieting kar raha hoon."\nMain: "Kya kha raha hai?"\nDost: "Jo bhi nazar aaye... dekh ke!" 🍔😂',
  'Ammi: "Beta, mobile chhod de, aankhein kharab ho jayengi!"\nBeta: "Ammi, aap chashma lagati hain... mobile to aapne bhi chalaya hoga!" 👓😄',
  'Police: "Tumne red light kyun cross ki?"\nDriver: "Sir, green light mein to sab jaate hain... main special hoon!" 🚦🤣',
];

const QUOTES = [
  '"Kamyabi unhi ko milti hai jo haar nahi maante." 💪',
  '"Waqt sab se bara ustaad hai... jo sikhata bhi hai aur aazmata bhi hai." ⏳',
  '"Chhoti soch se bara kaam nahi hota." 🌟',
  '"Mehnat ka phal meetha hota hai — bas sabar ka phal us se bhi meetha!" 🌱',
  '"Jo log tumhein giraana chahte hain, unhein dekh ke muskurao — tum un se upar ho." 😊',
  '"Kal ki fikar chhodo, aaj ko behtar banao — kal khud sanwar jayega." ☀️',
  '"Zindagi mein do cheezein kabhi mat bhoolo: upar wale ka shukar aur apne waade." 🤲',
  '"Mushkil waqt mein himmat mat haaro — raat jitni gehri ho, subah utni qareeb hoti hai." 🌅',
  '"Duniya tumhein tab tak nahi pehchanti jab tak tum khud ko na pehchano." 🪞',
  '"Sapne wo nahi jo neend mein aayein... sapne wo hain jo neend ura dein!" 🔥',
];

const EIGHTBALL = [
  'Haan, bilkul! ✅', 'Mushkil lag raha hai... ❌', 'Bhai, signal weak hain — dobara poocho 🔮',
  '100% haan! 🎯', 'Naamumkin nahi, lekin mehnat lagegi 💪', 'Meri crystal ball kehti hai: HAAN ✨',
  'Abhi waqt sahi nahi hai ⏳', 'Dil kehta hai haan, dimagh kehta hai soch lo 🤔',
  'Pakki baat — ho jayega! 🚀', 'Hmm... 50/50 🎲', 'Taqdeer tumhare saath hai 🌟', 'Bilkul nahi! 🙅',
];

const SHAYARI = [
  'Chandni raaton mein aksar ye socha karta hoon,\nTum jo mil jaate to kya baat hoti! 🌙',
  'Mohabbat mein haar jeet nahi hoti,\nBas dil lagane ki der hoti hai! ❤️',
  'Teri yaadon ke diye jalte hain seene mein,\nTu door hai phir bhi rehta hai qareeb mere! 🕯️',
  'Zindagi guzar gayi tujhe chahte chahte,\nAb to khuda se bhi shikayat nahi hoti! 💔',
  'Phoolon se khushbu aati hai, kaanton se nahi,\nIshq mein dard milta hai, aaraam se nahi! 🥀',
  'Aankhon mein aansu, hothon pe hansi rakhte hain,\nHum apne gham ko chhupana bhi jaante hain! 😊',
  'Dost wo nahi jo saath de mushkil mein,\nDost wo hai jo mushkil ko saath bana le! 🤝',
  'Waqt badalta hai, log badalte hain,\nBas yaadein wahi rehti hain! ⏳',
];

// ─── commands ────────────────────────────────────────────
const commands = {
  menu: {
    desc: 'Saare commands dekho',
    run: async (sock, msg, args, { jid }) => {
      const p = config.prefix;
      await reply(sock, jid, msg,
`╭───〔 *${config.botName}* 〕───⊷
├ Prefix: ${p} · Mode: ${MODE}
├ 31 commands · sab working ✅
╰──────────────⊷

『 MAIN 』
${p}menu · ${p}ping · ${p}alive · ${p}owner

『 DOWNLOAD 』
${p}tiktok <link> · ${p}ig <link> · ${p}fb <link>

『 STICKER 』
${p}sticker — photo → sticker (reply)
${p}toimg — sticker → photo, inbox mein (reply)
${p}attp <text> — text → sticker

『 GROUP 』 _(admin only)_
${p}tagall · ${p}hidetag · ${p}kick · ${p}add
${p}promote · ${p}demote · ${p}gclose · ${p}gopen
${p}glink · ${p}del (reply)

『 FUN 』
${p}joke · ${p}quote · ${p}8ball <sawal> · ${p}shayari

『 LOGO 』
${p}neon <text> · ${p}glow <text>

『 AI 』
${p}ai <sawal>

『 UTILITY 』
${p}getpp — profile photo nikalo (reply/tag)

『 OWNER 』
${p}vv — view-once dobara dekho (reply)
${p}vv2 — view-once owner ke inbox mein (reply)
${p}mode <public|self>

_— Powered by ${config.botName} _`);
    },
  },

  ping: {
    desc: 'Bot ki speed check karo',
    run: async (sock, msg, args, { jid }) => {
      const t = Date.now();
      await reply(sock, jid, msg, '🏓 Pong!');
      await reply(sock, jid, msg, `⚡ Speed: ${Date.now() - t}ms`);
    },
  },

  alive: {
    desc: 'Bot zinda hai?',
    run: async (sock, msg, args, { jid }) => {
      const s = Math.floor(process.uptime());
      const up = `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
      await reply(sock, jid, msg, `✅ *${config.botName} is alive!*\n\n🕐 Uptime: ${up}\n📡 Mode: ${MODE}\n⌨️ Prefix: ${config.prefix}`);
    },
  },

  owner: {
    desc: 'Owner ka number',
    run: async (sock, msg, args, { jid }) => {
      await reply(sock, jid, msg,
        config.owner
          ? `👑 *${config.botName} Owner*\n\n📱 wa.me/${config.owner.replace(/\D/g, '')}`
          : `👑 *${config.botName} Owner*\n\nOwner number set nahi — OWNER_NUMBER env mein set karein.`);
    },
  },

  // ── download ──
  tiktok: {
    desc: 'TikTok video download',
    run: async (sock, msg, args, { jid }) => {
      const url = args[0];
      if (!url || !/tiktok\.com/i.test(url)) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}tiktok <tiktok-link>*`);
      await sendDownload(sock, jid, msg, url, 'TikTok', '🎬');
    },
  },

  ig: {
    desc: 'Instagram reel/post download',
    run: async (sock, msg, args, { jid }) => {
      const url = args[0];
      if (!url || !/instagram\.com/i.test(url)) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}ig <instagram-link>*`);
      await sendDownload(sock, jid, msg, url, 'Instagram', '📸');
    },
  },

  fb: {
    desc: 'Facebook video download',
    run: async (sock, msg, args, { jid }) => {
      const url = args[0];
      if (!url || !/facebook\.com|fb\.watch/i.test(url)) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}fb <facebook-link>*`);
      await sendDownload(sock, jid, msg, url, 'Facebook', '📘');
    },
  },

  // ── sticker ──
  sticker: {
    desc: 'Photo → sticker (photo ke reply mein)',
    run: async (sock, msg, args, { jid }) => {
      const img = ctxOf(msg)?.quotedMessage?.imageMessage || msg.message?.imageMessage;
      if (!img) return reply(sock, jid, msg, `❌ Kisi photo ke reply mein *${config.prefix}sticker* likhein.`);
      await reply(sock, jid, msg, '⏳ Sticker ban raha hai...');
      try {
        const buf = await downloadMediaMessage({ key: msg.key, message: { imageMessage: img } }, 'buffer', {});
        const webp = await sharp(buf)
          .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 90 }).toBuffer();
        await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
      } catch {
        await reply(sock, jid, msg, '❌ Sticker nahi ban saka, dobara try karein.');
      }
    },
  },

  toimg: {
    desc: 'Sticker → photo, aapke inbox mein (sticker ke reply mein)',
    run: async (sock, msg, args, { jid }) => {
      const st = ctxOf(msg)?.quotedMessage?.stickerMessage || msg.message?.stickerMessage;
      if (!st) return reply(sock, jid, msg, `❌ Kisi sticker ke reply mein *${config.prefix}toimg* likhein.`);
      await reply(sock, jid, msg, '⏳ Image bana raha hoon...');
      try {
        const buf = await downloadMediaMessage({ key: msg.key, message: { stickerMessage: st } }, 'buffer', {});
        const png = await sharp(buf, { animated: false }).png().toBuffer();
        const ownerJid = config.owner ? num(config.owner) + '@s.whatsapp.net' : jid;
        await sock.sendMessage(ownerJid, { image: png, caption: `🖼️ *Sticker → Image*\n_— ${config.botName}_` });
        if (ownerJid !== jid) await reply(sock, jid, msg, '✅ Image aapke inbox mein bhej di hai!');
      } catch {
        await reply(sock, jid, msg, '❌ Image nahi ban saki, dobara try karein.');
      }
    },
  },

  attp: {
    desc: 'Text → sticker',
    run: async (sock, msg, args, { jid }) => {
      const text = args.join(' ');
      if (!text) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}attp <text>*`);
      const webp = await attpBuffer(text);
      await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
    },
  },

  // ── group ──
  tagall: {
    desc: 'Sab members ko tag karo (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const meta = await sock.groupMetadata(jid);
      const mentions = meta.participants.map((p) => p.id);
      await sock.sendMessage(jid, {
        text: `📢 *TAG ALL*\n${args.join(' ')}\n\n` + mentions.map((m) => '@' + num(m)).join(' '),
        mentions,
      }, { quoted: msg });
    },
  },

  hidetag: {
    desc: 'Chhupa tag — sab ko bina naam liye notify (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const meta = await sock.groupMetadata(jid);
      await sock.sendMessage(jid, {
        text: `🔔 ${args.join(' ') || config.botName}`,
        mentions: meta.participants.map((p) => p.id),
      }, { quoted: msg });
    },
  },

  kick: {
    desc: 'Member nikalo (admin — tag ya reply)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const ctx = ctxOf(msg);
      const target = ctx?.mentionedJid?.[0] || ctx?.participant;
      if (!target) return reply(sock, jid, msg, `❌ Kisi ko tag karein ya uske message ke reply mein *${config.prefix}kick* likhein.`);
      if (isOwner(target)) return reply(sock, jid, msg, '❌ Owner ko kick nahi kar sakte!');
      await sock.groupParticipantsUpdate(jid, [target], 'remove');
      await sock.sendMessage(jid, { text: `👢 @${num(target)} kicked.`, mentions: [target] }, { quoted: msg });
    },
  },

  add: {
    desc: 'Number se member add karo (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const n = (args[0] || '').replace(/\D/g, '');
      if (!n) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}add <number with country code>*\nMasalan: ${config.prefix}add 923001234567`);
      await sock.groupParticipantsUpdate(jid, [n + '@s.whatsapp.net'], 'add');
      await reply(sock, jid, msg, `✅ ${n} ko add karne ki request bhej di.`);
    },
  },

  promote: {
    desc: 'Admin banao (admin — tag ya reply)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const ctx = ctxOf(msg);
      const target = ctx?.mentionedJid?.[0] || ctx?.participant;
      if (!target) return reply(sock, jid, msg, '❌ Tag karein ya reply karein.');
      await sock.groupParticipantsUpdate(jid, [target], 'promote');
      await sock.sendMessage(jid, { text: `⬆️ @${num(target)} ab admin hai.`, mentions: [target] }, { quoted: msg });
    },
  },

  demote: {
    desc: 'Admin se hatao (admin — tag ya reply)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const ctx = ctxOf(msg);
      const target = ctx?.mentionedJid?.[0] || ctx?.participant;
      if (!target) return reply(sock, jid, msg, '❌ Tag karein ya reply karein.');
      await sock.groupParticipantsUpdate(jid, [target], 'demote');
      await sock.sendMessage(jid, { text: `⬇️ @${num(target)} ab admin nahi raha.`, mentions: [target] }, { quoted: msg });
    },
  },

  gclose: {
    desc: 'Group band karo — sirf admin likhein (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      await sock.groupSettingUpdate(jid, 'announcement');
      await reply(sock, jid, msg, '🔒 Group closed — ab sirf admin likh sakte hain.');
    },
  },

  gopen: {
    desc: 'Group kholo — sab likh sakein (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      await sock.groupSettingUpdate(jid, 'not_announcement');
      await reply(sock, jid, msg, '🔓 Group open — ab sab likh sakte hain.');
    },
  },

  glink: {
    desc: 'Group ka invite link (admin)',
    admin: true,
    run: async (sock, msg, args, { jid }) => {
      const code = await sock.groupInviteCode(jid);
      await reply(sock, jid, msg, `🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`);
    },
  },

  del: {
    desc: 'Message delete karo (kisi message ke reply mein)',
    run: async (sock, msg, args, { jid, sender }) => {
      const ctx = ctxOf(msg);
      const stanzaId = ctx?.stanzaId;
      const participant = ctx?.participant;
      if (!stanzaId) return reply(sock, jid, msg, `❌ Kisi message ke reply mein *${config.prefix}del* likhein.`);
      const isBotMsg = participant && num(participant) === num(sock.user?.id);
      if (!isBotMsg) {
        const err = await requireAdmin(sock, msg, sender);
        if (err) return reply(sock, jid, msg, err);
      }
      const key = { remoteJid: jid, id: stanzaId, fromMe: !!isBotMsg };
      if (!isBotMsg && participant) key.participant = participant;
      await sock.sendMessage(jid, { delete: key });
    },
  },

  // ── fun ──
  joke: {
    desc: 'Ek mazahiya joke',
    run: async (sock, msg, args, { jid }) => {
      await reply(sock, jid, msg, `😂 *Joke*\n\n${JOKES[Math.floor(Math.random() * JOKES.length)]}`);
    },
  },

  quote: {
    desc: 'Aaj ka motivational quote',
    run: async (sock, msg, args, { jid }) => {
      await reply(sock, jid, msg, `💡 *Quote*\n\n${QUOTES[Math.floor(Math.random() * QUOTES.length)]}`);
    },
  },

  '8ball': {
    desc: 'Sawal poochein, 8ball jawab dega',
    run: async (sock, msg, args, { jid }) => {
      if (!args.length) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}8ball <aapka sawal>*`);
      await reply(sock, jid, msg, `🎱 *8Ball*\n\n❓ ${args.join(' ')}\n🔮 ${EIGHTBALL[Math.floor(Math.random() * EIGHTBALL.length)]}`);
    },
  },

  shayari: {
    desc: 'Ek khoobsurat shayari',
    run: async (sock, msg, args, { jid }) => {
      await reply(sock, jid, msg, `✨ *Shayari*\n\n${SHAYARI[Math.floor(Math.random() * SHAYARI.length)]}`);
    },
  },

  // ── logo ──
  neon: {
    desc: 'Neon glow text image',
    run: async (sock, msg, args, { jid }) => {
      const text = args.join(' ');
      if (!text) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}neon <text>*`);
      const png = await textImage(text, 'neon');
      await sock.sendMessage(jid, { image: png, caption: `💠 *${text}*\n_— ${config.botName}_` }, { quoted: msg });
    },
  },

  glow: {
    desc: 'Pink glow text image',
    run: async (sock, msg, args, { jid }) => {
      const text = args.join(' ');
      if (!text) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}glow <text>*`);
      const png = await textImage(text, 'glow');
      await sock.sendMessage(jid, { image: png, caption: `💗 *${text}*\n_— ${config.botName}_` }, { quoted: msg });
    },
  },

  // ── ai ──
  ai: {
    desc: 'AI se kuch bhi poochein',
    run: async (sock, msg, args, { jid }) => {
      const q = args.join(' ');
      if (!q) return reply(sock, jid, msg, `❌ Usage: *${config.prefix}ai <aapka sawal>*`);
      await reply(sock, jid, msg, '🤖 Soch raha hoon...');
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch('https://text.pollinations.ai/' + encodeURIComponent(q), { signal: ctrl.signal });
        clearTimeout(t);
        const txt = (await res.text()).trim();
        if (!txt) throw new Error('empty');
        await reply(sock, jid, msg, `🤖 *AI*\n\n${txt.slice(0, 3000)}`);
      } catch {
        await reply(sock, jid, msg, '❌ AI abhi jawab nahi de saka, thodi der baad try karein.');
      }
    },
  },

  // ── utility ──
  getpp: {
    desc: 'Profile photo nikalo (reply ya tag)',
    run: async (sock, msg, args, { jid, sender }) => {
      const ctx = ctxOf(msg);
      const target = ctx?.mentionedJid?.[0] || ctx?.participant || sender;
      try {
        const url = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(jid, { image: { url }, caption: `🖼️ @${num(target)} ki profile photo` }, { quoted: msg });
      } catch {
        await reply(sock, jid, msg, '❌ Profile photo nahi mili (privacy settings ki wajah se).');
      }
    },
  },

  // ── owner ──
  vv: {
    desc: 'View-once photo/video dobara dekho (owner, reply)',
    owner: true,
    run: async (sock, msg, args, { jid }) => {
      const q = ctxOf(msg)?.quotedMessage;
      const inner = q?.viewOnceMessage?.message || q?.viewOnceMessageV2?.message || q?.viewOnceMessageV2Extension?.message;
      const imgM = inner?.imageMessage, vidM = inner?.videoMessage;
      if (!imgM && !vidM) return reply(sock, jid, msg, `❌ Kisi view-once photo/video ke reply mein *${config.prefix}vv* likhein.`);
      try {
        const kind = imgM ? 'imageMessage' : 'videoMessage';
        const buf = await downloadMediaMessage({ key: msg.key, message: { [kind]: imgM || vidM } }, 'buffer', {});
        const caption = `👁️ *View-once unlocked*\n_— ${config.botName}_`;
        if (imgM) await sock.sendMessage(jid, { image: buf, caption }, { quoted: msg });
        else await sock.sendMessage(jid, { video: buf, caption }, { quoted: msg });
      } catch {
        await reply(sock, jid, msg, '❌ View-once khol nahi saka, dobara try karein.');
      }
    },
  },

  vv2: {
    desc: 'View-once photo/video owner ke inbox mein bhejo (owner, reply)',
    owner: true,
    run: async (sock, msg, args, { jid }) => {
      const q = ctxOf(msg)?.quotedMessage;
      const inner = q?.viewOnceMessage?.message || q?.viewOnceMessageV2?.message || q?.viewOnceMessageV2Extension?.message;
      const imgM = inner?.imageMessage, vidM = inner?.videoMessage;
      if (!imgM && !vidM) return reply(sock, jid, msg, `❌ Kisi view-once photo/video ke reply mein *${config.prefix}vv2* likhein.`);
      if (!config.owner) return reply(sock, jid, msg, '❌ OWNER_NUMBER set nahi hai.');
      const ownerJid = num(config.owner) + '@s.whatsapp.net';
      try {
        const kind = imgM ? 'imageMessage' : 'videoMessage';
        const buf = await downloadMediaMessage({ key: msg.key, message: { [kind]: imgM || vidM } }, 'buffer', {});
        const caption = `👁️ *View-once unlocked (vv2)*\n_— ${config.botName}_`;
        if (imgM) await sock.sendMessage(ownerJid, { image: buf, caption });
        else await sock.sendMessage(ownerJid, { video: buf, caption });
        if (ownerJid !== jid) await reply(sock, jid, msg, '✅ View-once aapke inbox mein bhej di hai!');
      } catch {
        await reply(sock, jid, msg, '❌ View-once khol nahi saka, dobara try karein.');
      }
    },
  },

  mode: {
    desc: 'Bot mode: public ya self (owner)',
    owner: true,
    run: async (sock, msg, args, { jid }) => {
      const m = (args[0] || '').toLowerCase();
      if (m !== 'public' && m !== 'self') {
        return reply(sock, jid, msg, `❌ Usage: *${config.prefix}mode <public|self>*\n\npublic — sab use kar sakte hain\nself — sirf owner use kar sakta hai\n\nMaujooda mode: *${MODE}*`);
      }
      MODE = m;
      await reply(sock, jid, msg, `✅ Mode set: *${MODE}*`);
    },
  },
};

// ─── dispatcher ─────────────────────────────────────────
async function handleMessage(sock, msg) {
  try {
    const jid = msg.key?.remoteJid;
    if (!jid || jid === 'status@broadcast') return;

    const text = getText(msg);
    if (!text.startsWith(config.prefix)) return;

    const [raw, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
    const cmd = commands[(raw || '').toLowerCase()];
    if (!cmd) return;

    // fromMe (khud ke bheje hue) messages ka sender bot khud hai
    const sender = msg.key.fromMe ? (sock.user?.id || jid) : (msg.key.participant || jid);

    if (MODE === 'self' && !isOwner(sender)) return;

    if (cmd.owner && !isOwner(sender)) {
      await reply(sock, jid, msg, '❌ Ye command sirf owner ke liye hai.');
      return;
    }

    if (cmd.admin) {
      const err = await requireAdmin(sock, msg, sender);
      if (err) { await reply(sock, jid, msg, err); return; }
    }

    await cmd.run(sock, msg, args, { sender, jid });
  } catch (e) {
    console.error('[cmd error]', e.message);
  }
}

module.exports = { commands, handleMessage, isOwner };
