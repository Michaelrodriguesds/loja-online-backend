// Painel do DESENVOLVEDOR (você): lojas, planos, moderação, denúncias e avisos
const { Router } = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Loja, Usuario, Produto, Pedido, Comprador, Denuncia, Imagem } = require('../models');
const { SEGMENTOS } = require('../models/Loja');
const { exigirLogin, exigirAdmin } = require('../middlewares/auth');
const { validar } = require('../middlewares/validar');
const { statusLicenca, renovar, vencerAgora, limparCacheLoja } = require('../services/licenca');
const { lerAvisoCompleto, salvarAviso, avisoPublico, lerModeracao, salvarModeracao } = require('../services/sistema');
const { ErroApp } = require('../utils/erros');
const { diasPlano, frontendUrls } = require('../config/env');

const router = Router();
router.use(exigirLogin, exigirAdmin);

const idValido = (id) => { if (!mongoose.isValidObjectId(id)) throw new ErroApp(400, 'Identificador inválido.'); };

async function listarComDono(filtro = {}) {
  const lojas = await Loja.find(filtro).select('nome slug segmento whatsapp licenca moderacao aberta createdAt').sort({ 'licenca.acessoAte': 1 }).lean();
  const ids = lojas.map((l) => l._id);
  const [donos, produtos, pedidosMes] = await Promise.all([
    Usuario.find({ papel: 'lojista', lojaId: { $in: ids } }).select('nome email lojaId').lean(),
    Produto.aggregate([{ $match: { lojaId: { $in: ids } } }, { $group: { _id: '$lojaId', n: { $sum: 1 } } }]),
    Pedido.aggregate([{ $match: { lojaId: { $in: ids }, createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } } }, { $group: { _id: '$lojaId', n: { $sum: 1 } } }]),
  ]);
  const mapa = (lista, f) => new Map(lista.map((x) => [String(x.lojaId || x._id), f(x)]));
  const porDono = mapa(donos, (d) => ({ nome: d.nome, email: d.email }));
  const porProdutos = mapa(produtos, (x) => x.n);
  const porPedidos = mapa(pedidosMes, (x) => x.n);
  return lojas.map((l) => {
    const licenca = statusLicenca(l.licenca);
    return {
      ...l,
      link: `${frontendUrls[0]}/loja/${l.slug}`,
      dono: porDono.get(String(l._id)) || null,
      produtos: porProdutos.get(String(l._id)) || 0,
      pedidosMes: porPedidos.get(String(l._id)) || 0,
      licenca,
      observacao: l.licenca.observacao,
      situacao: l.moderacao?.bloqueada ? 'bloqueada' : licenca.situacao,
    };
  });
}

// ---------- Lojas ----------
router.get('/resumo', async (_req, res) => {
  const lista = await Loja.find().select('licenca moderacao').lean();
  const c = { total: lista.length, teste: 0, ativo: 0, vencendo: 0, vencido: 0, bloqueada: 0 };
  for (const l of lista) c[l.moderacao?.bloqueada ? 'bloqueada' : statusLicenca(l.licenca).situacao]++;
  c.produtosEmAnalise = await Produto.countDocuments({ status: 'analise' });
  c.denunciasNovas = await Denuncia.countDocuments({ status: 'nova' });
  res.json(c);
});

router.get('/lojas', async (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const filtro = busca ? { nome: { $regex: busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  const lista = await listarComDono(filtro);
  const situacao = req.query.situacao;
  res.json(situacao ? lista.filter((l) => l.situacao === situacao) : lista);
});

router.get('/lojas/:id', async (req, res) => {
  idValido(req.params.id);
  const [l] = await listarComDono({ _id: new mongoose.Types.ObjectId(req.params.id) });
  if (!l) throw new ErroApp(404, 'Loja não encontrada.');
  res.json(l);
});

// Você recebeu o pagamento → renova (+30 dias por padrão)
router.post('/lojas/:id/renovar', validar(z.object({ dias: z.number().int().min(1).max(366).default(diasPlano), observacao: z.string().max(200).optional() })), async (req, res) => {
  idValido(req.params.id);
  res.json(await renovar(req.params.id, req.validado.dias, req.validado.observacao));
});

// Faz o plano vencer agora (ex.: pagamento estornado)
router.post('/lojas/:id/vencer', async (req, res) => {
  idValido(req.params.id);
  await vencerAgora(req.params.id);
  res.json({ ok: true });
});

// Bloqueio por moderação (produto proibido, golpe...). Independe do plano.
router.post('/lojas/:id/moderar', validar(z.object({ bloquear: z.boolean(), motivo: z.string().trim().max(200).default('') })), async (req, res) => {
  idValido(req.params.id);
  const { bloquear, motivo } = req.validado;
  if (bloquear && motivo.length < 3) throw new ErroApp(400, 'Escreva o motivo do bloqueio (o lojista vai ver).');
  const l = await Loja.findByIdAndUpdate(
    req.params.id,
    { $set: { moderacao: { bloqueada: bloquear, motivo: bloquear ? motivo : '', em: new Date() } } },
    { new: true }
  ).select('slug moderacao');
  if (!l) throw new ErroApp(404, 'Loja não encontrada.');
  limparCacheLoja(l);
  res.json({ ok: true, moderacao: l.moderacao });
});

router.post('/lojas/:id/resetar-senha', validar(z.object({ novaSenha: z.string().min(8).max(100) })), async (req, res) => {
  idValido(req.params.id);
  const r = await Usuario.updateOne({ lojaId: req.params.id, papel: 'lojista' }, { $set: { senhaHash: await bcrypt.hash(req.validado.novaSenha, 10) } });
  if (!r.matchedCount) throw new ErroApp(404, 'Usuário da loja não encontrado.');
  res.json({ ok: true });
});

// Exclui a loja e TUDO dela. Não tem volta: precisa digitar o nome exato da loja.
router.post('/lojas/:id/excluir', validar(z.object({ confirmacao: z.string().trim().min(1) })), async (req, res) => {
  idValido(req.params.id);
  const l = await Loja.findById(req.params.id).select('nome slug').lean();
  if (!l) throw new ErroApp(404, 'Loja não encontrada.');
  const igual = (t) => t.trim().toLocaleLowerCase('pt-BR');
  if (igual(req.validado.confirmacao) !== igual(l.nome)) throw new ErroApp(400, `O nome digitado não confere. Digite exatamente: ${l.nome}`);
  const f = { lojaId: l._id };
  const [produtos, pedidos, compradores] = await Promise.all([
    Produto.deleteMany(f), Pedido.deleteMany(f), Comprador.deleteMany(f),
    Imagem.deleteMany(f), Denuncia.deleteMany(f), Usuario.deleteMany({ lojaId: l._id, papel: 'lojista' }),
  ]);
  await Loja.deleteOne({ _id: l._id });
  limparCacheLoja(l);
  res.json({ ok: true, excluidos: { produtos: produtos.deletedCount, pedidos: pedidos.deletedCount, compradores: compradores.deletedCount } });
});

// ---------- Moderação de produtos ----------
router.get('/produtos', validar(z.object({
  status: z.enum(['publicado', 'analise', 'oculto']).optional(),
  lojaId: z.string().regex(/^[0-9a-f]{24}$/).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
}), 'query'), async (req, res) => {
  const { status, lojaId, pagina } = req.validado;
  const filtro = {};
  if (status) filtro.status = status;
  if (lojaId) filtro.lojaId = lojaId;
  const limite = 30;
  const [itens, total] = await Promise.all([
    Produto.find(filtro).sort({ updatedAt: -1 }).skip((pagina - 1) * limite).limit(limite)
      .select('lojaId nome descricao categoria preco fotos status motivoModeracao ativo updatedAt').populate('lojaId', 'nome slug').lean(),
    Produto.countDocuments(filtro),
  ]);
  res.json({ itens, total, pagina, paginas: Math.ceil(total / limite) });
});

router.post('/produtos/:id/moderar', validar(z.object({ status: z.enum(['publicado', 'oculto']), motivo: z.string().trim().max(200).default('') })), async (req, res) => {
  idValido(req.params.id);
  const { status, motivo } = req.validado;
  const p = await Produto.findByIdAndUpdate(req.params.id, { $set: { status, motivoModeracao: status === 'oculto' ? motivo || 'Ocultado pelo administrador' : '' } }, { new: true });
  if (!p) throw new ErroApp(404, 'Produto não encontrado.');
  res.json(p);
});

// ---------- Denúncias ----------
router.get('/denuncias', async (req, res) => {
  const filtro = req.query.status ? { status: String(req.query.status) } : {};
  const lista = await Denuncia.find(filtro).sort({ createdAt: -1 }).limit(100).populate('lojaId', 'nome slug').populate('produtoId', 'nome').lean();
  res.json(lista);
});

router.patch('/denuncias/:id', validar(z.object({ status: z.enum(['nova', 'resolvida', 'descartada']) })), async (req, res) => {
  idValido(req.params.id);
  const d = await Denuncia.findByIdAndUpdate(req.params.id, { $set: { status: req.validado.status } }, { new: true });
  if (!d) throw new ErroApp(404, 'Denúncia não encontrada.');
  res.json(d);
});

// ---------- Regras de moderação ----------
router.get('/moderacao', async (_req, res) => res.json({ ...(await lerModeracao()), segmentos: SEGMENTOS }));

router.put('/moderacao', validar(z.object({
  palavras: z.array(z.string().trim().min(2).max(40)).max(300),
  aprovacaoManual: z.boolean(),
  segmentosBloqueados: z.array(z.enum(SEGMENTOS)),
})), async (req, res) => {
  await salvarModeracao(req.validado);
  res.json(await lerModeracao());
});

// ---------- Aviso geral e manutenção ----------
router.get('/aviso', async (_req, res) => res.json({ aviso: await lerAvisoCompleto(), situacao: await avisoPublico() }));

const avisoSchema = z
  .object({
    ativo: z.boolean(),
    tipo: z.enum(['informativo', 'manutencao']),
    mensagem: z.string().trim().max(500),
    inicio: z.string().datetime({ offset: true }).nullable().optional(),
    fim: z.string().datetime({ offset: true }).nullable().optional(),
    bloquear: z.boolean().default(false),
    mostrarPara: z.enum(['todos', 'lojistas']).default('lojistas'),
  })
  .refine((a) => !a.ativo || a.mensagem.length >= 5, { message: 'Escreva a mensagem do aviso.', path: ['mensagem'] })
  .refine((a) => !a.inicio || !a.fim || new Date(a.fim) > new Date(a.inicio), { message: 'O fim precisa ser depois do início.', path: ['fim'] });

router.put('/aviso', validar(avisoSchema), async (req, res) => {
  const a = req.validado;
  await salvarAviso({ ...a, inicio: a.inicio ? new Date(a.inicio) : null, fim: a.fim ? new Date(a.fim) : null, bloquear: a.tipo === 'manutencao' ? a.bloquear : false });
  res.json({ aviso: await lerAvisoCompleto(), situacao: await avisoPublico() });
});

module.exports = router;
