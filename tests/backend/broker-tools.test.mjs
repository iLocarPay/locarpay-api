// P0-BROKER-OPEN-STEPS-01 — suíte dos cinco steps administrativos do broker.
// Sem rede, sem Firestore real, sem e-mail/WhatsApp: provedores simulados, dados fictícios.
import { readFileSync } from 'node:fs';
import { reset, seed, store, spies } from './fakes.mjs';

// Configuração FICTÍCIA do servidor (nunca valores reais).
const EVO = 'https://evo.example.test';
const ENV = { EVOLUTION_API_URL: EVO, EVOLUTION_API_KEY: 'chave-evo-de-teste', EVOLUTION_INSTANCE: 'inst-teste', ADMIN_WHATSAPP: '5511900000000' };
const setEnv = (on) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };
setEnv(true);
const EXPECTED_URL = 'https://www.ilocarpay.com.br/api/ilocarpay-broker?step=evolution-webhook';

// ── rede simulada: qualquer host fora do Evolution fictício é contado como violação ──
const net = { calls: [], mode: 'ok', delayMs: 0, webhook: null, everCalls: 0, everUnexpected: 0 };
const RAW = '{"error":"provider-raw chave-evo-de-teste 5511900000000 inst-teste","stack":"at x (/var/task/y.js)"}';
const mkResp = (obj, status = 200) => ({ ok: status < 400, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)), json: async () => (typeof obj === 'string' ? JSON.parse(obj) : obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  net.calls.push({ method, u, body: opts.body || '', headers: opts.headers || {} }); net.everCalls++;
  if (!u.startsWith(EVO + '/')) { net.everUnexpected++; return mkResp({ error: 'bloqueado' }, 599); }
  if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
  if (net.mode === 'reject') { const e = new Error('connect ECONNREFUSED ' + EVO + ' chave-evo-de-teste'); e.name = 'FetchError'; throw e; }
  if (net.mode === 'fail') return mkResp(RAW, 500);
  if (/\/webhook\/find\//.test(u)) return mkResp(net.webhook || {});
  if (/\/webhook\/set\//.test(u)) { net.webhook = JSON.parse(opts.body).webhook; return mkResp({ ok: true, raw: 'provider-raw' }); }
  if (/\/message\/sendText\//.test(u)) return mkResp({ key: { id: 'provider-raw' } });
  return mkResp({});
};
const ext = () => net.calls.length;

const handler = (await import(new URL('../../api/ilocarpay-broker.js', import.meta.url).href)).default;
const { MASTER_EMAILS } = await import(new URL('../../lib/authz.js', import.meta.url).href);
const MASTER = [...MASTER_EMAILS][0];

let pass = 0, fail = 0; const results = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(['PASS', name]); } else { fail++; results.push(['FAIL', name, detail]); } };
const logs = [];
const orig = { e: console.error, l: console.log, w: console.warn };
console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));

const mkRes = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; }, setHeader() {} });
const call = async (body, headers = {}, method = 'POST', query = {}) => { const res = mkRes(); await handler({ method, body, headers, query, socket: {} }, res); return res; };
const J = (r) => JSON.stringify(r.body);

const H = {
  none: {}, invalid: { authorization: 'Bearer lixo' }, semBearer: { authorization: 'valid:' + MASTER },
  revoked: { authorization: 'Bearer revoked:' + MASTER }, master: { authorization: 'Bearer valid:' + MASTER },
  owner: { authorization: 'Bearer valid:owner-a@example.test' }, broker: { authorization: 'Bearer valid:broker-a@example.test' },
  tenant: { authorization: 'Bearer valid:inq@example.test' }, stranger: { authorization: 'Bearer valid:ninguem@example.test' },
  suspended: { authorization: 'Bearer valid:susp@example.test' },
};
const CAT = {
  INTEGRATION_NOT_CONFIGURED: [503, 'Integração não configurada neste ambiente. Acione o suporte iLocarPay.'],
  PROVIDER_UNAVAILABLE: [503, 'Serviço externo indisponível no momento. Tente novamente mais tarde.'],
  RECIPIENT_NOT_ALLOWED: [400, 'Destinatário não permitido para esta ferramenta.'],
  TOOL_BUSY: [409, 'Esta ferramenta já está em execução. Aguarde alguns instantes.'],
  TOOL_RATE_LIMITED: [429, 'Limite de uso desta ferramenta atingido. Tente novamente mais tarde.'],
};
const isCat = (r, code) => r.statusCode === CAT[code][0] && r.body && r.body.code === code && r.body.error === CAT[code][1];
// Vazamentos: resposta do provedor, credencial, telefone, instância, URL interna, e-mail, stack.
const VAZA = new RegExp(['provider-raw', 'chave-evo-de-teste', '5511900000000', '11900000000', 'inst-teste', 'evo\\.example', 'ECONNREFUSED', 'senha-de-teste', 'EAUTH', '535', 'smtp', '/var/', '\\bat \\w+ \\(', 'Error:', 'Bearer', '@', 'stack', 'apikey', 'baseUrl', 'instance'].join('|'), 'i');

const NOW0 = 1_800_000_000_000; let clock = NOW0; const realNow = Date.now; Date.now = () => clock;
function base() {
  reset(); setEnv(true);
  net.calls = []; net.mode = 'ok'; net.delayMs = 0; net.webhook = null;
  spies.mail = 0; spies.mailTo = []; spies.mailFail = false; clock = NOW0;
  seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active' });
  seed('brokers', 'broker_a', { email: 'broker-a@example.test', ownerId: 'ownerA', active: true });
  seed('users', 'uid-inq@example.test', { email: 'inq@example.test', role: 'tenant' });
  seed('users', 'uid-susp@example.test', { email: 'susp@example.test', suspended: true });
  seed('config', 'assinafy', { apiKey: 'chave-assinafy-de-teste' });
}
const zero = () => ext() === 0 && spies.mail === 0 && !store.get('_toolRateLimits');

const STEPS = {
  'test-email': { valid: {}, bad: { to: 12345 }, enabled: true },
  'send-whatsapp-test': { valid: {}, bad: { phone: 5511 }, enabled: true },
  'setup-webhook': { valid: { ownerId: 'ownerA' }, bad: { ownerId: '../x' }, enabled: true },
  'whatsapp-debug': { valid: { ownerId: 'ownerA' }, bad: { ownerId: '../x' }, enabled: false },
  'test-assinafy': { valid: { documentId: 'doc-x', ownerEmail: 'a@example.test', tenantEmail: 'b@example.test' }, bad: { documentId: 42 }, enabled: false },
};
const LIMIT = { 'test-email': 3, 'send-whatsapp-test': 3, 'setup-webhook': 5 };

for (const [step, cfg] of Object.entries(STEPS)) {
  const body = (extra = {}) => ({ step, ...cfg.valid, ...extra });
  // 1-4. identidade e papel: bloqueio ANTES de qualquer efeito
  for (const [nome, h, st] of [['sem token', H.none, 401], ['token inválido', H.invalid, 401], ['sem prefixo Bearer', H.semBearer, 401], ['token revogado', H.revoked, 401],
    ['usuário suspenso', H.suspended, 403], ['usuário sem cadastro', H.stranger, 403], ['owner (imobiliária)', H.owner, 403], ['corretor', H.broker, 403], ['inquilino', H.tenant, 403]]) {
    base();
    const r = await call(body(), h);
    ok(`${step}: ${nome} -> ${st}`, r.statusCode === st, `${r.statusCode} ${J(r)}`);
    ok(`${step}: ${nome}: zero efeito externo, zero leitura de limite`, zero(), `ext=${ext()} mail=${spies.mail}`);
  }
  // 6. papel/escopo forjado no corpo
  base();
  let r = await call(body({ role: 'master', isMaster: true, master: true, email: MASTER, ownerId: 'ownerA', uid: 'x' }), H.owner);
  ok(`${step}: role/e-mail/ownerId forjados no corpo -> 403`, r.statusCode === 403 && zero(), `${r.statusCode} ${J(r)}`);
  // 7. métodos
  base();
  r = await call(body(), H.master, 'PUT');
  ok(`${step}: PUT -> 405`, r.statusCode === 405 && zero(), J(r));
  r = await call(undefined, H.master, 'GET', { step, ...cfg.valid });
  ok(`${step}: GET não executa (healthcheck) e zero efeito`, r.statusCode === 200 && r.body.endpoint === 'ilocarpay-broker' && zero(), J(r));
  // 3b. autenticação ANTES de configuração: sem token + provedor sem configuração + Firestore fora -> 401
  base(); setEnv(false); spies.failCollections.add('owners'); spies.failCollections.add('config'); spies.failCollections.add('_toolRateLimits');
  r = await call(body(), H.none);
  spies.failCollections.clear(); setEnv(true);
  ok(`${step}: sem token não chega a ler configuração (401, não 5xx)`, r.statusCode === 401 && zero(), `${r.statusCode} ${J(r)}`);

  if (!cfg.enabled) {
    base();
    r = await call(body(), H.master);
    ok(`${step}: master -> 410 desativado`, r.statusCode === 410 && r.body.error === 'endpoint desativado', J(r));
    ok(`${step}: desativado não faz nenhuma chamada externa nem leitura`, zero() && !logs.some((l) => /inst-teste|evo\.example/.test(l)), `ext=${ext()}`);
    ok(`${step}: resposta não revela configuração`, !VAZA.test(J(r)) && Object.keys(r.body).join() === 'error', J(r));
    base();
    r = await call({ step, ...cfg.bad }, H.master);
    ok(`${step}: payload inválido também -> 410 sem efeito`, r.statusCode === 410 && zero(), J(r));
    continue;
  }
  // 8. payload inválido
  base();
  r = await call({ step, ...cfg.bad }, H.master);
  ok(`${step}: payload inválido -> 400`, r.statusCode === 400, `${r.statusCode} ${J(r)}`);
  ok(`${step}: payload inválido: zero efeito e nenhum uso de cota`, zero(), `ext=${ext()}`);
  // 5. master alcança somente o mock
  base();
  r = await call(body(), H.master);
  ok(`${step}: master -> 200 { ok: true }`, r.statusCode === 200 && r.body.ok === true, J(r));
  ok(`${step}: sucesso não devolve dado do provedor/configuração`, !VAZA.test(J(r)), J(r));
  ok(`${step}: só o provedor simulado foi acionado`, net.calls.every((c) => c.u.startsWith(EVO + '/')));
  // 9. rate limit global por ferramenta
  base();
  const st = [];
  for (let i = 0; i < LIMIT[step]; i++) { if (step === 'setup-webhook') net.webhook = null; st.push((await call(body(), H.master)).statusCode); }
  const antesExt = ext(), antesMail = spies.mail;
  net.webhook = null;
  r = await call(body(), H.master);
  ok(`${step}: ${LIMIT[step] + 1}ª chamada na janela -> 429`, st.every((s) => s === 200) && isCat(r, 'TOOL_RATE_LIMITED'), st.join() + ' ' + J(r));
  ok(`${step}: chamada barrada não gera efeito adicional`, ext() === antesExt && spies.mail === antesMail);
  clock = NOW0 + 61 * 60 * 1000;
  r = await call(body(), H.master);
  ok(`${step}: após a janela volta a funcionar`, r.statusCode === 200, J(r));
  // 10-12. falha do provedor sanitizada
  base();
  if (step === 'test-email') spies.mailFail = true; else net.mode = 'fail';
  logs.length = 0;
  r = await call(body(), H.master);
  ok(`${step}: falha do provedor -> 503 PROVIDER_UNAVAILABLE`, isCat(r, 'PROVIDER_UNAVAILABLE'), `${r.statusCode} ${J(r)}`);
  ok(`${step}: resposta crua/segredo/telefone/e-mail/stack não vazam`, !VAZA.test(J(r)), J(r));
  ok(`${step}: log sem resposta crua do provedor, credencial ou telefone`, !logs.some((l) => /provider-raw|chave-evo-de-teste|5511900000000|senha-de-teste/.test(l)), logs.join(' | '));
  ok(`${step}: lock liberado após falha`, store.get('_toolRateLimits').get(step).lockUntil === 0);
  if (step !== 'test-email') {
    base(); net.mode = 'reject';
    r = await call(body(), H.master);
    ok(`${step}: erro de rede -> 503 sanitizado`, isCat(r, 'PROVIDER_UNAVAILABLE') && !VAZA.test(J(r)), J(r));
  }
  // 503 de configuração só aparece para o master
  base(); setEnv(false);
  r = await call(body(), H.master);
  setEnv(true);
  ok(`${step}: sem configuração (master) -> 503 INTEGRATION_NOT_CONFIGURED sem efeito`, step === 'test-email' ? r.statusCode === 200 : (isCat(r, 'INTEGRATION_NOT_CONFIGURED') && zero()), J(r));
}

// ── específicos ──────────────────────────────────────────────────────────────
base(); {
  const r = await call({ step: 'test-email', to: 'outro@example.test' }, H.master);
  ok('test-email: destinatário arbitrário -> 400 RECIPIENT_NOT_ALLOWED sem envio', isCat(r, 'RECIPIENT_NOT_ALLOWED') && spies.mail === 0, J(r));
  const r2 = await call({ step: 'test-email', to: MASTER.toUpperCase() }, H.master);
  ok('test-email: o próprio e-mail do master é aceito', r2.statusCode === 200 && spies.mail === 1);
  ok('test-email: destino é SEMPRE o e-mail do token', spies.mailTo.length === 1 && spies.mailTo[0] === MASTER);
  ok('test-email: resposta não ecoa destinatário nem SMTP', Object.keys(r2.body).join() === 'ok', J(r2));
}
base(); {
  const r = await call({ step: 'send-whatsapp-test', phone: '(11) 98888-7777' }, H.master);
  ok('send-whatsapp-test: número arbitrário -> 400 RECIPIENT_NOT_ALLOWED sem chamada', isCat(r, 'RECIPIENT_NOT_ALLOWED') && ext() === 0, J(r));
  const r2 = await call({ step: 'send-whatsapp-test', phone: '11 90000-0000', message: 'golpe http://evil.example.test' }, H.master);
  ok('send-whatsapp-test: o número administrativo é aceito', r2.statusCode === 200 && ext() === 1, J(r2));
  const sent = JSON.parse(net.calls[0].body);
  ok('send-whatsapp-test: texto do corpo é ignorado (texto fixo)', !/golpe|evil/.test(net.calls[0].body) && /^Teste iLocarPay/.test(sent.text));
  ok('send-whatsapp-test: destino é o número administrativo do servidor', sent.number === ENV.ADMIN_WHATSAPP);
}
base(); {
  net.delayMs = 30;
  const [a, b] = await Promise.all([call({ step: 'send-whatsapp-test' }, H.master), call({ step: 'send-whatsapp-test' }, H.master)]);
  ok('send-whatsapp-test: duas simultâneas -> uma 200 e uma 409 TOOL_BUSY', [a.statusCode, b.statusCode].sort().join() === '200,409' && [a, b].some((x) => isCat(x, 'TOOL_BUSY')), J(a) + J(b));
  ok('send-whatsapp-test: simultâneas -> um único envio', net.calls.filter((c) => /sendText/.test(c.u)).length === 1);
}
base(); {
  const r = await call({ step: 'setup-webhook', ownerId: 'ownerA', webhookUrl: 'https://evil.example.test/h', url: 'https://evil.example.test/h', secret: 'segredo-do-atacante', events: ['ALL'], webhook: { url: 'https://evil.example.test/h' } }, H.master);
  const set = net.calls.find((c) => /\/webhook\/set\//.test(c.u));
  ok('setup-webhook: configuração do corpo (URL/segredo/eventos) é ignorada', r.statusCode === 200 && !!set && !/evil|segredo-do-atacante|"ALL"/.test(set.body), set && set.body);
  const w = set && JSON.parse(set.body).webhook;
  ok('setup-webhook: usa só a URL e os eventos fixos do servidor', !!w && w.url === EXPECTED_URL && w.enabled === true && w.events.join() === 'MESSAGES_UPDATE,MESSAGES_UPSERT');
  ok('setup-webhook: 1ª chamada altera (changed: true)', r.body.changed === true, J(r));
  const antes = net.calls.filter((c) => /\/webhook\/set\//.test(c.u)).length;
  const r2 = await call({ step: 'setup-webhook', ownerId: 'ownerA' }, H.master);
  ok('setup-webhook: já configurado -> não reescreve (changed: false, zero set)', r2.statusCode === 200 && r2.body.changed === false && net.calls.filter((c) => /\/webhook\/set\//.test(c.u)).length === antes, J(r2));
  const n0 = net.calls.length; // 1ª: find+set; 2ª: só find
  ok('setup-webhook: chamadas ao provedor = find+set, depois só find', n0 === 3, String(n0));
  const r3 = await call({ step: 'setup-webhook', ownerId: 'nao-existe' }, H.master);
  ok('setup-webhook: imobiliária inexistente -> 404 sem chamada', r3.statusCode === 404 && net.calls.length === n0, J(r3));
  ok('setup-webhook: GET não altera webhook', (await call(undefined, H.master, 'GET', { step: 'setup-webhook' })).statusCode === 200 && net.calls.length === n0);
}
{
  // Caller: nenhum dos cinco steps é chamado por painel, superadmin, páginas públicas ou scripts.
  const html = ['public/admin/index.html', 'public/superadmin/index.html', 'public/qr/index.html', 'public/broker/index.html']
    .map((p) => { try { return readFileSync(new URL('../../' + p, import.meta.url), 'utf8'); } catch { return ''; } }).join('\n');
  ok('nenhum caller no frontend para os cinco steps', !/test-email|send-whatsapp-test|test-assinafy|whatsapp-debug|setup-webhook/.test(html));
  const src = readFileSync(new URL('../../api/ilocarpay-broker.js', import.meta.url), 'utf8');
  ok('código de diagnóstico removido (sem corpo cru do Evolution nem e-mails fixos de teste)', !/stateBody|createBody|connectBody|Proprietário Teste|smtp: 'noreply/.test(src));
}
ok('rede: nenhuma chamada fora do provedor simulado em TODA a suíte', net.everUnexpected === 0 && net.everCalls > 0, `fora=${net.everUnexpected} total=${net.everCalls}`);

Date.now = realNow;
console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== P0-BROKER-OPEN-STEPS-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
