// Painel do LOJISTA: loja, aparência, entrega/Pix, produtos, pedidos e fotos
const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { Loja, Produto, Pedido } = require('../models');
const { SEGMENTOS, TEMAS } = require('../models/Loja');
const { exigirLogin, exigirLojista } = require('../middlewares/auth');
const { exigirLojaAtiva } = require('../middlewares/licenca');
const { validar } = require('../middlewares/validar');
const { limparCacheLoja } = require('../services/licenca');
const { lerModeracao } = require('../services/sistema');
const { statusParaProduto } = require('../services/moderacao');
const { geocodificar } = require('../services/frete');
const { salvarImagem, apagarImagensLocais } = require('../services/imagens');
const pedidos = require('../services/pedidos');
const { ErroApp } = require('../utils/erros');
const { normalizarTelefone } = require('../utils/formatos');
const { suporteWhatsapp, frontendUrls } = require('../config/env');

const router = express.Router();
router.use(exigirLogin, exigirLojista, exigirLojaAtiva);

const idValido = (id) => { if (!mongoose.isValidObjectId(id)) throw new ErroApp(400, 'Identificador inválido.'); };
const lojaDoUsuario = async (req) => {
  const loja = await Loja.findById(req.usuario.lojaId);
  if (!loja) throw new ErroApp(404, 'Loja não encontrada.');
  return loja;
};

// ---------- Loja ----------
router.get('/me', async (req, res) => {
  const loja = await Loja.findById(req.usuario.lojaId).lean();
  if (!loja) throw new ErroApp(404, 'Loja não encontrada.');
  const { segmentosBloqueados } = await lerModeracao();
  res.json({
    loja,
    link: `${frontendUrls[0]}/loja/${loja.slug}`,
    licenca: req.licenca,
    moderacao: req.moderacao,
    suporteWhatsapp,
    segmentosBloqueados,
  });
});

router.get('/resumo', async (req, res) => {
  const lojaId = new mongoose.Types.ObjectId(req.usuario.lojaId);
  const contagem = await Pedido.aggregate([{ $match: { lojaId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const por = Object.fromEntries(contagem.map((c) => [c._id, c.n]));
  const produtos = await Produto.countDocuments({ lojaId });
  const emAnalise = await Produto.countDocuments({ lojaId, status: { $in: ['analise', 'oculto'] } });
  res.json({
    aguardandoVoce: (por.aguardando_aprovacao || 0) + (por.aguardando_pagamento || 0),
    emAndamento: (por.aguardando_cliente || 0) + (por.em_preparo || 0) + (por.saiu_entrega || 0) + (por.pronto_retirada || 0),
    concluidos: por.concluido || 0,
    produtos,
    produtosEmAnalise: emAnalise,
  });
});

const lojaSchema = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  descricao: z.string().trim().max(300).optional(),
  whatsapp: z.string().regex(/^[\d\s()+-]{10,20}$/, 'WhatsApp inválido').optional(),
  instagram: z.string().trim().max(60).optional(),
  segmento: z.enum(SEGMENTOS).optional(),
  tema: z.enum(TEMAS).optional(),
  corPrimaria: z.string().regex(/^#[0-9a-f]{6}$/i, 'Cor inválida').optional(),
  logoUrl: z.string().max(500).optional(),
  bannerUrl: z.string().max(500).optional(),
  aberta: z.boolean().optional(),
  endereco: z.object({ texto: z.string().trim().max(150), cidade: z.string().trim().max(60), uf: z.string().trim().length(2).default('RJ') }).optional(),
  entrega: z.object({
    ativa: z.boolean(),
    valorKm: z.number().min(0).max(100),
    taxaMinima: z.number().min(0).max(1000),
    raioMaxKm: z.number().min(1).max(300),
    calculo: z.enum(['ida', 'ida_volta']),
    cidades: z.array(z.string().trim().min(2).max(60)).max(30),
    prazo: z.string().trim().max(80),
    retiradaAtiva: z.boolean(),
    prazoRetirada: z.string().trim().max(80),
  }).optional(),
  pagamento: z.object({
    chavePix: z.string().trim().max(77),
    nomeRecebedor: z.string().trim().max(25),
    cidade: z.string().trim().max(15),
    aceitaNaEntrega: z.boolean(),
  }).optional(),
  regras: z.object({ horasParaExpirar: z.number().int().min(1).max(168) }).optional(),
});

router.put('/loja', validar(lojaSchema), async (req, res) => {
  const d = req.validado;
  const loja = await lojaDoUsuario(req);
  if (d.segmento && d.segmento !== loja.segmento) {
    const { segmentosBloqueados } = await lerModeracao();
    if (segmentosBloqueados.includes(d.segmento)) throw new ErroApp(400, 'Este segmento ainda não está disponível.');
  }
  if (d.entrega && !d.entrega.ativa && !d.entrega.retiradaAtiva) throw new ErroApp(400, 'Deixe ativa pelo menos a entrega ou a retirada.');

  for (const campo of ['nome', 'descricao', 'instagram', 'segmento', 'tema', 'corPrimaria', 'logoUrl', 'bannerUrl', 'aberta']) {
    if (d[campo] !== undefined) loja[campo] = d[campo];
  }
  if (d.whatsapp) loja.whatsapp = normalizarTelefone(d.whatsapp);
  if (d.entrega) loja.entrega = d.entrega;
  if (d.pagamento) loja.pagamento = d.pagamento;
  if (d.regras) loja.regras = d.regras;
  let avisoEndereco = null;
  if (d.endereco) {
    const mudou = d.endereco.texto !== loja.endereco.texto || d.endereco.cidade !== loja.endereco.cidade;
    loja.endereco = { ...d.endereco, lat: mudou ? null : loja.endereco.lat, lng: mudou ? null : loja.endereco.lng };
    if (mudou && d.endereco.texto) {
      // Localiza o endereço da loja uma vez (ponto de partida do frete)
      const pos = await geocodificar(`${d.endereco.texto}, ${d.endereco.cidade}, ${d.endereco.uf}, Brasil`);
      if (pos) Object.assign(loja.endereco, pos);
      else avisoEndereco = 'Não encontramos esse endereço no mapa. O frete vai aparecer como "a combinar" até corrigir.';
    }
  }
  await loja.save();
  limparCacheLoja(loja);
  res.json({ loja: loja.toObject(), avisoEndereco });
});

// ---------- Fotos ----------
router.post('/imagens', express.json({ limit: '1mb' }), validar(z.object({ dados: z.string().max(1_000_000) })), async (req, res) => {
  res.status(201).json({ url: await salvarImagem(req.validado.dados, req.usuario.lojaId) });
});

// ---------- Produtos ----------
const variacaoSchema = z.object({
  _id: z.string().regex(/^[0-9a-f]{24}$/).optional(),
  tamanho: z.string().trim().max(20).default('Único'),
  cor: z.string().trim().max(30).default(''),
  estoque: z.number().int().min(0).max(100000),
});

const produtoSchema = z
  .object({
    nome: z.string().trim().min(2, 'Nome muito curto').max(100),
    descricao: z.string().trim().max(1000).default(''),
    categoria: z.string().trim().min(1).max(40).default('Outros'),
    preco: z.number().min(0).max(1_000_000),
    fotos: z.array(z.string().max(500)).max(5).default([]),
    soNoLocal: z.boolean().default(false),
    ativo: z.boolean().default(true),
    variacoes: z.array(variacaoSchema).max(60).default([]),
  })
  .refine((p) => p.soNoLocal || p.variacoes.length > 0, { message: 'Cadastre pelo menos uma variação com estoque.', path: ['variacoes'] });

router.get('/produtos', async (req, res) => {
  res.json(await Produto.find({ lojaId: req.usuario.lojaId }).sort({ createdAt: -1 }).lean());
});

router.get('/produtos/:id', async (req, res) => {
  idValido(req.params.id);
  const p = await Produto.findOne({ _id: req.params.id, lojaId: req.usuario.lojaId }).lean();
  if (!p) throw new ErroApp(404, 'Produto não encontrado.');
  res.json(p);
});

router.post('/produtos', validar(produtoSchema), async (req, res) => {
  const d = req.validado;
  const mod = await statusParaProduto(d, null);
  const p = await Produto.create({ ...d, lojaId: req.usuario.lojaId, ...mod });
  res.status(201).json(p);
});

router.put('/produtos/:id', validar(produtoSchema), async (req, res) => {
  idValido(req.params.id);
  const p = await Produto.findOne({ _id: req.params.id, lojaId: req.usuario.lojaId });
  if (!p) throw new ErroApp(404, 'Produto não encontrado.');
  const d = req.validado;
  const fotosRemovidas = p.fotos.filter((f) => !d.fotos.includes(f));
  Object.assign(p, { nome: d.nome, descricao: d.descricao, categoria: d.categoria, preco: d.preco, fotos: d.fotos, soNoLocal: d.soNoLocal, ativo: d.ativo });
  // Mantém o _id das variações que já existiam (os pedidos apontam para elas)
  p.variacoes = d.variacoes.map((v) => (v._id ? { _id: v._id, tamanho: v.tamanho, cor: v.cor, estoque: v.estoque } : v));
  Object.assign(p, await statusParaProduto(d, p.status));
  await p.save();
  apagarImagensLocais(fotosRemovidas).catch(() => {});
  res.json(p);
});

router.patch('/produtos/:id/ativo', validar(z.object({ ativo: z.boolean() })), async (req, res) => {
  idValido(req.params.id);
  const p = await Produto.findOneAndUpdate({ _id: req.params.id, lojaId: req.usuario.lojaId }, { $set: { ativo: req.validado.ativo } }, { new: true });
  if (!p) throw new ErroApp(404, 'Produto não encontrado.');
  res.json(p);
});

router.delete('/produtos/:id', async (req, res) => {
  idValido(req.params.id);
  const p = await Produto.findOneAndDelete({ _id: req.params.id, lojaId: req.usuario.lojaId });
  if (!p) throw new ErroApp(404, 'Produto não encontrado.');
  apagarImagensLocais(p.fotos).catch(() => {});
  res.json({ ok: true });
});

// ---------- Pedidos ----------
const listaSchema = z.object({
  grupo: z.enum(['aguardando', 'andamento', 'finalizados', 'todos']).default('todos'),
  pagina: z.coerce.number().int().min(1).default(1),
});
const GRUPOS = {
  aguardando: ['aguardando_aprovacao', 'aguardando_pagamento'],
  andamento: ['aguardando_cliente', 'em_preparo', 'saiu_entrega', 'pronto_retirada'],
  finalizados: ['concluido', 'recusado', 'cancelado'],
};

router.get('/pedidos', validar(listaSchema, 'query'), async (req, res) => {
  const { grupo, pagina } = req.validado;
  const filtro = { lojaId: req.usuario.lojaId };
  if (GRUPOS[grupo]) filtro.status = { $in: GRUPOS[grupo] };
  const limite = 30;
  const [itens, total] = await Promise.all([
    Pedido.find(filtro).sort({ createdAt: -1 }).skip((pagina - 1) * limite).limit(limite).select('-historico').lean(),
    Pedido.countDocuments(filtro),
  ]);
  res.json({ itens, total, pagina, paginas: Math.ceil(total / limite) });
});

router.get('/pedidos/:id', async (req, res) => {
  idValido(req.params.id);
  const p = await Pedido.findOne({ _id: req.params.id, lojaId: req.usuario.lojaId }).lean();
  if (!p) throw new ErroApp(404, 'Pedido não encontrado.');
  res.json(p);
});

const aprovarSchema = z.object({
  freteFinal: z.number().min(0).max(10000).nullable().optional(),
  entregaPor: z.enum(['proprio', 'terceiro']).optional(),
  prazo: z.string().trim().max(80).optional(),
});

router.post('/pedidos/:id/aprovar', validar(aprovarSchema), async (req, res) => {
  idValido(req.params.id);
  res.json(await pedidos.aprovar(await lojaDoUsuario(req), req.params.id, req.validado));
});
router.post('/pedidos/:id/recusar', validar(z.object({ motivo: z.string().trim().min(3, 'Escreva o motivo').max(200) })), async (req, res) => {
  idValido(req.params.id);
  res.json(await pedidos.recusar(await lojaDoUsuario(req), req.params.id, req.validado.motivo));
});
for (const [rota, acao] of [['confirmar-pagamento', 'confirmarPagamento'], ['despachar', 'despachar'], ['concluir', 'concluir']]) {
  router.post(`/pedidos/:id/${rota}`, async (req, res) => {
    idValido(req.params.id);
    res.json(await pedidos[acao](await lojaDoUsuario(req), req.params.id));
  });
}

module.exports = router;
