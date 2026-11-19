// Denúncia feita por um visitante da loja (produto proibido, golpe etc.)
const { Schema, model } = require('mongoose');

const denunciaSchema = new Schema(
  {
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja' },
    produtoId: { type: Schema.Types.ObjectId, ref: 'Produto', default: null },
    motivo: { type: String, enum: ['proibido', 'golpe', 'falsificado', 'ofensivo', 'outro'], required: true },
    texto: { type: String, default: '', maxlength: 500 },
    contato: { type: String, default: '', maxlength: 100 },
    status: { type: String, enum: ['nova', 'resolvida', 'descartada'], default: 'nova' },
  },
  { timestamps: true }
);

denunciaSchema.index({ status: 1, createdAt: -1 });

module.exports = model('Denuncia', denunciaSchema);
