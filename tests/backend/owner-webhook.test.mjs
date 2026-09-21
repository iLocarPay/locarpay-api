// P0-OWNER-WEBHOOK-SECRET-01 — step setup-webhook de api/ilocarpay-owner.js.
// Sem rede, sem Firestore real: Asaas simulado, dados e segredos fictícios.
import { reset, seed, store, spies } from './fakes.mjs';

// Configuração FICTÍCIA do servidor (definida antes do import: ASAAS_BASE é lido no load do módulo).
const ASAAS = 'https://asaas.example.test/v3';
process.env.ASAAS_API_URL = ASAAS;
const MIGRATE = 'segredo-migracao-de-teste-0123456789';
const ADMIN = 'segredo-admin-de-teste-0123456789';
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

// ── Asaas simulado (com estado): qualquer outro host é violação ────────────────
const net = { calls: [], mode: 'ok', delayMs: 0, hooks: [], everCalls: 0, everUnexpected: 0 };
const RAW = '{"errors":[{"code":"provider-raw","description":"chave-asaas-de-teste invalida em /var/task/x.js"}]}';
const mkResp = (obj, status = 200) => ({ ok: status < 400, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)), json: async () => (typeof obj === 'string' ? JSON.parse(obj) : obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  net.calls.push({ method, u, body: opts.body || '' }); net.everCalls++;
  if (!u.startsWith(ASAAS + '/')) { net.everUnexpected++; return mkResp({ error: 'bloqueado' }, 599); }
  if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
  if (net.mode === 'reject') { const e = new Error('connect ECONNREFUSED chave-asaas-de-teste'); e.name = 'FetchError'; throw e; }
  if (net.mode === 'list-fail' && method === 'GET') return mkResp(RAW, 500);
  if (net.mode === 'write-fail' && method !== 'GET') return mkResp(RAW, 400);
  if (/\/webhooks$/.test(u) && method === 'GET') return mkResp({ data: net.hooks });
  if (/\/webhooks$/.test(u) && method === 'POST') { const b = JSON.parse(opts.body); const h = { id: 'wh-' + (net.hooks.length + 1), ...b }; net.hooks.push(h); return mkResp(h); }
  const m = u.match(/\/webhooks\/([^/]+)$/);
  if (m && method === 'PUT') { const h = net.hooks.find((x) => x.id === m[1]); Object.assign(h, JSON.parse(opts.body)); return mkResp(h); }
  return mkResp({});
};
const writes = () => net.calls.filter((c) => c.method !== 'GET').length;

const handler = (await import(new URL('../../api/ilocarpay-owner.js', import.meta.url).href)).default;
const { MASTER_EMAILS } = await import(new URL('../../lib/authz.js', import.meta.url).href);
const MASTER = [...MASTER_EMAILS][0];

let pass = 0, fail = 0; const results = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(['PASS', name]); } else { fail++; results.push(['FAIL', name, detail]); } };
const logs = [];
const orig = { e: console.error, l: console.log, w: console.warn };
console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));

const mkRes = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; return this; }, end() { return this; }, setHeader() {} });
const call = async (body, headers = {}, method = 'POST', query = {}) => { const res = mkRes(); await handler({ method, body, headers, query, socket: {} }, res); return res; };
const J = (r) => JSON.stringify(r.body);
const H = {
  none: {}, invalid: { authorization: 'Bearer lixo' }, revoked: { authorization: 'Bearer revoked:' + MASTER },
  master: { authorization: 'Bearer valid:' + MASTER }, owner: { authorization: 'Bearer valid:owner-a@example.test' },
};
const OK_EVENTS = 'PAYMENT_RECEIVED,PAYMENT_CONFIRMED,PAYMENT_OVERDUE,SUBSCRIPTION_DELETED';
const MSG_PROV = 'Serviço externo indisponível no momento. Tente novamente mais tarde.';
const VAZA = /provider-raw|chave-asaas-de-teste|segredo-|\/var\/|ECONNREFUSED|errors|description|access_token|wh-\d|asaas\.example|Bearer|stack|Error:/i;

const NOW0 = 1_800_000_000_000; let clock = NOW0; const realNow = Date.now; Date.now = () => clock;
function base() {
  reset(); net.calls = []; net.mode = 'ok'; net.delayMs = 0; net.hooks = []; clock = NOW0;
  setEnv('MIGRATE_SECRET', MIGRATE); setEnv('ADMIN_SECRET', ADMIN);
  seed('owners', 'transgu-owner-001', { email: 'master-owner@example.test', asaasApiKey: 'chave-asaas-de-teste' });
  seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active' });
}
const zero = () => net.calls.length === 0 && !store.get('_toolRateLimits') && !(store.get('config') && store.get('config').get('asaas-webhook'));
const SW = (extra = {}) => ({ step: 'setup-webhook', ...extra });

// ════ 1. MIGRATE_SECRET não autoriza mais nada — prova fail-closed em TODAS as combinações ════
const SERVER = [['ausente', undefined], ['vazio', ''], ['só espaços', '   '], ['configurado', MIGRATE]];
const CLIENT = [['sem secret', {}], ['secret vazio', { secret: '' }], ['secret incorreto', { secret: 'errado' }], ['secret de outro tamanho', { secret: 'x' }],
  ['secret correto', { secret: MIGRATE }], ['secret null', { secret: null }], ['secret número', { secret: 12345 }], ['secret objeto', { secret: { $eq: MIGRATE } }],
  ['secret array', { secret: [MIGRATE, MIGRATE] }], ['secret só espaços', { secret: '   ' }]];
let combos = 0, combosOk = 0;
for (const [sn, sv] of SERVER) {
  for (const [cn, cv] of CLIENT) {
    base(); setEnv('MIGRATE_SECRET', sv);
    const r = await call(SW(cv));
    combos++;
    const good = r.statusCode === 401 && zero() && !VAZA.test(J(r));
    if (good) combosOk++; else ok(`servidor ${sn} + ${cn}: bloqueado`, false, `${r.statusCode} ${J(r)} calls=${net.calls.length}`);
  }
}
ok(`MIGRATE_SECRET: ${combos} combinações (servidor x corpo) -> 401, zero Asaas, zero leitura de cota/config`, combosOk === combos, `${combosOk}/${combos}`);
base(); setEnv('MIGRATE_SECRET', undefined);
let r = await call(SW());
ok('antigo fail-open (variável ausente + corpo sem secret, undefined === undefined) -> 401', r.statusCode === 401 && zero(), J(r));
base();
r = await call({ step: 'setup-webhook' }, {}, 'POST', { secret: MIGRATE });
ok('segredo na query -> 401 sem efeito', r.statusCode === 401 && zero(), J(r));
base();
r = await call(SW(), { 'x-migrate-secret': MIGRATE, 'x-secret': MIGRATE, secret: MIGRATE });
ok('segredo em headers arbitrários -> 401 sem efeito', r.statusCode === 401 && zero(), J(r));
base();
r = await call(SW(), { 'x-admin-token': ADMIN });
ok('ADMIN_SECRET (superadmin por senha) não autoriza este step -> 401', r.statusCode === 401 && zero(), J(r));
base();
r = await call(SW(), { authorization: 'Bearer ' + MIGRATE });
ok('MIGRATE_SECRET como Bearer -> 401', r.statusCode === 401 && zero(), J(r));

// ════ 2. master via Firebase Bearer (authz canônico) ════
for (const [nome, h, st] of [['sem token', H.none, 401], ['token inválido', H.invalid, 401], ['token revogado', H.revoked, 401], ['owner (não master)', H.owner, 403]]) {
  base();
  r = await call(SW({ secret: MIGRATE }), h);
  ok(`${nome} (mesmo com o secret correto no corpo) -> ${st} sem efeito`, r.statusCode === st && zero(), `${r.statusCode} ${J(r)}`);
}
base(); spies.failCollections.add('owners'); spies.failCollections.add('config'); spies.failCollections.add('_toolRateLimits');
r = await call(SW());
spies.failCollections.clear();
ok('autenticação antes de ler configuração: sem token + Firestore fora -> 401 (não 5xx)', r.statusCode === 401 && net.calls.length === 0, J(r));
base();
r = await call(SW({ role: 'master', isMaster: true, email: MASTER, ownerId: 'transgu-owner-001' }), H.owner);
ok('role/e-mail/ownerId forjados no corpo -> 403', r.statusCode === 403 && zero(), J(r));

// ════ 3. master: comportamento e idempotência ════
base();
r = await call(SW(), H.master);
ok('master -> 200 action created', r.statusCode === 200 && r.body.ok === true && r.body.action === 'created', J(r));
ok('resposta só { ok, action } (sem id/url/eventos do provedor)', Object.keys(r.body).sort().join() === 'action,ok', J(r));
ok('chamadas: 1 listagem + 1 criação no Asaas simulado', net.calls.length === 2 && net.calls[0].method === 'GET' && net.calls[1].method === 'POST');
const criado = JSON.parse(net.calls[1].body);
ok('cria com URL e eventos fixos do servidor', criado.url === 'https://ilocarpay.com.br/billing-webhook' && criado.events.join() === OK_EVENTS && criado.enabled === true);
ok('config/asaas-webhook gravado após sucesso', !!store.get('config').get('asaas-webhook'));
ok('lock liberado após sucesso', store.get('_toolRateLimits').get('owner-setup-webhook').lockUntil === 0);
r = await call(SW({ url: 'https://evil.example.test/x', events: ['ALL'], secret: 'x', webhookUrl: 'https://evil.example.test/y' }), H.master);
ok('repetição: já configurado -> action unchanged, só a listagem (zero escrita)', r.statusCode === 200 && r.body.action === 'unchanged' && writes() === 1 && net.calls.length === 3, J(r));
ok('URL/eventos do corpo são ignorados', !net.calls.some((c) => /evil|"ALL"/.test(c.body)));
net.hooks[0].events = ['PAYMENT_RECEIVED'];
r = await call(SW(), H.master);
const put = net.calls.filter((c) => c.method === 'PUT');
ok('webhook existente com eventos divergentes -> action updated (PUT, sem duplicar)', r.statusCode === 200 && r.body.action === 'updated' && put.length === 1 && net.hooks.length === 1, J(r));
ok('update usa eventos fixos do servidor', JSON.parse(put[0].body).events.join() === OK_EVENTS);
base(); seed('owners', 'transgu-owner-001', { email: 'master-owner@example.test' });
r = await call(SW(), H.master);
ok('sem chave master Asaas -> 503 fixo e zero chamada ao Asaas', r.statusCode === 503 && r.body.error === 'Integração não configurada neste ambiente. Acione o suporte iLocarPay.' && net.calls.length === 0, J(r));

// ════ 4. falhas do provedor sanitizadas ════
for (const [modo, desc] of [['list-fail', 'listagem falha'], ['write-fail', 'criação falha'], ['reject', 'erro de rede']]) {
  base(); net.mode = modo; logs.length = 0;
  r = await call(SW(), H.master);
  ok(`${desc} -> 503 com mensagem fixa`, r.statusCode === 503 && r.body.error === MSG_PROV && Object.keys(r.body).join() === 'error', J(r));
  ok(`${desc}: resposta sem corpo cru, chave, segredo ou stack`, !VAZA.test(J(r)), J(r));
  ok(`${desc}: logs sem corpo cru, chave master ou segredos`, !logs.some((l) => /provider-raw|chave-asaas-de-teste|segredo-/.test(l)), logs.join(' | '));
  ok(`${desc}: lock liberado`, store.get('_toolRateLimits').get('owner-setup-webhook').lockUntil === 0);
  if (modo === 'list-fail') ok('listagem falha -> NÃO cria (evita webhook duplicado)', writes() === 0 && net.hooks.length === 0);
  if (modo !== 'reject') ok(`${desc}: config não gravado`, !(store.get('config') && store.get('config').get('asaas-webhook')));
}

// ════ 5. limite e concorrência ════
base();
const st = [];
for (let i = 0; i < 5; i++) { net.hooks = []; st.push((await call(SW(), H.master)).statusCode); }
const antes = net.calls.length;
r = await call(SW(), H.master);
ok('6ª execução na janela -> 429 com mensagem fixa', st.join() === '200,200,200,200,200' && r.statusCode === 429 && r.body.error === 'Limite de uso desta ferramenta atingido. Tente novamente mais tarde.', st.join() + ' ' + J(r));
ok('429 não chama o Asaas', net.calls.length === antes);
clock = NOW0 + 61 * 60 * 1000;
ok('após a janela volta a funcionar', (await call(SW(), H.master)).statusCode === 200);
base(); net.delayMs = 30;
const [a, b] = await Promise.all([call(SW(), H.master), call(SW(), H.master)]);
ok('duas simultâneas -> uma 200 e uma 409', [a.statusCode, b.statusCode].sort().join() === '200,409', J(a) + J(b));
ok('simultâneas -> uma única criação no Asaas', net.hooks.length === 1 && writes() === 1);

// ════ 6. métodos ════
base();
r = await call(SW(), H.master, 'PUT');
ok('PUT -> 405 sem efeito', r.statusCode === 405 && zero(), J(r));
setEnv('CRON_SECRET', undefined);
r = await call(undefined, H.master, 'GET', { step: 'setup-webhook', secret: MIGRATE });
ok('GET é a rota do cron (exige CRON_SECRET) -> 401 e nunca executa o setup-webhook', r.statusCode === 401 && zero(), J(r));

// ════ 7. demais steps do ilocarpay-owner.js inalterados ════
base();
r = await call({ step: 'nao-existe' });
ok('step inválido -> 400 "step invalido"', r.statusCode === 400 && r.body.error === 'step invalido', J(r));
r = await call({ step: 'update', ownerId: 'ownerA' });
ok('update sem x-admin-token -> 401 (SEC-FIN-01B)', r.statusCode === 401, J(r));
r = await call({ step: 'setup-asaas', ownerId: 'ownerA' }, H.master);
ok('setup-asaas continua exigindo x-admin-token (Bearer não basta) -> 401', r.statusCode === 401, J(r));
base(); setEnv('MIGRATE_SECRET', undefined);
r = await call({ step: 'migrate', ownerId: 'ownerA' });
ok('migrate sem MIGRATE_SECRET configurado -> 403 (fail-closed pré-existente)', r.statusCode === 403, J(r));
setEnv('ASAAS_BILLING_WEBHOOK_TOKEN', undefined);
r = await call({ event: 'PAYMENT_RECEIVED' });
ok('billing-webhook sem token configurado -> 401 (pré-existente)', r.statusCode === 401, J(r));
ok('rede: nenhuma chamada fora do Asaas simulado em TODA a suíte', net.everUnexpected === 0 && net.everCalls > 0, `fora=${net.everUnexpected}`);
ok('logs de toda a suíte sem segredos, chave master ou token', !logs.some((l) => /segredo-migracao|segredo-admin|chave-asaas-de-teste|valid:/.test(l)));

Date.now = realNow;
console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== P0-OWNER-WEBHOOK-SECRET-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
