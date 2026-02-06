const argon2 = require('argon2');
const crypto = require('crypto');

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
};

async function hashKey(rawKey) {
  return argon2.hash(rawKey, ARGON2_OPTIONS);
}

async function verifyKey(rawKey, hash) {
  return argon2.verify(hash, rawKey);
}

function keyPrefix(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 8);
}

module.exports = { hashKey, verifyKey, keyPrefix };
