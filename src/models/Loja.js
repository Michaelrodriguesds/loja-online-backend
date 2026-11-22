// Uma loja = um lojista = um plano mensal
const { Schema, model } = require('mongoose');

const SEGMENTOS = ['moda', 'barbearia', 'beleza', 'acessorios', 'calcados', 'variedades', 'alimentos', 'outro'];
const TEMAS = ['urbano', 'clean', 'delicado', 'vibrante'];

const lojaSchema = new Schema(
  {
    nome: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true }, // link público: /loja/<slug>
    segmento: { type: String, enum: SEGMENTOS, default: 'moda' },
    descricao: { type: String, default: '', maxlength: 300 },
    whatsapp: { type: String, required: true },
    instagram: { type: String, default: '' },

    // ===== Aparência =====
    tema: { type: String, enum: TEMAS, default: 'clean' },
    corPrimaria: { type: String, default: '#E8A33D' },
    logoUrl: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },

    // Endereço da loja: ponto de partida do frete e local de retirada
    endereco: {
      texto: { type: String, default: '' }, // "Rua X, 123 - Bairro"
      cidade: { type: String, default: '' },
      uf: { type: String, default: 'RJ' },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    aberta: { type: Boolean, default: true }, // "pausar loja": vitrine aparece, mas não recebe pedidos

    entrega: {
      ativa: { type: Boolean, default: true },
      valorKm: { type: Number, default: 1.5, min: 0 },
      taxaMinima: { type: Number, default: 5, min: 0 },
      raioMaxKm: { type: Number, default: 20, min: 1 },
      calculo: { type: String, enum: ['ida', 'ida_volta'], default: 'ida' },
      cidades: { type: [String], default: [] },
      prazo: { type: String, default: 'Até 24h após o pagamento', maxlength: 80 },
      retiradaAtiva: { type: Boolean, default: true },
      prazoRetirada: { type: String, default: 'A partir de 2h após a aprovação', maxlength: 80 },
    },

    pagamento: {
      tipoChave: { type: String, enum: ['', 'cpf', 'cnpj', 'telefone', 'email', 'aleatoria'], default: '' },
      chavePix: { type: String, default: '' },
      nomeRecebedor: { type: String, default: '' },
      cidade: { type: String, default: '' },
      aceitaNaEntrega: { type: Boolean, default: true }, // pagar na entrega/retirada (o lojista decide ao aprovar)
      // Como o cliente pode pagar na entrega/retirada (cartão é por aproximação na maquininha)
      parcelamento: {
        maxParcelas: { type: Number, default: 1, min: 1, max: 12 }, // 1 = sem parcelamento
        semJurosAte: { type: Number, default: 1, min: 1, max: 12 },
        jurosMes: { type: Number, default: 0, min: 0, max: 15 }, // % ao mês acima do sem juros
        parcelaMinima: { type: Number, default: 10, min: 0 },
      },
      formasNaEntrega: { type: [String], enum: ['cartao_credito', 'cartao_debito', 'pix', 'dinheiro'], default: ['cartao_credito', 'cartao_debito', 'pix', 'dinheiro'] },
    },

    regras: {
      horasParaExpirar: { type: Number, default: 12, min: 1, max: 168 }, // pedido não aprovado/pago é cancelado sozinho
    },

    // ===== Licença (controle do desenvolvedor) =====
    licenca: {
      plano: { type: String, enum: ['teste', 'pago'], default: 'teste' },
      acessoAte: { type: Date, required: true },
      ultimoAvisoEm: { type: String, default: '' },
      observacao: { type: String, default: '' },
    },

    // ===== Moderação (bloqueio manual pelo desenvolvedor) =====
    moderacao: {
      bloqueada: { type: Boolean, default: false },
      motivo: { type: String, default: '' },
      em: { type: Date, default: null },
    },

    proximoPedido: { type: Number, default: 1001 }, // numeração dos pedidos de cada loja
  },
  { timestamps: true }
);

lojaSchema.index({ 'licenca.acessoAte': 1 });

module.exports = model('Loja', lojaSchema);
module.exports.SEGMENTOS = SEGMENTOS;
module.exports.TEMAS = TEMAS;
