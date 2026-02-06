const crypto = require('crypto');

function generateKey() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { generateKey };
