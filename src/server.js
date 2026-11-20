// Ponto de entrada: conecta no banco, liga as tarefas e sobe a API
const config = require('./config/env');
require('./models'); // registra os modelos antes de criar os índices
const { conectarBanco } = require('./config/db');
const { iniciarTarefas } = require('./jobs/tarefas');
const app = require('./app');

async function iniciar() {
  try {
    await conectarBanco(config.mongoUri);
    iniciarTarefas();
    app.listen(config.porta, () => console.log(`🚀 API rodando em http://localhost:${config.porta}`));
  } catch (erro) {
    console.error('❌ Não foi possível iniciar a API:', erro.message);
    process.exit(1);
  }
}

// Registra no log do Render qualquer erro que escape, em vez de derrubar a API em silêncio
process.on('unhandledRejection', (erro) => console.error('💥 Promessa sem tratamento:', erro));
process.on('uncaughtException', (erro) => console.error('💥 Erro não tratado:', erro));

iniciar();
