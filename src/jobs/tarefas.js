// Tarefas automáticas (rodam sozinhas enquanto a API estiver ligada)
const cron = require('node-cron');
const { Loja } = require('../models');
const { expirarPedidos } = require('../services/pedidos');
const { statusLicenca, DIA_MS } = require('../services/licenca');
const { avisoPlano, emailDoLojista } = require('../services/notificacoes');
const { hojeISO } = require('../utils/formatos');
const { fuso } = require('../config/env');

// Avisa o lojista por e-mail 5 dias antes, 1 dia antes e no dia em que o plano vence.
// (O bloqueio em si não depende desta tarefa: é conferido a cada acesso.)
async function avisarPlanos() {
  const hoje = hojeISO();
  const agora = Date.now();
  const lojas = await Loja.find({
    'licenca.acessoAte': { $gt: new Date(agora - DIA_MS), $lte: new Date(agora + 5 * DIA_MS) },
    'licenca.ultimoAvisoEm': { $ne: hoje },
  }).select('nome licenca').lean();

  for (const l of lojas) {
    const st = statusLicenca(l.licenca);
    let texto = null;
    if (!st.ativa) texto = 'venceu';
    else if (st.diasRestantes === 1) texto = 'vence amanhã';
    else if (st.diasRestantes === 5) texto = 'vence em 5 dias';
    if (!texto) continue;
    avisoPlano(l, await emailDoLojista(l._id), texto);
    await Loja.updateOne({ _id: l._id }, { $set: { 'licenca.ultimoAvisoEm': hoje } });
  }
}

function seguro(nome, fn) {
  return () => fn().catch((erro) => console.error(`❌ Tarefa "${nome}" falhou:`, erro.message));
}

function iniciarTarefas() {
  cron.schedule('*/5 * * * *', seguro('expirar pedidos', expirarPedidos), { timezone: fuso });
  cron.schedule('0 9 * * *', seguro('avisos de plano', avisarPlanos), { timezone: fuso });
  console.log('⏰ Tarefas automáticas iniciadas');
}

module.exports = { iniciarTarefas, avisarPlanos };
