// P0-RETRY-ASSINAFY-01 — suíte autônoma do step retry-assinafy (e da sanitização do broker).
// Sem rede, sem Firestore real, sem e-mail: Firebase e Assinafy simulados, dados fictícios.
import { readFileSync, readdirSync } from 'node:fs';
import { reset, seed, store, spies } from './fakes.mjs';

// ── rede: TODA chamada passa por aqui; nada sai da máquina ────────────────────
const net = { calls: [], mode: 'ok', delayMs: 0, unexpected: 0, everUnexpected: 0, everCalls: 0 };
const mkResp = (obj, status = 200) => ({ ok: status < 400, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)), json: async () => obj });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  net.calls.push({ method, u }); net.everCalls++;
  if (!u.startsWith('https://api.assinafy.com.br/')) { net.unexpected++; net.everUnexpected++; return mkResp({ error: 'bloqueado pelo teste' }, 599); }
  if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
  if (net.mode === 'hang') return new Promise(() => {});
  if (net.mode === 'reject-forjado') { const e = new Error('socket hang up at /var/task/api/x.js'); e.code = 'CONTRACT_ALREADY_SENT'; e.expose = true; e.status = undefined; throw e; }
  if (net.mode === 'reject-econnreset') { const e = new Error('ECONNRESET credencial-de-teste /var/task'); e.code = 'ECONNRESET'; throw e; }
  if (/\/accounts$/.test(u)) return mkResp({ data: [{ id: 'acc1' }] });
  if (/\/documents$/.test(u)) {
    if (net.mode === 'doc-500') return mkResp('{"detail":"credencial-de-teste invalida","trace":"/var/task/api/interno.js","email":"dono@example.test"}', 500);
    return mkResp({ data: { id: 'doc-' + net.calls.length } });
  }
  if (/\/signers/.test(u)) {
    if (net.mode === 'same-signer') return mkResp({ data: { id: 'sig-unico' } });
    const body = JSON.parse(opts.body || '{}');
    return mkResp({ data: { id: 'sig-' + (body.email || 'x') } });
  }
  if (/\/assignments$/.test(u)) {
    if (net.mode === 'assign-timeout') throw new Error('The operation was aborted');
    return mkResp({ data: { id: 'asg-' + net.calls.length, signing_urls: [] } });
  }
  return mkResp({ data: {} });
};
const ext = () => ({
  total: net.calls.filter((c) => c.u.startsWith('https://api.assinafy.com.br/')).length,
  documents: net.calls.filter((c) => c.method === 'POST' && /\/documents$/.test(c.u)).length,
  assignments: net.calls.filter((c) => c.method === 'POST' && /\/assignments$/.test(c.u)).length,
});

const handler = (await import(new URL('../../api/ilocarpay-broker.js', import.meta.url).href)).default;
const { MASTER_EMAILS } = await import(new URL('../../lib/authz.js', import.meta.url).href);

let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; results.push(['PASS', name]); } else { fail++; results.push(['FAIL', name, detail]); } };

const logs = [];
const origError = console.error, origLog = console.log, origWarn = console.warn;
console.error = (...a) => logs.push(a.join(' '));
console.log = (...a) => logs.push(a.join(' '));
console.warn = (...a) => logs.push(a.join(' '));

const mkRes = () => ({ statusCode: 200, body: null, sent: null, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; return this; }, send(x) { this.sent = x; return this; }, end() { return this; }, setHeader() {} });
const call = async (body, headers = {}, method = 'POST', query = {}) => { const res = mkRes(); await handler({ method, body, headers, query, socket: {} }, res); return res; };
const retry = (contractId, headers, extra = {}) => call({ step: 'retry-assinafy', contractId, ...extra }, headers);
const J = (r) => JSON.stringify(r.body ?? r.sent);

const H = {
  none: {},
  invalid: { authorization: 'Bearer lixo' },
  revoked: { authorization: 'Bearer revoked:owner-a@example.test' },
  semBearer: { authorization: 'valid:owner-a@example.test' },
  ownerA: { authorization: 'Bearer valid:owner-a@example.test' },
  ownerB: { authorization: 'Bearer valid:owner-b@example.test' },
  ownerSusp: { authorization: 'Bearer valid:owner-s@example.test' },
  userSusp: { authorization: 'Bearer valid:owner-u@example.test' },
  brokerA: { authorization: 'Bearer valid:broker-a@example.test' },
  stranger: { authorization: 'Bearer valid:ninguem@example.test' },
  // master = primeira identidade da lista canônica de lib/authz.js (sem repetir e-mail real aqui)
  master: { authorization: 'Bearer valid:' + [...MASTER_EMAILS][0] },
};

const CATALOG = {
  CONFIGURATION_UNAVAILABLE: [503, 'Assinatura digital indisponível: a integração ainda não está configurada. Acione o suporte iLocarPay para concluir a configuração.'],
  CONTRACT_DATA_INVALID: [422, 'Proprietário e inquilino estão cadastrados com o mesmo e-mail. Cada parte precisa de um e-mail próprio para assinar o contrato.'],
  CONTRACT_ALREADY_SENT: [409, 'Este contrato já foi enviado para assinatura digital.'],
  RETRY_NOT_ALLOWED: [409, 'Este contrato não está com falha de envio; não há o que reenviar.'],
  RETRY_IN_PROGRESS: [409, 'Já existe um envio deste contrato em andamento. Aguarde alguns minutos e atualize a tela.'],
  RETRY_NEEDS_REVIEW: [409, 'O envio anterior deste contrato pode ter sido concluído parcialmente. Acione o suporte iLocarPay antes de tentar novamente.'],
  RETRY_RATE_LIMITED: [429, 'Muitas tentativas de reenvio para este contrato. Tente novamente mais tarde.'],
};
const isCatalog = (r, code) => r.statusCode === CATALOG[code][0] && r.body && r.body.code === code && r.body.error === CATALOG[code][1];
// Sinais de vazamento: detalhe técnico, terceiro, credencial, caminho, e-mail, ids de documento.
const VAZA = /config\/assinafy|apikey|chave assinafy|process\.env|FIREBASE_|\/var\/|node_modules|[A-Z]:\\|\bat \w+ \(|Error:|FIRESTORE_UNAVAILABLE|Assinafy (GET|POST|DELETE)|credencial-de-teste|detail|trace|@example\.test|@gmail|doc-\d|asg-|sig-|acc1|socket hang up|ECONNRESET|aborted|lixo|Bearer/i;

const NOW0 = 1_800_000_000_000;
let clock = NOW0;
const realNow = Date.now;
Date.now = () => clock;

function base() {
  reset();
  net.calls = []; net.mode = 'ok'; net.delayMs = 0; net.unexpected = 0;
  spies.mail = 0;
  clock = NOW0;
  seed('config', 'assinafy', { apiKey: 'chave-de-teste' });
  seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active' });
  seed('owners', 'ownerB', { email: 'owner-b@example.test', status: 'active' });
  seed('owners', 'ownerS', { email: 'owner-s@example.test', status: 'suspended' });
  seed('owners', 'ownerU', { email: 'owner-u@example.test', status: 'active' });
  seed('users', 'uid-owner-u@example.test', { email: 'owner-u@example.test', suspended: true });
  seed('brokers', 'broker_a', { email: 'broker-a@example.test', ownerId: 'ownerA', active: true });
  const contrato = (ownerId, extra = {}) => ({
    ownerId, tenantId: 'uid-t', tenantName: 'Inquilino', tenantEmail: 'inq@example.test',
    landlordName: 'Dono', landlordEmail: 'dono@example.test', propertyAddress: 'Rua X, 1',
    baseRent: 1000, dueDay: 10, assinafyStatus: 'error', assinafyError: 'falha anterior', createdAt: NOW0, ...extra,
  });
  const lead = (contractId, ownerId) => ({ ownerId, contractId, tenant: { name: 'Inquilino', email: 'inq@example.test' }, landlord: { name: 'Dono', email: 'dono@example.test' }, property: {} });
  for (const [id, owner] of [['cA', 'ownerA'], ['cB', 'ownerB'], ['cS', 'ownerS'], ['cU', 'ownerU']]) {
    seed('contracts', id, contrato(owner));
    seed('leads', 'l' + id, lead(id, owner));
  }
  return contrato;
}
const cA = () => store.get('contracts').get('cA');
const blocked = (name, r, status) => {
  ok(`${name} -> ${status}`, r.statusCode === status, `${r.statusCode} ${J(r)}`);
  ok(`${name}: zero chamada à Assinafy e zero e-mail`, ext().total === 0 && spies.mail === 0, JSON.stringify(ext()) + ' mail=' + spies.mail);
  ok(`${name}: contrato intocado (sem lock)`, cA().assinafyRetry === undefined && cA().assinafyStatus === 'error');
};

// ════ AUTENTICAÇÃO / AUTORIZAÇÃO ═════════════════════════════════════════════
base(); blocked('1. sem token', await retry('cA', H.none), 401);
base(); blocked('2. token inválido', await retry('cA', H.invalid), 401);
base(); blocked('2b. token sem prefixo Bearer', await retry('cA', H.semBearer), 401);
base(); blocked('4a. token revogado', await retry('cA', H.revoked), 401);
base(); await retry('cA', H.ownerA);
ok('verifyIdToken é chamado com checkRevoked=true', spies.lastCheckRevoked === true);
base(); blocked('3. usuário sem cadastro/escopo', await retry('cA', H.stranger), 404);
base(); blocked('4b. owner suspenso (owners.status) no próprio contrato', await retry('cS', H.ownerSusp), 404);
base(); { const r = await retry('cU', H.userSusp); ok('4c. usuário suspenso (users.suspended) -> 403', r.statusCode === 403, J(r)); ok('4c: zero chamada externa', ext().total === 0 && spies.mail === 0); }
base(); blocked('5. corretor do mesmo owner (papel sem permissão)', await retry('cA', H.brokerA), 404);
base(); {
  const r = await retry('cB', H.ownerA);
  ok('7. contrato de outra imobiliária -> 404', r.statusCode === 404, J(r));
  ok('7: zero chamada externa', ext().total === 0 && spies.mail === 0);
  ok('7: 404 idêntico ao de contrato inexistente (não enumera)', J(r) === J(await retry('nao-existe', H.ownerA)));
  ok('7: contrato alheio intocado', store.get('contracts').get('cB').assinafyRetry === undefined);
}
base(); {
  const r = await retry('cB', H.ownerA, { ownerId: 'ownerA', role: 'master', email: [...MASTER_EMAILS][0], isMaster: true, tenantId: 'uid-t' });
  ok('8. ownerId/role/e-mail falsificados no body -> 404', r.statusCode === 404, J(r));
  ok('8: zero chamada externa', ext().total === 0);
}
base(); { const r = await retry('nao-existe', H.ownerA); ok('9. contrato inexistente -> 404', r.statusCode === 404 && r.body.error === 'Contrato não encontrado', J(r)); ok('9: zero chamada externa', ext().total === 0); }
base(); {
  const r = await call({ step: 'retry-assinafy', contractId: 'cA' }, H.ownerA, 'PUT');
  ok('10. método PUT -> 405', r.statusCode === 405, J(r));
  const g = await call(undefined, H.ownerA, 'GET', { step: 'retry-assinafy', contractId: 'cA' });
  ok('10b. GET não executa o reenvio (healthcheck)', g.statusCode === 200 && ext().total === 0 && cA().assinafyRetry === undefined, J(g));
}
base(); {
  const r = await retry('cA', H.ownerA);
  ok('6. owner ativo do contrato -> 200', r.statusCode === 200 && r.body.ok === true && typeof r.body.assinafyDocumentId === 'string', J(r));
  ok('6: exatamente 1 documento e 1 assignment', ext().documents === 1 && ext().assignments === 1, JSON.stringify(ext()));
  ok('6: o espião de e-mail funciona (2 e-mails simulados: proprietário e inquilino)', spies.mail === 2, 'mail=' + spies.mail);
  ok('6: sucesso registrado só após o assignment (status sent + documentId)', cA().assinafyStatus === 'sent' && !!cA().assinafyDocumentId);
  ok('6: lock removido e erro anterior limpo após sucesso', cA().assinafyRetry === undefined && cA().assinafyError === null);
}
base(); { const r = await retry('cB', H.master); ok('6b. master (authz canônico) -> 200', r.statusCode === 200, J(r)); ok('6b: lock gravado como master', ext().assignments === 1); }

// ════ IDEMPOTÊNCIA / CONCORRÊNCIA ════════════════════════════════════════════
base(); {
  await retry('cA', H.ownerA);
  const antes = ext().total, mails = spies.mail;
  const r = await retry('cA', H.ownerA);
  ok('11. contrato já processado -> 409 CONTRACT_ALREADY_SENT', isCatalog(r, 'CONTRACT_ALREADY_SENT'), J(r));
  ok('11: não cria documento nem envia e-mail de novo', ext().total === antes && spies.mail === mails);
  ok('11: resposta não expõe o id do documento', !VAZA.test(J(r)), J(r));
}
base(); {
  seed('contracts', 'cA', { ...store.get('contracts').get('cA'), assinafyStatus: 'pending' });
  const r = await retry('cA', H.ownerA);
  ok('11b. contrato fora do estado de falha -> 409 RETRY_NOT_ALLOWED', isCatalog(r, 'RETRY_NOT_ALLOWED'), J(r));
  ok('11b: zero chamada externa', ext().total === 0);
}
base(); {
  net.delayMs = 30;
  const [r1, r2] = await Promise.all([retry('cA', H.ownerA), retry('cA', H.ownerA)]);
  const st = [r1.statusCode, r2.statusCode].sort().join(',');
  ok('12. duas chamadas simultâneas -> uma 200 e uma 409', st === '200,409', st + ' ' + J(r1) + ' ' + J(r2));
  ok('12: a recusada é RETRY_IN_PROGRESS', [r1, r2].some((r) => isCatalog(r, 'RETRY_IN_PROGRESS')));
  ok('12: no máximo UMA operação externa (1 documento, 1 assignment)', ext().documents === 1 && ext().assignments === 1, JSON.stringify(ext()));
}
base(); {
  net.delayMs = 30;
  const rs = await Promise.all(Array.from({ length: 8 }, () => retry('cA', H.ownerA)));
  ok('12b. oito chamadas simultâneas -> exatamente um assignment', ext().assignments === 1 && rs.filter((r) => r.statusCode === 200).length === 1, JSON.stringify(ext()));
}
const CRON_ANTES = process.env.CRON_SECRET;
process.env.CRON_SECRET = 'segredo-de-teste';
base(); {
  net.delayMs = 30;
  const cron = mkRes();
  const [r] = await Promise.all([
    retry('cA', H.ownerA),
    handler({ method: 'POST', body: { step: 'cron-retry-assinafy' }, headers: { authorization: 'Bearer segredo-de-teste' }, query: {}, socket: {} }, cron),
  ]);
  const cronA = ext().assignments;
  ok('12c. reenvio manual + cron concorrentes -> um único envio do contrato cA', net.calls.filter((c) => /\/assignments$/.test(c.u)).length <= 4 && (r.statusCode === 200 || isCatalog(r, 'RETRY_IN_PROGRESS')), J(r) + ' ' + JSON.stringify(cron.body));
  // cA, cB, cS, cU estão em 'error': o cron envia os outros 3; cA só uma vez no total.
  ok('12c: cA enviado exatamente uma vez', cronA === 4 && !!cA().assinafyDocumentId, 'assignments=' + cronA);
}
if (CRON_ANTES === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = CRON_ANTES;

base(); {
  net.mode = 'doc-500';
  const r = await retry('cA', H.ownerA);
  ok('13. falha externa -> 500 genérico', r.statusCode === 500 && r.body.error === 'Erro interno', J(r));
  ok('13: falha NÃO é registrada como sucesso', cA().assinafyStatus === 'error' && !cA().assinafyDocumentId);
  ok('13: nenhum assignment/e-mail', ext().assignments === 0 && spies.mail === 0);
  ok('13: lock liberado (falha antes do ponto sem volta)', cA().assinafyRetry && cA().assinafyRetry.lockUntil === 0 && cA().assinafyRetry.committed === false);
  net.mode = 'ok';
  const r2 = await retry('cA', H.ownerA);
  ok('14. nova tentativa após falha recuperável -> 200', r2.statusCode === 200 && ext().assignments === 1, J(r2));
}
base(); {
  net.mode = 'assign-timeout';
  const r = await retry('cA', H.ownerA);
  ok('14b. falha NO passo que dispara e-mail -> 500 genérico', r.statusCode === 500 && r.body.error === 'Erro interno', J(r));
  ok('14b: lock marcado como comprometido (não expira)', cA().assinafyRetry && cA().assinafyRetry.committed === true);
  net.mode = 'ok';
  clock = NOW0 + 24 * 60 * 60 * 1000;
  const antes = ext().assignments;
  const r2 = await retry('cA', H.ownerA);
  ok('14c. mesmo 24h depois -> 409 RETRY_NEEDS_REVIEW (sem segundo envio)', isCatalog(r2, 'RETRY_NEEDS_REVIEW') && ext().assignments === antes, J(r2));
}
base(); {
  const c = store.get('contracts').get('cA');
  seed('contracts', 'cA', { ...c, assinafyRetry: { lockBy: 'owner', lockAt: NOW0 - 1000, lockUntil: NOW0 + 5 * 60 * 1000, committed: false, windowStart: NOW0 - 1000, attempts: 1 } });
  const r = await retry('cA', H.ownerA);
  ok('15. lock ativo -> 409 RETRY_IN_PROGRESS', isCatalog(r, 'RETRY_IN_PROGRESS'), J(r));
  ok('15: zero chamada externa', ext().total === 0);
  clock = NOW0 + 5 * 60 * 1000 - 1;
  ok('16a. 1 ms antes de expirar ainda bloqueia', isCatalog(await retry('cA', H.ownerA), 'RETRY_IN_PROGRESS') && ext().total === 0);
  clock = NOW0 + 5 * 60 * 1000 + 1;
  const r2 = await retry('cA', H.ownerA);
  ok('16b. lock abandonado (expirado, não comprometido) é recuperado -> 200', r2.statusCode === 200 && ext().assignments === 1, J(r2));
}
base(); {
  const r = await call({ step: 'retry-assinafy' }, H.ownerA);
  ok('17. sem contractId -> 400', r.statusCode === 400 && r.body.error === 'contractId obrigatório', J(r));
  const r2 = await call({ step: 'retry-assinafy', contractId: { $ne: 1 } }, H.ownerA);
  ok('17b. contractId não-string -> 400', r2.statusCode === 400, J(r2));
  ok('17: nenhum lock criado e zero chamada externa', cA().assinafyRetry === undefined && ext().total === 0);
  store.get('leads').delete('lcA');
  const r3 = await retry('cA', H.ownerA);
  ok('17c. contrato sem lead -> 404 sem lock', r3.statusCode === 404 && cA().assinafyRetry === undefined && ext().total === 0, J(r3));
}
base(); {
  net.mode = 'doc-500';
  const st = [];
  for (let i = 0; i < 5; i++) st.push((await retry('cA', H.ownerA)).statusCode);
  const antes = ext().total;
  const r = await retry('cA', H.ownerA);
  ok('18. 6ª tentativa na janela de 1h -> 429 RETRY_RATE_LIMITED', st.join() === '500,500,500,500,500' && isCatalog(r, 'RETRY_RATE_LIMITED'), st.join() + ' ' + J(r));
  ok('18: a tentativa barrada não chama a Assinafy', ext().total === antes);
  net.mode = 'ok';
  clock = NOW0 + 61 * 60 * 1000;
  const r2 = await retry('cA', H.ownerA);
  ok('18b. após a janela, nova tentativa é permitida', r2.statusCode === 200, J(r2));
}

// ════ SANITIZAÇÃO ════════════════════════════════════════════════════════════
base(); {
  net.mode = 'doc-500'; logs.length = 0;
  const r = await retry('cA', H.ownerA);
  ok('19/20/21. resposta de falha sem e.message, corpo da Assinafy, caminho, e-mail ou credencial', !VAZA.test(J(r)) && !('code' in r.body), J(r));
  ok('21b. detalhe técnico fica só no log', logs.some((l) => /Assinafy POST/.test(l)));
}
base(); {
  seed('config', 'assinafy', {});
  const r = await retry('cA', H.ownerA);
  ok('22. configuração ausente -> 503 do catálogo', isCatalog(r, 'CONFIGURATION_UNAVAILABLE'), J(r));
  ok('22: lock liberado (falha antes do ponto sem volta)', cA().assinafyRetry.lockUntil === 0);
  net.mode = 'same-signer';
  seed('config', 'assinafy', { apiKey: 'chave-de-teste' });
  const r2 = await retry('cA', H.ownerA);
  ok('22b. mesmo e-mail nas duas partes -> 422 do catálogo, sem e-mail na resposta', isCatalog(r2, 'CONTRACT_DATA_INVALID') && !VAZA.test(J(r2)), J(r2));
  ok('22b: nenhum assignment disparado', ext().assignments === 0);
}
base(); {
  net.mode = 'reject-forjado';
  const r = await retry('cA', H.ownerA);
  ok('23. erro externo com code/expose FORJADOS não seleciona mensagem pública', r.statusCode === 500 && r.body.error === 'Erro interno' && !('code' in r.body), J(r));
  net.mode = 'reject-econnreset';
  const r2 = await retry('cA', H.ownerA);
  ok('23b. erro de rede com code arbitrário -> 500 genérico', r2.statusCode === 500 && r2.body.error === 'Erro interno' && !('code' in r2.body), J(r2));
}
base(); {
  const seen = [];
  const collect = (r) => { seen.push(r); return r; };
  collect(await retry('cA', H.none));
  collect(await retry('cA', H.stranger));
  collect(await retry('cU', H.userSusp));
  collect(await call({ step: 'retry-assinafy' }, H.ownerA));
  collect(await call({ step: 'retry-assinafy', contractId: 'cA' }, H.ownerA, 'DELETE'));
  const esperado = { 401: 'Nao autorizado', 404: 'Contrato não encontrado', 403: 'Acesso negado', 400: 'contractId obrigatório', 405: 'Method not allowed' };
  ok('24. 400/401/403/404/405 com mensagens fixas', seen.every((r) => esperado[r.statusCode] === r.body.error), seen.map((r) => r.statusCode + ':' + r.body.error).join(' | '));
  ok('24b. toda resposta com code usa status+mensagem exatos do catálogo', seen.every((r) => !r.body.code || isCatalog(r, r.body.code)));
}
base(); {
  // generate-contract (outro caminho até a Assinafy): falha crua do terceiro também não vaza.
  net.mode = 'doc-500';
  const r = await call({ step: 'generate-contract', contractId: 'cA' }, H.ownerA);
  ok('20b. generate-contract com falha da Assinafy -> 500 genérico sem corpo do terceiro', r.statusCode === 500 && r.body.error === 'Erro interno' && !VAZA.test(J(r)), J(r));
}
{
  // 22c. Allowlist em duas camadas, verificada nas funções REAIS do broker (extraídas do
  // código-fonte): o Symbol é privado do módulo e publicError só marca codes do catálogo;
  // publicSpecOf ainda recusa um erro marcado com code fora do catálogo.
  const src = readFileSync(new URL('../../api/ilocarpay-broker.js', import.meta.url), 'utf8');
  const trecho = src.slice(src.indexOf('const PUBLIC_ERRORS'), src.indexOf('// CEP helpers'));
  const { PUBLIC_ERRORS, PUBLIC_ERROR, publicError, publicSpecOf } = new Function(trecho + '; return { PUBLIC_ERRORS, PUBLIC_ERROR, publicError, publicSpecOf };')();
  // 7 codes do reenvio/sanitização + 5 das ferramentas administrativas (P0-BROKER-OPEN-STEPS-01).
  const TOOL_CODES = ['INTEGRATION_NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'RECIPIENT_NOT_ALLOWED', 'TOOL_BUSY', 'TOOL_RATE_LIMITED'];
  ok('22c. catálogo congelado com exatamente os 12 codes esperados', Object.isFrozen(PUBLIC_ERRORS) && Object.keys(PUBLIC_ERRORS).sort().join() === [...Object.keys(CATALOG), ...TOOL_CODES].sort().join(), Object.keys(PUBLIC_ERRORS).join());
  ok('22c. catálogo do broker == catálogo esperado (status e mensagem)', Object.entries(CATALOG).every(([k, [s, m]]) => PUBLIC_ERRORS[k].status === s && PUBLIC_ERRORS[k].message === m));
  const inv = publicError('QUALQUER', 'x');
  ok('22c. publicError com code fora do catálogo -> 500 genérico não publicável', inv.status === 500 && inv.message === 'Erro interno' && publicSpecOf(inv) === null);
  ok('23c. erro marcado com code fora do catálogo não é publicável', ['QUALQUER', '__proto__', 'constructor', 'toString'].every((code) => publicSpecOf({ [PUBLIC_ERROR]: true, code, message: 'arbitrário' }) === null));
  ok('23d. expose/code forjados sem o Symbol não são publicáveis', publicSpecOf({ expose: true, code: 'RETRY_IN_PROGRESS', message: 'arbitrário' }) === null);
  ok('23e. instância adulterada: a mensagem publicada é a do catálogo', publicSpecOf(Object.assign(publicError('RETRY_IN_PROGRESS'), { message: 'arbitrário', status: 200 })) === PUBLIC_ERRORS.RETRY_IN_PROGRESS);
}
base(); {
  // 16c. Lock gravado PELO PRÓPRIO CÓDIGO e abandonado (função morreu no meio do envio).
  net.mode = 'hang';
  const pendente = retry('cA', H.ownerA); // nunca resolve: simula instância morta
  await new Promise((r) => setTimeout(r, 20));
  const lk = cA().assinafyRetry || {};
  const maxDuration = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).functions['api/ilocarpay-broker.js'].maxDuration;
  ok('16c. lock gravado com validade MAIOR que o maxDuration do broker', lk.lockUntil - lk.lockAt > maxDuration * 1000 && lk.committed === false, JSON.stringify(lk) + ' maxDuration=' + maxDuration);
  net.mode = 'ok';
  clock = NOW0 + maxDuration * 1000 + 1;
  ok('16d. após o maxDuration o lock ainda bloqueia (dono pode estar vivo)', isCatalog(await retry('cA', H.ownerA), 'RETRY_IN_PROGRESS'));
  // Política explícita: validade de 6 min (> 300s de maxDuration) — nem menor, nem eterna.
  ok('16c2. validade do lock é exatamente 6 min', lk.lockUntil - lk.lockAt === 6 * 60 * 1000, String(lk.lockUntil - lk.lockAt));
  clock = NOW0 + 6 * 60 * 1000 + 1;
  const r = await retry('cA', H.ownerA);
  ok('16e. depois da validade, o lock abandonado é recuperado -> 200', r.statusCode === 200 && ext().assignments === 1, J(r));
  void pendente;
}

// ════ REGRESSÃO ══════════════════════════════════════════════════════════════
base(); {
  const r = await call({ step: 'generate-contract', contractId: 'cA' }, H.ownerA);
  ok('26. generate-contract legítimo segue funcionando (mocks)', r.statusCode === 200 && ext().assignments === 1 && !!cA().assinafyDocumentId, J(r));
  ok('26b. generate-contract não usa o lock do reenvio', cA().assinafyRetry === undefined);
  const r2 = await call({ step: 'generate-contract', contractId: 'cA' }, H.none);
  ok('25. generate-contract sem token -> 401 (03B2 preservado)', r2.statusCode === 401, J(r2));
  const r3 = await call({ step: 'nao-existe' }, H.ownerA);
  ok('25b. step desconhecido -> 400 "step inválido"', r3.statusCode === 400 && r3.body.error === 'step inválido', J(r3));
  const r4 = await call({ step: 'reject-lead', leadId: 'nope' }, H.ownerA);
  ok('25c. reject-lead de lead inexistente -> 404 com mensagem própria', r4.statusCode === 404 && r4.body.error === 'Lead não encontrado', J(r4));
  const r5 = await call(undefined, {}, 'GET', {});
  ok('25d. healthcheck GET inalterado', r5.statusCode === 200 && r5.body.ok === true && r5.body.endpoint === 'ilocarpay-broker', J(r5));
  spies.failCollections.add('leads');
  const r6 = await call({ step: 'reject-lead', leadId: 'x' }, H.ownerA);
  spies.failCollections.clear();
  ok('25e. falha inesperada em step antigo -> 500 "Erro interno"', r6.statusCode === 500 && r6.body.error === 'Erro interno', J(r6));
  const res = mkRes(); spies.failCollections.add('contracts');
  await handler({ method: 'GET', body: undefined, headers: {}, query: { view: 'contract', contractId: 'cA' }, socket: {} }, res);
  spies.failCollections.clear();
  ok('25f. HTML público do contrato não devolve erro cru', res.statusCode === 500 && res.sent === 'Erro interno', J(res));
}
{
  // Caller legítimo: o painel envia o Firebase ID token no retry (estático — é HTML/JS de browser).
  const html = readFileSync(new URL('../../public/admin/index.html', import.meta.url), 'utf8');
  const i = html.indexOf('window.retryAssinafy = async');
  const bloco = html.slice(i, html.indexOf('};', i));
  ok('caller do painel envia Authorization: Bearer <ID token> no retry', i > 0 && /getIdToken\(\)/.test(bloco) && /'Authorization': 'Bearer ' \+ _raTkn/.test(bloco) && /step: 'retry-assinafy'/.test(bloco));
  // 27. nenhum resíduo do módulo Imóveis na árvore da hotfix
  const api = readdirSync(new URL('../../api/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const lib = readdirSync(new URL('../../lib/', import.meta.url));
  const brokerSrc = readFileSync(new URL('../../api/ilocarpay-broker.js', import.meta.url), 'utf8');
  ok('27. sem property-*/lib/properties.js na hotfix', !lib.includes('properties.js') && !/property-|PROPERTY_STEPS|handlePropertyStep/.test(brokerSrc));
  ok('28. 12 Serverless Functions (api/*.js sem prefixo _)', api.filter((f) => !f.startsWith('_')).length === 12, api.join(','));
}
ok('rede: nenhuma chamada fora da Assinafy simulada em TODA a suíte', net.everUnexpected === 0 && net.everCalls > 0, 'fora=' + net.everUnexpected + ' total=' + net.everCalls);

// ── relatório ────────────────────────────────────────────────────────────────
Date.now = realNow;
console.error = origError; console.log = origLog; console.warn = origWarn;
for (const [s, n, d] of results) if (s === 'FAIL') console.log(`  FAIL  ${n}  ${d || ''}`);
console.log(`\n==== P0-RETRY-ASSINAFY-01: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
