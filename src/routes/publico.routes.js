// Parte PÚBLICA: a vitrine de cada loja, conta do comprador, frete, pedidos e denúncias
const { Router } = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Loja, Produto, Pedido, Comprador, Denuncia } = require('../models');
const { SEGMENTOS } = require('../models/Loja');
const { gerarTokenComprador, exigirComprador } = require('../middlewares/auth');
const { validar } = require('../middlewares/validar');
const { limiteLogin, limiteSenha, limitePedido, limiteDenuncia } = require('../middlewares/limites');
const { lojaStatus } = require('../services/licenca');
const { lerModeracao } = require('../services/sistema');
const { calcularFrete } = require('../services/frete');
const { enviarSemEsperar } = require('../services/email');
const pedidos = require('../services/pedidos');
const { comCacheSWR } = require('../utils/cache');
const { ErroApp, ehDuplicado } = require('../utils/erros');
const { normalizarTelefone } = require('../utils/formatos');
const { novoTokenReset, hashToken } = require('../utils/tokens');
const { frontendUrls } = require('../config/env');

const router = Router();

// Lista de segmentos para a tela "criar loja" (os bloqueados aparecem como "em breve")
router.get('/segmentos', async (_req, res) => {
  const { segmentosBloqueados } = await lerModeracao();
  res.json(SEGMENTOS.map((s) => ({ id: s, disponivel: !segmentosBloqueados.includes(s) })));
});

// Carrega a loja do link e confere se está no ar (plano em dia e não bloqueada)
async function carregarLoja(req, _res, next) {
  const loja = await comCacheSWR(`publico:${req.params.slug}`, 30 * 1000, () => Loja.findOne({ slug: req.params.slug }).lean());
  if (!loja) return next(new ErroApp(404, 'Loja não encontrada. Confira o link.'));
  const st = await lojaStatus(loja._id);
  if (!st.disponivel) {
    const e = new ErroApp(403, 'Esta loja está temporariamente indisponível.');
    e.detalhes = { indisponivel: true, nome: loja.nome };
    return next(e);
  }
  req.loja = loja;
  next();
}

const r = Router({ mergeParams: true });
router.use('/lojas/:slug', carregarLoja, r);

function dadosPublicos(l) {
  return {
    id: l._id, nome: l.nome, slug: l.slug, segmento: l.segmento, descricao: l.descricao,
    whatsapp: l.whatsapp, instagram: l.instagram, tema: l.tema, corPrimaria: l.corPrimaria, logoUrl: l.logoUrl, bannerUrl: l.bannerUrl,
    aberta: l.aberta,
    endereco: { texto: l.endereco?.texto || '', cidade: l.endereco?.cidade || '' },
    entrega: {
      ativa: l.entrega.ativa, valorKm: l.entrega.valorKm, taxaMinima: l.entrega.taxaMinima, raioMaxKm: l.entrega.raioMaxKm,
      calculo: l.entrega.calculo, cidades: l.entrega.cidades, prazo: l.entrega.prazo,
      retiradaAtiva: l.entrega.retiradaAtiva, prazoRetirada: l.entrega.prazoRetirada,
    },
    pagamento: { pix: !!l.pagamento?.chavePix, aceitaNaEntrega: l.pagamento?.aceitaNaEntrega },
  };
}

const CAMPOS_PRODUTO = 'nome descricao categoria preco fotos soNoLocal variacoes createdAt';

r.get('/', (req, res) => res.json(dadosPublicos(req.loja)));

r.get('/produtos', async (req, res) => {
  const lista = await Produto.find({ lojaId: req.loja._id, status: 'publicado', ativo: true }).select(CAMPOS_PRODUTO).sort({ createdAt: -1 }).lean();
  res.json(lista);
});

r.get('/produtos/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErroApp(404, 'Produto não encontrado.');
  const p = await Produto.findOne({ _id: req.params.id, lojaId: req.loja._id, status: 'publicado', ativo: true }).select(CAMPOS_PRODUTO).lean();
  if (!p) throw new ErroApp(404, 'Produto não encontrado ou indisponível.');
  res.json(p);
});

// ---------- Conta do comprador ----------
const enderecoSchema = z.object({
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  rua: z.string().trim().min(2, 'Informe a rua').max(120),
  numero: z.string().trim().min(1, 'Informe o número').max(10),
  complemento: z.string().trim().max(60).default(''),
  bairro: z.string().trim().min(2, 'Informe o bairro').max(60),
  cidade: z.string().trim().min(2, 'Informe a cidade').max(60),
  uf: z.string().trim().length(2).default('RJ'),
});

const cadastroSchema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  whatsapp: z.string().regex(/^[\d\s()+-]{10,20}$/, 'WhatsApp inválido'),
  senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(100),
  endereco: enderecoSchema.optional(),
  aceitouTermos: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar os termos' }) }),
});

const dadosComprador = (c) => ({ id: c._id, nome: c.nome, email: c.email, whatsapp: c.whatsapp, endereco: c.endereco });

r.post('/conta/cadastro', limiteLogin, validar(cadastroSchema), async (req, res) => {
  const d = req.validado;
  try {
    const c = await Comprador.create({
      lojaId: req.loja._id, nome: d.nome, email: d.email, whatsapp: normalizarTelefone(d.whatsapp),
      senhaHash: await bcrypt.hash(d.senha, 10), endereco: d.endereco || {}, aceitouTermosEm: new Date(),
    });
    res.status(201).json({ token: gerarTokenComprador(c), comprador: dadosComprador(c) });
  } catch (erro) {
    if (ehDuplicado(erro)) throw new ErroApp(409, 'Você já tem conta nesta loja. Faça login.');
    throw erro;
  }
});

r.post('/conta/login', limiteLogin, validar(z.object({ email: z.string().trim().toLowerCase().email(), senha: z.string().min(1) })), async (req, res) => {
  const c = await Comprador.findOne({ lojaId: req.loja._id, email: req.validado.email }).select('+senhaHash');
  if (!c || !(await bcrypt.compare(req.validado.senha, c.senhaHash))) throw new ErroApp(401, 'E-mail ou senha incorretos.');
  res.json({ token: gerarTokenComprador(c), comprador: dadosComprador(c) });
});

r.post('/conta/esqueci-senha', limiteSenha, validar(z.object({ email: z.string().trim().toLowerCase().email() })), async (req, res) => {
  const c = await Comprador.findOne({ lojaId: req.loja._id, email: req.validado.email });
  if (c) {
    const { token, hash, expira } = novoTokenReset(60);
    await Comprador.updateOne({ _id: c._id }, { $set: { 'reset.hash': hash, 'reset.expira': expira } });
    enviarSemEsperar({
      para: c.email,
      assunto: `${req.loja.nome}: redefinir sua senha`,
      titulo: 'Redefinir senha',
      paragrafos: [`Recebemos um pedido para trocar a sua senha na loja ${req.loja.nome}. O link vale por 1 hora.`, 'Se não foi você, ignore este e-mail.'],
      botao: { texto: 'Criar nova senha', url: `${frontendUrls[0]}/loja/${req.loja.slug}/redefinir-senha?token=${token}` },
    });
  }
  res.json({ ok: true, mensagem: 'Se o e-mail estiver cadastrado, você vai receber um link em instantes.' });
});

r.post('/conta/redefinir-senha', limiteSenha, validar(z.object({ token: z.string().min(20).max(200), novaSenha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(100) })), async (req, res) => {
  const c = await Comprador.findOne({ lojaId: req.loja._id, 'reset.hash': hashToken(req.validado.token), 'reset.expira': { $gt: new Date() } });
  if (!c) throw new ErroApp(400, 'Link inválido ou vencido. Peça um novo.');
  await Comprador.updateOne({ _id: c._id }, { $set: { senhaHash: await bcrypt.hash(req.validado.novaSenha, 10) }, $unset: { reset: 1 } });
  res.json({ ok: true });
});

r.get('/conta', exigirComprador, async (req, res) => {
  const c = await Comprador.findOne({ _id: req.comprador.id, lojaId: req.loja._id }).lean();
  if (!c) throw new ErroApp(401, 'Entre na sua conta para continuar.');
  res.json(dadosComprador(c));
});

const atualizarContaSchema = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  whatsapp: z.string().regex(/^[\d\s()+-]{10,20}$/, 'WhatsApp inválido').optional(),
  endereco: enderecoSchema.optional(),
});

r.put('/conta', exigirComprador, validar(atualizarContaSchema), async (req, res) => {
  const d = req.validado;
  const set = {};
  if (d.nome) set.nome = d.nome;
  if (d.whatsapp) set.whatsapp = normalizarTelefone(d.whatsapp);
  if (d.endereco) set.endereco = d.endereco;
  const c = await Comprador.findOneAndUpdate({ _id: req.comprador.id, lojaId: req.loja._id }, { $set: set }, { new: true }).lean();
  if (!c) throw new ErroApp(401, 'Entre na sua conta para continuar.');
  res.json(dadosComprador(c));
});

// ---------- Frete (estimativa) ----------
r.post('/frete', exigirComprador, async (req, res) => {
  const c = await Comprador.findOne({ _id: req.comprador.id, lojaId: req.loja._id }).lean();
  if (!c) throw new ErroApp(401, 'Entre na sua conta para continuar.');
  res.json(await calcularFrete(req.loja, c.endereco));
});

// ---------- Pedidos ----------
const pedidoSchema = z.object({
  itens: z.array(z.object({
    produtoId: z.string().regex(/^[0-9a-f]{24}$/),
    varId: z.string().regex(/^[0-9a-f]{24}$/),
    qtd: z.number().int().min(1).max(50),
  })).min(1, 'O carrinho está vazio').max(40),
  modo: z.enum(['entrega', 'retirada']),
  pagamento: z.enum(['pix', 'na_entrega']),
});

function pedidoParaComprador(loja, p) {
  return {
    ...p,
    nomeStatus: pedidos.NOMES_STATUS[p.status],
    pixCopiaCola: pedidos.pixDoPedido(loja, p),
    lojaWhatsapp: loja.whatsapp,
    retiradaEndereco: p.modo === 'retirada' ? [loja.endereco?.texto, loja.endereco?.cidade].filter(Boolean).join(' - ') : '',
  };
}

r.post('/pedidos', limitePedido, exigirComprador, validar(pedidoSchema), async (req, res) => {
  const p = await pedidos.criarPedido(req.loja, req.comprador.id, req.validado);
  res.status(201).json(pedidoParaComprador(req.loja, p.toObject()));
});

r.get('/pedidos', exigirComprador, async (req, res) => {
  const lista = await Pedido.find({ lojaId: req.loja._id, compradorId: req.comprador.id }).sort({ createdAt: -1 }).limit(50).select('-historico').lean();
  res.json(lista.map((p) => ({ ...p, nomeStatus: pedidos.NOMES_STATUS[p.status] })));
});

r.get('/pedidos/:id', exigirComprador, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErroApp(404, 'Pedido não encontrado.');
  const p = await Pedido.findOne({ _id: req.params.id, lojaId: req.loja._id, compradorId: req.comprador.id }).lean();
  if (!p) throw new ErroApp(404, 'Pedido não encontrado.');
  res.json(pedidoParaComprador(req.loja, p));
});

r.post('/pedidos/:id/aceitar-frete', exigirComprador, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErroApp(404, 'Pedido não encontrado.');
  const loja = await Loja.findById(req.loja._id).lean(); // dados atualizados (prazo do Pix)
  const p = await pedidos.aceitarFrete(loja, req.comprador.id, req.params.id);
  res.json(pedidoParaComprador(loja, p.toObject()));
});

r.post('/pedidos/:id/cancelar', exigirComprador, validar(z.object({ motivo: z.string().trim().max(200).optional() })), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErroApp(404, 'Pedido não encontrado.');
  const p = await pedidos.cancelarPeloComprador(req.loja, req.comprador.id, req.params.id, req.validado.motivo);
  res.json(pedidoParaComprador(req.loja, p.toObject()));
});

// ---------- Denúncia ----------
const denunciaSchema = z.object({
  produtoId: z.string().regex(/^[0-9a-f]{24}$/).nullable().optional(),
  motivo: z.enum(['proibido', 'golpe', 'falsificado', 'ofensivo', 'outro']),
  texto: z.string().trim().max(500).default(''),
  contato: z.string().trim().max(100).default(''),
});

r.post('/denuncias', limiteDenuncia, validar(denunciaSchema), async (req, res) => {
  await Denuncia.create({ ...req.validado, lojaId: req.loja._id });
  res.status(201).json({ ok: true, mensagem: 'Obrigado! Vamos analisar.' });
});

module.exports = router;
