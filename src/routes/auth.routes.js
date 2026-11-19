// Cadastro e login do lojista (e login do admin), recuperação de senha
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Loja, Usuario } = require('../models');
const { SEGMENTOS, TEMAS } = require('../models/Loja');
const { gerarToken, exigirLogin } = require('../middlewares/auth');
const { validar } = require('../middlewares/validar');
const { limiteLogin, limiteSenha } = require('../middlewares/limites');
const { statusLicenca, DIA_MS } = require('../services/licenca');
const { lerModeracao } = require('../services/sistema');
const { enviarSemEsperar } = require('../services/email');
const { ErroApp, ehDuplicado } = require('../utils/erros');
const { gerarSlug, normalizarTelefone } = require('../utils/formatos');
const { novoTokenReset, hashToken } = require('../utils/tokens');
const { diasTeste, frontendUrls } = require('../config/env');

const router = Router();
const SLUGS_RESERVADOS = ['admin', 'api', 'painel', 'entrar', 'criar-loja', 'loja', 'carrinho', 'conta'];
const COR = /^#[0-9a-f]{6}$/i;

async function slugDisponivel(nome) {
  const base = gerarSlug(nome) || 'loja';
  let slug = SLUGS_RESERVADOS.includes(base) ? `${base}-1` : base;
  for (let n = 2; await Loja.exists({ slug }); n++) slug = `${base}-${n}`;
  return slug;
}

const cadastroSchema = z.object({
  nomeLoja: z.string().trim().min(2, 'Nome da loja muito curto').max(80),
  nome: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(100),
  whatsapp: z.string().regex(/^[\d\s()+-]{10,20}$/, 'WhatsApp inválido'),
  segmento: z.enum(SEGMENTOS),
  tema: z.enum(TEMAS).default('clean'),
  corPrimaria: z.string().regex(COR).optional(),
  cidade: z.string().trim().max(60).optional(),
  aceitouTermos: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar os Termos de Uso' }) }),
});

// Cadastro: cria o login e a loja, já com os 30 dias grátis
router.post('/cadastro', limiteLogin, validar(cadastroSchema), async (req, res) => {
  const d = req.validado;
  const { segmentosBloqueados } = await lerModeracao();
  if (segmentosBloqueados.includes(d.segmento)) throw new ErroApp(400, 'Este segmento ainda não está disponível. Fale com o suporte.');
  if (await Usuario.exists({ email: d.email })) throw new ErroApp(409, 'Este e-mail já está cadastrado. Faça login.');

  const loja = await Loja.create({
    nome: d.nomeLoja,
    slug: await slugDisponivel(d.nomeLoja),
    segmento: d.segmento,
    tema: d.tema,
    corPrimaria: d.corPrimaria || undefined,
    whatsapp: normalizarTelefone(d.whatsapp),
    endereco: { cidade: d.cidade || '' },
    entrega: { cidades: d.cidade ? [d.cidade] : [] },
    licenca: { plano: 'teste', acessoAte: new Date(Date.now() + diasTeste * DIA_MS) },
  });

  let usuario;
  try {
    usuario = await Usuario.create({ nome: d.nome, email: d.email, papel: 'lojista', lojaId: loja._id, senhaHash: await bcrypt.hash(d.senha, 10) });
  } catch (erro) {
    await Loja.deleteOne({ _id: loja._id });
    if (ehDuplicado(erro)) throw new ErroApp(409, 'Este e-mail já está cadastrado. Faça login.');
    throw erro;
  }

  res.status(201).json({
    token: gerarToken(usuario),
    papel: 'lojista',
    nome: usuario.nome,
    loja: { id: loja._id, nome: loja.nome, slug: loja.slug },
    licenca: statusLicenca(loja.licenca),
  });
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), senha: z.string().min(1) });

// O login funciona mesmo com plano vencido: o app mostra a tela "renove seu plano"
router.post('/login', limiteLogin, validar(loginSchema), async (req, res) => {
  const { email, senha } = req.validado;
  const usuario = await Usuario.findOne({ email }).select('+senhaHash');
  if (!usuario || !(await bcrypt.compare(senha, usuario.senhaHash))) throw new ErroApp(401, 'E-mail ou senha incorretos.');
  res.json({ token: gerarToken(usuario), papel: usuario.papel, nome: usuario.nome });
});

// Esqueci a senha: manda um link por e-mail (resposta igual exista ou não o e-mail)
router.post('/esqueci-senha', limiteSenha, validar(z.object({ email: z.string().trim().toLowerCase().email() })), async (req, res) => {
  const usuario = await Usuario.findOne({ email: req.validado.email });
  if (usuario) {
    const { token, hash, expira } = novoTokenReset(60);
    await Usuario.updateOne({ _id: usuario._id }, { $set: { 'reset.hash': hash, 'reset.expira': expira } });
    enviarSemEsperar({
      para: usuario.email,
      assunto: 'Redefinir sua senha',
      titulo: 'Redefinir senha',
      paragrafos: ['Recebemos um pedido para trocar a sua senha. O link vale por 1 hora.', 'Se não foi você, ignore este e-mail.'],
      botao: { texto: 'Criar nova senha', url: `${frontendUrls[0]}/redefinir-senha?token=${token}` },
    });
  }
  res.json({ ok: true, mensagem: 'Se o e-mail estiver cadastrado, você vai receber um link em instantes.' });
});

const redefinirSchema = z.object({ token: z.string().min(20).max(200), novaSenha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(100) });

router.post('/redefinir-senha', limiteSenha, validar(redefinirSchema), async (req, res) => {
  const usuario = await Usuario.findOne({ 'reset.hash': hashToken(req.validado.token), 'reset.expira': { $gt: new Date() } });
  if (!usuario) throw new ErroApp(400, 'Link inválido ou vencido. Peça um novo.');
  await Usuario.updateOne({ _id: usuario._id }, { $set: { senhaHash: await bcrypt.hash(req.validado.novaSenha, 10) }, $unset: { reset: 1 } });
  res.json({ ok: true });
});

const trocarSenhaSchema = z.object({ senhaAtual: z.string().min(1), novaSenha: z.string().min(8).max(100) });

router.post('/trocar-senha', exigirLogin, validar(trocarSenhaSchema), async (req, res) => {
  const usuario = await Usuario.findById(req.usuario.id).select('+senhaHash');
  if (!usuario || !(await bcrypt.compare(req.validado.senhaAtual, usuario.senhaHash))) throw new ErroApp(400, 'Senha atual incorreta.');
  usuario.senhaHash = await bcrypt.hash(req.validado.novaSenha, 10);
  await usuario.save();
  res.json({ ok: true });
});

module.exports = router;
