// Cliente final de UMA loja (o mesmo e-mail pode ter conta em lojas diferentes)
const { Schema, model } = require('mongoose');

const compradorSchema = new Schema(
  {
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja', required: true },
    nome: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    whatsapp: { type: String, required: true },
    senhaHash: { type: String, required: true, select: false },
    endereco: {
      cep: { type: String, default: '' },
      rua: { type: String, default: '' },
      numero: { type: String, default: '' },
      complemento: { type: String, default: '' },
      bairro: { type: String, default: '' },
      cidade: { type: String, default: '' },
      uf: { type: String, default: 'RJ' },
    },
    aceitouTermosEm: { type: Date, default: null },
    reset: { hash: { type: String, select: false }, expira: { type: Date, select: false } },
  },
  { timestamps: true }
);

compradorSchema.index({ lojaId: 1, email: 1 }, { unique: true });

module.exports = model('Comprador', compradorSchema);
