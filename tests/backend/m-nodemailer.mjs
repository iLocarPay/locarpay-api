import { spies } from './fakes.mjs';
// Fake do nodemailer: conta envios, guarda só os destinatários e permite simular falha do SMTP.
export default { createTransport: () => ({ sendMail: async (msg) => {
  if (spies.mailFail) { const e = new Error('Invalid login: 535 senha-de-teste smtp.example.test'); e.code = 'EAUTH'; throw e; }
  spies.mail = (spies.mail || 0) + 1;
  (spies.mailTo = spies.mailTo || []).push(msg && msg.to);
  return {};
} }) };
