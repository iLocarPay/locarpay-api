// PROPERTIES-02A — suíte do módulo Imóveis (lib/properties.js), exercitado pelo handler real
// Sem rede, sem Firestore real: fakes em memória e identidades fictícias.
import { reset, seed, store, spies, all } from './fakes.mjs';
import { getFirestore } from './m-firestore.mjs';

// O módulo é exercitado pelo caminho REAL: o handler do broker, que expõe os steps property-*.
const handler = (await import(new URL('../../api/ilocarpay-broker.js', import.meta.url).href)).default;
const mod = await import(new URL('../../lib/properties.js', import.meta.url).href);
const OPS = ['create', 'get', 'list', 'update', 'archive', 'restore'];

let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; results.push(['PASS', name, '']); }
  else { fail++; results.push(['FAIL', name, detail]); }
};

// console.error capturado para checar ausência de PII nos logs
const logs = [];
const origError = console.error;
console.error = (...a) => logs.push(a.join(' '));

const mkRes = () => ({
  statusCode: 200, body: null, headers: {},
  status(s) { this.statusCode = s; return this; },
  json(o) { this.body = o; return this; },
  end() { return this; },
  setHeader(k, v) { this.headers[k] = v; },
});

// Todas as mensagens de erro devolvidas ao cliente, para auditoria de PII ao final.
const seenErrors = [];
// Traduz o step curto usado nos casos para o step público do broker (property-<op>).
const toPublicStep = (body) => {
  if (!body || typeof body.step !== 'string' || !OPS.includes(body.step)) return body;
  return { ...body, step: 'property-' + body.step };
};
const call = async (body, headers = {}, method = 'POST') => {
  const res = mkRes();
  const b = body === undefined ? undefined : toPublicStep({ ...body });
  await handler({ method, body: b, headers, query: {}, socket: {} }, res);
  if (res.body && typeof res.body.error === 'string') seenErrors.push(res.body.error);
  return res;
};

const H = {
  none: {},
  invalid: { authorization: 'Bearer nope' },
  ownerA: { authorization: 'Bearer valid:owner-a@example.test' },
  ownerB: { authorization: 'Bearer valid:owner-b@example.test' },
  ownerNoPlan: { authorization: 'Bearer valid:owner-np@example.test' },
  ownerSusp: { authorization: 'Bearer valid:owner-s@example.test' },
  brokerA: { authorization: 'Bearer valid:broker-a@example.test' },
  brokerA2: { authorization: 'Bearer valid:broker-a2@example.test' },
  brokerB: { authorization: 'Bearer valid:broker-b@example.test' },
  brokerOff: { authorization: 'Bearer valid:broker-off@example.test' },
  suspended: { authorization: 'Bearer valid:susp@example.test' },
  stranger: { authorization: 'Bearer valid:ninguem@example.test' },
  master: { authorization: 'Bearer valid:denisfelicio20@gmail.com' },
};

const SLUG_A = 'broker_a_example_test_ownerA';
const SLUG_A2 = 'broker_a2_example_test_ownerA';

function base() {
  reset();
  seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active', maxProperties: 3 });
  seed('owners', 'ownerB', { email: 'owner-b@example.test', status: 'active', maxProperties: 5 });
  seed('owners', 'ownerNoPlan', { email: 'owner-np@example.test', status: 'active' });
  seed('owners', 'ownerSusp', { email: 'owner-s@example.test', status: 'suspended', maxProperties: 5 });
  seed('brokers', SLUG_A, { email: 'broker-a@example.test', ownerId: 'ownerA', active: true });
  seed('brokers', SLUG_A2, { email: 'broker-a2@example.test', ownerId: 'ownerA', active: true });
  seed('brokers', 'broker_b_example_test_ownerB', { email: 'broker-b@example.test', ownerId: 'ownerB', active: true });
  seed('brokers', 'broker_off', { email: 'broker-off@example.test', ownerId: 'ownerA', active: false });
  seed('users', 'uid-susp@example.test', { email: 'susp@example.test', suspended: true });
}

const ADDRESS = { street: 'Rua Exemplo', number: '123', neighborhood: 'Centro', city: 'Bauru', state: 'SP', zipCode: '17500-000' };
const CREATE = { step: 'create', type: 'apartment', purpose: 'residential', baseRent: 1500, address: { ...ADDRESS } };
const createAs = (headers, extra = {}) => call({ ...CREATE, ...extra }, headers);

// ── 1. autenticação ──────────────────────────────────────────────────────────
base();
let r = await call({ step: 'list' }, H.none);
ok('token ausente -> 401', r.statusCode === 401, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.invalid);
ok('token inválido -> 401', r.statusCode === 401, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.suspended);
ok('usuário suspenso -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.stranger);
ok('autenticado sem papel (fail-closed) -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.ownerSusp);
ok('owner suspenso -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.brokerOff);
ok('corretor inativo -> 403', r.statusCode === 403, JSON.stringify(r.body));
// GET não executa step de imóvel: o broker responde o próprio healthcheck e nada é lido/escrito.
base();
r = await call({ step: 'list' }, H.ownerA, 'GET');
ok('GET não executa operação de imóvel', r.statusCode === 200 && !r.body.properties && !store.get('properties'), JSON.stringify(r.body));
r = await call({ step: 'create', ...CREATE }, H.ownerA, 'GET');
ok('GET não cria imóvel', !store.get('properties') || store.get('properties').size === 0);
r = await call({ step: 'list' }, H.ownerA, 'PUT');
ok('método não permitido (PUT) -> 405', r.statusCode === 405, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.ownerA, 'OPTIONS');
ok('OPTIONS -> 200 (CORS)', r.statusCode === 200);
r = await call({ step: 'nope' }, H.ownerA);
ok('step inválido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call(undefined, H.ownerA);
ok('body ausente -> 400', r.statusCode === 400, JSON.stringify(r.body));

// ── 2. create ────────────────────────────────────────────────────────────────
base();
r = await createAs(H.ownerA);
const p1 = r.body && r.body.property;
ok('create válido -> 200', r.statusCode === 200, JSON.stringify(r.body));
ok('create: propertyCode sequencial IMO-000001', p1 && p1.propertyCode === 'IMO-000001', p1 && p1.propertyCode);
ok('create: status inicial AVAILABLE', p1 && p1.status === 'AVAILABLE');
ok('create: ownerId do token (não do corpo)', p1 && p1.ownerId === 'ownerA');
ok('create: addressLine derivado', p1 && p1.addressLine === 'Rua Exemplo, 123, Centro, Bauru/SP', p1 && p1.addressLine);
ok('create: CEP normalizado (8 dígitos)', p1 && p1.address.zipCode === '17500000', p1 && p1.address.zipCode);
ok('create: timestamps resolvidos (sem sentinel na resposta)', p1 && p1.createdAt && typeof p1.createdAt.seconds === 'number', JSON.stringify(p1 && p1.createdAt));
const stored1 = store.get('properties') && [...store.get('properties').values()][0];
ok('create: schemaVersion 1 e createdBy do token', stored1 && stored1.schemaVersion === 1 && stored1.createdBy === 'uid-owner-a@example.test');
ok('create: searchTokens gerados', stored1 && Array.isArray(stored1.searchTokens) && stored1.searchTokens.includes('centro'));
r = await createAs(H.ownerA);
ok('create: segundo código é IMO-000002', r.body.property.propertyCode === 'IMO-000002', r.body.property.propertyCode);

base();
r = await call({ step: 'create', type: 'apartment', purpose: 'residential', baseRent: 1500 }, H.ownerA);
ok('create sem address -> 400', r.statusCode === 400 && /address/.test(r.body.error), JSON.stringify(r.body));
r = await createAs(H.ownerA, { address: { ...ADDRESS, zipCode: '123' } });
ok('create CEP inválido -> 400', r.statusCode === 400 && /zipCode/.test(r.body.error), JSON.stringify(r.body));
r = await createAs(H.ownerA, { address: { ...ADDRESS, state: 'XX' } });
ok('create UF inválida -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { type: 'castelo' });
ok('create type fora do enum -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { baseRent: 'muito' });
ok('create baseRent inválido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { baseRent: -1 });
ok('create baseRent negativo -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { createdBy: 'uid-hacker' });
ok('create com createdBy forjado -> 400 (campo não permitido)', r.statusCode === 400 && /createdBy/.test(r.body.error), JSON.stringify(r.body));
r = await createAs(H.ownerA, { status: 'RENTED' });
ok('create com status forjado -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { propertyCode: 'IMO-999999' });
ok('create com propertyCode forjado -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { address: { ...ADDRESS, extra: 'x' } });
ok('create com campo extra em address -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { notes: 'x'.repeat(501) });
ok('create notes acima do limite -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { landlord: { name: 'Fulano', email: 'nao-email', phone: '14999' } });
ok('create landlord.email inválido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await createAs(H.ownerA, { landlord: { name: 'Fulano', cpf: '12345678901' } });
ok('create landlord.cpf (PII não prevista) -> 400', r.statusCode === 400 && /landlord/.test(r.body.error), JSON.stringify(r.body));
r = await createAs(H.ownerA, { defaultDueDay: 31 });
ok('create defaultDueDay fora de 1..28 -> 400', r.statusCode === 400, JSON.stringify(r.body));

// ── 3. isolamento entre imobiliárias ─────────────────────────────────────────
base();
r = await createAs(H.ownerA, { ownerId: 'ownerB' });
ok('owner A forjando ownerId=ownerB -> 403', r.statusCode === 403, JSON.stringify(r.body));
ok('forja não criou documento', !store.get('properties') || store.get('properties').size === 0);
r = await createAs(H.ownerA, { ownerId: 'ownerA' });
ok('owner A com ownerId próprio explícito -> 200', r.statusCode === 200, JSON.stringify(r.body));
const idA = r.body.property.propertyId;
r = await call({ step: 'get', propertyId: idA }, H.ownerB);
ok('outro owner lendo imóvel alheio -> 404 (não revela existência)', r.statusCode === 404 && /não encontrado/i.test(r.body.error), JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idA, notes: 'invadido' }, H.ownerB);
ok('outro owner editando imóvel alheio -> 404', r.statusCode === 404, JSON.stringify(r.body));
r = await call({ step: 'archive', propertyId: idA }, H.ownerB);
ok('outro owner arquivando imóvel alheio -> 404', r.statusCode === 404, JSON.stringify(r.body));
r = await call({ step: 'get', propertyId: 'inexistente' }, H.ownerA);
ok('imóvel inexistente -> 404', r.statusCode === 404, JSON.stringify(r.body));
r = await call({ step: 'get', propertyId: idA }, H.brokerB);
ok('corretor de outro owner -> 404/403', r.statusCode === 404 || r.statusCode === 403, JSON.stringify(r.body));

// ── 4. master ────────────────────────────────────────────────────────────────
base();
r = await createAs(H.master);
ok('master sem ownerId -> 400', r.statusCode === 400 && /ownerId/.test(r.body.error), JSON.stringify(r.body));
r = await createAs(H.master, { ownerId: 'naoExiste' });
ok('master com imobiliária inexistente -> 404', r.statusCode === 404, JSON.stringify(r.body));
r = await createAs(H.master, { ownerId: 'ownerB' });
ok('master cria dentro da imobiliária informada -> 200', r.statusCode === 200 && r.body.property.ownerId === 'ownerB', JSON.stringify(r.body));

// ── 5. corretor (somente leitura + visibilidade) ─────────────────────────────
base();
await createAs(H.ownerA, { notes: 'interno', landlord: { name: 'Proprietário', email: 'l@example.test', phone: '14999999999' } });
r = await createAs(H.ownerA, { assignedBrokerIds: [SLUG_A2] });
const restrito = r.body.property.propertyId;
r = await createAs(H.brokerA);
ok('corretor tentando criar -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: restrito, notes: 'x' }, H.brokerA);
ok('corretor tentando editar -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'archive', propertyId: restrito }, H.brokerA);
ok('corretor tentando arquivar -> 403', r.statusCode === 403, JSON.stringify(r.body));
r = await call({ step: 'list' }, H.brokerA);
ok('corretor lista só o que pode ver', r.statusCode === 200 && r.body.properties.length === 1, JSON.stringify(r.body));
ok('corretor não recebe landlord nem notes', r.body.properties[0] && !('landlord' in r.body.properties[0]) && !('notes' in r.body.properties[0]), JSON.stringify(r.body.properties[0]));
r = await call({ step: 'get', propertyId: restrito }, H.brokerA);
ok('corretor não atribuído -> 404 no imóvel restrito', r.statusCode === 404, JSON.stringify(r.body));
r = await call({ step: 'get', propertyId: restrito }, H.brokerA2);
ok('corretor atribuído lê o imóvel restrito', r.statusCode === 200, JSON.stringify(r.body));

// ── 6. list: paginação e filtros ─────────────────────────────────────────────
base();
seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active', maxProperties: 50 });
for (let i = 0; i < 5; i++) await createAs(H.ownerA);
r = await call({ step: 'list', limit: 2 }, H.ownerA);
ok('list limit=2 devolve 2', r.statusCode === 200 && r.body.properties.length === 2, JSON.stringify(r.body.properties.length));
ok('list devolve nextCursor', !!r.body.nextCursor, JSON.stringify(r.body.nextCursor));
const page2 = await call({ step: 'list', limit: 2, cursor: r.body.nextCursor }, H.ownerA);
ok('list paginada não repete itens', page2.body.properties[0].propertyCode === 'IMO-000003', page2.body.properties[0].propertyCode);
const last = await call({ step: 'list', limit: 10 }, H.ownerA);
ok('list última página sem cursor', last.body.properties.length === 5 && last.body.nextCursor === null, JSON.stringify(last.body.nextCursor));
r = await call({ step: 'list', limit: 101 }, H.ownerA);
ok('list limit acima do máximo -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'list', limit: 0 }, H.ownerA);
ok('list limit 0 -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'list', cursor: 'DROP TABLE' }, H.ownerA);
ok('list cursor inválido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'list', status: 'INVALIDO' }, H.ownerA);
ok('list status fora do enum -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'list', ordem: 'x' }, H.ownerA);
ok('list com filtro não permitido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'list', status: 'AVAILABLE' }, H.ownerA);
ok('list filtrada por status', r.statusCode === 200 && r.body.properties.length === 5);
r = await call({ step: 'list' }, H.ownerB);
ok('list de outra imobiliária não vaza imóveis', r.statusCode === 200 && r.body.properties.length === 0, JSON.stringify(r.body));

// ── 7. update ────────────────────────────────────────────────────────────────
base();
r = await createAs(H.ownerA);
const idU = r.body.property.propertyId;
r = await call({ step: 'update', propertyId: idU, baseRent: 1800, notes: 'reformado' }, H.ownerA);
ok('update permitido -> 200', r.statusCode === 200 && r.body.property.baseRent === 1800, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, propertyCode: 'IMO-000999' }, H.ownerA);
ok('update de campo imutável (propertyCode) -> 400', r.statusCode === 400 && /imutável/i.test(r.body.error), JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, createdAt: 1 }, H.ownerA);
ok('update de createdAt -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, createdBy: 'uid-hacker' }, H.ownerA);
ok('update de createdBy -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, ownerId: 'ownerB' }, H.ownerA);
ok('update trocando ownerId -> 403 (escopo do chamador)', r.statusCode === 403, JSON.stringify(r.body));
const afterOwnerTry = store.get('properties').get(idU);
ok('ownerId permanece inalterado', afterOwnerTry.ownerId === 'ownerA');
r = await call({ step: 'update', propertyId: idU }, H.ownerA);
ok('update sem campos -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, cor: 'azul' }, H.ownerA);
ok('update com campo desconhecido -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, status: 'IN_NEGOTIATION' }, H.ownerA);
ok('transição AVAILABLE -> IN_NEGOTIATION permitida', r.statusCode === 200 && r.body.property.status === 'IN_NEGOTIATION', JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, status: 'INACTIVE' }, H.ownerA);
ok('transição IN_NEGOTIATION -> INACTIVE bloqueada -> 422', r.statusCode === 422, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, status: 'ARCHIVED' }, H.ownerA);
ok('update não pode setar ARCHIVED -> 400', r.statusCode === 400, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idU, address: { ...ADDRESS, city: 'Marília' } }, H.ownerA);
ok('update de address recalcula addressLine', r.statusCode === 200 && /Marília\/SP$/.test(r.body.property.addressLine), JSON.stringify(r.body.property.addressLine));

// ── 8. externalRef (conflito/duplicação) ─────────────────────────────────────
base();
r = await createAs(H.ownerA, { externalRef: 'REF-1' });
ok('create com externalRef -> 200', r.statusCode === 200);
r = await createAs(H.ownerA, { externalRef: 'REF-1' });
ok('externalRef duplicado na mesma imobiliária -> 409', r.statusCode === 409, JSON.stringify(r.body));
r = await call({ ...CREATE, externalRef: 'REF-1' }, H.ownerB);
ok('mesmo externalRef em outra imobiliária -> permitido', r.statusCode === 200, JSON.stringify(r.body));

// ── 9. archive / restore ─────────────────────────────────────────────────────
base();
r = await createAs(H.ownerA);
const idArch = r.body.property.propertyId;
r = await call({ step: 'archive', propertyId: idArch }, H.ownerA);
ok('archive -> status ARCHIVED', r.statusCode === 200 && r.body.property.status === 'ARCHIVED', JSON.stringify(r.body));
ok('archive registra archivedAt/archivedBy', (() => { const d = store.get('properties').get(idArch); return d.archivedBy === 'uid-owner-a@example.test' && !!d.archivedAt; })());
ok('archive é soft delete (documento permanece)', store.get('properties').has(idArch));
r = await call({ step: 'archive', propertyId: idArch }, H.ownerA);
ok('archive repetido é idempotente', r.statusCode === 200 && r.body.alreadyArchived === true, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idArch, notes: 'x' }, H.ownerA);
ok('update em arquivado -> 422', r.statusCode === 422, JSON.stringify(r.body));
r = await call({ step: 'restore', propertyId: idArch }, H.ownerA);
ok('restore -> AVAILABLE', r.statusCode === 200 && r.body.property.status === 'AVAILABLE', JSON.stringify(r.body));
r = await call({ step: 'restore', propertyId: idArch }, H.ownerA);
ok('restore de não arquivado -> 422', r.statusCode === 422, JSON.stringify(r.body));
r = await call({ step: 'update', propertyId: idArch, status: 'RENTED' }, H.ownerA);
r = await call({ step: 'archive', propertyId: idArch }, H.ownerA);
ok('archive de imóvel RENTED -> 409', r.statusCode === 409, JSON.stringify(r.body));

// ── 10. maxProperties (decisão A: bloqueia, fail-closed) ─────────────────────
base();
r = await createAs(H.ownerA); r = await createAs(H.ownerA); r = await createAs(H.ownerA);
ok('cria até o limite do plano (3)', r.statusCode === 200, JSON.stringify(r.body));
r = await createAs(H.ownerA);
ok('acima do limite do plano -> 409', r.statusCode === 409 && /[Ll]imite/.test(r.body.error), JSON.stringify(r.body));
ok('limite não criou documento extra', store.get('properties').size === 3, String(store.get('properties').size));
const anyId = [...store.get('properties').keys()][0];
await call({ step: 'archive', propertyId: anyId }, H.ownerA);
r = await createAs(H.ownerA);
ok('arquivado não conta para o limite', r.statusCode === 200, JSON.stringify(r.body));
base();
r = await createAs(H.ownerNoPlan);
ok('plano sem maxProperties -> 409 fail-closed', r.statusCode === 409, JSON.stringify(r.body));

// ── 11. falha do Firestore e ausência de PII ─────────────────────────────────
base();
logs.length = 0;
spies.failCollections.add('properties');
r = await call({ step: 'list' }, H.ownerA);
ok('falha do Firestore -> 500 genérico', r.statusCode === 500 && r.body.error === 'Erro interno', JSON.stringify(r.body));
ok('resposta 500 não vaza detalhe interno', !/FIRESTORE_UNAVAILABLE/.test(JSON.stringify(r.body)));
ok('log do 500 sem e-mail/token', logs.length > 0 && !logs.some((l) => /@example\.test|valid:|Bearer/.test(l)), logs.join(' | '));
spies.failCollections.clear();
const piiInErrors = seenErrors.filter((m) => /@|uid-|Bearer|valid:|ownerA|ownerB|IMO-\d/.test(m));
ok(`nenhuma das ${seenErrors.length} mensagens de erro expõe identidade/ids`, piiInErrors.length === 0, piiInErrors.slice(0, 3).join(' | '));

// ── 12. rate limit de escrita ────────────────────────────────────────────────
base();
seed('owners', 'ownerA', { email: 'owner-a@example.test', status: 'active', maxProperties: 500 });
r = await createAs(H.ownerA);
const idRl = r.body.property.propertyId;
let got429 = false, statuses = [];
for (let i = 0; i < 62; i++) {
  const rr = await call({ step: 'update', propertyId: idRl, notes: 'n' + i }, H.ownerA);
  statuses.push(rr.statusCode);
  if (rr.statusCode === 429) { got429 = true; break; }
}
ok('excesso de escritas -> 429', got429, 'status vistos: ' + statuses.slice(-3).join(','));
r = await call({ step: 'list' }, H.ownerA);
ok('leitura não é bloqueada pelo rate limit de escrita', r.statusCode === 200, JSON.stringify(r.body));

// ── 13. integração pelo broker: steps fechados e módulo sem endpoint público ──
base();
ok('PROPERTY_STEPS expõe exatamente os 6 steps property-*', [...mod.PROPERTY_STEPS].sort().join(',') === OPS.map((o) => 'property-' + o).sort().join(','), [...mod.PROPERTY_STEPS].join(','));
ok('módulo em lib/ não exporta handler HTTP (default)', mod.default === undefined);
ok('módulo exporta as operações de serviço', ['handleCreate', 'handleGet', 'handleList', 'handleUpdate', 'handleArchive', 'handleRestore', 'handlePropertyStep', 'resolveCaller'].every((k) => typeof mod[k] === 'function'));
r = await call({ step: 'property-nao-existe' }, H.ownerA);
ok('step property-* desconhecido -> 400', r.statusCode === 400, JSON.stringify(r.body));
// Contrato do módulo em si (defesa em profundidade): mesmo chamado diretamente, só aceita
// os steps do conjunto fechado e nunca executa uma operação sem step válido.
{
  const db = getFirestore();
  let caught = null;
  try { await mod.handlePropertyStep(db, { body: { ...CREATE, step: 'property-qualquer' }, headers: H.ownerA }, 'property-qualquer'); }
  catch (e) { caught = e; }
  ok('módulo rejeita step fora do conjunto fechado (chamada direta) -> 400', caught && caught.status === 400, caught && caught.message);
  ok('step inválido não executa operação nenhuma', !store.get('properties') || store.get('properties').size === 0);
}
r = await call({ step: 'property-create' }, H.none);
ok('step de imóvel sem autenticação -> 401', r.statusCode === 401, JSON.stringify(r.body));
// cada step chama exatamente a sua operação (e nenhuma outra)
base();
r = await call({ step: 'property-create', ...CREATE, step: 'property-create' }, H.ownerA);
const criado = r.body && r.body.property;
ok('property-create cria (e só cria)', r.statusCode === 200 && !!criado && store.get('properties').size === 1, JSON.stringify(r.body));
const pid = criado.propertyId;
r = await call({ step: 'property-get', propertyId: pid }, H.ownerA);
ok('property-get lê sem alterar', r.statusCode === 200 && r.body.property.propertyId === pid && store.get('properties').size === 1);
r = await call({ step: 'property-list' }, H.ownerA);
ok('property-list lista sem alterar', r.statusCode === 200 && Array.isArray(r.body.properties) && store.get('properties').size === 1);
r = await call({ step: 'property-archive', propertyId: pid }, H.ownerA);
ok('property-archive arquiva (soft delete)', r.statusCode === 200 && store.get('properties').get(pid).status === 'ARCHIVED' && store.get('properties').size === 1);
r = await call({ step: 'property-restore', propertyId: pid }, H.ownerA);
ok('property-restore restaura', r.statusCode === 200 && store.get('properties').get(pid).status === 'AVAILABLE');
r = await call({ step: 'property-update', propertyId: pid, notes: 'ok' }, H.ownerA);
ok('property-update edita', r.statusCode === 200 && store.get('properties').get(pid).notes === 'ok');
// steps antigos do broker seguem funcionando e não são afetados
base();
r = await call({ step: 'deliver-keys', contractId: 'inexistente', tenantId: 'x' }, H.none);
ok('step antigo (deliver-keys) preservado: legacy chega ao lookup -> 404', r.statusCode === 404, JSON.stringify(r.body));
r = await call({ step: 'generate-contract', contractId: 'x' }, H.none);
ok('step antigo (generate-contract) preservado: 401 sem token', r.statusCode === 401, JSON.stringify(r.body));
r = await call({ step: 'nope-inexistente' }, H.ownerA);
ok('step desconhecido do broker -> 400', r.statusCode === 400, JSON.stringify(r.body));

// ── relatório ────────────────────────────────────────────────────────────────
console.error = origError;
for (const [state, name, detail] of results) {
  if (state === 'FAIL') console.log(`  FAIL  ${name}  ${detail}`);
}
console.log(`\n==== PROPERTIES-02A BACKEND: ${pass} PASS / ${fail} FAIL (${results.length} casos) ====`);
process.exit(fail ? 1 : 0);
