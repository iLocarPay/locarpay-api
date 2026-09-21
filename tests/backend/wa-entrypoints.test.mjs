// GATE-WA-ENTRYPOINTS-01 — wa-keepalive (POST desativado; GET só com CRON_SECRET) e evolution-webhook
// (token server-side obrigatório, payload validado, escopo pela imobiliária da instância).
// Sem rede, sem Firestore real, sem provedor: tudo simulado, dados fictícios.
import { readFileSync } from 'node:fs';
import { reset, seed, store, spies } from './fakes.mjs';

const ROOT = new URL('../../', import.meta.url);
const EVO = 'https://evo.example.test';
const TOK = 'tok-webhook-de-teste-0123456789abcdef';
const CRON = 'segredo-cron-de-teste-0123456789';
const ENV = { EVOLUTION_API_URL: EVO, EVOLUTION_API_KEY: 'chave-evo-de-teste', EVOLUTION_INSTANCE: 'inst-plataforma', EVOLUTION_WEBHOOK_TOKEN: TOK, CRON_SECRET: CRON };
const setEnv = (on) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };
setEnv(true);

const net = { calls: [], everUnexpected: 0 };
const resp = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); net.calls.push({ method: (opts.method || 'GET').toUpperCase(), u });
  if (!u.startsWith(EVO + '/')) { net.everUnexpected++; return resp({}, 599); }
  if (/connectionState/.test(u)) return resp({ instance: { state: 'open' } });
  if (/webhook\/find/.test(u)) return resp({});
  return resp({ ok: true });
};

const handler = (await import(new URL('api/ilocarpay-broker.js', ROOT).href)).default;
const { MASTER_EMAILS } = await import(new URL('lib/authz.js', ROOT).href);
const MASTER = [...MASTER_EMAILS][0];

let pass = 0, fail = 0; const results = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(['PASS', name]); } else { fail++; results.push(['FAIL', name, detail]); } };
const logs = [];
const orig = { e: console.error, l: console.log, w: console.warn };
console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
const mkRes = () => ({ statusCode: 200, body: null, headers: {}, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; return this; }, send(x) { this.body = x; return this; }, end() { return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } });
const call = async (body, headers = {}, method = 'POST', query = {}) => { const res = mkRes(); await handler({ method, body, headers, query, socket: {} }, res); return res; };
const J = (r) => JSON.stringify(r.body);
// NO_WT: omite o parâmetro wt (passar undefined acionaria o valor padrão TOK).
const NO_WT = Symbol('sem-wt');
const hook = (body, wt = TOK, headers = {}) => call(body, headers, 'POST', wt === NO_WT ? { step: 'evolution-webhook' } : { step: 'evolution-webhook', wt });

const PHONE_A = '5514988887777', PHONE_B_SAME_SUFFIX = '5511988887777';
function base() {
  reset(); setEnv(true); net.calls = []; logs.length = 0;
  seed('owners', 'ownerA', { email: 'admin-a@example.test', status: 'active', evolutionInstance: 'inst-a', whatsappConnected: true });
  seed('owners', 'ownerB', { email: 'admin-b@example.test', status: 'active', evolutionInstance: 'inst-b', whatsappConnected: true });
  seed('owners', 'ownerS', { email: 'admin-s@example.test', status: 'suspended', evolutionInstance: 'inst-s' });
  seed('owners', 'ownerD1', { email: 'admin-d1@example.test', status: 'active', evolutionInstance: 'inst-dup' });
  seed('owners', 'ownerD2', { email: 'admin-d2@example.test', status: 'active', evolutionInstance: 'inst-dup' });
  seed('owners', 'ownerG', { email: 'admin-g@example.test', status: 'active', evolutionInstance: 'inst-plataforma' });
  // mensagens enviadas (fromMe) ainda não lidas, em A e em B, com o MESMO sufixo de 8 dígitos
  seed('messages', 'mA1', { ownerId: 'ownerA', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('messages', 'mA2', { ownerId: 'ownerA', fromMe: true, readByTenant: false, tenantPhone: '5514900001111' });
  seed('messages', 'mB1', { ownerId: 'ownerB', fromMe: true, readByTenant: false, tenantPhone: PHONE_B_SAME_SUFFIX });
  seed('messages', 'mX1', { fromMe: true, readByTenant: false, tenantPhone: PHONE_A }); // sem imobiliária
  // mensagens das imobiliárias cuja instância deve ser REJEITADA (plataforma, compartilhada, suspensa)
  seed('messages', 'mG1', { ownerId: 'ownerG', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('messages', 'mD1', { ownerId: 'ownerD1', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('messages', 'mD2', { ownerId: 'ownerD2', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('messages', 'mS1', { ownerId: 'ownerS', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('maintenance/ch1/messages', 'mC1', { chamadoOwnerId: 'ownerA', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
  seed('maintenance/ch2/messages', 'mC2', { chamadoOwnerId: 'ownerB', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
}
const msg = (col, id) => store.get(col).get(id);
const readState = () => ['messages/mA1', 'messages/mA2', 'messages/mB1', 'messages/mX1', 'maintenance/ch1/messages/mC1', 'maintenance/ch2/messages/mC2']
  .map((p) => { const i = p.lastIndexOf('/'); return msg(p.slice(0, i), p.slice(i + 1)).readByTenant ? 1 : 0; }).join('');
const NONE_READ = '000000';
const readEvt = (instance, phone = PHONE_A, extra = {}) => ({ event: 'messages.update', instance, data: [{ key: { remoteJid: phone + '@s.whatsapp.net', fromMe: true }, update: { status: 'READ' } }], ...extra });

// ════ WA-KEEPALIVE ════
for (const [nome, h, q, b] of [['anônimo', {}, {}, {}], ['Bearer do cron no POST', { authorization: 'Bearer ' + CRON }, {}, {}], ['master autenticado', { authorization: 'Bearer valid:' + MASTER }, {}, {}],
  ['segredo no corpo', {}, {}, { secret: CRON, cronSecret: CRON }], ['segredo na query', {}, { secret: CRON }, {}]]) {
  base();
  const r = await call({ step: 'wa-keepalive', ...b }, h, 'POST', q);
  ok(`keepalive POST (${nome}) -> 410 sem provedor, sem leitura/escrita`, r.statusCode === 410 && net.calls.length === 0 && spies.writes === 0 && !spies.reads.some((x) => /owners/.test(x)), `${r.statusCode} ${J(r)} ${JSON.stringify(spies.reads)}`);
}
for (const [nome, envCron, h, q] of [['sem CRON_SECRET no servidor', undefined, { authorization: 'Bearer undefined' }, {}], ['CRON_SECRET vazio', '', { authorization: 'Bearer ' }, {}],
  ['Bearer errado', CRON, { authorization: 'Bearer outro' }, {}], ['sem header', CRON, {}, {}], ['segredo na query', CRON, {}, { secret: CRON }]]) {
  base(); if (envCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = envCron;
  const r = await call(undefined, h, 'GET', { step: 'wa-keepalive', ...q });
  ok(`keepalive GET (${nome}) -> 401 sem efeito`, r.statusCode === 401 && net.calls.length === 0 && spies.writes === 0, `${r.statusCode} ${J(r)}`);
}
base();
{ const r = await call(undefined, { authorization: 'Bearer ' + CRON }, 'GET', { step: 'wa-keepalive' });
  ok('keepalive GET do cron (caller legítimo) continua funcionando', r.statusCode === 200 && net.calls.some((c) => /connectionState\/inst-a$/.test(c.u)), J(r)); }

// ════ EVOLUTION-WEBHOOK: autenticação ════
for (const [nome, envTok, wt] of [['sem token no servidor', undefined, TOK], ['token fraco no servidor (<32)', 'curto', 'curto'], ['sem wt', TOK, NO_WT], ['wt vazio', TOK, ''],
  ['wt errado de mesmo tamanho', TOK, TOK.slice(0, -1) + 'X'], ['wt de outro tamanho', TOK, TOK + 'x'], ['wt array', TOK, [TOK]], ['undefined dos dois lados', undefined, NO_WT]]) {
  base(); if (envTok === undefined) delete process.env.EVOLUTION_WEBHOOK_TOKEN; else process.env.EVOLUTION_WEBHOOK_TOKEN = envTok;
  const r = await hook(readEvt('inst-a'), wt);
  ok(`webhook (${nome}) -> 401, nenhuma leitura/escrita`, r.statusCode === 401 && r.body.error === 'Unauthorized' && spies.reads.length === 0 && readState() === NONE_READ, `${r.statusCode} ${J(r)}`);
}
base();
{ const r = await hook(readEvt('inst-a'), NO_WT, { 'x-webhook-token': TOK, authorization: 'Bearer ' + TOK });
  ok('webhook: token só em header não é o contrato (401)', r.statusCode === 401 && readState() === NONE_READ); }

// ════ EVOLUTION-WEBHOOK: efeito legítimo e isolamento ════
base();
let r = await hook(readEvt('inst-a'));
ok('webhook válido da instância A -> 200 { ok }', r.statusCode === 200 && J(r) === '{"ok":true}', J(r));
ok('marca como lidas só mensagens de A com o telefone (top-level e chamado)', readState() === '100010', readState());
ok('mensagens de B com o MESMO sufixo continuam não lidas', msg('messages', 'mB1').readByTenant === false && msg('maintenance/ch2/messages', 'mC2').readByTenant === false);
ok('mensagem sem imobiliária não é tocada', msg('messages', 'mX1').readByTenant === false);
ok('log sem telefone, token ou payload', !logs.some((l) => /5514988887777|88887777|tok-webhook|remoteJid|inst-a/.test(l)), logs.join(' | '));
const readAt1 = msg('messages', 'mA1').readAt;
r = await hook(readEvt('inst-a'));
ok('repetição do evento: nada novo (readAt preservado, estado igual)', r.statusCode === 200 && readState() === '100010' && msg('messages', 'mA1').readAt === readAt1);
base();
r = await hook(readEvt('inst-a', PHONE_A, { ownerId: 'ownerB', owner: 'ownerB', tenantId: 'x' }));
ok('ownerId no payload não escolhe a imobiliária (B intacta)', readState() === '100010', readState());
base();
const [p1, p2] = await Promise.all([hook(readEvt('inst-a')), hook(readEvt('inst-a'))]);
ok('dois eventos simultâneos: mesmo estado final, B intacta', p1.statusCode === 200 && p2.statusCode === 200 && readState() === '100010', readState());
for (const [nome, inst] of [['instância desconhecida', 'inst-zzz'], ['instância da plataforma', 'inst-plataforma'], ['instância compartilhada', 'inst-dup'], ['imobiliária suspensa', 'inst-s']]) {
  base(); r = await hook(readEvt(inst));
  const rejeitadas = ['mG1', 'mD1', 'mD2', 'mS1'].filter((id) => msg('messages', id).readByTenant !== false);
  ok(`webhook com ${nome} -> 200 sem nenhuma escrita (inclusive nas mensagens dessa imobiliária)`, r.statusCode === 200 && readState() === NONE_READ && spies.writes === 0 && rejeitadas.length === 0, readState() + ' ' + rejeitadas.join());
}

// ════ EVOLUTION-WEBHOOK: payload inválido ════
const invalidos = [
  ['corpo ausente', undefined], ['corpo array', [readEvt('inst-a')]], ['evento diferente', { ...readEvt('inst-a'), event: 'messages.upsert' }],
  ['sem instância', { ...readEvt('inst-a'), instance: undefined }], ['instância malformada', readEvt('../inst-a')], ['instância não-string', { ...readEvt('inst-a'), instance: ['inst-a'] }],
  ['itens demais (>50)', { event: 'messages.update', instance: 'inst-a', data: Array.from({ length: 51 }, () => readEvt('inst-a').data[0]) }],
  ['payload grande demais (>256 KB)', { ...readEvt('inst-a'), pad: 'x'.repeat(300 * 1024) }],
  ['fromMe falso', { event: 'messages.update', instance: 'inst-a', data: [{ key: { remoteJid: PHONE_A + '@s.whatsapp.net', fromMe: false }, update: { status: 'READ' } }] }],
  ['fromMe como string', { event: 'messages.update', instance: 'inst-a', data: [{ key: { remoteJid: PHONE_A + '@s.whatsapp.net', fromMe: 'true' }, update: { status: 'READ' } }] }],
  ['status diferente de lido', { event: 'messages.update', instance: 'inst-a', data: [{ key: { remoteJid: PHONE_A + '@s.whatsapp.net', fromMe: true }, update: { status: 'DELIVERY_ACK' } }] }],
  ['telefone curto (sufixo que casaria com A)', readEvt('inst-a', '887777')], ['remoteJid gigante', readEvt('inst-a', '1'.repeat(80))],
];
for (const [nome, body] of invalidos) {
  base(); r = await hook(body);
  ok(`payload inválido (${nome}) -> sem nenhuma escrita`, readState() === NONE_READ && spies.writes === 0 && (r.statusCode === 200 || r.statusCode === 400), `${r.statusCode} ${readState()}`);
}
base(); spies.failCollections.add('owners'); logs.length = 0;
r = await hook(readEvt('inst-a')); spies.failCollections.clear();
ok('falha interna -> 200 { ok } sem vazar detalhe', r.statusCode === 200 && J(r) === '{"ok":true}' && !logs.some((l) => /FIRESTORE_UNAVAILABLE|tok-webhook/.test(l)), logs.join(' | '));
base();
for (let i = 0; i < 450; i++) seed('messages', 'bulk' + i, { ownerId: 'ownerA', fromMe: true, readByTenant: false, tenantPhone: PHONE_A });
r = await hook(readEvt('inst-a'));
ok('limite de escritas por evento (400)', [...store.get('messages').values()].filter((m) => m.ownerId === 'ownerA' && m.readByTenant === true).length === 400);

// ════ SETUP-WEBHOOK registra a URL com o token ════
base(); delete process.env.EVOLUTION_WEBHOOK_TOKEN;
r = await call({ step: 'setup-webhook', ownerId: 'ownerA' }, { authorization: 'Bearer valid:' + MASTER });
ok('setup-webhook sem token no servidor -> 503 sem provedor (não registra URL sem autenticação)', r.statusCode === 503 && r.body.code === 'INTEGRATION_NOT_CONFIGURED' && net.calls.length === 0, J(r));
base();
r = await call({ step: 'setup-webhook', ownerId: 'ownerA' }, { authorization: 'Bearer valid:' + MASTER });
const set = net.calls.find((c) => /webhook\/set\//.test(c.u));
ok('setup-webhook com token -> registra a URL com wt', r.statusCode === 200 && !!set, J(r));
ok('resposta do setup-webhook não revela o token', !J(r).includes(TOK));

// ════ estático ════
const src = readFileSync(new URL('api/ilocarpay-broker.js', ROOT), 'utf8');
ok('comparação do token em tempo constante (timingSafeEqual)', /timingSafeEqual\(a, b\)/.test(src) && /import \{ timingSafeEqual \}\s+from 'node:crypto';/.test(src));
ok('POST wa-keepalive não chama mais handleWaKeepalive', (src.match(/await handleWaKeepalive\(db\)/g) || []).length === 1);
ok('rede: nenhuma chamada fora do Evolution simulado', net.everUnexpected === 0);

console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== GATE-WA-ENTRYPOINTS-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
