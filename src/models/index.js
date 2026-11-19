// Carrega todos os modelos de uma vez (necessário antes de criar os índices)
module.exports = {
  Loja: require('./Loja'),
  Usuario: require('./Usuario'),
  Comprador: require('./Comprador'),
  Produto: require('./Produto'),
  Pedido: require('./Pedido'),
  Denuncia: require('./Denuncia'),
  Imagem: require('./Imagem'),
  Config: require('./Config'),
};
