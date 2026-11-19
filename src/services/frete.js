// Cálculo do frete: distância (loja → endereço do comprador) × valor por km.
// 1) Transforma endereço em coordenadas (Nominatim/OpenStreetMap, grátis)
// 2) Mede a distância pela rua (OSRM público ou OpenRouteService); se falhar, usa
//    a linha reta × 1,3 (aproximação de rua)
// 3) Se nada funcionar, o frete fica "a combinar" e o lojista define ao aprovar.
// O valor é SEMPRE estimado: o lojista confirma o frete final na aprovação.
const { frete: cfg } = require('../config/env');
const { comCache } = require('../utils/cache');
const { arredondar } = require('../utils/dinheiro');
const { semAcentos } = require('../utils/formatos');

const TIMEOUT = 6000;

function distanciaRetaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const R = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function buscarJson(url, opcoes = {}) {
  const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Endereço → { lat, lng }. Guarda em cache por 1 dia (o Nominatim pede no máx. 1 consulta/segundo)
async function geocodificar(texto) {
  if (cfg.geocoder === 'desligado' || !texto) return null;
  const chave = `geo:${semAcentos(texto).toLowerCase()}`;
  try {
    return await comCache(chave, 24 * 60 * 60 * 1000, async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(texto)}`;
      const lista = await buscarJson(url, { headers: { 'User-Agent': `LojaOnlineSaaS/1.0 (${cfg.contato})`, 'Accept-Language': 'pt-BR' } });
      if (!lista?.length) return null;
      return { lat: Number(lista[0].lat), lng: Number(lista[0].lon) };
    });
  } catch (erro) {
    console.warn('⚠️  Não deu para localizar o endereço:', erro.message);
    return null;
  }
}

async function distanciaRuaKm(a, b) {
  try {
    if (cfg.rotas === 'ors' && cfg.orsKey) {
      const d = await buscarJson(
        `https://api.openrouteservice.org/v2/directions/driving-car?start=${a.lng},${a.lat}&end=${b.lng},${b.lat}`,
        { headers: { Authorization: cfg.orsKey } }
      );
      return d.features[0].properties.summary.distance / 1000;
    }
    if (cfg.rotas === 'osrm') {
      const d = await buscarJson(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`);
      if (d.code === 'Ok' && d.routes?.length) return d.routes[0].distance / 1000;
    }
  } catch (erro) {
    console.warn('⚠️  Rota indisponível, usando distância aproximada:', erro.message);
  }
  return distanciaRetaKm(a, b) * 1.3;
}

const textoEndereco = (e) => [e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ''}`, e.bairro, e.cidade, e.uf || 'RJ', 'Brasil'].filter(Boolean).join(', ');
const mesmaCidade = (a, b) => semAcentos(a).trim().toLowerCase() === semAcentos(b).trim().toLowerCase();

/** Valor do frete a partir da distância (só ida ou ida e volta, com taxa mínima) */
function valorFrete(entrega, kmIda) {
  const km = entrega.calculo === 'ida_volta' ? kmIda * 2 : kmIda;
  return arredondar(Math.max(Number(entrega.taxaMinima) || 0, km * (Number(entrega.valorKm) || 0)));
}

/**
 * @returns {{ distanciaKm: number|null, frete: number|null, aCombinar: boolean, foraDaArea: boolean, motivo?: string }}
 */
async function calcularFrete(loja, endereco) {
  const e = loja.entrega || {};
  if (!e.ativa) return { distanciaKm: null, frete: null, aCombinar: false, foraDaArea: true, motivo: 'Esta loja não faz entregas. Escolha retirar no local.' };
  if (!endereco?.cidade) return { distanciaKm: null, frete: null, aCombinar: false, foraDaArea: true, motivo: 'Cadastre seu endereço para calcular o frete.' };
  if (e.cidades?.length && !e.cidades.some((c) => mesmaCidade(c, endereco.cidade))) {
    return { distanciaKm: null, frete: null, aCombinar: false, foraDaArea: true, motivo: `Entregamos só em: ${e.cidades.join(', ')}.` };
  }

  let origem = loja.endereco?.lat != null ? { lat: loja.endereco.lat, lng: loja.endereco.lng } : null;
  if (!origem && loja.endereco?.texto) origem = await geocodificar(`${loja.endereco.texto}, ${loja.endereco.cidade}, ${loja.endereco.uf || 'RJ'}, Brasil`);
  const destino = await geocodificar(textoEndereco(endereco));
  if (!origem || !destino) return { distanciaKm: null, frete: null, aCombinar: true, foraDaArea: false, motivo: 'Frete a combinar: a loja confirma o valor ao aprovar.' };

  const km = Math.round((await distanciaRuaKm(origem, destino)) * 10) / 10;
  if (km > e.raioMaxKm) return { distanciaKm: km, frete: null, aCombinar: false, foraDaArea: true, motivo: `Endereço a ${km} km. Entregamos até ${e.raioMaxKm} km.` };
  return { distanciaKm: km, frete: valorFrete(e, km), aCombinar: false, foraDaArea: false };
}

module.exports = { calcularFrete, valorFrete, geocodificar, distanciaRetaKm, textoEndereco };
