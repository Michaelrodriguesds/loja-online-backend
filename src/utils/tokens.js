// Tokens de recuperação de senha: o link leva o token; o banco guarda só o hash
const crypto = require('crypto');

function novoTokenReset(minutos = 60) {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token), expira: new Date(Date.now() + minutos * 60 * 1000) };
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { novoTokenReset, hashToken };
