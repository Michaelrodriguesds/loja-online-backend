// Filtro automático: produto com palavra suspeita vai para "análise" (você aprova ou oculta)
const { semAcentos } = require('../utils/formatos');
const { lerModeracao } = require('./sistema');

const normalizar = (t) => ` ${semAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

function palavraEncontrada(texto, palavras) {
  const alvo = normalizar(texto);
  return palavras.find((p) => {
    const termo = normalizar(p).trim();
    return termo && alvo.includes(` ${termo} `);
  });
}

/**
 * Decide o status de um produto salvo pelo lojista.
 * Se você já ocultou o produto, ele continua oculto até você liberar.
 */
async function statusParaProduto(produto, statusAtual) {
  if (statusAtual === 'oculto') return { status: 'oculto' };
  const { palavras, aprovacaoManual } = await lerModeracao();
  const achou = palavraEncontrada(`${produto.nome} ${produto.descricao || ''} ${produto.categoria || ''}`, palavras);
  if (achou) return { status: 'analise', motivoModeracao: `Palavra suspeita: "${achou}"` };
  if (aprovacaoManual && statusAtual !== 'publicado') return { status: 'analise', motivoModeracao: 'Aguardando aprovação' };
  return { status: 'publicado', motivoModeracao: '' };
}

module.exports = { statusParaProduto, palavraEncontrada };
