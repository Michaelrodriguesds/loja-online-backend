// Login por token JWT (cabeçalho Authorization: Bearer <token>)
// Três tipos de login: lojista, admin (você) e comprador (cliente de uma loja)
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { ErroApp } = require('../utils/erros');

function gerarToken(usuario) {
  return jwt.sign(
    { sub: String(usuario._id), papel: usuario.papel, lid: usuario.lojaId ? String(usuario.lojaId) : null },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function gerarTokenComprador(comprador) {
  return jwt.sign({ sub: String(comprador._id), papel: 'comprador', lid: String(comprador.lojaId) }, jwtSecret, { expiresIn: '30d' });
}

function lerToken(req) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  try {
    const d = jwt.verify(token, jwtSecret);
    return { id: d.sub, papel: d.papel, lojaId: d.lid };
  } catch {
    return undefined; // token inválido ou vencido
  }
}

function exigirLogin(req, _res, next) {
  const usuario = lerToken(req);
  if (usuario === null) return next(new ErroApp(401, 'Faça login para continuar.'));
  if (!usuario) return next(new ErroApp(401, 'Sua sessão expirou. Faça login novamente.'));
  req.usuario = usuario;
  next();
}

function exigirLojista(req, _res, next) {
  if (req.usuario?.papel !== 'lojista' || !req.usuario.lojaId) return next(new ErroApp(403, 'Acesso só para lojistas.'));
  next();
}

function exigirAdmin(req, _res, next) {
  if (req.usuario?.papel !== 'admin') return next(new ErroApp(403, 'Acesso só para o administrador.'));
  next();
}

// Comprador logado NA loja da URL (o token de uma loja não vale em outra)
function exigirComprador(req, _res, next) {
  const u = lerToken(req);
  if (!u) return next(new ErroApp(401, 'Entre na sua conta para continuar.'));
  if (u.papel !== 'comprador' || u.lojaId !== String(req.loja._id)) return next(new ErroApp(401, 'Entre na sua conta desta loja para continuar.'));
  req.comprador = u;
  next();
}

module.exports = { gerarToken, gerarTokenComprador, exigirLogin, exigirLojista, exigirAdmin, exigirComprador };
