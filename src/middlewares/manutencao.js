// Durante a manutenção com bloqueio, o sistema responde 503 para lojistas e
// compradores. Continuam funcionando: /health, /status, /auth/login, /admin e /imagens.
const { avisoPublico } = require('../services/sistema');

const LIBERADAS = [/^\/health/, /^\/status/, /^\/auth\/login/, /^\/admin/, /^\/imagens/];

async function bloquearEmManutencao(req, res, next) {
  if (LIBERADAS.some((r) => r.test(req.path))) return next();
  try {
    const aviso = await avisoPublico();
    if (aviso?.bloqueando) return res.status(503).json({ erro: aviso.mensagem, manutencao: true, fim: aviso.fim });
  } catch {
    // se não der para ler o aviso, não trava o sistema
  }
  next();
}

module.exports = { bloquearEmManutencao };
