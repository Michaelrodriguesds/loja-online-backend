// Deixa a chave Pix no formato que os bancos aceitam.
// O lojista pode digitar "123.456.789-09" ou "(21) 99999-0000": aqui vira
// "12345678909" e "+5521999990000". Chave errada = Pix copia e cola recusado pelo banco.
const { ErroApp } = require('./erros');

const TIPOS = ['cpf', 'cnpj', 'telefone', 'email', 'aleatoria'];
const so = (t) => String(t || '').replace(/\D/g, '');

function cpfValido(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dig = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dig(9) === Number(c[9]) && dig(10) === Number(c[10]);
}

function cnpjValido(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dig = (n) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = pesos.reduce((t, p, i) => t + Number(c[i]) * p, 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dig(12) === Number(c[12]) && dig(13) === Number(c[13]);
}

// Adivinha o tipo quando não foi informado (só nos casos sem dúvida)
function detectarTipo(chave) {
  const t = String(chave || '').trim();
  if (t.includes('@')) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return 'aleatoria';
  if (t.startsWith('+')) return 'telefone';
  if (so(t).length === 14) return 'cnpj';
  return null; // 11 dígitos pode ser CPF ou celular: precisa escolher
}

/** @returns {{ tipo: string, chave: string }} */
function normalizarChavePix(tipoInformado, chaveDigitada) {
  const bruta = String(chaveDigitada || '').trim();
  if (!bruta) return { tipo: tipoInformado || '', chave: '' };
  const tipo = tipoInformado || detectarTipo(bruta);
  if (!tipo) throw new ErroApp(400, 'Escolha o tipo da chave Pix (CPF ou celular?).');
  if (!TIPOS.includes(tipo)) throw new ErroApp(400, 'Tipo de chave Pix inválido.');

  if (tipo === 'cpf') {
    const c = so(bruta);
    if (!cpfValido(c)) throw new ErroApp(400, 'CPF da chave Pix inválido. Confira os números.');
    return { tipo, chave: c };
  }
  if (tipo === 'cnpj') {
    const c = so(bruta);
    if (!cnpjValido(c)) throw new ErroApp(400, 'CNPJ da chave Pix inválido. Confira os números.');
    return { tipo, chave: c };
  }
  if (tipo === 'telefone') {
    let c = so(bruta);
    if (c.length === 13 && c.startsWith('55')) c = c.slice(2);
    if (c.length !== 10 && c.length !== 11) throw new ErroApp(400, 'Celular da chave Pix inválido. Use DDD + número, ex.: (21) 99999-0000.');
    return { tipo, chave: `+55${c}` };
  }
  if (tipo === 'email') {
    const c = bruta.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) || c.length > 77) throw new ErroApp(400, 'E-mail da chave Pix inválido.');
    return { tipo, chave: c };
  }
  const c = bruta.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c)) throw new ErroApp(400, 'Chave aleatória inválida. Copie e cole do app do banco (formato com traços).');
  return { tipo, chave: c };
}

module.exports = { normalizarChavePix, detectarTipo, cpfValido, cnpjValido, TIPOS };
