// P0-RETRY-ASSINAFY-01 — teste de mutação da hotfix. Um defeito por vez; a suíte TEM de falhar.
// Uso: cd tests/backend && node mutants.cjs  (restaura os arquivos ao final, mesmo com falha).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const W = path.resolve(__dirname, '../..') + '/';
const BRK = W + 'api/ilocarpay-broker.js';
const ADM = W + 'public/admin/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const orig = { [BRK]: fs.readFileSync(BRK, 'utf8'), [ADM]: fs.readFileSync(ADM, 'utf8') };
const toCrlf = (t) => t.split(CR + LF).join(LF).split(LF).join(CR + LF);

const M = [
  // ── autenticação / autorização
  [BRK, 'AUTH: gate do retry-assinafy removido', "    else if (step === 'retry-assinafy') {\n      // P0-RETRY-ASSINAFY-01: Bearer OBRIGATÓRIO", "    else if (false) {\n      // P0-RETRY-ASSINAFY-01: Bearer OBRIGATÓRIO"],
  [BRK, 'AUTH: bypass de usuário suspenso (assertActiveUser)', "      await assertActiveUser(db, auth);\n      const cId = req.body?.contractId;", "      const cId = req.body?.contractId;"],
  [BRK, 'ESCOPO: comparação de owner removida', "        try { await assertOwner(db, auth, cSnap.data().ownerId); } catch (_) { throw notFound(); }", "        /* sem checagem de escopo */"],
  [BRK, 'ESCOPO: confia em ownerId do body', "        try { await assertOwner(db, auth, cSnap.data().ownerId); } catch (_) { throw notFound(); }", "        try { await assertOwner(db, auth, req.body.ownerId || cSnap.data().ownerId); } catch (_) { throw notFound(); }"],
  [BRK, 'ESCOPO: corretor passa a poder reenviar', "        try { await assertOwner(db, auth, cSnap.data().ownerId); } catch (_) { throw notFound(); }", "        try { await assertOwnerOrBroker(db, auth, cSnap.data().ownerId, cSnap.data().brokerEmail); } catch (_) { throw notFound(); }"],
  [BRK, 'ENUM: outro escopo volta a responder 403 (enumerável)', "} catch (_) { throw notFound(); }\n        req._retryHolder = 'owner';", "} catch (e) { throw e; }\n        req._retryHolder = 'owner';"],
  [BRK, 'PAYLOAD: validação de contractId removida', "      if (!cId || typeof cId !== 'string') throw Object.assign(new Error('contractId obrigatório'), { status: 400 });\n      const notFound", "      const notFound"],
  // ── idempotência / concorrência
  [BRK, 'IDEMP: bloqueio de contrato já enviado removido', "    if (c.assinafyDocumentId) throw publicError('CONTRACT_ALREADY_SENT'", "    if (false) throw publicError('CONTRACT_ALREADY_SENT'"],
  [BRK, 'IDEMP: estado fora de error liberado', "    if (c.assinafyStatus !== 'error') throw publicError('RETRY_NOT_ALLOWED'", "    if (false) throw publicError('RETRY_NOT_ALLOWED'"],
  [BRK, 'CONC: lock ativo ignorado (duas chamadas liberadas)', "    if (typeof r.lockUntil === 'number' && r.lockUntil > now) throw", "    if (false) throw"],
  [BRK, 'CONC: lock nunca gravado', "    tx.update(ref, { assinafyRetry: lock });", "    /* sem lock */"],
  [BRK, 'CONC: reenvio sem lock (chama createAssinafyContract direto)', "      const assinafyResult = await runAssinafyRetry(db, contractId, req._retryHolder, (c) => ({", "      const assinafyResult = await ((f) => createAssinafyContract(db, contractId, f(req._c || {})))((c) => ({"],
  [BRK, 'CONC: cron ignora o lock do reenvio', "      await runAssinafyRetry(db, contractId, 'cron', (c) => ({", "      await ((f) => createAssinafyContract(db, contractId, f(contractSnap.data())))((c) => ({"],
  [BRK, 'LOCK: comprometido volta a expirar', "    if (r.committed === true) throw publicError('RETRY_NEEDS_REVIEW'", "    if (false) throw publicError('RETRY_NEEDS_REVIEW'"],
  [BRK, 'LOCK: ponto sem volta não é marcado', "  if (typeof hooks.beforeNotify === 'function') await hooks.beforeNotify();", "  /* sem gancho */"],
  [BRK, 'LOCK: falha após ponto sem volta libera o lock', "pastNoReturn ? { ...lock, committed: true } : { ...lock, lockUntil: 0 }", "{ ...lock, lockUntil: 0 }"],
  [BRK, 'LOCK: falha recuperável não libera o lock', "pastNoReturn ? { ...lock, committed: true } : { ...lock, lockUntil: 0 }", "pastNoReturn ? { ...lock, committed: true } : lock"],
  [BRK, 'LOCK: expiração nunca recupera (lock eterno)', "const RETRY_LOCK_MS = 6 * 60 * 1000;", "const RETRY_LOCK_MS = 1e15;"],
  [BRK, 'FALHA: erro externo registrado como sucesso', "      await ref.update({ assinafyRetry: pastNoReturn ? { ...lock, committed: true } : { ...lock, lockUntil: 0 } });", "      await ref.update({ assinafyStatus: 'sent', assinafyRetry: FieldValue.delete() });"],
  [BRK, 'RATE: limite de tentativas desligado', "    if (attempts >= RETRY_MAX_ATTEMPTS) throw", "    if (false) throw"],
  [BRK, 'RATE: janela nunca reinicia', "    const inWindow = typeof r.windowStart === 'number' && now - r.windowStart < RETRY_WINDOW_MS;", "    const inWindow = typeof r.windowStart === 'number';"],
  // ── sanitização
  [BRK, 'SAN: catch geral vaza e.message', "    else if (e && e.status) res.status(e.status).json({ error: e.message });\n    else res.status(500).json({ error: 'Erro interno' });", "    else res.status(e.status || 500).json({ error: e.message });"],
  [BRK, 'SAN: generate-contract volta a embutir a resposta da Assinafy', "    // terceiro fica só no log, nunca concatenada na mensagem devolvida.\n    throw e;", "    // terceiro fica só no log, nunca concatenada na mensagem devolvida.\n    throw Object.assign(new Error('Falha ao enviar ao Assinafy: ' + e.message), { status: 500 });"],
  [BRK, 'SAN: marca de publicável volta a ser expose (forjável)', "(e && e[PUBLIC_ERROR] === true && typeof e.code === 'string'", "(e && (e[PUBLIC_ERROR] === true || e.expose === true) && typeof e.code === 'string'"],
  [BRK, 'SAN: code de fora do catálogo aceito', "Object.prototype.hasOwnProperty.call(PUBLIC_ERRORS, e.code))\n    ? PUBLIC_ERRORS[e.code]\n    : null;", "true)\n    ? (PUBLIC_ERRORS[e.code] || { status: 500, message: e.message })\n    : null;"],
  [BRK, 'SAN: HTML público devolve erro cru', "        return res.status(500).send('Erro interno');", "        return res.status(500).send(e.message);"],
  [BRK, 'SAN: 409 volta a expor o id do documento', "    if (c.assinafyDocumentId) throw publicError('CONTRACT_ALREADY_SENT', 'retry: contrato já possui documento');", "    if (c.assinafyDocumentId) throw Object.assign(new Error('Contrato já enviado ao Assinafy: ' + c.assinafyDocumentId), { status: 409 });"],
  // ── caller legítimo
  [ADM, 'CALLER: painel deixa de enviar o ID token', "        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _raTkn },\n        body: JSON.stringify({ step: 'retry-assinafy', contractId })", "        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ step: 'retry-assinafy', contractId })"],
];

let killed = 0; const survivors = [];
for (const [file, name, from0, to0] of M) {
  const o = orig[file];
  const crlf = !o.includes(from0);
  const from = crlf ? toCrlf(from0) : from0, to = crlf ? toCrlf(to0) : to0;
  const n = o.split(from).length - 1;
  if (n !== 1) { console.log(`  ?? ALVO ${n === 0 ? 'NÃO ENCONTRADO' : 'AMBÍGUO'}: ${name}`); survivors.push(name + ' (alvo)'); continue; }
  fs.writeFileSync(file, o.replace(from, () => to));
  let failed = false;
  try { execSync('node --loader ./loader.mjs retry-assinafy.test.mjs', { cwd: W + 'tests/backend', stdio: 'pipe', timeout: 120000 }); } catch (_) { failed = true; }
  fs.writeFileSync(file, o);
  console.log(`  ${failed ? 'MORTO ' : 'VIVO  '} ${name}`);
  if (failed) killed++; else survivors.push(name);
}
for (const f of Object.keys(orig)) fs.writeFileSync(f, orig[f]);
console.log(`\nmutantes mortos: ${killed}/${M.length} | sobreviventes: ${survivors.length}`);
survivors.forEach((s) => console.log('  sobreviveu: ' + s));
console.log('arquivos restaurados:', Object.keys(orig).every((f) => fs.readFileSync(f, 'utf8') === orig[f]));
process.exit(survivors.length ? 1 : 0);
