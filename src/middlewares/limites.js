// Limite de requisições por IP (protege contra abuso e robôs)
const rateLimit = require('express-rate-limit');

const padrao = { standardHeaders: 'draft-7', legacyHeaders: false };
const desligado = process.env.SEM_LIMITES === 'true'; // só para o teste automático
const criar = (o) => (desligado ? (_q, _r, n) => n() : rateLimit({ ...padrao, ...o }));

module.exports = {
  limiteLogin: criar({ windowMs: 15 * 60 * 1000, limit: 20, message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } }),
  limiteSenha: criar({ windowMs: 60 * 60 * 1000, limit: 5, message: { erro: 'Muitos pedidos de recuperação. Aguarde 1 hora.' } }),
  limitePedido: criar({ windowMs: 10 * 60 * 1000, limit: 10, message: { erro: 'Muitos pedidos seguidos. Aguarde alguns minutos.' } }),
  limiteDenuncia: criar({ windowMs: 10 * 60 * 1000, limit: 5, message: { erro: 'Você já enviou várias denúncias. Aguarde alguns minutos.' } }),
  limiteGeral: criar({ windowMs: 60 * 1000, limit: 150, message: { erro: 'Muitas requisições. Aguarde um instante.' } }),
};
