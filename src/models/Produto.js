// Produto de uma loja, com variações (tamanho × cor) e estoque de cada uma
const { Schema, model } = require('mongoose');

const variacaoSchema = new Schema({
  tamanho: { type: String, trim: true, default: 'Único', maxlength: 20 },
  cor: { type: String, trim: true, default: '', maxlength: 30 },
  estoque: { type: Number, default: 0, min: 0 },
});

const produtoSchema = new Schema(
  {
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja', required: true },
    nome: { type: String, required: true, trim: true, maxlength: 100 },
    descricao: { type: String, default: '', maxlength: 1000 },
    categoria: { type: String, trim: true, default: 'Outros', maxlength: 40 },
    preco: { type: Number, required: true, min: 0 },
    fotos: { type: [String], default: [] },
    soNoLocal: { type: Boolean, default: false }, // aparece na vitrine, mas não vende online (ex.: bebida)
    variacoes: { type: [variacaoSchema], default: [] },
    ativo: { type: Boolean, default: true }, // o lojista pode pausar o produto
    // Moderação: publicado | analise (aguarda você) | oculto (você escondeu)
    status: { type: String, enum: ['publicado', 'analise', 'oculto'], default: 'publicado' },
    motivoModeracao: { type: String, default: '' },
  },
  { timestamps: true }
);

produtoSchema.index({ lojaId: 1, status: 1, ativo: 1, createdAt: -1 });
produtoSchema.index({ status: 1, createdAt: -1 });

module.exports = model('Produto', produtoSchema);
