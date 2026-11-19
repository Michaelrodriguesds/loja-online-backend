// Bloqueio automático quando o plano vence (ou quando você bloqueia a loja)
const { lojaStatus } = require('../services/licenca');
const { suporteWhatsapp } = require('../config/env');

// Mesmo bloqueado, o lojista consegue ver os dados e FINALIZAR pedidos que já
// estavam em andamento (senão o comprador que já pagou fica sem o produto).
const LIBERADAS_BLOQUEADO = [
  ['GET', /^\/me$/],
  ['GET', /^\/resumo$/],
  ['GET', /^\/pedidos/],
  ['POST', /^\/pedidos\/[0-9a-f]{24}\/(confirmar-pagamento|despachar|concluir|recusar)$/],
];

async function exigirLojaAtiva(req, res, next) {
  const st = await lojaStatus(req.usuario.lojaId);
  req.licenca = st.licenca;
  req.moderacao = st.moderacao;
  if (st.disponivel) return next();
  if (LIBERADAS_BLOQUEADO.some(([m, r]) => m === req.method && r.test(req.path))) return next();
  const porModeracao = st.moderacao.bloqueada;
  return res.status(402).json({
    erro: porModeracao
      ? `Sua loja foi bloqueada pelo administrador${st.moderacao.motivo ? `: ${st.moderacao.motivo}` : '.'}`
      : 'Seu plano venceu. Fale com o suporte para renovar. Seus produtos e pedidos estão guardados.',
    bloqueado: true,
    motivo: porModeracao ? 'moderacao' : 'plano',
    licenca: st.licenca,
    suporteWhatsapp,
  });
}

module.exports = { exigirLojaAtiva };
