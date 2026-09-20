# 🤖 BOXXAXMD — WhatsApp Bot

Apne **apne WhatsApp number** se link hone wala MD-style bot. Koi QR scan nahi — bas **8-digit pairing code** WhatsApp ke *Linked devices* mein daalo aur bot active.

## ✨ Features (31 commands — sab working, koi padding nahi)

| Category | Commands |
|---|---|
| MAIN | `.menu` `.ping` `.alive` `.owner` |
| DOWNLOAD | `.tiktok <link>` `.ig <link>` `.fb <link>` |
| STICKER | `.sticker` (photo → sticker, reply) · `.toimg` (sticker → photo, aapke inbox mein, reply) · `.attp <text>` |
| GROUP (admin) | `.tagall` `.hidetag` `.kick` `.add` `.promote` `.demote` `.gclose` `.gopen` `.glink` `.del` |
| FUN | `.joke` `.quote` `.8ball <sawal>` `.shayari` |
| LOGO | `.neon <text>` `.glow <text>` |
| AI | `.ai <sawal>` |
| UTILITY | `.getpp` (reply/tag → profile photo) |
| OWNER | `.vv` (view-once dobara dekho, reply) · `.vv2` (view-once owner inbox mein, reply) · `.mode <public\|self>` |

Prefix: `.` (config.js mein badal sakte hain)

## 🚀 Chalana (local)

```bash
cd whatsapp-md-bot
npm install
OWNER_NUMBER=923001234567 npm start
```

Phir browser mein kholo: **http://localhost:3000**

1. Apna WhatsApp number likho (country code ke saath, bina `+` ke — masalan `923001234567`)
2. **Pairing Code Hasil Karein** dabao — 8-digit code milega
3. WhatsApp kholo → **⋮ → Linked devices → Link a device → "Link with phone number instead"**
4. Code daal do ✅ — kuch second mein **Connected ✓**

Session `session/` folder mein save rehti hai — server restart par dobara pair nahi karna padta.

## 🔧 Settings (env variables)

| Variable | Kaam | Lazmi? |
|---|---|---|
| `OWNER_NUMBER` | Owner ka number (bina `+`). Owner-only commands (`.vv`, `.mode`) aur pairing protection isi se hoti hai | ✅ Zaroor set karein |
| `PORT` | Web page ka port (default `3000`) | nahi |

Jab `OWNER_NUMBER` set ho to `/api/pair` sirf usi number ko code dega — koi ajnabi aapka bot hijack nahi kar sakta.

**Logout:** pairing page par *Logout* button admin token maangega — ye token server start hone par logs mein likha hota hai (`ADMIN TOKEN ...`).

## ☁️ Deploy (Render — free, recommended)

> ⚠️ **Vercel ke baare mein imaandaar baat:** Vercel *serverless* hai — uska function zyada se zyada 10–60 second chalta hai, phir band ho jata hai. WhatsApp bot ko **lagataar chalne wala connection** chahiye hota hai, is liye Vercel par bot 24/7 **nahi chalega** (pairing page khul jayega lekin bot connect nahi rahega). Is liye neeche wala tareeqa use karein — yehi sahi aur free hai.

1. Code ko GitHub repo mein push karo (`.gitignore` mein `session/` aur `node_modules/` pehle se hain)
2. [Render](https://render.com) → New → **Web Service** → repo connect karo (ya neeche di hui `render.yaml` se Blueprint use karo)
3. Build command: `npm install` · Start command: `npm start`
4. Environment mein `OWNER_NUMBER` add karo (apna number, masalan `923001234567`)
5. Deploy → mile hue URL kholo → pairing page se code lo → WhatsApp mein link karo

> **Disk note:** free Render par restart hone par session mit sakti hai — aise mein dobara pair karna padta hai (2 minute ka kaam). Permanent ke liye paid disk ya VPS behtar hai.

## ⚠️ Zaroori warning

Ye **unofficial** tareeqa hai (WhatsApp ke official Business API se nahi). Apne number par bot chalane se WhatsApp **temporary/permanent ban** laga sakta hai. Apne **main number ki jagah second number** use karna zyada safe hai.

## 🛠️ Tech

- [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web multi-device)
- Express (pairing web UI), Sharp (sticker/image processing)
- Downloaders: public Cobalt API · AI: Pollinations (free, keyless)
