// Login do lojista (dono da loja) e do desenvolvedor (admin)
const { Schema, model } = require('mongoose');

const usuarioSchema = new Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    senhaHash: { type: String, required: true, select: false },
    papel: { type: String, enum: ['lojista', 'admin'], default: 'lojista' },
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja' }, // vazio para admin
    reset: { hash: { type: String, select: false }, expira: { type: Date, select: false } },
  },
  { timestamps: true }
);

module.exports = model('Usuario', usuarioSchema);
