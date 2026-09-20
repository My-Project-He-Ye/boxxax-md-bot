// ─── BOXXAXMD · Baileys auth state on Upstash Redis (REST) ────────────
// useMultiFileAuthState() jaisa interface: { state, saveCreds } — plus
// clearAll() jo logout/401 par saari session keys delete karta hai.
// Render free tier ki disk ephemeral hai, is liye session Redis mein rehta hai.
// Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Redis.fromEnv).

const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { Redis } = require('@upstash/redis');

const DEFAULT_PREFIX = 'boxxaxmd:auth';

// Dono env vars set hon to hi Redis auth use hoga — warna file auth fallback.
function redisConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function makeRedisClient() {
  // fromEnv() UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN parhta hai
  return Redis.fromEnv();
}

// Saare keys jo is prefix ke neeche hain delete karo (logout / 401 ke liye).
async function clearAuthKeys(redis, prefix = DEFAULT_PREFIX) {
  let cursor = 0;
  const doomed = [];
  do {
    const [next, keys] = await redis.scan(cursor, { match: `${prefix}:*`, count: 100 });
    cursor = Number(next);
    if (keys && keys.length) doomed.push(...keys);
  } while (cursor !== 0);
  for (let i = 0; i < doomed.length; i += 50) {
    const p = redis.pipeline();
    for (const k of doomed.slice(i, i + 50)) p.del(k);
    await p.exec();
  }
  return doomed.length;
}

// Baileys useMultiFileAuthState jaisa: { state: { creds, keys }, saveCreds }
// + clearAll(). Redis key layout:
//   boxxaxmd:auth:creds
//   boxxaxmd:auth:key:<type>:<id>
async function useRedisAuthState(redis, prefix = DEFAULT_PREFIX) {
  const credsKey = `${prefix}:creds`;
  const keyFor = (type, id) => `${prefix}:key:${String(type).replace(/[:/]/g, '_')}:${id}`;

  const readData = async (key) => {
    try {
      const raw = await redis.get(key);
      if (raw == null) return null;
      // Hamesha string store karte hain, lekin Upstash kabhi object de de
      // to use bhi sambhal lo.
      const txt = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return JSON.parse(txt, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (pipe, key, data) =>
    pipe.set(key, JSON.stringify(data, BufferJSON.replacer));

  const creds = (await readData(credsKey)) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(keyFor(type, id));
            if (type === 'app-state-sync-key' && value) {
              value = proto.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const pipe = redis.pipeline();
          let n = 0;
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const k = keyFor(category, id);
              if (value) { writeData(pipe, k, value); n++; }
              else { pipe.del(k); n++; }
            }
          }
          if (n > 0) await pipe.exec();
        },
      },
    },
    saveCreds: () => redis.set(credsKey, JSON.stringify(creds, BufferJSON.replacer)),
    clearAll: () => clearAuthKeys(redis, prefix),
  };
}

module.exports = { useRedisAuthState, clearAuthKeys, makeRedisClient, redisConfigured, DEFAULT_PREFIX };
