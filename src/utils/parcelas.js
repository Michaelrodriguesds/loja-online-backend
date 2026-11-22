// Parcelamento no cartão de crédito (cobrado na maquininha, na entrega ou na loja).
// Até "semJurosAte" parcelas: sem juros. Acima disso: juros mensais (tabela Price).
const { arredondar } = require('./dinheiro');

const PADRAO = { maxParcelas: 1, semJurosAte: 1, jurosMes: 0, parcelaMinima: 10 };

function configParcelas(loja) {
  return { ...PADRAO, ...(loja?.pagamento?.parcelamento || {}) };
}

/** Lista de opções: [{ n, parcela, total, semJuros }] */
function calcularParcelas(valor, cfg) {
  const c = { ...PADRAO, ...cfg };
  const opcoes = [];
  for (let n = 1; n <= c.maxParcelas; n++) {
    const semJuros = n <= c.semJurosAte || !c.jurosMes;
    const i = c.jurosMes / 100;
    const parcela = semJuros ? valor / n : (valor * i) / (1 - (1 + i) ** -n);
    if (n > 1 && parcela < c.parcelaMinima) break;
    opcoes.push({ n, parcela: arredondar(parcela), total: arredondar(parcela * n), semJuros });
  }
  return opcoes;
}

module.exports = { calcularParcelas, configParcelas, PADRAO };
