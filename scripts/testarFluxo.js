// Teste de ponta a ponta da API. Cria lojas, produtos, compradores e pedidos de teste,
// confere cada regra e APAGA tudo o que criou no final. Nenhum e-mail real é enviado.
//
// Uso: npm run testar               → usa o banco do seu .env (MONGODB_URI)
//      npm run testar -- --memoria  → usa um banco temporário na memória (não toca no seu)
process.env.SEM_LIMITES = 'true';
process.env.GEOCODER = 'desligado'; // sem internet no teste: frete fica "a combinar"
delete process.env.RESEND_API_KEY;
delete process.env.CLOUDINARY_CLOUD_NAME;

const usarMemoria = process.argv.includes('--memoria');
let servidorMemoria = null;

let ok = 0;
let falhas = 0;
function conferir(condicao, descricao, extra) {
  if (condicao) { ok++; console.log(`  ✅ ${descricao}`); } else { falhas++; console.log(`  ❌ ${descricao}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

// Captura os links de e-mail simulados (para testar "esqueci a senha")
const logsEmail = [];
const logOriginal = console.log;
console.log = (...a) => { if (String(a[0]).startsWith('📧')) logsEmail.push(a.join(' ')); else logOriginal(...a); };

async function main() {
  if (usarMemoria) {
    const { MongoMemoryServer } = require('mongodb-memory-server-core');
    servidorMemoria = await MongoMemoryServer.create();
    process.env.MONGODB_URI = servidorMemoria.getUri('loja_teste');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-123456789';
  }
  require('dotenv').config();
  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');
  const config = require('../src/config/env');
  const models = require('../src/models');
  const { conectarBanco } = require('../src/config/db');
  const { expirarPedidos } = require('../src/services/pedidos');
  const { valorFrete, distanciaRetaKm } = require('../src/services/frete');
  const { crc16 } = require('../src/utils/pixEstatico');
  const app = require('../src/app');

  await conectarBanco(config.mongoUri);
  const http = app.listen(0);
  const base = `http://127.0.0.1:${http.address().port}`;
  const sufixo = Date.now().toString(36);
  const criados = { lojas: [], admin: null };

  async function api(metodo, caminho, corpo, token) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    let dados = null;
    try { dados = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, dados };
  }

  try {
    console.log('\n🧮 Contas do frete');
    conferir(valorFrete({ valorKm: 1.5, taxaMinima: 5, calculo: 'ida' }, 6.4) === 9.6, '6,4 km × R$ 1,50 = R$ 9,60');
    conferir(valorFrete({ valorKm: 1.5, taxaMinima: 5, calculo: 'ida' }, 2) === 5, 'perto: cobra a taxa mínima (R$ 5)');
    conferir(valorFrete({ valorKm: 1.5, taxaMinima: 5, calculo: 'ida_volta' }, 6.4) === 19.2, 'ida e volta dobra a distância');
    const sgNit = distanciaRetaKm({ lat: -22.8268, lng: -43.0539 }, { lat: -22.8832, lng: -43.1034 });
    conferir(sgNit > 7 && sgNit < 9, `distância em linha reta São Gonçalo → Niterói ≈ ${sgNit.toFixed(1)} km`);

    console.log('\n🏪 Cadastro do lojista');
    const cad = {
      nomeLoja: `Loja Teste ${sufixo}`, nome: 'Lojista Teste', email: `lojista.${sufixo}@teste.com`, senha: 'senha12345',
      whatsapp: '21999990000', segmento: 'moda', tema: 'urbano', cidade: 'São Gonçalo', aceitouTermos: true,
    };
    let r = await api('POST', '/auth/cadastro', { ...cad, segmento: 'alimentos' });
    conferir(r.status === 400, 'segmento "alimentos" ainda bloqueado', r.dados);
    r = await api('POST', '/auth/cadastro', { ...cad, aceitouTermos: false });
    conferir(r.status === 400, 'sem aceitar os termos não cadastra');
    r = await api('POST', '/auth/cadastro', cad);
    conferir(r.status === 201 && r.dados.token && r.dados.licenca.diasRestantes === 30, 'loja criada com 30 dias grátis', r.dados);
    const tokenLojista = r.dados.token;
    const slug = r.dados.loja.slug;
    criados.lojas.push(r.dados.loja.id);
    r = await api('POST', '/auth/cadastro', cad);
    conferir(r.status === 409, 'e-mail repetido é recusado');
    r = await api('POST', '/auth/login', { email: cad.email, senha: 'errada123' });
    conferir(r.status === 401, 'senha errada não entra');
    r = await api('POST', '/auth/login', { email: cad.email, senha: cad.senha });
    conferir(r.status === 200 && r.dados.papel === 'lojista', 'login do lojista');

    r = await api('GET', '/painel/me', null, tokenLojista);
    conferir(r.status === 200 && r.dados.link.endsWith(`/loja/${slug}`), 'painel mostra o link da loja', r.dados?.link);

    console.log('\n⚙️  Configurações da loja');
    r = await api('PUT', '/painel/loja', {
      descricao: 'Moda urbana em São Gonçalo', tema: 'urbano', corPrimaria: '#E8A33D',
      endereco: { texto: 'Rua Teste, 100 - Alcântara', cidade: 'São Gonçalo', uf: 'RJ' },
      entrega: { ativa: true, valorKm: 1.5, taxaMinima: 5, raioMaxKm: 20, calculo: 'ida', cidades: ['São Gonçalo', 'Niterói', 'Itaboraí'], prazo: 'Até 24h', retiradaAtiva: true, prazoRetirada: 'A partir de 2h' },
      pagamento: { chavePix: 'teste@pix.com', nomeRecebedor: 'LOJA TESTE', cidade: 'SAO GONCALO', aceitaNaEntrega: true },
      regras: { horasParaExpirar: 12 },
    }, tokenLojista);
    conferir(r.status === 200 && r.dados.loja.entrega.cidades.length === 3, 'entrega, Pix e endereço salvos', r.dados);
    r = await api('PUT', '/painel/loja', { entrega: { ativa: false, valorKm: 1.5, taxaMinima: 5, raioMaxKm: 20, calculo: 'ida', cidades: [], prazo: '', retiradaAtiva: false, prazoRetirada: '' } }, tokenLojista);
    conferir(r.status === 400, 'não deixa desligar entrega E retirada ao mesmo tempo');

    console.log('\n💠 Chave Pix no formato do banco');
    const pagBase = { nomeRecebedor: 'LOJA TESTE', cidade: 'SAO GONCALO', aceitaNaEntrega: true };
    r = await api('PUT', '/painel/loja', { pagamento: { ...pagBase, tipoChave: 'cpf', chavePix: '529.982.247-25' } }, tokenLojista);
    conferir(r.dados?.loja?.pagamento?.chavePix === '52998224725', 'CPF com pontos vira só números', r.dados?.loja?.pagamento);
    r = await api('PUT', '/painel/loja', { pagamento: { ...pagBase, tipoChave: 'telefone', chavePix: '(21) 99999-0000' } }, tokenLojista);
    conferir(r.dados?.loja?.pagamento?.chavePix === '+5521999990000', 'celular vira +5521999990000', r.dados?.loja?.pagamento);
    r = await api('PUT', '/painel/loja', { pagamento: { ...pagBase, tipoChave: 'cpf', chavePix: '111.111.111-11' } }, tokenLojista);
    conferir(r.status === 400, 'CPF inválido é recusado');
    r = await api('PUT', '/painel/loja', { pagamento: { ...pagBase, chavePix: '21999990000' } }, tokenLojista);
    conferir(r.status === 400, '11 dígitos sem tipo: pede para escolher (CPF ou celular)');
    r = await api('PUT', '/painel/loja', { pagamento: { ...pagBase, chavePix: 'teste@pix.com' } }, tokenLojista);
    conferir(r.dados?.loja?.pagamento?.tipoChave === 'email', 'e-mail é reconhecido sozinho');

    console.log('\n🖼️  Fotos');
    const pngMinimo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    r = await api('POST', '/painel/imagens', { dados: pngMinimo }, tokenLojista);
    conferir(r.status === 201 && r.dados.url.includes('/imagens/'), 'foto enviada', r.dados);
    const urlFoto = r.dados.url;
    const foto = await fetch(base + new URL(urlFoto).pathname);
    conferir(foto.status === 200 && foto.headers.get('content-type') === 'image/png', 'foto abre pelo link');
    r = await api('POST', '/painel/imagens', { dados: 'data:text/html;base64,PGh0bWw+' }, tokenLojista);
    conferir(r.status === 400, 'arquivo que não é imagem é recusado');

    console.log('\n👕 Produtos');
    r = await api('POST', '/painel/produtos', {
      nome: 'Camiseta Oversized', categoria: 'Roupas', preco: 79.9, fotos: [urlFoto],
      variacoes: [{ tamanho: 'M', cor: 'Preto', estoque: 3 }, { tamanho: 'G', cor: 'Preto', estoque: 1 }],
    }, tokenLojista);
    conferir(r.status === 201 && r.dados.status === 'publicado', 'produto com variações publicado', r.dados);
    const camiseta = r.dados;
    const varM = camiseta.variacoes[0]._id;
    const varG = camiseta.variacoes[1]._id;
    r = await api('POST', '/painel/produtos', { nome: 'Boné Aba Curva', categoria: 'Bonés', preco: 59.9, variacoes: [{ tamanho: 'Único', cor: 'Bege', estoque: 5 }] }, tokenLojista);
    const bone = r.dados;
    r = await api('POST', '/painel/produtos', { nome: 'Vape descartável', categoria: 'Acessórios', preco: 50, variacoes: [{ estoque: 10 }] }, tokenLojista);
    conferir(r.status === 201 && r.dados.status === 'analise', 'produto com palavra proibida vai para análise', r.dados?.motivoModeracao);
    const suspeito = r.dados;
    r = await api('POST', '/painel/produtos', { nome: 'Pomada modeladora', categoria: 'Cuidados', preco: 30, soNoLocal: true }, tokenLojista);
    conferir(r.status === 201 && r.dados.soNoLocal, 'produto "só no local" sem variação');
    const soLocal = r.dados;
    r = await api('POST', '/painel/produtos', { nome: 'Sem estoque', preco: 10, variacoes: [] }, tokenLojista);
    conferir(r.status === 400, 'produto vendável sem variação é recusado');

    console.log('\n🛍️  Vitrine pública');
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 200 && r.dados.tema === 'urbano' && r.dados.pagamento.pix === true, 'dados da loja (tema, Pix)', r.dados);
    conferir(r.dados.pagamento.chavePix === undefined, 'chave Pix não vaza na vitrine');
    r = await api('GET', `/publico/lojas/${slug}/produtos`);
    const nomes = (r.dados || []).map((p) => p.nome);
    conferir(nomes.includes('Camiseta Oversized') && !nomes.includes('Vape descartável'), 'produto em análise não aparece', nomes);
    r = await api('GET', '/publico/lojas/nao-existe-xyz');
    conferir(r.status === 404, 'link de loja inexistente dá 404');

    console.log('\n🙋 Conta do comprador');
    const endereco = { cep: '24400-000', rua: 'Rua do Cliente', numero: '50', bairro: 'Centro', cidade: 'São Gonçalo', uf: 'RJ' };
    r = await api('POST', `/publico/lojas/${slug}/conta/cadastro`, { nome: 'Cliente Teste', email: `cliente.${sufixo}@teste.com`, whatsapp: '21988887777', senha: 'cliente123', endereco, aceitouTermos: true });
    conferir(r.status === 201 && r.dados.token, 'comprador cadastrado com endereço', r.dados);
    const tokenCliente = r.dados.token;
    r = await api('POST', `/publico/lojas/${slug}/conta/login`, { email: `cliente.${sufixo}@teste.com`, senha: 'cliente123' });
    conferir(r.status === 200, 'login do comprador');

    // esqueci a senha
    r = await api('POST', `/publico/lojas/${slug}/conta/esqueci-senha`, { email: `cliente.${sufixo}@teste.com` });
    await new Promise((ok2) => setTimeout(ok2, 100));
    const link = logsEmail.reverse().find((l) => l.includes('redefinir-senha?token='));
    const tokenReset = link ? /token=([0-9a-f]+)/.exec(link)[1] : '';
    conferir(r.status === 200 && tokenReset.length === 64, 'e-mail de recuperação gerado com link');
    r = await api('POST', `/publico/lojas/${slug}/conta/redefinir-senha`, { token: tokenReset, novaSenha: 'novaSenha123' });
    conferir(r.status === 200, 'senha redefinida pelo link');
    r = await api('POST', `/publico/lojas/${slug}/conta/redefinir-senha`, { token: tokenReset, novaSenha: 'outra12345' });
    conferir(r.status === 400, 'o mesmo link não funciona duas vezes');
    r = await api('POST', `/publico/lojas/${slug}/conta/login`, { email: `cliente.${sufixo}@teste.com`, senha: 'novaSenha123' });
    conferir(r.status === 200, 'login com a senha nova');

    r = await api('POST', `/publico/lojas/${slug}/frete`, {}, tokenCliente);
    conferir(r.status === 200 && r.dados.aCombinar === true, 'sem mapa disponível, frete fica "a combinar"', r.dados);
    await api('PUT', `/publico/lojas/${slug}/conta`, { endereco: { ...endereco, cidade: 'Rio de Janeiro' } }, tokenCliente);
    r = await api('POST', `/publico/lojas/${slug}/frete`, {}, tokenCliente);
    conferir(r.dados?.foraDaArea === true, 'cidade fora da área de entrega é avisada', r.dados);
    await api('PUT', `/publico/lojas/${slug}/conta`, { endereco }, tokenCliente);

    console.log('\n📦 Pedido com entrega e Pix (fluxo completo)');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: camiseta._id, varId: varG, qtd: 2 }], modo: 'entrega', pagamento: 'pix' }, tokenCliente);
    conferir(r.status === 409, 'não deixa comprar mais do que o estoque', r.dados);
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: soLocal._id, varId: camiseta.variacoes[0]._id, qtd: 1 }], modo: 'retirada', pagamento: 'pix' }, tokenCliente);
    conferir(r.status === 409 || r.status === 400, 'produto "só no local" não entra em pedido');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, {
      itens: [{ produtoId: camiseta._id, varId: varM, qtd: 2 }, { produtoId: bone._id, varId: bone.variacoes[0]._id, qtd: 1 }],
      modo: 'entrega', pagamento: 'pix',
    }, tokenCliente);
    conferir(r.status === 201 && r.dados.status === 'aguardando_aprovacao', 'pedido criado aguardando aprovação', r.dados);
    const p1 = r.dados;
    conferir(p1.subtotal === 219.7 && p1.numero === 1001, `subtotal R$ 219,70 e número #${p1.numero}`, p1.subtotal);
    let cam = await models.Produto.findById(camiseta._id).lean();
    conferir(cam.variacoes[0].estoque === 1, 'estoque reservado (3 → 1)');

    r = await api('POST', `/painel/pedidos/${p1._id}/confirmar-pagamento`, {}, tokenLojista);
    conferir(r.status === 409, 'não confirma pagamento antes de aprovar');
    r = await api('POST', `/painel/pedidos/${p1._id}/aprovar`, { freteFinal: 9.6, entregaPor: 'proprio', prazo: 'Hoje até 18h' }, tokenLojista);
    conferir(r.status === 200 && r.dados.status === 'aguardando_cliente', 'frete definido na aprovação → cliente precisa aceitar', r.dados?.status);
    r = await api('GET', `/publico/lojas/${slug}/pedidos/${p1._id}`, null, tokenCliente);
    conferir(r.dados.total === 229.3 && !r.dados.pixCopiaCola, 'total com frete R$ 229,30, Pix ainda não aparece', r.dados?.total);
    r = await api('POST', `/publico/lojas/${slug}/pedidos/${p1._id}/aceitar-frete`, {}, tokenCliente);
    conferir(r.status === 200 && r.dados.status === 'aguardando_pagamento' && r.dados.pixCopiaCola, 'cliente aceitou → aparece o Pix copia e cola', r.dados?.status);
    const pix = r.dados.pixCopiaCola || '';
    conferir(pix.includes('5406229.30') && crc16(pix.slice(0, -4)) === pix.slice(-4), 'Pix com o valor certo e código válido (CRC)');
    for (const [acao, esperado] of [['confirmar-pagamento', 'em_preparo'], ['despachar', 'saiu_entrega'], ['concluir', 'concluido']]) {
      r = await api('POST', `/painel/pedidos/${p1._id}/${acao}`, {}, tokenLojista);
      conferir(r.status === 200 && r.dados.status === esperado, `${acao} → ${esperado}`, r.dados);
    }
    conferir(r.dados.pago === true && r.dados.historico.length >= 6, 'histórico completo do pedido');

    console.log('\n🏬 Retirada pagando no local');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: bone._id, varId: bone.variacoes[0]._id, qtd: 1 }], modo: 'retirada', pagamento: 'na_entrega' }, tokenCliente);
    const p2 = r.dados;
    conferir(r.status === 201 && p2.total === 59.9, 'retirada sem frete', r.dados);
    r = await api('POST', `/painel/pedidos/${p2._id}/aprovar`, {}, tokenLojista);
    conferir(r.dados?.status === 'em_preparo', 'aprovado → direto para "em preparo" (paga na retirada)', r.dados);
    r = await api('POST', `/painel/pedidos/${p2._id}/despachar`, {}, tokenLojista);
    conferir(r.dados?.status === 'pronto_retirada', 'pronto para retirada');

    console.log('\n↩️  Cancelar, recusar e expirar devolvem o estoque');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: camiseta._id, varId: varG, qtd: 1 }], modo: 'retirada', pagamento: 'pix' }, tokenCliente);
    const p3 = r.dados;
    r = await api('POST', `/publico/lojas/${slug}/pedidos/${p3._id}/cancelar`, {}, tokenCliente);
    cam = await models.Produto.findById(camiseta._id).lean();
    conferir(r.dados?.status === 'cancelado' && cam.variacoes[1].estoque === 1, 'cliente cancelou → estoque voltou');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: camiseta._id, varId: varG, qtd: 1 }], modo: 'retirada', pagamento: 'pix' }, tokenCliente);
    const p4 = r.dados;
    r = await api('POST', `/painel/pedidos/${p4._id}/recusar`, { motivo: 'Produto com defeito' }, tokenLojista);
    cam = await models.Produto.findById(camiseta._id).lean();
    conferir(r.dados?.status === 'recusado' && cam.variacoes[1].estoque === 1, 'lojista recusou → estoque voltou');
    r = await api('POST', `/publico/lojas/${slug}/pedidos`, { itens: [{ produtoId: camiseta._id, varId: varG, qtd: 1 }], modo: 'retirada', pagamento: 'pix' }, tokenCliente);
    const p5 = r.dados;
    await models.Pedido.updateOne({ _id: p5._id }, { $set: { expiraEm: new Date(Date.now() - 1000) } });
    await expirarPedidos();
    const p5b = await models.Pedido.findById(p5._id).lean();
    cam = await models.Produto.findById(camiseta._id).lean();
    conferir(p5b.status === 'cancelado' && cam.variacoes[1].estoque === 1, 'pedido sem aprovação no prazo foi cancelado sozinho');

    r = await api('GET', '/painel/resumo', null, tokenLojista);
    conferir(r.status === 200 && r.dados.concluidos === 1, 'resumo do painel', r.dados);

    console.log('\n🔒 Uma loja não vê a outra');
    r = await api('POST', '/auth/cadastro', { ...cad, nomeLoja: `Outra Loja ${sufixo}`, email: `outra.${sufixo}@teste.com` });
    const tokenOutra = r.dados.token;
    const slugOutra = r.dados.loja.slug;
    criados.lojas.push(r.dados.loja.id);
    r = await api('GET', `/painel/produtos/${camiseta._id}`, null, tokenOutra);
    conferir(r.status === 404, 'lojista B não abre produto da loja A');
    r = await api('GET', `/painel/pedidos/${p1._id}`, null, tokenOutra);
    conferir(r.status === 404, 'lojista B não abre pedido da loja A');
    r = await api('GET', `/publico/lojas/${slugOutra}/conta`, null, tokenCliente);
    conferir(r.status === 401, 'login do comprador na loja A não vale na loja B');
    r = await api('GET', '/admin/lojas', null, tokenLojista);
    conferir(r.status === 403, 'lojista não entra no painel do admin');

    console.log('\n🛡️  Seu painel (admin)');
    const emailAdmin = `admin.${sufixo}@teste.com`;
    const admin = await models.Usuario.create({ nome: 'Admin', email: emailAdmin, papel: 'admin', senhaHash: await bcrypt.hash('admin12345', 10) });
    criados.admin = admin._id;
    r = await api('POST', '/auth/login', { email: emailAdmin, senha: 'admin12345' });
    const tokenAdmin = r.dados.token;
    conferir(r.dados.papel === 'admin', 'login do admin');
    r = await api('GET', '/admin/resumo', null, tokenAdmin);
    conferir(r.status === 200 && r.dados.produtosEmAnalise >= 1, 'resumo: produtos em análise', r.dados);
    const lojaId = criados.lojas[0];
    r = await api('GET', `/admin/lojas/${lojaId}`, null, tokenAdmin);
    conferir(r.dados?.dono?.email === cad.email && r.dados.produtos === 4, 'detalhe da loja com dono e nº de produtos', r.dados);
    r = await api('POST', `/admin/produtos/${suspeito._id}/moderar`, { status: 'oculto', motivo: 'Produto proibido' }, tokenAdmin);
    conferir(r.dados?.status === 'oculto', 'admin ocultou o produto suspeito');
    r = await api('PUT', `/painel/produtos/${suspeito._id}`, { nome: 'Acessório', categoria: 'Acessórios', preco: 50, variacoes: [{ estoque: 10 }] }, tokenLojista);
    conferir(r.dados?.status === 'oculto', 'lojista editou, mas continua oculto até o admin liberar');

    r = await api('POST', `/publico/lojas/${slug}/denuncias`, { produtoId: camiseta._id, motivo: 'falsificado', texto: 'teste' });
    conferir(r.status === 201, 'visitante enviou denúncia');
    r = await api('GET', '/admin/denuncias?status=nova', null, tokenAdmin);
    conferir(r.dados.some((d) => String(d.lojaId?._id) === String(lojaId)), 'denúncia aparece para o admin');

    console.log('\n⏳ Plano vencido (bloqueio automático com dados preservados)');
    await models.Loja.updateOne({ _id: lojaId }, { $set: { 'licenca.acessoAte': new Date(Date.now() - 1000) } });
    require('../src/utils/cache').invalidar('');
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 403 && r.dados.detalhes?.indisponivel, 'vitrine mostra "loja indisponível"', r.dados);
    r = await api('GET', '/painel/produtos', null, tokenLojista);
    conferir(r.status === 402 && r.dados.motivo === 'plano', 'painel bloqueado (402) pedindo renovação');
    r = await api('GET', '/painel/pedidos', null, tokenLojista);
    conferir(r.status === 200, 'mas ainda vê os pedidos');
    r = await api('POST', `/painel/pedidos/${p2._id}/concluir`, {}, tokenLojista);
    conferir(r.status === 200 && r.dados.status === 'concluido', 'e consegue finalizar pedido em andamento');
    conferir((await models.Produto.countDocuments({ lojaId })) === 4, 'produtos continuam guardados');
    r = await api('POST', `/admin/lojas/${lojaId}/renovar`, { dias: 30, observacao: 'Pix recebido' }, tokenAdmin);
    conferir(r.status === 200 && r.dados.ativa && r.dados.plano === 'pago', 'admin renovou +30 dias', r.dados);
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 200, 'loja voltou ao ar na hora');

    console.log('\n🚫 Bloqueio por moderação');
    r = await api('POST', `/admin/lojas/${lojaId}/moderar`, { bloquear: true, motivo: 'Venda de produto proibido' }, tokenAdmin);
    r = await api('GET', '/painel/produtos', null, tokenLojista);
    conferir(r.status === 402 && r.dados.motivo === 'moderacao' && r.dados.erro.includes('proibido'), 'lojista vê o motivo do bloqueio', r.dados);
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 403, 'vitrine fora do ar');
    await api('POST', `/admin/lojas/${lojaId}/moderar`, { bloquear: false }, tokenAdmin);
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 200, 'desbloqueada');

    console.log('\n📢 Aviso e manutenção');
    r = await api('PUT', '/admin/aviso', { ativo: true, tipo: 'manutencao', mensagem: 'Manutenção rápida', bloquear: true, mostrarPara: 'todos' }, tokenAdmin);
    r = await api('GET', `/publico/lojas/${slug}`);
    conferir(r.status === 503, 'manutenção trava a vitrine');
    r = await api('GET', '/admin/resumo', null, tokenAdmin);
    conferir(r.status === 200, 'admin continua entrando');
    await api('PUT', '/admin/aviso', { ativo: false, tipo: 'informativo', mensagem: '' }, tokenAdmin);

    console.log('\n🗑️  Excluir loja');
    r = await api('POST', `/admin/lojas/${criados.lojas[1]}/excluir`, { confirmacao: 'nome errado' }, tokenAdmin);
    conferir(r.status === 400, 'exige o nome exato para excluir');
    r = await api('POST', `/admin/lojas/${criados.lojas[1]}/excluir`, { confirmacao: `Outra Loja ${sufixo}` }, tokenAdmin);
    conferir(r.status === 200, 'loja excluída');
  } catch (erro) {
    falhas++;
    console.error('💥 Erro durante o teste:', erro);
  } finally {
    // Limpa tudo o que o teste criou
    const ids = criados.lojas;
    await Promise.all([
      models.Produto.deleteMany({ lojaId: { $in: ids } }), models.Pedido.deleteMany({ lojaId: { $in: ids } }),
      models.Comprador.deleteMany({ lojaId: { $in: ids } }), models.Imagem.deleteMany({ lojaId: { $in: ids } }),
      models.Denuncia.deleteMany({ lojaId: { $in: ids } }), models.Usuario.deleteMany({ lojaId: { $in: ids } }),
      models.Loja.deleteMany({ _id: { $in: ids } }),
      criados.admin ? models.Usuario.deleteOne({ _id: criados.admin }) : null,
    ]);
    await models.Config.updateOne({ chave: 'sistema' }, { $set: { 'aviso.ativo': false } });
    http.close();
    await mongoose.disconnect();
    if (servidorMemoria) await servidorMemoria.stop();
    logOriginal(`\n${falhas ? '❌' : '✅'} ${ok} verificações OK, ${falhas} falha(s). Dados de teste apagados.\n`);
    process.exit(falhas ? 1 : 0);
  }
}

main();
