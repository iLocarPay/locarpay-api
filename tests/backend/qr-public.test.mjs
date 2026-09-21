// P0-QR-PUBLIC-01 — encerramento da página pública /qr e do caminho "sem ownerId -> instância global"
// do step whatsapp-qr. Sem rede, sem Firestore real, sem provedor: tudo simulado, dados fictícios.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { reset, seed, spies } from './fakes.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const EVO = 'https://evo.example.test';
const ENV = { EVOLUTION_API_URL: EVO, EVOLUTION_API_KEY: 'chave-evo-de-teste', EVOLUTION_INSTANCE: 'inst-global-teste' };
const setEnv = (on) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };

// ── provedor simulado + espiões de rede e de timers ──────────────────────────
const net = { calls: [], everCalls: 0, everUnexpected: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  net.calls.push({ method: (opts.method || 'GET').toUpperCase(), u }); net.everCalls++;
  if (!u.startsWith(EVO + '/')) { net.everUnexpected++; return { ok: false, status: 599, text: async () => '{}', json: async () => ({}) }; }
  if (/connectionState/.test(u)) return { ok: true, status: 200, text: async () => JSON.stringify({ instance: { state: 'open' } }), json: async () => ({ instance: { state: 'open' } }) };
  return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
};
const realSetTimeout = globalThis.setTimeout, realSetInterval = globalThis.setInterval;
const timers = { timeout: 0, interval: 0 };
const armTimers = () => { timers.timeout = 0; timers.interval = 0;
  globalThis.setTimeout = (...a) => { timers.timeout++; return realSetTimeout(...a); };
  globalThis.setInterval = (...a) => { timers.interval++; return realSetInterval(...a); }; };
const disarmTimers = () => { globalThis.setTimeout = realSetTimeout; globalThis.setInterval = realSetInterval; };

setEnv(true);
const handler = (await import(new URL('api/ilocarpay-broker.js', ROOT).href)).default;

let pass = 0, fail = 0; const results = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(['PASS', name]); } else { fail++; results.push(['FAIL', name, detail]); } };
const logs = [];
const orig = { e: console.error, l: console.log, w: console.warn };
console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
const mkRes = () => ({ statusCode: 200, body: null, headers: {}, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } });
const call = async (body, headers = {}, method = 'POST', query = {}) => { const res = mkRes(); await handler({ method, body, headers, query, socket: {} }, res); return res; };
const J = (r) => JSON.stringify(r.body);
const VAZA = /inst-global-teste|evo\.example|chave-evo|base64|qr|instance|state|connected|@|\+?55\d{8,}|https?:|Bearer|Error:|stack/i;
function base() { reset(); setEnv(true); net.calls = []; logs.length = 0; seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active', evolutionInstance: 'owner_ownerA' }); }

// ════ 1. a página pública deixou de existir (404 por construção na Vercel) ════
ok('1. public/qr/index.html não existe mais', !existsSync(new URL('public/qr/index.html', ROOT)));
ok('1b. diretório public/qr não existe (nenhum outro arquivo servido em /qr)', !existsSync(new URL('public/qr', ROOT)));
const vercel = JSON.parse(read('vercel.json'));
const rotas = ['rewrites', 'redirects', 'routes'].flatMap((k) => (vercel[k] || []).map((r) => [k, String(r.source || r.src || ''), String(r.destination || r.dest || '')]));
ok('1c. nenhum rewrite/redirect/route casa /qr ou é catch-all', !rotas.some(([, s, d]) => /(^|\/)qr(\/|$|\?)|\(\.\*\)|:path\*/.test(s) || /(^|\/)qr(\/|$)/.test(d)), JSON.stringify(rotas.filter(([, s]) => /qr|\(\.\*\)/.test(s))));
ok('1d. sem página 404 customizada que devolva conteúdo de /qr', !readdirSync(new URL('public/', ROOT)).some((f) => /^(404|_error)/i.test(f)));
ok('1e. nenhuma função nova em api/ (404 vem do estático, não de um handler)', readdirSync(new URL('api/', ROOT)).filter((f) => f.endsWith('.js') && !f.startsWith('_')).length === 12);

// ════ 2-3. referências: nenhum caller/link quebrado; painel intacto ════
const textos = ['public/admin/index.html', 'public/broker/index.html', 'public/superadmin/index.html', 'public/index.html', 'public/download/index.html', 'public/firebase-messaging-sw.js']
  .filter((p) => existsSync(new URL(p, ROOT))).map((p) => [p, read(p)]);
const refQr = textos.filter(([, t]) => /(["'(=]|href=)\/qr(["'\/?#)]|$)|ilocarpay\.com\.br\/qr/m.test(t)).map(([p]) => p);
ok('19. nenhum link/caller textual para /qr no frontend', refQr.length === 0, refQr.join(','));
const admin = read('public/admin/index.html');
ok('19b. painel mantém o fluxo próprio de QR (openWhatsappQr + step whatsapp-qr com ownerId)', /async function openWhatsappQr\(ownerId\)/.test(admin) && /_qrOwnerId = ownerId \|\| currentOwnerId;/.test(admin) && /step: 'whatsapp-qr', ownerId: _qrOwnerId/.test(admin));
ok('19c. service worker do site não intercepta /qr (só FCM)', !/qr/i.test(read('public/firebase-messaging-sw.js')));

// ════ 4-15. o caminho "sem ownerId -> instância global" foi fechado no step ════
const SEM_OWNER = [['sem ownerId', {}], ['ownerId vazio', { ownerId: '' }], ['ownerId "undefined"', { ownerId: 'undefined' }], ['ownerId só espaços', { ownerId: '   ' }],
  ['ownerId null', { ownerId: null }], ['ownerId número', { ownerId: 42 }], ['ownerId objeto', { ownerId: { a: 1 } }], ['ownerId array', { ownerId: ['ownerA'] }]];
for (const [nome, extra] of SEM_OWNER) {
  for (const envOn of [true, false]) {
    base(); setEnv(envOn); spies.failCollections.add('owners'); armTimers();
    const r = await call({ step: 'whatsapp-qr', ...extra });
    disarmTimers(); spies.failCollections.clear(); setEnv(true);
    const tag = `${nome} (${envOn ? 'com' : 'sem'} variáveis do Evolution)`;
    ok(`2/4/5. ${tag}: anônimo -> 401 fixo (WHATSAPP-MT-02), zero chamada ao provedor`, r.statusCode === 401 && r.body.error === 'Nao autorizado' && net.calls.length === 0, `${r.statusCode} ${J(r)} calls=${net.calls.length}`);
    ok(`6/7. ${tag}: recusa antes de ler Firestore (owners indisponível não muda a resposta)`, r.statusCode === 401);
    ok(`12. ${tag}: nenhum timer/polling iniciado`, timers.timeout === 0 && timers.interval === 0, JSON.stringify(timers));
    ok(`13/15. ${tag}: resposta só { error } sem QR/instância/estado/URL/telefone`, Object.keys(r.body).join() === 'error' && !VAZA.test(J(r)), J(r));
  }
}
base();
const r0 = await call({ step: 'whatsapp-qr' });
ok('8-11. nenhuma rota do provedor (listar/connectionState/create/connect/logout/delete) foi chamada', net.calls.length === 0 && !net.calls.some((c) => /instance\/(fetchInstances|connectionState|create|connect|logout|delete)/.test(c.u)));
ok('13b. log do servidor não contém QR, instância global nem credencial', !logs.some((l) => /inst-global-teste|chave-evo|base64/.test(l)), logs.join(' | '));
for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
  base();
  const r = await call(m === 'GET' ? undefined : { step: 'whatsapp-qr' }, {}, m, { step: 'whatsapp-qr' });
  ok(`3. ${m} com step whatsapp-qr não executa nada (sem provedor)`, net.calls.length === 0 && (m === 'GET' ? r.statusCode === 200 && r.body.endpoint === 'ilocarpay-broker' : r.statusCode === 405), `${r.statusCode} ${J(r)}`);
}

// ════ 16-17. fluxos operacionais inalterados ════
base();
const rp = await call({ step: 'whatsapp-qr', ownerId: 'ownerA' }, { authorization: 'Bearer valid:owner-a@example.test' });
ok('16. fluxo do painel (admin autenticado, WHATSAPP-MT-02): instância própria já aberta -> connected', rp.statusCode === 200 && rp.body.connected === true, J(rp));
ok('16b. fluxo do painel consulta só a instância da própria imobiliária', net.calls.length === 1 && /connectionState\/owner_ownerA$/.test(net.calls[0].u), JSON.stringify(net.calls));
base();
{
const rTok = process.env.EVOLUTION_WEBHOOK_TOKEN; process.env.EVOLUTION_WEBHOOK_TOKEN = 'tok-webhook-de-teste-0123456789abcdef';
const wAnon = await call({ event: 'messages.update', data: [] }, {}, 'POST', { step: 'evolution-webhook' });
const wAuth = await call({ event: 'messages.update', data: [] }, {}, 'POST', { step: 'evolution-webhook', wt: 'tok-webhook-de-teste-0123456789abcdef' });
if (rTok === undefined) delete process.env.EVOLUTION_WEBHOOK_TOKEN; else process.env.EVOLUTION_WEBHOOK_TOKEN = rTok;
ok('17. webhook do Evolution: sem token 401; com token 200 (GATE-WA-ENTRYPOINTS-01)', wAnon.statusCode === 401 && wAuth.statusCode === 200 && wAuth.body.ok === true, JSON.stringify([wAnon.body, wAuth.body]));
}
const src = read('api/ilocarpay-broker.js');
ok('16c. envio operacional intacto: sendWhatsApp e getEvoConfig continuam com o fallback global para ENVIO', /async function sendWhatsApp\(phone, message, ownerData = null, ownerId = null\)/.test(src) && /process\.env\.EVOLUTION_INSTANCE/.test(src));

// ════ 18/20. superfície ════
ok('18. contagem de Serverless Functions = 12', readdirSync(new URL('api/', ROOT)).filter((f) => f.endsWith('.js') && !f.startsWith('_')).length === 12);
ok('20. rota multi-tenant futura não foi criada (sem whatsapp_integrations/whatsapp-status)', !/whatsapp_integrations|'whatsapp-status'/.test(src));
ok('rede: nenhuma chamada fora do provedor simulado em toda a suíte', net.everUnexpected === 0);

console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== P0-QR-PUBLIC-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
