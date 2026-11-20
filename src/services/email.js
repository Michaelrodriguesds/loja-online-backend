// Envio de e-mails. Ordem de preferência:
//  1) Brevo (brevo.com — 300/dia grátis): envia usando o SEU e-mail (pode ser Gmail), sem domínio próprio
//  2) Resend (resend.com): sem domínio verificado, só entrega para o e-mail dono da conta
//  3) Nenhum configurado: o e-mail só aparece no log (modo simulado)
const { email } = require('../config/env');

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function modelo(titulo, paragrafos, botao) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#222">
  <h2 style="margin:0 0 16px">${esc(titulo)}</h2>
  ${paragrafos.map((p) => `<p style="line-height:1.5">${esc(p)}</p>`).join('')}
  ${botao ? `<p><a href="${esc(botao.url)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${esc(botao.texto)}</a></p>` : ''}
  </div>`;
}

async function enviarEmail({ para, assunto, titulo, paragrafos, botao }) {
  if (!para) return;
  if (email.brevoKey && email.brevoRemetente) {
    try {
      const nomeRemetente = (email.remetente.match(/^(.*?)\s*</)?.[1] || 'Loja Online').trim();
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': email.brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: nomeRemetente, email: email.brevoRemetente }, to: [{ email: para }], subject: assunto, htmlContent: modelo(titulo, paragrafos, botao) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) console.error('❌ E-mail (Brevo) não enviado:', r.status, await r.text());
    } catch (erro) {
      console.error('❌ E-mail (Brevo) não enviado:', erro.message);
    }
    return;
  }
  if (!email.resendKey) {
    console.log(`📧 [simulado] Para: ${para} | ${assunto}${botao ? ` | ${botao.url}` : ''}`);
    return { simulado: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${email.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: email.remetente, to: [para], subject: assunto, html: modelo(titulo, paragrafos, botao) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('❌ E-mail não enviado:', r.status, await r.text());
  } catch (erro) {
    console.error('❌ E-mail não enviado:', erro.message);
  }
}

// Não trava a resposta da API esperando o e-mail
const enviarSemEsperar = (dados) => { enviarEmail(dados).catch(() => {}); };

module.exports = { enviarEmail, enviarSemEsperar };
