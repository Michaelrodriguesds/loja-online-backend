// Controle de licença: 30 dias grátis, depois o lojista paga você todo mês.
// O bloqueio é AUTOMÁTICO: toda requisição compara "acessoAte" com agora.
const { Loja } = require('../models');
const { comCache, invalidar } = require('../utils/cache');
const { diasPlano } = require('../config/env');
const { ErroApp } = require('../utils/erros');

const DIA_MS = 24 * 60 * 60 * 1000;

function statusLicenca(licenca) {
  const restanteMs = new Date(licenca.acessoAte).getTime() - Date.now();
  const ativa = restanteMs > 0;
  return {
    plano: licenca.plano,
    acessoAte: licenca.acessoAte,
    ativa,
    diasRestantes: ativa ? Math.ceil(restanteMs / DIA_MS) : 0,
    situacao: !ativa ? 'vencido' : restanteMs <= 5 * DIA_MS ? 'vencendo' : licenca.plano === 'teste' ? 'teste' : 'ativo',
  };
}

// Situação completa da loja (plano + bloqueio manual). Cache de 1 minuto.
function lojaStatus(lojaId) {
  return comCache(`status:${lojaId}`, 60 * 1000, async () => {
    const l = await Loja.findById(lojaId).select('licenca moderacao').lean();
    if (!l) throw new ErroApp(404, 'Loja não encontrada');
    const licenca = statusLicenca(l.licenca);
    const moderacao = { bloqueada: !!l.moderacao?.bloqueada, motivo: l.moderacao?.motivo || '' };
    return { licenca, moderacao, disponivel: licenca.ativa && !moderacao.bloqueada };
  });
}

function limparCacheLoja(loja) {
  invalidar(`status:${loja._id}`);
  if (loja.slug) invalidar(`publico:${loja.slug}`);
}

// Renova somando dias: se ainda estava ativa, conta a partir do vencimento
// (o lojista não perde os dias que faltavam); se já venceu, conta de hoje.
async function renovar(lojaId, dias = diasPlano, observacao = '') {
  const l = await Loja.findById(lojaId);
  if (!l) throw new ErroApp(404, 'Loja não encontrada');
  const base = Math.max(new Date(l.licenca.acessoAte).getTime(), Date.now());
  l.licenca.acessoAte = new Date(base + dias * DIA_MS);
  l.licenca.plano = 'pago';
  l.licenca.ultimoAvisoEm = '';
  if (observacao) l.licenca.observacao = observacao;
  await l.save();
  limparCacheLoja(l);
  return statusLicenca(l.licenca);
}

async function vencerAgora(lojaId) {
  const l = await Loja.findByIdAndUpdate(lojaId, { $set: { 'licenca.acessoAte': new Date() } }, { new: true }).select('slug');
  if (!l) throw new ErroApp(404, 'Loja não encontrada');
  limparCacheLoja(l);
}

module.exports = { statusLicenca, lojaStatus, limparCacheLoja, renovar, vencerAgora, DIA_MS };
