// Monta a aplicação Express (separado do server.js para facilitar testes)
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoose = require('mongoose');
const { frontendUrls } = require('./config/env');
const { limiteGeral } = require('./middlewares/limites');
const { rotaNaoEncontrada, tratarErros } = require('./middlewares/erros');
const { bloquearEmManutencao } = require('./middlewares/manutencao');
const { avisoPublico } = require('./services/sistema');
const { Imagem } = require('./models');

const app = express();

app.set('trust proxy', 1); // necessário no Render (IP real do cliente)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // fotos abrem no site da loja
app.use(cors({ origin: frontendUrls }));
app.use(compression());
// Fotos chegam maiores (até 1 MB); o resto da API aceita no máximo 100 KB.
// O corpo é lido logo na entrada (antes do login), para a conexão não ficar parada.
const jsonPequeno = express.json({ limit: '100kb' });
const jsonFoto = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/painel/imagens' ? jsonFoto(req, res, next) : jsonPequeno(req, res, next)));

// Registro no log do Render: envios de foto, erros e requisições lentas
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - inicio;
    if (res.statusCode >= 500 || ms > 5000 || req.path === '/painel/imagens') {
      console.log(`📝 ${req.method} ${req.path} → ${res.statusCode} em ${ms} ms${req.headers['content-length'] ? ` (${Math.round(req.headers['content-length'] / 1024)} KB)` : ''}`);
    }
  });
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, horario: new Date().toISOString() }));
app.get('/status', async (_req, res) => res.json({ aviso: await avisoPublico() }));

// Fotos guardadas no MongoDB (quando não há Cloudinary). Cache longo: a foto nunca muda.
app.get('/imagens/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const img = await Imagem.findById(req.params.id).lean();
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.tipo, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(img.dados.buffer ? Buffer.from(img.dados.buffer) : img.dados);
});

app.use(bloquearEmManutencao);
app.use(limiteGeral);
app.use('/auth', require('./routes/auth.routes'));
app.use('/painel', require('./routes/painel.routes'));
app.use('/admin', require('./routes/admin.routes'));
app.use('/publico', require('./routes/publico.routes'));

app.use(rotaNaoEncontrada);
app.use(tratarErros);

module.exports = app;
