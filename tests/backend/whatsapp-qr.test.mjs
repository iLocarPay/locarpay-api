// WHATSAPP-MT-02 — QR do WhatsApp da PRÓPRIA imobiliária (admin autenticado, organização derivada
// do token). Sem rede, sem Firestore real, sem provedor: tudo simulado, dados fictícios.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { reset, seed, store, spies } from './fakes.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const EVO = 'https://evo.example.test';
const ENV = { EVOLUTION_API_URL: EVO, EVOLUTION_API_KEY: 'chave-evo-de-teste', EVOLUTION_INSTANCE: 'inst-plataforma' };
const setEnv = (on) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };
setEnv(true);

// ── Evolution simulado (com estado por instância) ─────────────────────────────
const B64 = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '');
const net = { calls: [], states: {}, mode: 'ok', delayMs: 0, serial: 0, everUnexpected: 0 };
const resp = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  net.calls.push({ method, u });
  if (!u.startsWith(EVO + '/')) { net.everUnexpected++; return resp({ error: 'bloqueado' }, 599); }
  if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
  const m = u.match(/instance\/(connectionState|connect)\/([^/?]+)$/);
  if (net.mode === 'reject') { const e = new Error('connect ECONNREFUSED chave-evo-de-teste'); e.name = 'FetchError'; throw e; }
  if (m && m[1] === 'connectionState') {
    if (net.mode === 'state404') return resp({ error: 'instance not found inst-a', stack: 'at x' }, 404);
    return resp({ instance: { instanceName: m[2], state: net.states[m[2]] || 'close', owner: '5511999998888@s.whatsapp.net' } });
  }
  if (m && m[1] === 'connect') {
    net.serial++;
    if (net.mode === 'connect500') return resp({ error: 'provider-raw falha', apikey: 'chave-evo-de-teste' }, 500);
    if (net.mode === 'malformed') return resp({ base64: 'data:text/html;base64,PHNjcmlwdD4=', pairingCode: 'PAIR-1234' });
    if (net.mode === 'notb64') return resp({ base64: '<script>alert(1)</script>' });
    if (net.mode === 'oversize') return resp({ base64: 'data:image/png;base64,' + 'A'.repeat(70 * 1024) });
    if (net.mode === 'noqr') return resp({ count: 0 });
    if (net.mode === 'raw') return resp({ base64: B64('qr-raw-' + m[2] + '-' + net.serial) });
    return resp({ base64: 'data:image/png;base64,' + B64('qr-' + m[2] + '-' + net.serial), pairingCode: 'PAIR-SECRETO', code: '2@codigo-cru', count: 1, instance: { owner: '5511999998888' }, extra: { apikey: 'chave-evo-de-teste' } });
  }
  return resp({ error: 'rota inesperada' }, 418);
};
const destructive = () => net.calls.filter((c) => c.method !== 'GET' || /instance\/(create|delete|logout|restart|fetchInstances)|webhook\//.test(c.u));

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
const qr = (h, extra = {}) => call({ step: 'whatsapp-qr', ...extra }, h);
const J = (r) => JSON.stringify(r.body);
const tok = (email) => ({ authorization: 'Bearer valid:' + email });
const H = {
  none: {}, invalid: { authorization: 'Bearer lixo' }, revoked: { authorization: 'Bearer revoked:admin-a@example.test' },
  adminA: tok('admin-a@example.test'), adminB: tok('admin-b@example.test'), adminS: tok('admin-s@example.test'), adminU: tok('admin-u@example.test'),
  adminN: tok('admin-n@example.test'), adminG: tok('admin-g@example.test'), adminD: tok('admin-d1@example.test'), adminM: tok('admin-m@example.test'),
  brokerA: tok('broker-a@example.test'), tenantA: tok('inq-a@example.test'), landlord: tok('dono@example.test'), stranger: tok('ninguem@example.test'),
  master: tok(MASTER),
};
// Nada disto pode aparecer em resposta de erro/sucesso indevida.
const SENSIVEL = /inst-a-7kq|inst-b-9zx|inst-plataforma|inst-dup|chave-evo|evo\.example|PAIR|codigo-cru|5511999998888|provider-raw|ECONNREFUSED|stack|apikey|ownerA|ownerB/i;

const NOW0 = 1_800_000_000_000; let clock = NOW0; const realNow = Date.now; Date.now = () => clock;
function base() {
  reset(); setEnv(true); clock = NOW0;
  net.calls = []; net.mode = 'ok'; net.delayMs = 0; net.states = { 'inst-a-7Kq': 'close', 'inst-b-9Zx': 'close' };
  logs.length = 0;
  seed('owners', 'ownerA', { email: 'admin-a@example.test', status: 'active', evolutionInstance: 'inst-a-7Kq' });
  seed('owners', 'ownerB', { email: 'admin-b@example.test', status: 'active', evolutionInstance: 'inst-b-9Zx' });
  seed('owners', 'ownerS', { email: 'admin-s@example.test', status: 'suspended', evolutionInstance: 'inst-s' });
  seed('owners', 'ownerU', { email: 'admin-u@example.test', status: 'active', evolutionInstance: 'inst-u' });
  seed('users', 'uid-admin-u@example.test', { email: 'admin-u@example.test', suspended: true });
  seed('owners', 'ownerN', { email: 'admin-n@example.test', status: 'active' });
  seed('owners', 'ownerG', { email: 'admin-g@example.test', status: 'active', evolutionInstance: 'inst-plataforma' });
  seed('owners', 'ownerD1', { email: 'admin-d1@example.test', status: 'active', evolutionInstance: 'inst-dup' });
  seed('owners', 'ownerD2', { email: 'admin-d2@example.test', status: 'active', evolutionInstance: 'inst-dup' });
  seed('owners', 'ownerM1', { email: 'admin-m@example.test', status: 'active', evolutionInstance: 'inst-m1' });
  seed('owners', 'ownerM2', { email: 'admin-m@example.test', status: 'active', evolutionInstance: 'inst-m2' });
  seed('brokers', 'broker_a', { email: 'broker-a@example.test', ownerId: 'ownerA', active: true });
  seed('users', 'uid-inq-a@example.test', { email: 'inq-a@example.test', role: 'tenant', ownerId: 'ownerA' });
}
const noProvider = () => net.calls.length === 0;
const nostore = (r) => r.headers['cache-control'] === 'no-store, private, max-age=0' && r.headers['pragma'] === 'no-cache';

// ════ AUTENTICAÇÃO (1-9) ════
base();
let r = await qr(H.none);
ok('1. sem token -> 401', r.statusCode === 401 && r.body.error === 'Nao autorizado', J(r));
ok('1b. sem token: zero leitura de Firestore e zero provedor', spies.reads.length === 0 && noProvider(), JSON.stringify(spies.reads));
ok('1c. sem token: resposta já com no-store', nostore(r), JSON.stringify(r.headers));
base(); r = await qr(H.invalid);
ok('2. token inválido -> 401, sem Firestore/provedor', r.statusCode === 401 && spies.reads.length === 0 && noProvider(), J(r));
base(); r = await qr(H.revoked);
ok('4a. token revogado -> 401', r.statusCode === 401 && noProvider(), J(r));
base(); r = await qr(H.stranger);
ok('3. usuário sem cadastro/organização -> 403, zero provedor', r.statusCode === 403 && r.body.error === 'Acesso negado' && noProvider(), J(r));
base(); r = await qr(H.adminU);
ok('4b. usuário suspenso (users.suspended) -> 403, zero provedor', r.statusCode === 403 && noProvider(), J(r));
base(); r = await qr(H.adminS);
ok('4c. imobiliária suspensa -> 403, zero provedor', r.statusCode === 403 && noProvider(), J(r));
for (const [nome, h] of [['5. corretor', H.brokerA], ['6. inquilino', H.tenantA], ['7. proprietário/landlord', H.landlord]]) {
  base(); r = await qr(h);
  ok(`${nome} -> 403 sem provedor e sem ler owners por ID`, r.statusCode === 403 && noProvider() && !spies.reads.some((x) => /^owners\//.test(x)), `${r.statusCode} ${J(r)} ${JSON.stringify(spies.reads)}`);
}
base(); r = await qr(H.adminA);
ok('8. admin A -> 200 com QR', r.statusCode === 200 && r.body.connected === false && typeof r.body.qr === 'string', J(r).slice(0, 120));
ok('8b. admin A alcança só a instância A', net.calls.length === 2 && net.calls.every((c) => /\/inst-a-7Kq$/.test(c.u)), JSON.stringify(net.calls));
base(); r = await qr(H.master);
ok('9a. master sem imobiliária própria -> 403 (sem suporte cross-tenant nesta fase)', r.statusCode === 403 && noProvider(), J(r));
base(); seed('owners', 'ownerMaster', { email: MASTER, status: 'active', evolutionInstance: 'inst-master' }); net.states['inst-master'] = 'close';
r = await qr(H.master);
ok('9b. master administrador da própria imobiliária -> só a própria instância', r.statusCode === 200 && net.calls.every((c) => /\/inst-master$/.test(c.u)), J(r).slice(0, 80));
r = await qr(H.master, { ownerId: 'ownerA' });
ok('9c. master pedindo outra imobiliária -> 404, sem provedor adicional', r.statusCode === 404 && net.calls.length === 2, J(r));

// ════ ISOLAMENTO (10-20) ════
base(); r = await qr(H.adminA);
ok('10. admin A -> instância A', r.statusCode === 200 && net.calls.some((c) => /inst-a-7Kq/.test(c.u)) && !net.calls.some((c) => /inst-b/.test(c.u)));
base(); r = await qr(H.adminA, { ownerId: 'ownerB' });
ok('11/13. admin A com ownerId B -> 404 fixo, sem provedor', r.statusCode === 404 && r.body.error === 'Recurso não encontrado' && noProvider(), J(r));
ok('20. registro de B nunca é lido pelo ID do corpo', !spies.reads.includes('owners/ownerB'), JSON.stringify(spies.reads));
base(); r = await qr(H.adminB, { ownerId: 'ownerA' });
ok('12. admin B com ownerId A -> 404, sem provedor', r.statusCode === 404 && noProvider() && !spies.reads.includes('owners/ownerA'), J(r));
base(); r = await qr(H.adminA, { ownerId: 'ownerA' });
ok('13b. ownerId igual ao próprio é aceito como asserção (não como identidade)', r.statusCode === 200, J(r).slice(0, 60));
for (const bad of [42, { a: 1 }, ['ownerA'], 'OWNERA', ' ownerA']) {
  base(); r = await qr(H.adminA, { ownerId: bad });
  ok(`13c. ownerId malformado/diferente (${JSON.stringify(bad)}) -> 404 sem provedor`, r.statusCode === 404 && noProvider(), J(r));
}
base(); r = await qr(H.adminA, { instanceId: 'inst-b-9Zx', instance: 'inst-b-9Zx', evolutionInstance: 'inst-b-9Zx', instanceName: 'inst-b-9Zx' });
ok('14. instanceId falsificado no corpo é ignorado (só instância A)', r.statusCode === 200 && net.calls.every((c) => /inst-a-7Kq/.test(c.u)), JSON.stringify(net.calls));
base(); r = await qr(H.brokerA, { role: 'admin', isAdmin: true, email: 'admin-a@example.test', ownerId: 'ownerA' });
ok('15. role/e-mail/ownerId forjados por corretor -> 403 sem provedor', r.statusCode === 403 && noProvider(), J(r));
base(); r = await qr(H.adminN);
ok('16/17. imobiliária sem instância vinculada -> 409 WHATSAPP_NOT_PROVISIONED, sem provedor (nunca global)', r.statusCode === 409 && r.body.code === 'WHATSAPP_NOT_PROVISIONED' && noProvider(), J(r));
base(); r = await qr(H.adminG);
ok('28. instância igual à da plataforma -> 409 WHATSAPP_CONFIG_INVALID, sem provedor', r.statusCode === 409 && r.body.code === 'WHATSAPP_CONFIG_INVALID' && noProvider(), J(r));
base(); r = await qr(H.adminD);
ok('19. mesma instância em duas imobiliárias -> 409 fail-closed, sem provedor', r.statusCode === 409 && r.body.code === 'WHATSAPP_CONFIG_INVALID' && noProvider(), J(r));
base(); r = await qr(H.adminM);
ok('18. mesmo e-mail administra duas imobiliárias (ambíguo) -> 403, sem provedor', r.statusCode === 403 && noProvider(), J(r));
base(); setEnv(false); r = await qr(H.adminA); setEnv(true);
ok('14b. provedor sem configuração -> 503 fixo, sem chamada', r.statusCode === 503 && r.body.code === 'INTEGRATION_NOT_CONFIGURED' && noProvider(), J(r));
base(); r = await qr(H.adminN);
ok('16b. erros não revelam instância/estado de nenhuma organização', !SENSIVEL.test(J(r)), J(r));

// ════ NÃO DESTRUTIVO (21-28) ════
base(); net.mode = 'state404'; r = await qr(H.adminA);
ok('21/22. provedor 404 -> 503 fixo; não exclui nem recria', r.statusCode === 503 && r.body.code === 'PROVIDER_UNAVAILABLE' && destructive().length === 0 && net.calls.length === 1, JSON.stringify(net.calls));
base(); r = await qr(H.adminA);
ok('23/24/25. pedir QR: nenhuma criação, exclusão, logout, restart ou alteração de webhook', destructive().length === 0 && net.calls.every((c) => c.method === 'GET'), JSON.stringify(destructive()));
ok('23b. pedir QR não grava evolutionInstance nem cria documento', store.get('owners').get('ownerA').evolutionInstance === 'inst-a-7Kq' && !store.get('owners').has('owner_ownerA'));
base(); net.delayMs = 30;
const [c1, c2] = await Promise.all([qr(H.adminA), qr(H.adminA)]);
ok('26. duas chamadas simultâneas -> uma 200 e uma 409 (TOOL_BUSY)', [c1.statusCode, c2.statusCode].sort().join() === '200,409' && [c1, c2].some((x) => x.body.code === 'TOOL_BUSY'), J(c1) + J(c2));
ok('26b. simultâneas -> um único connect e zero efeito destrutivo', net.calls.filter((c) => /\/connect\//.test(c.u)).length === 1 && destructive().length === 0);
base(); net.states['inst-a-7Kq'] = 'open'; r = await qr(H.adminA);
ok('27. conexão já ativa -> { connected: true } sem novo QR (sem connect)', r.statusCode === 200 && r.body.connected === true && !('qr' in r.body) && !net.calls.some((c) => /\/connect\//.test(c.u)), J(r));
ok('27b. resposta conectada sem instância/telefone', Object.keys(r.body).sort().join() === 'connected,ok', J(r));
ok('27c. status conectado registrado só na própria imobiliária', store.get('owners').get('ownerA').whatsappConnected === true && store.get('owners').get('ownerB').whatsappConnected === undefined);

// ════ QR (29-37) ════
base(); r = await qr(H.adminA);
ok('29. QR mínimo devolvido ao admin (data URL PNG)', /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.body.qr) && r.body.expiresIn === 25, J(r).slice(0, 80));
ok('30. allowlist: só ok/connected/qr/expiresIn (sem pairingCode, code, telefone, extra)', Object.keys(r.body).sort().join() === 'connected,expiresIn,ok,qr' && !/PAIR|codigo-cru|5511999998888|chave-evo/.test(J(r)));
ok('34. sucesso com Cache-Control: no-store, private', nostore(r), JSON.stringify(r.headers));
ok('33. QR não aparece nos logs', !logs.some((l) => l.includes(r.body.qr.slice(22, 60)) || /base64|PAIR/.test(l)), logs.join(' | '));
const qrAtual = r.body.qr;
ok('36. QR não é persistido em nenhum documento', ![...store.values()].some((m) => [...m.values()].some((d) => JSON.stringify(d).includes(qrAtual.slice(22)))));
r = await qr(H.adminA);
ok('37. nova consulta traz QR novo (nada reaproveitado do anterior)', r.statusCode === 200 && r.body.qr !== qrAtual);
base(); net.mode = 'raw'; r = await qr(H.adminA);
ok('29b. QR em base64 cru é normalizado para data URL PNG', r.statusCode === 200 && r.body.qr.startsWith('data:image/png;base64,'), J(r).slice(0, 60));
for (const [modo, desc] of [['malformed', 'QR com tipo diferente de PNG'], ['notb64', 'QR que não é base64'], ['oversize', 'QR acima do tamanho máximo'], ['noqr', 'resposta sem QR']]) {
  base(); net.mode = modo; r = await qr(H.adminA);
  ok(`31/32. ${desc} -> 503 fixo, nada devolvido`, r.statusCode === 503 && r.body.code === 'PROVIDER_UNAVAILABLE' && !('qr' in r.body), J(r).slice(0, 120));
}
for (const [modo, desc] of [['connect500', 'provedor com erro 500'], ['reject', 'erro de rede']]) {
  base(); net.mode = modo; logs.length = 0; r = await qr(H.adminA);
  ok(`35. ${desc} -> 503 sem QR, instância, telefone, token ou resposta do provedor`, r.statusCode === 503 && !SENSIVEL.test(J(r)) && nostore(r), J(r));
  ok(`35b. ${desc}: lock liberado`, store.get('_toolRateLimits').get('wa-qr-org-ownerA').lockUntil === 0);
  ok(`35c. ${desc}: log sem resposta do provedor nem credencial`, !logs.some((l) => /provider-raw|chave-evo|ECONNREFUSED/.test(l)), logs.join(' | '));
}

// ════ RATE LIMIT / LOCK ════
base();
const sts = []; for (let i = 0; i < 40; i++) sts.push((await qr(H.adminA)).statusCode);
const antes = net.calls.length;
r = await qr(H.adminA);
ok('rate: 41ª consulta da organização em 10 min -> 429', sts.every((s) => s === 200) && r.statusCode === 429 && r.body.code === 'TOOL_RATE_LIMITED', sts.slice(-3).join() + ' ' + J(r));
ok('rate: 429 sem chamada ao provedor', net.calls.length === antes);
clock = NOW0 + 11 * 60 * 1000;
ok('rate: após a janela volta a funcionar', (await qr(H.adminA)).statusCode === 200);
base(); seed('_toolRateLimits', 'wa-qr-global', { windowStart: NOW0, count: 300 });
r = await qr(H.adminB);
ok('rate: limite global defensivo -> 429 sem provedor', r.statusCode === 429 && noProvider(), J(r));
base(); seed('_toolRateLimits', 'wa-qr-user-uid-admin-a@example.test', { windowStart: NOW0, count: 40 });
r = await qr(H.adminA);
ok('rate: limite por usuário -> 429 sem provedor', r.statusCode === 429 && noProvider(), J(r));
base(); seed('_toolRateLimits', 'wa-qr-org-ownerA', { windowStart: NOW0, count: 1, lockUntil: NOW0 + 30 * 1000 });
r = await qr(H.adminA);
ok('lock ativo -> 409 TOOL_BUSY sem provedor', r.statusCode === 409 && r.body.code === 'TOOL_BUSY' && noProvider(), J(r));
ok('lock de A não bloqueia B', (await qr(H.adminB)).statusCode === 200);
clock = NOW0 + 61 * 1000;
ok('lock abandonado expira após 60 s', (await qr(H.adminA)).statusCode === 200);
base(); { const t0 = realNow(); await qr(H.adminA); ok('sem espera longa na função (< 1 s com provedor instantâneo)', realNow() - t0 < 1000, String(realNow() - t0)); }

// ════ COMPATIBILIDADE (38-43) ════
ok('38. /qr pública continua inexistente (404 por construção)', !existsSync(new URL('public/qr', ROOT)));
const src = read('api/ilocarpay-broker.js');
ok('39. envio operacional intacto (sendWhatsApp com fallback global para ENVIO)', /async function sendWhatsApp\(phone, message, ownerData = null, ownerId = null\)/.test(src));
ok('39b. nenhum código de criação/exclusão de instância restou no broker', !/instance\/create|instance\/delete|ensureEvoInstance/.test(src));
base();
{
const rTok = process.env.EVOLUTION_WEBHOOK_TOKEN; process.env.EVOLUTION_WEBHOOK_TOKEN = 'tok-webhook-de-teste-0123456789abcdef';
const wAnon = await call({ event: 'messages.update', data: [] }, {}, 'POST', { step: 'evolution-webhook' });
const wAuth = await call({ event: 'messages.update', data: [] }, {}, 'POST', { step: 'evolution-webhook', wt: 'tok-webhook-de-teste-0123456789abcdef' });
if (rTok === undefined) delete process.env.EVOLUTION_WEBHOOK_TOKEN; else process.env.EVOLUTION_WEBHOOK_TOKEN = rTok;
ok('40. webhook do Evolution: sem token 401; com token 200 (GATE-WA-ENTRYPOINTS-01)', wAnon.statusCode === 401 && wAuth.statusCode === 200 && wAuth.body.ok === true, JSON.stringify([wAnon.body, wAuth.body]));
}
base(); r = await call({ step: 'setup-webhook', ownerId: 'ownerA' }, H.adminA);
ok('41. setup-webhook continua master-only (admin -> 403)', r.statusCode === 403 && noProvider(), J(r));
const gate = src.slice(src.indexOf("    else if (step === 'whatsapp-qr') {"), src.indexOf('    let result;'));
// 42. P0-OWNER-WHATSAPP-DISCONNECT-01 fechou o disconnect com o MESMO gate canônico do QR (sem ampliar acesso).
ok('42. whatsapp-disconnect usa o mesmo resolvedor canônico do QR (admin da própria imobiliária)', /else if \(step === 'whatsapp-disconnect'\) \{[\s\S]{0,300}req\._waOrg = await resolveWhatsappAdmin\(db, req\);/.test(src) && /async function handleWhatsappDisconnect\(db, org\) \{/.test(src));
ok('43. Serverless Functions = 12', readdirSync(new URL('api/', ROOT)).filter((f) => f.endsWith('.js') && !f.startsWith('_')).length === 12);
ok('43b. schema multi-tenant futuro não criado', !/whatsapp_integrations/.test(src));
const admin = read('public/admin/index.html');
const blocoQr = admin.slice(admin.indexOf('async function _fetchQr()'), admin.indexOf('function _updateOwnerWhatsappBadge'));
ok('caller: painel envia Bearer e não loga a resposta do QR', /'Authorization': 'Bearer ' \+ _qrTkn/.test(blocoQr) && !/console\.log\(/.test(blocoQr) && !/data\.instance|data\.base64|data\.state/.test(blocoQr));
ok('caller: 401 pede novo login sem nova tentativa; 403/404/409 sem polling', /httpStatus === 401/.test(blocoQr) && /Sessão expirada/.test(blocoQr));
ok('caller: fechar o modal (botão ou fundo) remove o QR e para o polling', /function _closeWhatsappQr\(\)/.test(admin) && /removeAttribute\('src'\)/.test(admin) && /btn-wa-modal-close'\)\.addEventListener\('click', \(\) => _closeWhatsappQr\(\)\)/.test(admin));
ok('caller: QR/token nunca em URL', !/whatsapp-qr[^\n]*\?(qr|token)=/.test(admin));
ok('rede: nenhuma chamada fora do Evolution simulado', net.everUnexpected === 0);

Date.now = realNow;
console.error = orig.e; console.log = orig.l; console.warn = orig.w;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== WHATSAPP-MT-02: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
