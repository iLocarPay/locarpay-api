// P0-OWNER-WHATSAPP-DISCONNECT-01 — desconectar o WhatsApp da PRÓPRIA imobiliária.
// Sem rede, sem Firestore real, sem provedor: tudo simulado, dados fictícios.
import { readFileSync, existsSync } from 'node:fs';
import { reset, seed, store, spies } from './fakes.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const EVO = 'https://evo.example.test';
const ENV = { EVOLUTION_API_URL: EVO, EVOLUTION_API_KEY: 'chave-evo-de-teste', EVOLUTION_INSTANCE: 'inst-plataforma' };
const setEnv = (on) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };
setEnv(true);

// ── Evolution simulado (com estado por instância) ─────────────────────────────
const net = { calls: [], states: {}, mode: 'ok', delayMs: 0, everUnexpected: 0 };
const resp = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  net.calls.push({ method, u });
  if (!u.startsWith(EVO + '/')) { net.everUnexpected++; return resp({ error: 'bloqueado' }, 599); }
  if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
  const m = u.match(/instance\/(connectionState|logout)\/([^/?]+)$/);
  if (net.mode === 'timeout') { const e = new Error('The operation was aborted chave-evo-de-teste'); e.name = 'AbortError'; throw e; }
  if (m && m[1] === 'connectionState') {
    if (net.mode === 'state500') return resp({ error: 'provider-raw', apikey: 'chave-evo-de-teste' }, 500);
    if (net.mode === 'stateGarbage') return resp({ foo: 'bar' });
    return resp({ instance: { instanceName: m[2], state: net.states[m[2]] || 'close', owner: '5511999998888@s.whatsapp.net' } });
  }
  if (m && m[1] === 'logout' && method === 'DELETE') {
    if (net.mode === 'logout500') return resp({ error: 'provider-raw falha', owner: '5511999998888' }, 500);
    if (net.mode === 'logoutTimeout') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    net.states[m[2]] = 'close';
    return resp({ status: 'SUCCESS', provider: 'provider-raw', owner: '5511999998888' });
  }
  return resp({ error: 'rota inesperada' }, 418);
};
const logouts = () => net.calls.filter((c) => c.method === 'DELETE' && /instance\/logout\//.test(c.u));
const forbidden = () => net.calls.filter((c) => /instance\/(create|delete|restart|connect\/)|webhook\//.test(c.u));

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
const dc = (h, extra = {}) => call({ step: 'whatsapp-disconnect', ...extra }, h);
const J = (r) => JSON.stringify(r.body);
const tok = (email) => ({ authorization: 'Bearer valid:' + email });
const H = {
  none: {}, invalid: { authorization: 'Bearer lixo' }, revoked: { authorization: 'Bearer revoked:admin-a@example.test' },
  adminA: tok('admin-a@example.test'), adminB: tok('admin-b@example.test'), adminS: tok('admin-s@example.test'), adminU: tok('admin-u@example.test'),
  adminN: tok('admin-n@example.test'), adminG: tok('admin-g@example.test'), adminD: tok('admin-d1@example.test'), adminM: tok('admin-m@example.test'),
  brokerA: tok('broker-a@example.test'), tenantA: tok('inq-a@example.test'), landlord: tok('dono@example.test'), stranger: tok('ninguem@example.test'),
  master: tok(MASTER),
};
const SENSIVEL = /inst-a-7kq|inst-b-9zx|inst-plataforma|inst-dup|chave-evo|evo\.example|5511999998888|provider-raw|aborted|stack|apikey|ownerA|ownerB|SUCCESS/i;

const NOW0 = 1_800_000_000_000; let clock = NOW0; const realNow = Date.now; Date.now = () => clock;
function base() {
  reset(); setEnv(true); clock = NOW0;
  net.calls = []; net.mode = 'ok'; net.delayMs = 0; net.states = { 'inst-a-7Kq': 'open', 'inst-b-9Zx': 'open', 'inst-plataforma': 'open', 'inst-dup': 'open' };
  logs.length = 0;
  seed('owners', 'ownerA', { email: 'admin-a@example.test', status: 'active', evolutionInstance: 'inst-a-7Kq', whatsappConnected: true });
  seed('owners', 'ownerB', { email: 'admin-b@example.test', status: 'active', evolutionInstance: 'inst-b-9Zx', whatsappConnected: true });
  seed('owners', 'ownerS', { email: 'admin-s@example.test', status: 'suspended', evolutionInstance: 'inst-s', whatsappConnected: true });
  seed('owners', 'ownerU', { email: 'admin-u@example.test', status: 'active', evolutionInstance: 'inst-u', whatsappConnected: true });
  seed('users', 'uid-admin-u@example.test', { email: 'admin-u@example.test', suspended: true });
  seed('owners', 'ownerN', { email: 'admin-n@example.test', status: 'active' });
  seed('owners', 'ownerG', { email: 'admin-g@example.test', status: 'active', evolutionInstance: 'inst-plataforma', whatsappConnected: true });
  seed('owners', 'ownerD1', { email: 'admin-d1@example.test', status: 'active', evolutionInstance: 'inst-dup', whatsappConnected: true });
  seed('owners', 'ownerD2', { email: 'admin-d2@example.test', status: 'active', evolutionInstance: 'inst-dup', whatsappConnected: true });
  seed('owners', 'ownerM1', { email: 'admin-m@example.test', status: 'active', evolutionInstance: 'inst-m1' });
  seed('owners', 'ownerM2', { email: 'admin-m@example.test', status: 'active', evolutionInstance: 'inst-m2' });
  seed('brokers', 'broker_a', { email: 'broker-a@example.test', ownerId: 'ownerA', active: true });
  seed('users', 'uid-inq-a@example.test', { email: 'inq-a@example.test', role: 'tenant', ownerId: 'ownerA' });
}
const owner = (id) => store.get('owners').get(id);
const noProvider = () => net.calls.length === 0;
const untouched = () => owner('ownerA').whatsappConnected === true && owner('ownerB').whatsappConnected === true && net.states['inst-plataforma'] === 'open';

// ════ AUTENTICAÇÃO / PAPEL ════
for (const [nome, h, st] of [['anônimo', H.none, 401], ['token inválido', H.invalid, 401], ['token revogado', H.revoked, 401],
  ['usuário suspenso', H.adminU, 403], ['imobiliária suspensa', H.adminS, 403], ['corretor', H.brokerA, 403], ['inquilino', H.tenantA, 403],
  ['proprietário/landlord', H.landlord, 403], ['usuário sem organização', H.stranger, 403], ['e-mail ambíguo (2 imobiliárias)', H.adminM, 403], ['master sem imobiliária própria', H.master, 403]]) {
  base();
  const r = await dc(h, { ownerId: 'ownerA' });
  ok(`${nome} -> ${st}, zero chamada ao provedor, nada alterado`, r.statusCode === st && noProvider() && untouched(), `${r.statusCode} ${J(r)} calls=${net.calls.length}`);
}
base(); { const r = await dc(H.none); ok('anônimo: nenhuma leitura do Firestore', r.statusCode === 401 && spies.reads.length === 0, JSON.stringify(spies.reads)); }

// ════ ISOLAMENTO ════
base();
let r = await dc(H.adminA);
ok('admin A -> 200 desconecta', r.statusCode === 200 && r.body.disconnected === true && r.body.changed === true, J(r));
ok('admin A: exatamente 1 logout, na instância A', logouts().length === 1 && /\/inst-a-7Kq$/.test(logouts()[0].u), JSON.stringify(net.calls));
ok('admin A: B e a instância da plataforma continuam conectadas', owner('ownerB').whatsappConnected === true && net.states['inst-b-9Zx'] === 'open' && net.states['inst-plataforma'] === 'open');
ok('admin A: status gravado só em A, depois da confirmação', owner('ownerA').whatsappConnected === false && typeof owner('ownerA').whatsappDisconnectedAt === 'string');
ok('admin A: nenhuma criação/exclusão de instância, reconexão ou webhook', forbidden().length === 0, JSON.stringify(forbidden()));
ok('resposta sem instância, telefone ou resposta do provedor', Object.keys(r.body).sort().join() === 'changed,disconnected,ok' && !SENSIVEL.test(J(r)), J(r));
base(); r = await dc(H.adminA, { ownerId: 'ownerB' });
ok('admin A com ownerId B -> 404 fixo, B intacto, sem provedor', r.statusCode === 404 && r.body.error === 'Recurso não encontrado' && noProvider() && untouched(), J(r));
ok('doc de B nunca lido pelo ID do corpo', !spies.reads.includes('owners/ownerB'), JSON.stringify(spies.reads));
base(); r = await dc(H.adminB, { ownerId: 'ownerA' });
ok('admin B com ownerId A -> 404, A intacto', r.statusCode === 404 && noProvider() && untouched(), J(r));
base(); r = await dc(H.adminA, { instanceId: 'inst-b-9Zx', instance: 'inst-plataforma', evolutionInstance: 'inst-b-9Zx', role: 'master', email: MASTER, phone: '5511999998888' });
ok('instanceId/role/e-mail/telefone falsificados não mudam o alvo', r.statusCode === 200 && logouts().length === 1 && /inst-a-7Kq$/.test(logouts()[0].u) && net.states['inst-b-9Zx'] === 'open' && net.states['inst-plataforma'] === 'open', JSON.stringify(net.calls));
for (const bad of [42, { a: 1 }, ['ownerA'], 'OWNERA']) {
  base(); r = await dc(H.adminA, { ownerId: bad });
  ok(`ownerId malformado (${JSON.stringify(bad)}) -> 404 sem efeito`, r.statusCode === 404 && noProvider() && untouched(), J(r));
}
base(); seed('owners', 'ownerMaster', { email: MASTER, status: 'active', evolutionInstance: 'inst-master', whatsappConnected: true }); net.states['inst-master'] = 'open';
r = await dc(H.master, { ownerId: 'ownerA' });
ok('master pedindo outra imobiliária -> 404, A intacto (sem cross-tenant)', r.statusCode === 404 && noProvider() && untouched(), J(r));

// ════ INSTÂNCIA GLOBAL / AUSENTE / AMBÍGUA ════
base(); r = await dc(H.adminN);
ok('sem instância vinculada -> 409 WHATSAPP_NOT_PROVISIONED, sem provedor (nunca global)', r.statusCode === 409 && r.body.code === 'WHATSAPP_NOT_PROVISIONED' && noProvider() && net.states['inst-plataforma'] === 'open', J(r));
base(); r = await dc(H.adminG);
ok('instância igual à da plataforma -> 409, plataforma não desconectada', r.statusCode === 409 && r.body.code === 'WHATSAPP_CONFIG_INVALID' && noProvider() && net.states['inst-plataforma'] === 'open', J(r));
base(); r = await dc(H.adminD);
ok('instância compartilhada -> 409, nada desconectado', r.statusCode === 409 && r.body.code === 'WHATSAPP_CONFIG_INVALID' && noProvider() && net.states['inst-dup'] === 'open', J(r));
base(); setEnv(false); r = await dc(H.adminA); setEnv(true);
ok('provedor sem configuração -> 503 fixo, sem chamada e sem gravação', r.statusCode === 503 && r.body.code === 'INTEGRATION_NOT_CONFIGURED' && noProvider() && untouched(), J(r));

// ════ MÉTODO / PAYLOAD ════
for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
  base(); r = await call(m === 'GET' ? undefined : { step: 'whatsapp-disconnect' }, H.adminA, m, { step: 'whatsapp-disconnect' });
  ok(`${m} não desconecta`, noProvider() && untouched() && (m === 'GET' ? r.statusCode === 200 : r.statusCode === 405), `${r.statusCode} ${J(r)}`);
}
base(); r = await call(undefined, H.adminA);
ok('corpo ausente -> 400 sem efeito', r.statusCode === 400 && noProvider() && untouched(), J(r));

// ════ REPETIÇÃO / CONCORRÊNCIA ════
base(); await dc(H.adminA); const n1 = logouts().length;
r = await dc(H.adminA);
ok('repetição após sucesso -> 200 changed:false e nenhum logout novo', r.statusCode === 200 && r.body.changed === false && logouts().length === n1 && n1 === 1, J(r));
base(); net.states['inst-a-7Kq'] = 'close'; seed('owners', 'ownerA', { ...owner('ownerA'), whatsappConnected: true });
r = await dc(H.adminA);
ok('já desconectada no provedor -> sem logout; status alinhado para false', r.statusCode === 200 && r.body.changed === false && logouts().length === 0 && owner('ownerA').whatsappConnected === false, J(r));
base(); net.delayMs = 30;
const [c1, c2] = await Promise.all([dc(H.adminA), dc(H.adminA)]);
ok('duas chamadas simultâneas -> uma 200 e uma 409 TOOL_BUSY', [c1.statusCode, c2.statusCode].sort().join() === '200,409' && [c1, c2].some((x) => x.body.code === 'TOOL_BUSY'), J(c1) + J(c2));
ok('simultâneas -> no máximo 1 logout', logouts().length === 1);
base(); const sts = []; for (let i = 0; i < 5; i++) { net.states['inst-a-7Kq'] = 'open'; sts.push((await dc(H.adminA)).statusCode); }
const antes = net.calls.length; net.states['inst-a-7Kq'] = 'open';
r = await dc(H.adminA);
ok('6ª operação na janela de 1 h -> 429, sem provedor', sts.every((s) => s === 200) && r.statusCode === 429 && net.calls.length === antes, sts.join() + ' ' + J(r));
clock = NOW0 + 61 * 60 * 1000;
ok('após a janela volta a funcionar', (await dc(H.adminA)).statusCode === 200);
base(); seed('_toolRateLimits', 'wa-disc-org-ownerA', { windowStart: NOW0, count: 1, lockUntil: NOW0 + 30 * 1000 });
r = await dc(H.adminA);
ok('lock ativo -> 409 sem provedor', r.statusCode === 409 && noProvider() && untouched(), J(r));
ok('lock de A não bloqueia B', (await dc(H.adminB)).statusCode === 200);
clock = NOW0 + 61 * 1000;
ok('lock abandonado expira após 60 s', (await dc(H.adminA)).statusCode === 200);

// ════ FALHAS ════
for (const [modo, desc] of [['logout500', 'logout com erro 500'], ['logoutTimeout', 'timeout no logout'], ['state500', 'estado com erro 500'], ['timeout', 'timeout ao consultar estado'], ['stateGarbage', 'estado ilegível']]) {
  base(); net.mode = modo; logs.length = 0;
  r = await dc(H.adminA);
  ok(`${desc} -> 503 fixo`, r.statusCode === 503 && r.body.code === 'PROVIDER_UNAVAILABLE', J(r));
  ok(`${desc}: sucesso NÃO gravado (continua conectada no doc)`, owner('ownerA').whatsappConnected === true && owner('ownerA').whatsappDisconnectedAt === undefined);
  ok(`${desc}: resposta e log sem dados do provedor, telefone ou credencial`, !SENSIVEL.test(J(r)) && !logs.some((l) => /provider-raw|5511999998888|chave-evo/.test(l)), J(r) + ' | ' + logs.join(' | '));
  ok(`${desc}: lock liberado`, store.get('_toolRateLimits').get('wa-disc-org-ownerA').lockUntil === 0);
}

// ════ CALLER E COMPATIBILIDADE ════
const admin = read('public/admin/index.html');
const blocoDc = admin.slice(admin.indexOf('window.disconnectWhatsapp = async'), admin.indexOf('window.saveWaConfig'));
ok('caller: usa a sessão do painel (auth.currentUser) e envia Bearer', /auth\.currentUser\.getIdToken\(\)/.test(blocoDc) && /'Authorization': 'Bearer ' \+ _dcTkn/.test(blocoDc) && !/import\('https:\/\/www\.gstatic\.com/.test(blocoDc));
ok('caller: só marca desconectado quando res.ok', /if \(!res\.ok\) throw/.test(blocoDc) && blocoDc.indexOf('if (!res.ok) throw') < blocoDc.indexOf('whatsappConnected: false'));
ok('caller: ownerId só como asserção, sem instanceId', /step: 'whatsapp-disconnect', ownerId: currentOwnerId/.test(blocoDc) && !/instanceId/.test(blocoDc));
const src = read('api/ilocarpay-broker.js');
ok('logout é a única ação do provedor no disconnect (sem delete/create/webhook)', !/instance\/delete|instance\/create|webhook\/set/.test(src.slice(src.indexOf('async function handleWhatsappDisconnect'), src.indexOf('async function handleWaKeepalive'))));
base(); net.states['inst-a-7Kq'] = 'close';
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => /instance\/connect\//.test(String(url)) ? resp({ base64: 'data:image/png;base64,QUJD' }) : origFetch(url, opts);
r = await call({ step: 'whatsapp-qr' }, H.adminA);
globalThis.fetch = origFetch;
ok('QR autenticado continua íntegro', r.statusCode === 200 && r.body.qr === 'data:image/png;base64,QUJD' && r.headers['cache-control'] === 'no-store, private, max-age=0', J(r));
base(); r = await call({ event: 'messages.update', data: [] }, {}, 'POST', { step: 'evolution-webhook' });
ok('webhook do Evolution continua íntegro', r.statusCode === 200 && r.body.ok === true);
ok('envio operacional intacto (sendWhatsApp)', /async function sendWhatsApp\(phone, message, ownerData = null, ownerId = null\)/.test(src));
ok('/qr pública continua inexistente', !existsSync(new URL('public/qr', ROOT)));
ok('rede: nenhuma chamada fora do Evolution simulado', net.everUnexpected === 0);

Date.now = realNow;
console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== P0-OWNER-WHATSAPP-DISCONNECT-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
