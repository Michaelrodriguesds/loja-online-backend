// Gera o segredo do login. Uso: npm run gerar-chaves
const crypto = require('crypto');

console.log('\nCopie esta linha para o seu arquivo .env (backend):\n');
console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`);
console.log('\n⚠️  Se o JWT_SECRET mudar, todo mundo precisa fazer login de novo.\n');
