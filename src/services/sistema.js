// Configurações gerais (aviso/manutenção e moderação), controladas por você no /admin
const { Config } = require('../models');
const { PALAVRAS_PADRAO } = require('../models/Config');
const { comCache, invalidar } = require('../utils/cache');

const CHAVE = 'sistema';

function lerConfig() {
  return comCache('config:sistema', 15 * 1000, async () => {
    const c = await Config.findOne({ chave: CHAVE }).lean();
    return c || {};
  });
}

function situacaoDoAviso(aviso, agora = new Date()) {
  if (!aviso?.ativo || !aviso.mensagem) return 'nada';
  if (aviso.fim && agora >= new Date(aviso.fim)) return 'nada';
  if (aviso.inicio && agora < new Date(aviso.inicio)) return 'programado';
  return 'vigente';
}

async function avisoPublico() {
  const { aviso } = await lerConfig();
  const situacao = situacaoDoAviso(aviso);
  if (situacao === 'nada') return null;
  return {
    tipo: aviso.tipo,
    mensagem: aviso.mensagem,
    inicio: aviso.inicio,
    fim: aviso.fim,
    mostrarPara: aviso.mostrarPara,
    situacao,
    bloqueando: situacao === 'vigente' && aviso.tipo === 'manutencao' && aviso.bloquear,
    versao: new Date(aviso.atualizadoEm || 0).getTime(),
  };
}

async function lerAvisoCompleto() {
  return (await lerConfig()).aviso || { ativo: false };
}

async function salvarAviso(dados) {
  await Config.updateOne({ chave: CHAVE }, { $set: { aviso: { ...dados, atualizadoEm: new Date() } } }, { upsert: true });
  invalidar('config:sistema');
}

async function lerModeracao() {
  const m = (await lerConfig()).moderacao || {};
  return {
    palavras: m.palavras || PALAVRAS_PADRAO,
    aprovacaoManual: !!m.aprovacaoManual,
    segmentosBloqueados: m.segmentosBloqueados || ['alimentos'],
  };
}

async function salvarModeracao(dados) {
  await Config.updateOne({ chave: CHAVE }, { $set: { moderacao: dados } }, { upsert: true });
  invalidar('config:sistema');
}

module.exports = { avisoPublico, lerAvisoCompleto, salvarAviso, situacaoDoAviso, lerModeracao, salvarModeracao };
