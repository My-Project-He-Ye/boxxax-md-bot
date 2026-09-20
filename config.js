// ─── Boss MD Bot · config ─────────────────────────────
module.exports = {
  botName: 'BOXXAXMD',
  prefix: '.',
  // Bot owner number (digits only, with country code, no +).
  // Owner-only commands (.kick, .tagall etc.) sirf isi number se chalenge.
  owner: process.env.OWNER_NUMBER || '',
  // Web pairing page ka port
  port: process.env.PORT || 3000,
  // Session folder (login state yahan save hota hai — dobara pair nahi karna padta)
  sessionDir: './session',
};
