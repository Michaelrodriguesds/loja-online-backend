// Fotos guardadas no próprio MongoDB (usado quando o Cloudinary não está configurado).
// O app comprime antes de enviar (máx. ~600 KB por foto).
const { Schema, model } = require('mongoose');

const imagemSchema = new Schema(
  {
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja', required: true, index: true },
    tipo: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    dados: { type: Buffer, required: true },
  },
  { timestamps: true }
);

module.exports = model('Imagem', imagemSchema);
