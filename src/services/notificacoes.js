// Todos os e-mails automáticos do sistema (sem chave do Resend, só aparecem no terminal)
const { Usuario } = require('../models');
const { enviarSemEsperar } = require('./email');
const { frontendUrls } = require('../config/env');

const site = () => frontendUrls[0];
const reais = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

async function emailDoLojista(lojaId) {
  const u = await Usuario.findOne({ lojaId, papel: 'lojista' }).select('email').lean();
  return u?.email;
}

function novoPedidoParaLojista(loja, pedido) {
  emailDoLojista(loja._id).then((para) => enviarSemEsperar({
    para,
    assunto: `Novo pedido #${pedido.numero} na ${loja.nome}`,
    titulo: `Novo pedido #${pedido.numero}`,
    paragrafos: [
      `${pedido.comprador.nome} fez um pedido de ${reais(pedido.total)} (${pedido.modo === 'entrega' ? 'entrega' : 'retirada'}).`,
      'Abra o painel para conferir e aprovar.',
    ],
    botao: { texto: 'Ver pedido', url: `${site()}/painel/pedidos/${pedido._id}` },
  })).catch(() => {});
}

const TEXTOS_COMPRADOR = {
  aguardando_cliente: (p) => `A loja confirmou o frete em ${reais(p.freteFinal)}. Abra o pedido para aceitar ou cancelar.`,
  aguardando_pagamento: (p) => `Seu pedido foi aprovado! Total: ${reais(p.total)}. Abra o pedido para pagar com Pix.`,
  em_preparo: (p) => (p.pago ? 'Pagamento confirmado. Seu pedido está sendo preparado.' : 'Seu pedido foi aprovado e está sendo preparado.'),
  saiu_entrega: () => 'Seu pedido saiu para entrega!',
  pronto_retirada: () => 'Seu pedido está pronto para retirada.',
  recusado: (p) => `A loja não pôde aceitar seu pedido. Motivo: ${p.motivo}`,
};

function mudancaParaComprador(loja, pedido) {
  const texto = TEXTOS_COMPRADOR[pedido.status];
  if (!texto) return;
  enviarSemEsperar({
    para: pedido.comprador.email,
    assunto: `${loja.nome}: pedido #${pedido.numero} atualizado`,
    titulo: `Pedido #${pedido.numero}`,
    paragrafos: [texto(pedido)],
    botao: { texto: 'Acompanhar pedido', url: `${site()}/loja/${loja.slug}/pedidos/${pedido._id}` },
  });
}

function compradorRespondeu(loja, pedido, acao) {
  emailDoLojista(loja._id).then((para) => enviarSemEsperar({
    para,
    assunto: `Pedido #${pedido.numero}: o cliente ${acao}`,
    titulo: `Pedido #${pedido.numero}`,
    paragrafos: [`${pedido.comprador.nome} ${acao}.`],
    botao: { texto: 'Ver pedido', url: `${site()}/painel/pedidos/${pedido._id}` },
  })).catch(() => {});
}

function avisoPlano(loja, para, texto) {
  enviarSemEsperar({
    para,
    assunto: `Seu plano da loja ${loja.nome} ${texto}`,
    titulo: `Plano ${texto}`,
    paragrafos: [
      `O plano da loja ${loja.nome} ${texto}.`,
      'Quando vence, a loja sai do ar automaticamente (seus produtos e pedidos ficam guardados). Fale com o suporte para renovar.',
    ],
    botao: { texto: 'Abrir painel', url: `${site()}/painel` },
  });
}

module.exports = { novoPedidoParaLojista, mudancaParaComprador, compradorRespondeu, avisoPlano, emailDoLojista };
