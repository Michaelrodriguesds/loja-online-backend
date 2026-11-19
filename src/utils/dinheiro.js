// Contas de dinheiro SEMPRE em centavos inteiros (evita erro de 1 centavo do
// ponto flutuante, ex.: 0,1 + 0,2 = 0,30000000000000004).
const paraCentavos = (reais) => Math.round(Number(reais || 0) * 100);
const paraReais = (centavos) => centavos / 100;
const arredondar = (reais) => paraReais(paraCentavos(reais));

function somar(valores) {
  return paraReais(valores.reduce((t, v) => t + paraCentavos(v), 0));
}

module.exports = { paraCentavos, paraReais, arredondar, somar };
