// Lê e valida as variáveis do arquivo .env
require('dotenv').config();

function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor || valor.startsWith('cole_aqui')) {
    console.error(`\n❌ A variável ${nome} não foi definida no arquivo .env\n`);
    process.exit(1);
  }
  return valor;
}

const urlSemBarra = (u) => String(u || '').trim().replace(/\/+$/, '');

module.exports = {
  porta: Number(process.env.PORT) || 3000,
  producao: process.env.NODE_ENV === 'production',
  mongoUri: obrigatoria('MONGODB_URI'),
  jwtSecret: obrigatoria('JWT_SECRET'),
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(urlSemBarra).filter(Boolean),
  apiUrl: urlSemBarra(process.env.API_URL || 'http://localhost:3000'),
  fuso: 'America/Sao_Paulo',

  // Licença (seu controle como desenvolvedor)
  diasTeste: Number(process.env.DIAS_TESTE) || 30,
  diasPlano: Number(process.env.DIAS_PLANO) || 30,
  suporteWhatsapp: process.env.SUPORTE_WHATSAPP || '',

  // E-mails (recuperar senha, novo pedido). Sem chave = só aparece no terminal
  email: {
    brevoKey: process.env.BREVO_API_KEY || '',
    brevoRemetente: process.env.BREVO_REMETENTE || '', // seu e-mail verificado no Brevo (pode ser Gmail)
    resendKey: process.env.RESEND_API_KEY || '',
    remetente: process.env.EMAIL_REMETENTE || 'Loja Online <onboarding@resend.dev>',
  },

  // Fotos: com Cloudinary configurado, vão para lá. Sem ele, ficam no MongoDB
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  // Cálculo da distância do frete
  //  GEOCODER: nominatim (grátis, OpenStreetMap) | desligado (frete "a combinar")
  //  ROTAS:    osrm (grátis, servidor público) | ors (OpenRouteService, precisa de chave) | reta
  frete: {
    geocoder: process.env.GEOCODER || 'nominatim',
    rotas: process.env.ROTAS || 'osrm',
    orsKey: process.env.ORS_API_KEY || '',
    contato: process.env.CONTATO_GEOCODER || 'suporte@exemplo.com',
  },
};
