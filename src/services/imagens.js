// Guarda as fotos dos produtos: no Cloudinary (se configurado) ou no MongoDB.
const crypto = require('crypto');
const { Imagem } = require('../models');
const { cloudinary, apiUrl } = require('../config/env');
const { ErroApp } = require('../utils/erros');

const MAX_BYTES = 700 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

function lerDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || !TIPOS.includes(m[1])) throw new ErroApp(400, 'Envie uma foto JPG, PNG ou WEBP.');
  const dados = Buffer.from(m[2], 'base64');
  if (dados.length > MAX_BYTES) throw new ErroApp(413, 'Foto muito grande. O app reduz sozinho; tente outra foto.');
  return { tipo: m[1], dados };
}

async function enviarCloudinary(dataUrl, lojaId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `lojas/${lojaId}`;
  const assinatura = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${cloudinary.apiSecret}`).digest('hex');
  const form = new URLSearchParams({ file: dataUrl, folder, timestamp: String(timestamp), api_key: cloudinary.apiKey, signature: assinatura });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new ErroApp(502, 'Não foi possível enviar a foto agora. Tente de novo.');
  return (await r.json()).secure_url;
}

async function salvarImagem(dataUrl, lojaId) {
  const { tipo, dados } = lerDataUrl(dataUrl);
  if (cloudinary.cloudName && cloudinary.apiKey && cloudinary.apiSecret) return enviarCloudinary(dataUrl, lojaId);
  const img = await Imagem.create({ lojaId, tipo, dados });
  return `${apiUrl}/imagens/${img._id}`;
}

// Apaga do MongoDB as fotos locais que não são mais usadas
async function apagarImagensLocais(urls) {
  const ids = (urls || []).map((u) => /\/imagens\/([0-9a-f]{24})$/.exec(u)?.[1]).filter(Boolean);
  if (ids.length) await Imagem.deleteMany({ _id: { $in: ids } });
}

module.exports = { salvarImagem, apagarImagensLocais };
