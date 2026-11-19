// Regras dos pedidos: criar (reservando estoque), aprovar, pagar, entregar, cancelar.
//
// Caminho normal:
//   aguardando_aprovacao → (lojista aprova) → aguardando_pagamento (Pix) ou em_preparo (paga na entrega)
//   → em_preparo → saiu_entrega / pronto_retirada → concluido
// Se o lojista aprovar com frete MAIOR que o estimado: aguardando_cliente (o comprador aceita ou cancela).
// Pedido não aprovado/pago a tempo é cancelado sozinho e o estoque volta.
const { Loja, Produto, Pedido, Comprador } = require('../models');
const { ABERTOS } = require('../models/Pedido');
const { ErroApp } = require('../utils/erros');
const { somar, arredondar, paraCentavos } = require('../utils/dinheiro');
const { gerarPixCopiaCola } = require('../utils/pixEstatico');
const { calcularFrete } = require('./frete');
const avisos = require('./notificacoes');

const HORA_MS = 60 * 60 * 1000;

const NOMES_STATUS = {
  aguardando_aprovacao: 'Aguardando aprovação da loja',
  aguardando_cliente: 'Aguardando você aceitar o frete',
  aguardando_pagamento: 'Aguardando pagamento',
  em_preparo: 'Em preparo',
  saiu_entrega: 'Saiu para entrega',
  pronto_retirada: 'Pronto para retirada',
  concluido: 'Concluído',
  recusado: 'Recusado pela loja',
  cancelado: 'Cancelado',
};

function mudarStatus(pedido, status, obs = '') {
  pedido.status = status;
  pedido.historico.push({ status, em: new Date(), obs });
}

// ---------- Estoque ----------
async function devolverEstoque(pedido) {
  if (pedido.estoqueDevolvido) return;
  for (const it of pedido.itens) {
    await Produto.updateOne({ _id: it.produtoId, 'variacoes._id': it.varId }, { $inc: { 'variacoes.$.estoque': it.qtd } });
  }
  pedido.estoqueDevolvido = true;
}

// Tira do estoque de forma atômica: só desconta se ainda tiver a quantidade.
// Se um item falhar, devolve o que já tinha tirado.
async function reservarEstoque(lojaId, itens) {
  const feitos = [];
  for (const it of itens) {
    const r = await Produto.updateOne(
      { _id: it.produtoId, lojaId, variacoes: { $elemMatch: { _id: it.varId, estoque: { $gte: it.qtd } } } },
      { $inc: { 'variacoes.$.estoque': -it.qtd } }
    );
    if (!r.modifiedCount) {
      for (const f of feitos) await Produto.updateOne({ _id: f.produtoId, 'variacoes._id': f.varId }, { $inc: { 'variacoes.$.estoque': f.qtd } });
      const desc = [it.tamanho, it.cor].filter(Boolean).join(' / ');
      throw new ErroApp(409, `Acabou o estoque de "${it.nome}"${desc ? ` (${desc})` : ''}. Atualize o carrinho.`);
    }
    feitos.push(it);
  }
}

// ---------- Criar ----------
/**
 * @param {object} loja documento da loja
 * @param {string} compradorId
 * @param {{ itens: {produtoId, varId, qtd}[], modo: 'entrega'|'retirada', pagamento: 'pix'|'na_entrega' }} dados
 */
async function criarPedido(loja, compradorId, dados) {
  if (!loja.aberta) throw new ErroApp(409, 'A loja está pausada e não está recebendo pedidos agora.');
  if (dados.modo === 'entrega' && !loja.entrega?.ativa) throw new ErroApp(400, 'Esta loja não faz entregas. Escolha retirar no local.');
  if (dados.modo === 'retirada' && !loja.entrega?.retiradaAtiva) throw new ErroApp(400, 'Esta loja não tem retirada no local.');
  if (dados.pagamento === 'na_entrega' && !loja.pagamento?.aceitaNaEntrega) throw new ErroApp(400, 'Esta loja aceita só Pix.');
  if (dados.pagamento === 'pix' && !loja.pagamento?.chavePix) throw new ErroApp(400, 'A loja ainda não cadastrou a chave Pix. Escolha pagar na entrega ou fale com a loja.');

  const comprador = await Comprador.findOne({ _id: compradorId, lojaId: loja._id }).lean();
  if (!comprador) throw new ErroApp(401, 'Entre na sua conta para continuar.');

  // Junta itens repetidos e confere preço/estoque no banco (nunca confia no preço do app)
  const agrupados = new Map();
  for (const it of dados.itens) {
    const k = `${it.produtoId}|${it.varId}`;
    agrupados.set(k, { ...it, qtd: (agrupados.get(k)?.qtd || 0) + it.qtd });
  }
  const ids = [...new Set([...agrupados.values()].map((i) => i.produtoId))];
  const produtos = await Produto.find({ _id: { $in: ids }, lojaId: loja._id }).lean();
  const porId = new Map(produtos.map((p) => [String(p._id), p]));

  const itens = [];
  for (const it of agrupados.values()) {
    const p = porId.get(String(it.produtoId));
    if (!p || p.status !== 'publicado' || !p.ativo) throw new ErroApp(409, 'Um produto do carrinho não está mais disponível. Atualize o carrinho.');
    if (p.soNoLocal) throw new ErroApp(400, `"${p.nome}" é vendido só no local.`);
    const v = p.variacoes.find((x) => String(x._id) === String(it.varId));
    if (!v) throw new ErroApp(409, `Uma opção de "${p.nome}" mudou. Atualize o carrinho.`);
    itens.push({ produtoId: p._id, varId: v._id, nome: p.nome, tamanho: v.tamanho, cor: v.cor, foto: p.fotos?.[0] || '', preco: p.preco, qtd: it.qtd });
  }
  const subtotal = somar(itens.map((i) => i.preco * i.qtd));

  let frete = { distanciaKm: null, frete: 0 };
  if (dados.modo === 'entrega') {
    frete = await calcularFrete(loja, comprador.endereco);
    if (frete.foraDaArea) throw new ErroApp(400, frete.motivo);
  }

  await reservarEstoque(loja._id, itens);

  // Número sequencial do pedido nesta loja (atômico)
  const l = await Loja.findByIdAndUpdate(loja._id, { $inc: { proximoPedido: 1 } }, { new: false }).select('proximoPedido');

  const pedido = new Pedido({
    lojaId: loja._id,
    numero: l.proximoPedido,
    compradorId: comprador._id,
    comprador: { nome: comprador.nome, whatsapp: comprador.whatsapp, email: comprador.email },
    itens,
    modo: dados.modo,
    endereco: dados.modo === 'entrega' ? comprador.endereco : undefined,
    distanciaKm: frete.distanciaKm,
    freteEstimado: dados.modo === 'entrega' ? frete.frete : 0,
    pagamento: dados.pagamento,
    subtotal,
    total: somar([subtotal, frete.frete || 0]),
    expiraEm: new Date(Date.now() + (loja.regras?.horasParaExpirar || 12) * HORA_MS),
  });
  mudarStatus(pedido, 'aguardando_aprovacao');
  try {
    await pedido.save();
  } catch (erro) {
    await devolverEstoque(pedido);
    throw erro;
  }
  avisos.novoPedidoParaLojista(loja, pedido);
  return pedido;
}

// ---------- Ações ----------
async function carregar(lojaId, pedidoId, filtroExtra = {}) {
  const pedido = await Pedido.findOne({ _id: pedidoId, lojaId, ...filtroExtra });
  if (!pedido) throw new ErroApp(404, 'Pedido não encontrado.');
  return pedido;
}

function exigirStatus(pedido, permitidos, acao) {
  if (!permitidos.includes(pedido.status)) {
    throw new ErroApp(409, `Não dá para ${acao}: o pedido está "${NOMES_STATUS[pedido.status]}".`);
  }
}

function seguirDepoisDaAprovacao(pedido, loja) {
  if (pedido.pagamento === 'pix') {
    mudarStatus(pedido, 'aguardando_pagamento');
    pedido.expiraEm = new Date(Date.now() + (loja.regras?.horasParaExpirar || 12) * HORA_MS);
  } else {
    mudarStatus(pedido, 'em_preparo');
    pedido.expiraEm = null;
  }
}

/** Lojista aprova, confirmando frete final, quem entrega e o prazo */
async function aprovar(loja, pedidoId, { freteFinal, entregaPor, prazo }) {
  const pedido = await carregar(loja._id, pedidoId);
  exigirStatus(pedido, ['aguardando_aprovacao'], 'aprovar');
  if (pedido.pagamento === 'pix' && !loja.pagamento?.chavePix) throw new ErroApp(400, 'Cadastre sua chave Pix em "Entrega e Pix" antes de aprovar pedidos com Pix.');

  if (pedido.modo === 'entrega') {
    const frete = freteFinal ?? pedido.freteEstimado;
    if (frete == null) throw new ErroApp(400, 'Informe o valor do frete para este pedido.');
    pedido.freteFinal = arredondar(frete);
    pedido.entregaPor = entregaPor || 'proprio';
    pedido.total = somar([pedido.subtotal, pedido.freteFinal]);
    pedido.prazo = prazo || loja.entrega?.prazo || '';
    // Frete ficou mais caro que o mostrado ao comprador: ele precisa aceitar
    if (pedido.freteEstimado == null || paraCentavos(pedido.freteFinal) > paraCentavos(pedido.freteEstimado)) {
      mudarStatus(pedido, 'aguardando_cliente', `Frete final R$ ${pedido.freteFinal.toFixed(2)}`);
      await pedido.save();
      avisos.mudancaParaComprador(loja, pedido);
      return pedido;
    }
  } else {
    pedido.freteFinal = 0;
    pedido.prazo = prazo || loja.entrega?.prazoRetirada || '';
  }
  seguirDepoisDaAprovacao(pedido, loja);
  await pedido.save();
  avisos.mudancaParaComprador(loja, pedido);
  return pedido;
}

async function recusar(loja, pedidoId, motivo) {
  const pedido = await carregar(loja._id, pedidoId);
  exigirStatus(pedido, ABERTOS, 'recusar');
  pedido.motivo = motivo || 'Recusado pela loja';
  await devolverEstoque(pedido);
  mudarStatus(pedido, 'recusado', pedido.motivo);
  pedido.expiraEm = null;
  await pedido.save();
  avisos.mudancaParaComprador(loja, pedido);
  return pedido;
}

async function confirmarPagamento(loja, pedidoId) {
  const pedido = await carregar(loja._id, pedidoId);
  exigirStatus(pedido, ['aguardando_pagamento'], 'confirmar o pagamento');
  pedido.pago = true;
  pedido.expiraEm = null;
  mudarStatus(pedido, 'em_preparo', 'Pagamento confirmado');
  await pedido.save();
  avisos.mudancaParaComprador(loja, pedido);
  return pedido;
}

async function despachar(loja, pedidoId) {
  const pedido = await carregar(loja._id, pedidoId);
  exigirStatus(pedido, ['em_preparo'], 'marcar como enviado');
  mudarStatus(pedido, pedido.modo === 'entrega' ? 'saiu_entrega' : 'pronto_retirada');
  await pedido.save();
  avisos.mudancaParaComprador(loja, pedido);
  return pedido;
}

async function concluir(loja, pedidoId) {
  const pedido = await carregar(loja._id, pedidoId);
  exigirStatus(pedido, ['saiu_entrega', 'pronto_retirada'], 'concluir');
  pedido.pago = true;
  mudarStatus(pedido, 'concluido');
  await pedido.save();
  return pedido;
}

// ----- Ações do comprador -----
async function aceitarFrete(loja, compradorId, pedidoId) {
  const pedido = await carregar(loja._id, pedidoId, { compradorId });
  exigirStatus(pedido, ['aguardando_cliente'], 'aceitar o frete');
  seguirDepoisDaAprovacao(pedido, loja);
  pedido.historico[pedido.historico.length - 1].obs = 'Cliente aceitou o frete';
  await pedido.save();
  avisos.compradorRespondeu(loja, pedido, 'aceitou o novo frete');
  return pedido;
}

async function cancelarPeloComprador(loja, compradorId, pedidoId, motivo) {
  const pedido = await carregar(loja._id, pedidoId, { compradorId });
  exigirStatus(pedido, ABERTOS, 'cancelar');
  pedido.motivo = motivo || 'Cancelado pelo cliente';
  await devolverEstoque(pedido);
  mudarStatus(pedido, 'cancelado', pedido.motivo);
  pedido.expiraEm = null;
  await pedido.save();
  avisos.compradorRespondeu(loja, pedido, 'cancelou o pedido');
  return pedido;
}

// ----- Tarefa automática -----
async function expirarPedidos() {
  const vencidos = await Pedido.find({ status: { $in: ABERTOS }, expiraEm: { $ne: null, $lt: new Date() } }).limit(200);
  for (const pedido of vencidos) {
    await devolverEstoque(pedido);
    pedido.motivo = 'Cancelado automaticamente: o prazo para aprovação/pagamento acabou';
    mudarStatus(pedido, 'cancelado', pedido.motivo);
    pedido.expiraEm = null;
    await pedido.save();
  }
  return vencidos.length;
}

// Pix copia e cola com o valor do pedido (só quando está aguardando pagamento)
function pixDoPedido(loja, pedido) {
  if (pedido.status !== 'aguardando_pagamento' || !loja.pagamento?.chavePix) return null;
  return gerarPixCopiaCola({
    chave: loja.pagamento.chavePix,
    valor: pedido.total,
    nome: loja.pagamento.nomeRecebedor || loja.nome,
    cidade: loja.pagamento.cidade || loja.endereco?.cidade || 'BRASIL',
    txid: `PED${pedido.numero}`,
  });
}

module.exports = {
  criarPedido, aprovar, recusar, confirmarPagamento, despachar, concluir,
  aceitarFrete, cancelarPeloComprador, expirarPedidos, pixDoPedido, NOMES_STATUS,
};
