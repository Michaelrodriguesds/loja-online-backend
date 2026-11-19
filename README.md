# Loja Online SaaS — Backend

API para várias lojas online de comércios locais (1 loja = 1 lojista = 1 plano mensal).
Node.js + Express 5 + MongoDB. Mesma base do SaaS da barbearia.

## Como rodar no seu PC

```bash
npm install
copy .env.example .env      # no Windows (ou cp no Linux/Mac) e preencha
npm run gerar-chaves        # cole o JWT_SECRET no .env
npm run criar-admin -- seu@email.com SuaSenhaForte123 "Michael"
npm run dev
```

## Testar

```bash
npm run testar                # testa no banco do .env e apaga tudo que criou
```

78 verificações: cadastro, produtos, estoque, pedidos, frete, Pix, bloqueio, moderação, admin.

## Estrutura

```
src/
├── models/        Loja, Usuario (lojista/admin), Comprador, Produto, Pedido, Denuncia, Imagem, Config
├── routes/
│   ├── auth.routes.js     /auth     cadastro do lojista, login, esqueci/redefinir senha
│   ├── painel.routes.js   /painel   área do lojista (loja, produtos, pedidos, fotos)
│   ├── publico.routes.js  /publico  vitrine, conta do comprador, frete, pedidos, denúncias
│   └── admin.routes.js    /admin    SUA área (lojas, planos, moderação, avisos)
├── services/
│   ├── pedidos.js     regras do pedido + reserva/devolução de estoque
│   ├── frete.js       distância × valor por km (taxa mínima, raio, cidades)
│   ├── licenca.js     30 dias grátis, bloqueio automático, renovação
│   ├── moderacao.js   palavras suspeitas → produto vai para análise
│   ├── imagens.js     fotos no Cloudinary ou no MongoDB
│   └── email.js       Resend (recuperar senha, avisos)
└── jobs/tarefas.js    cancela pedidos vencidos (5 em 5 min), avisa plano vencendo
```

## Regras principais

| Regra | Onde |
|---|---|
| Plano vence → loja sai do ar sozinha (dados guardados) | `services/licenca.js`, `middlewares/licenca.js` |
| Loja bloqueada ainda finaliza pedidos em andamento | `middlewares/licenca.js` (`LIBERADAS_BLOQUEADO`) |
| Pedido: aprovar → (cliente aceita frete maior) → Pix → preparo → entrega → concluído | `services/pedidos.js` |
| Estoque é reservado no pedido e volta se cancelar/recusar/expirar | `services/pedidos.js` |
| Cada consulta filtra pela loja (uma loja nunca vê dados da outra) | todas as rotas |
| Segmento "alimentos" bloqueado até você liberar no /admin | `models/Config.js` |

## Publicar no Render

1. Novo **Web Service** apontando para este repositório.
2. Build: `npm install` · Start: `npm start`.
3. Em **Environment**, cadastre as variáveis do `.env` (com `NODE_ENV=production`,
   `FRONTEND_URL` = endereço do Netlify, `API_URL` = endereço do Render).
4. Plano **Starter (US$ 7)**: o grátis "dorme" e a loja demora ~1 min para abrir.
