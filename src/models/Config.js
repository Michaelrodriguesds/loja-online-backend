// Configurações gerais do sistema (um único documento, chave 'sistema')
const { Schema, model } = require('mongoose');

const PALAVRAS_PADRAO = [
  'arma', 'pistola', 'revolver', 'municao', 'faca tatica', 'droga', 'maconha', 'cocaina', 'lanca perfume',
  'vape', 'pod descartavel', 'cigarro eletronico', 'remedio', 'anabolizante', 'sibutramina', 'viagra',
  'replica', 'primeira linha', 'falsificado', 'pirata', 'cerveja', 'vodka', 'whisky', 'cachaca', 'bebida alcoolica',
  'conteudo adulto', 'acompanhante', 'filhote', 'cartao clonado', 'conta hackeada',
];

const configSchema = new Schema(
  {
    chave: { type: String, required: true, unique: true },
    aviso: {
      ativo: { type: Boolean, default: false },
      tipo: { type: String, enum: ['informativo', 'manutencao'], default: 'informativo' },
      mensagem: { type: String, default: '', maxlength: 500 },
      inicio: { type: Date, default: null },
      fim: { type: Date, default: null },
      bloquear: { type: Boolean, default: false },
      mostrarPara: { type: String, enum: ['todos', 'lojistas'], default: 'lojistas' },
      atualizadoEm: { type: Date, default: null },
    },
    moderacao: {
      palavras: { type: [String], default: PALAVRAS_PADRAO }, // produto com essas palavras vai para análise
      aprovacaoManual: { type: Boolean, default: false }, // true = TODO produto novo espera sua aprovação
      segmentosBloqueados: { type: [String], default: ['alimentos'] }, // segmentos que ainda não podem criar loja
    },
  },
  { timestamps: true }
);

module.exports = model('Config', configSchema);
module.exports.PALAVRAS_PADRAO = PALAVRAS_PADRAO;
