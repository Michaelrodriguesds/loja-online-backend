// Pedido de um comprador em uma loja
const { Schema, model } = require('mongoose');

const STATUS = [
  'aguardando_aprovacao', // o lojista ainda não olhou
  'aguardando_cliente', //   o frete final ficou maior: o comprador precisa aceitar
  'aguardando_pagamento', // aprovado, esperando o Pix
  'em_preparo',
  'saiu_entrega',
  'pronto_retirada',
  'concluido',
  'recusado',
  'cancelado',
];
const ABERTOS = ['aguardando_aprovacao', 'aguardando_cliente', 'aguardando_pagamento'];

const itemSchema = new Schema(
  {
    produtoId: { type: Schema.Types.ObjectId, ref: 'Produto' },
    varId: { type: Schema.Types.ObjectId },
    nome: String,
    tamanho: String,
    cor: String,
    foto: String,
    preco: Number,
    qtd: Number,
  },
  { _id: false }
);

const pedidoSchema = new Schema(
  {
    lojaId: { type: Schema.Types.ObjectId, ref: 'Loja', required: true },
    numero: { type: Number, required: true },
    compradorId: { type: Schema.Types.ObjectId, ref: 'Comprador', required: true },
    comprador: { nome: String, whatsapp: String, email: String },
    itens: { type: [itemSchema], default: [] },

    modo: { type: String, enum: ['entrega', 'retirada'], required: true },
    endereco: { cep: String, rua: String, numero: String, complemento: String, bairro: String, cidade: String, uf: String },
    distanciaKm: { type: Number, default: null },
    freteEstimado: { type: Number, default: null }, // null = a combinar (não deu para calcular)
    freteFinal: { type: Number, default: null },
    entregaPor: { type: String, enum: ['proprio', 'terceiro', ''], default: '' },
    prazo: { type: String, default: '' },

    pagamento: { type: String, enum: ['pix', 'na_entrega'], required: true },
    formaNaEntrega: { type: String, enum: ['', 'cartao_credito', 'cartao_debito', 'pix', 'dinheiro'], default: '' }, // escolhida pelo cliente
    trocoPara: { type: Number, default: null }, // se for pagar em dinheiro
    parcelas: { type: Number, default: 1 }, // crédito na maquininha
    pago: { type: Boolean, default: false },
    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },

    status: { type: String, enum: STATUS, default: 'aguardando_aprovacao' },
    motivo: { type: String, default: '' }, // motivo da recusa/cancelamento
    expiraEm: { type: Date, default: null },
    estoqueDevolvido: { type: Boolean, default: false },
    historico: { type: [{ status: String, em: Date, obs: String, _id: false }], default: [] },
  },
  { timestamps: true }
);

pedidoSchema.index({ lojaId: 1, numero: 1 }, { unique: true });
pedidoSchema.index({ lojaId: 1, status: 1, createdAt: -1 });
pedidoSchema.index({ compradorId: 1, createdAt: -1 });
pedidoSchema.index({ status: 1, expiraEm: 1 });

module.exports = model('Pedido', pedidoSchema);
module.exports.STATUS = STATUS;
module.exports.ABERTOS = ABERTOS;
