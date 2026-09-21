// Teste de mutação da hotfix (P0-RETRY-ASSINAFY-01, P0-BROKER-OPEN-STEPS-01, P0-OWNER-WEBHOOK-SECRET-01, P0-QR-PUBLIC-01, WHATSAPP-MT-02).
// Um defeito por vez; as suítes TÊM de falhar.
// Uso: cd tests/backend && node mutants.cjs  (restaura os arquivos ao final, mesmo com falha).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const W = path.resolve(__dirname, '../..') + '/';
const BRK = W + 'api/ilocarpay-broker.js';
const ADM = W + 'public/admin/index.html';
const ALZ = W + 'lib/authz.js';
const OWN = W + 'api/ilocarpay-owner.js';
const VCJ = W + 'vercel.json';
const QRP = W + 'public/qr/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const orig = { [BRK]: fs.readFileSync(BRK, 'utf8'), [ADM]: fs.readFileSync(ADM, 'utf8'), [ALZ]: fs.readFileSync(ALZ, 'utf8'), [OWN]: fs.readFileSync(OWN, 'utf8'), [VCJ]: fs.readFileSync(VCJ, 'utf8') };
const SUITES = ['whatsapp-qr.test.mjs', 'qr-public.test.mjs', 'owner-webhook.test.mjs', 'retry-assinafy.test.mjs', 'broker-tools.test.mjs'];
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

  // ══ P0-BROKER-OPEN-STEPS-01: ferramentas administrativas ══
  // gate
  [BRK, 'TOOLS/AUTH: gate removido', "    else if (BROKER_TOOL_STEPS.has(step)) {\n      // P0-BROKER-OPEN-STEPS-01: ferramentas administrativas", "    else if (false) {\n      // P0-BROKER-OPEN-STEPS-01: ferramentas administrativas"],
  [ALZ, 'TOOLS/AUTH: token inválido aceito (verifyBearer)', "  try { decoded = await getAuth().verifyIdToken(token, true); }\n  catch { throw Object.assign(new Error('Token invalido'), { status: 401 }); }\n  return { uid: decoded.uid", "  try { decoded = await getAuth().verifyIdToken(token, true); }\n  catch { decoded = { uid: 'anon', email: '' }; }\n  return { uid: decoded.uid"],
  [BRK, 'TOOLS/AUTH: bypass de identidade ativa (só verifyBearer)', "      req._toolAuth = await requireMasterBearer(req);", "      req._toolAuth = await verifyBearer(req);"],
  [BRK, 'TOOLS/AUTH: master-only trocado por qualquer autenticado ativo', "      req._toolAuth = await requireMasterBearer(req);", "      req._toolAuth = await verifyBearer(req); await assertActiveUser(db, req._toolAuth);"],
  [BRK, 'TOOLS/AUTH: confia em role do body', "      req._toolAuth = await requireMasterBearer(req);", "      req._toolAuth = (req.body?.role === 'master' || req.body?.isMaster === true) ? await verifyBearer(req) : await requireMasterBearer(req);"],
  [BRK, 'TOOLS/AUTH: confia em ownerId do body', "      req._toolAuth = await requireMasterBearer(req);", "      req._toolAuth = req.body?.ownerId ? await verifyBearer(req) : await requireMasterBearer(req);"],
  [BRK, 'TOOLS/AUTH: chamada externa antes da autorização', "      req._toolAuth = await requireMasterBearer(req);", "      { const c = getEvoConfig(null, null); await makeEvoFetch(c.baseUrl, c.apiKey)('instance/fetchInstances').catch(() => {}); }\n      req._toolAuth = await requireMasterBearer(req);"],
  [BRK, 'TOOLS/METHOD: método mutável aceito fora de POST', "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });", "  if (req.method !== 'POST' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });"],
  // limites e concorrência
  [BRK, 'TOOLS/RATE: limite removido', "    if (count >= TOOL_LIMITS[step]) throw", "    if (false) throw"],
  [BRK, 'TOOLS/RATE: janela nunca reinicia', "    const inWindow = typeof d.windowStart === 'number' && now - d.windowStart < TOOL_WINDOW_MS;", "    const inWindow = typeof d.windowStart === 'number';"],
  [BRK, 'TOOLS/CONC: lock de execução ignorado', "    if (typeof d.lockUntil === 'number' && d.lockUntil > now) throw publicError('TOOL_BUSY'", "    if (false) throw publicError('TOOL_BUSY'"],
  // destinatários
  [BRK, 'TOOLS/DEST: test-email aceita destinatário arbitrário', "        if (to.trim().toLowerCase() !== self) throw publicError('RECIPIENT_NOT_ALLOWED'", "        if (false) throw publicError('RECIPIENT_NOT_ALLOWED'"],
  [BRK, 'TOOLS/DEST: test-email envia para o "to" do corpo', "      try { await sendEmail(self, '✅ Teste SMTP — iLocarPay'", "      try { await sendEmail(to || self, '✅ Teste SMTP — iLocarPay'"],
  [BRK, 'TOOLS/DEST: send-whatsapp-test aceita número arbitrário', "        if (asked.length < 10 || adminPhone.length < 10 || norm(asked) !== norm(adminPhone)) throw publicError('RECIPIENT_NOT_ALLOWED'", "        if (false) throw publicError('RECIPIENT_NOT_ALLOWED'"],
  [BRK, 'TOOLS/DEST: send-whatsapp-test usa o texto do corpo', "      try { sent = await sendWhatsApp(adminPhone, 'Teste iLocarPay\\n\\nhttps://www.ilocarpay.com.br'); }", "      try { sent = await sendWhatsApp(adminPhone, req.body.message || 'Teste iLocarPay\\n\\nhttps://www.ilocarpay.com.br'); }"],
  // webhook
  [BRK, 'TOOLS/WEBHOOK: URL vinda do body', "        const body = JSON.stringify({ webhook: { enabled: true, url: EVOLUTION_WEBHOOK_URL,", "        const body = JSON.stringify({ webhook: { enabled: true, url: req.body.webhookUrl || EVOLUTION_WEBHOOK_URL,"],
  [BRK, 'TOOLS/WEBHOOK: segredo/campos do body mesclados', "webhook_by_events: true, events: [...EVOLUTION_WEBHOOK_EVENTS] } });", "webhook_by_events: true, events: [...EVOLUTION_WEBHOOK_EVENTS], ...(req.body.webhook || {}), secret: req.body.secret } });"],
  [BRK, 'TOOLS/WEBHOOK: reescreve mesmo já configurado', "        if (already) result = { ok: true, changed: false };", "        if (false) result = { ok: true, changed: false };"],
  // sanitização
  [BRK, 'TOOLS/SAN: setup-webhook devolve resposta bruta', "          result = { ok: true, changed: true };", "          result = { ok: true, changed: true, provider: await r.text() };"],
  [BRK, 'TOOLS/SAN: falha do provedor devolve corpo cru', "          if (!r.ok) throw publicError('PROVIDER_UNAVAILABLE', 'setup-webhook: provedor status ' + r.status);", "          if (!r.ok) throw Object.assign(new Error(await r.text()), { status: 502 });"],
  [BRK, 'TOOLS/SAN: whatsapp-debug volta a expor configuração', "      throw Object.assign(new Error('endpoint desativado'), { status: 410 });", "      { const c = getEvoConfig(null, null); result = { ok: true, instance: c.instance, baseUrl: c.baseUrl }; }"],
  [BRK, 'TOOLS/SAN: log do WhatsApp volta a gravar o corpo do provedor', "    if (!r.ok) console.warn('[whatsapp] sendText falhou: status', r.status);", "    if (!r.ok) console.warn('[whatsapp] sendText falhou:', await r.text().catch(() => r.status));"],
  [BRK, 'TOOLS/FALHA: envio de WhatsApp sempre reportado como sucesso', "    return r.ok === true;", "    return true;"],
  [BRK, 'TOOLS/FALHA: erro de SMTP vira resposta com e.message', "        throw publicError('PROVIDER_UNAVAILABLE', 'test-email: smtp falhou');", "        throw Object.assign(new Error(e.message), { status: 502 });"],

  // ══ P0-OWNER-WEBHOOK-SECRET-01: setup-webhook do ilocarpay-owner.js ══
  [OWN, 'OWNER/AUTH: gate removido', "    if (step === 'setup-webhook')          await requireMasterBearer(req);\n", ""],
  [OWN, 'OWNER/SECRET: volta ao segredo do corpo (undefined === undefined)', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook' && body.secret !== process.env.MIGRATE_SECRET) throw Object.assign(new Error('nao autorizado'), { status: 403 });"],
  [OWN, 'OWNER/SECRET: segredo do corpo aceito como alternativa ao master', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook' && !(process.env.MIGRATE_SECRET && body.secret === process.env.MIGRATE_SECRET)) await requireMasterBearer(req);"],
  [OWN, 'OWNER/SECRET: sem checar existência da variável (aceita vazio == vazio)', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook' && !(typeof body.secret === 'string' && body.secret === (process.env.MIGRATE_SECRET || ''))) await requireMasterBearer(req);"],
  [OWN, 'OWNER/SECRET: comparação invertida', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook' && body.secret !== process.env.MIGRATE_SECRET) await requireMasterBearer(req);"],
  [OWN, 'OWNER/SECRET: segredo pela query', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook' && !(process.env.MIGRATE_SECRET && req.query?.secret === process.env.MIGRATE_SECRET)) await requireMasterBearer(req);"],
  [OWN, 'OWNER/AUTH: master-only trocado por qualquer autenticado', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook')          await verifyFirebaseToken(req);"],
  [OWN, 'OWNER/AUTH: ADMIN_SECRET (superadmin por senha) passa a autorizar', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook')          await requireSuperAdmin(req).catch(() => requireMasterBearer(req));"],
  [OWN, 'OWNER/ORDEM: provedor chamado antes da autenticação', "    if (step === 'setup-webhook')          await requireMasterBearer(req);", "    if (step === 'setup-webhook')          { await fetch(`${ASAAS_BASE}/webhooks`).catch(() => {}); await requireMasterBearer(req); }"],
  [OWN, 'OWNER/METHOD: método mutável aceito fora de POST', "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });", "  if (req.method !== 'POST' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });"],
  [OWN, 'OWNER/RATE: limite removido', "    if (count >= SETUP_WEBHOOK_LIMIT) throw", "    if (false) throw"],
  [OWN, 'OWNER/CONC: lock ignorado', "    if (typeof d.lockUntil === 'number' && d.lockUntil > now) throw Object.assign(new Error('Esta ferramenta", "    if (false) throw Object.assign(new Error('Esta ferramenta"],
  [OWN, 'OWNER/IDEMP: reescreve mesmo já configurado', "      if (same) return { ok: true, action: 'unchanged' };", "      if (false) return { ok: true, action: 'unchanged' };"],
  [OWN, 'OWNER/IDEMP: listagem falha e mesmo assim cria (duplicata)', "    if (!listResp.ok) { console.error('[setup-webhook] Asaas list status', listResp.status); throw providerDown(); }\n    const listJson = await listResp.json().catch(() => null);\n    if (!listJson || !Array.isArray(listJson.data)) { console.error('[setup-webhook] Asaas list sem data'); throw providerDown(); }\n    const existing = listJson.data.find(", "    const listJson = await listResp.json().catch(() => null);\n    const existing = ((listJson && listJson.data) || []).find("],
  [OWN, 'OWNER/SAN: e.message de falha inesperada volta à resposta', "    console.error('[setup-webhook] falha inesperada:', (e && e.name) || 'erro');\n    throw providerDown();", "    throw e;"],
  [OWN, 'OWNER/SAN: resposta crua do provedor volta ao cliente', "    if (!createResp.ok) { console.error('[setup-webhook] Asaas create status', createResp.status); throw providerDown(); }", "    if (!createResp.ok) throw Object.assign(new Error(await createResp.text()), { status: 502 });"],
  [OWN, 'OWNER/SAN: sucesso volta a devolver dados do provedor', "    return { ok: true, action: 'created' };", "    return { ok: true, action: 'created', webhookId: created.id, url: BILLING_WEBHOOK_URL, events };"],
  // ══ WHATSAPP-MT-02: QR autenticado por imobiliária ══
  [BRK, "MT02/AUTH: autenticação removida (identidade vinda do corpo)", "  const auth = await verifyBearer(req);\n  await assertActiveUser(db, auth);\n  const deny", "  const auth = { uid: 'anon', email: String((req.body && req.body.email) || '') };\n  const deny"],
  [BRK, "MT02/AUTH: bypass de usuário suspenso", "  const auth = await verifyBearer(req);\n  await assertActiveUser(db, auth);\n  const deny", "  const auth = await verifyBearer(req);\n  const deny"],
  [BRK, "MT02/PAPEL: corretor passa a acessar a imobiliária dele", "  const q = await db.collection('owners').where('email', '==', auth.email).limit(2).get();", "  const q = await (async () => { const o = await db.collection('owners').where('email', '==', auth.email).limit(2).get(); if (o.size) return o; const b = await db.collection('brokers').where('email', '==', auth.email).limit(1).get(); if (b.empty) return o; const s = await db.collection('owners').doc(b.docs[0].data().ownerId).get(); return { size: 1, docs: [s] }; })();"],
  [BRK, "MT02/PAPEL: vínculo ambíguo aceito (primeira imobiliária)", "  if (q.size !== 1) throw deny();", "  if (q.size < 1) throw deny();"],
  [BRK, "MT02/PAPEL: imobiliária suspensa aceita", "  if (ownerData.status === 'suspended') throw deny();\n  // Compatibilidade", "  // Compatibilidade"],
  [BRK, "MT02/ESCOPO: ownerId do corpo escolhe a organização", "  const doc = q.docs[0];", "  const doc = (req.body && typeof req.body.ownerId === 'string') ? await db.collection('owners').doc(req.body.ownerId).get() : q.docs[0];"],
  [BRK, "MT02/ESCOPO: ownerId divergente deixa de dar 404", "  if (asked !== undefined && asked !== null && asked !== '' && asked !== doc.id) {", "  if (false) {"],
  [BRK, "MT02/ESCOPO: instanceId do corpo escolhe a instância", "      result = await handleWhatsappQr(db, req._waOrg);", "      result = await handleWhatsappQr(db, { ...req._waOrg, ownerData: { ...req._waOrg.ownerData, evolutionInstance: req.body.instanceId || req._waOrg.ownerData.evolutionInstance } });"],
  [BRK, "MT02/INST: sem instância cai na instância global", "  const inst = typeof org.ownerData.evolutionInstance === 'string' ? org.ownerData.evolutionInstance.trim() : '';", "  const inst = (typeof org.ownerData.evolutionInstance === 'string' && org.ownerData.evolutionInstance.trim()) || String(process.env.EVOLUTION_INSTANCE || '').trim();"],
  [BRK, "MT02/INST: instância igual à da plataforma aceita", "  if (globalInst && inst === globalInst) throw", "  if (false) throw"],
  [BRK, "MT02/INST: instância compartilhada entre imobiliárias aceita", "  if (dup.size !== 1) throw", "  if (false) throw"],
  [BRK, "MT02/NAO-DESTRUTIVO: cria instância quando ausente", "  if (!inst) throw publicError('WHATSAPP_NOT_PROVISIONED', 'wa-qr: organização sem instância vinculada');", "  if (!inst) { const c = getEvoConfig(org.ownerData, org.ownerId); await makeEvoFetch(c.baseUrl, c.apiKey)('instance/create', { method: 'POST', body: '{}' }).catch(() => {}); throw publicError('WHATSAPP_NOT_PROVISIONED', 'x'); }"],
  [BRK, "MT02/NAO-DESTRUTIVO: provedor 404 apaga e recria", "    if (!st.ok) throw publicError('PROVIDER_UNAVAILABLE', 'wa-qr: connectionState status ' + st.status);", "    if (!st.ok) { await evoFetch(`instance/delete/${inst}`, { method: 'DELETE' }).catch(() => {}); await evoFetch('instance/create', { method: 'POST', body: '{}' }).catch(() => {}); throw publicError('PROVIDER_UNAVAILABLE', 'x'); }"],
  [BRK, "MT02/NAO-DESTRUTIVO: conectado ainda gera novo QR", "    if (state === 'open') {\n      if (org.ownerData.whatsappConnected !== true) {", "    if (false) {\n      if (org.ownerData.whatsappConnected !== true) {"],
  [BRK, "MT02/ORDEM: provedor chamado antes da autorização", "      req._waOrg = await resolveWhatsappAdmin(db, req);", "      { const c = getEvoConfig(null, null); await makeEvoFetch(c.baseUrl, c.apiKey)(`instance/connectionState/${c.instance}`).catch(() => {}); }\n      req._waOrg = await resolveWhatsappAdmin(db, req);"],
  [BRK, "MT02/RATE: limite removido", "      if (count >= limits[k]) throw", "      if (false) throw"],
  [BRK, "MT02/LOCK: lock por organização removido", "    if (typeof org.lockUntil === 'number' && org.lockUntil > now) throw publicError('TOOL_BUSY'", "    if (false) throw publicError('TOOL_BUSY'"],
  [BRK, "MT02/QR: Cache-Control no-store removido", "      res.setHeader('Cache-Control', 'no-store, private, max-age=0');", "      res.setHeader('Cache-Control', 'public, max-age=60');"],
  [BRK, "MT02/QR: payload completo do provedor devolvido", "    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN };", "    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN, ...cj };"],
  [BRK, "MT02/QR: QR registrado no log", "    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN };", "    console.log('[wa-qr]', qr);\n    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN };"],
  [BRK, "MT02/QR: QR persistido no Firestore", "    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN };", "    await db.collection('owners').doc(org.ownerId).update({ lastQr: qr }).catch(() => {});\n    return { ok: true, connected: false, qr, expiresIn: WA_QR_EXPIRES_IN };"],
  [BRK, "MT02/QR: QR malformado aceito", "    if (typeof qr !== 'string' || qr.length > WA_QR_MAX_LEN || !WA_QR_DATA_URL.test(qr)) {", "    if (typeof qr !== 'string') {"],
  [BRK, "MT02/QR: QR acima do tamanho máximo aceito", "    if (typeof qr !== 'string' || qr.length > WA_QR_MAX_LEN || !WA_QR_DATA_URL.test(qr)) {", "    if (typeof qr !== 'string' || !WA_QR_DATA_URL.test(qr)) {"],
  [BRK, "MT02/SAN: e.message do provedor volta à resposta", "    console.error('[wa-qr] falha do provedor:', (e && e.name) || 'erro');\n    throw publicError('PROVIDER_UNAVAILABLE', 'wa-qr: falha de rede');", "    throw Object.assign(new Error(e.message), { status: 502 });"],
  [ADM, "MT02/CALLER: painel deixa de enviar o Bearer", "        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _qrTkn },\n        body: JSON.stringify({ step: 'whatsapp-qr', ownerId: _qrOwnerId })", "        method: 'POST', headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ step: 'whatsapp-qr', ownerId: _qrOwnerId })"],
  [ADM, "MT02/CALLER: painel volta a logar a resposta do QR", "      const data = await res.json();\n      if (!res.ok) { const he = new Error", "      const data = await res.json();\n      console.log('[whatsapp-qr] response:', JSON.stringify(data).slice(0, 200));\n      if (!res.ok) { const he = new Error"],
  [ADM, "MT02/CALLER: fechar o modal não remove o QR", "  $('btn-wa-modal-close').addEventListener('click', () => _closeWhatsappQr());", "  $('btn-wa-modal-close').addEventListener('click', () => { _clearQrTimers(); $('modal-whatsapp-qr').style.display = 'none'; });"],
  // ══ P0-QR-PUBLIC-01: rota pública ══
  [VCJ, 'QR/ROTA: rewrite /qr reintroduzido', '"rewrites": [', '"rewrites": [\n    { "source": "/qr", "destination": "/api/ilocarpay-broker" },'],
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
  for (const s of SUITES) {
    try { execSync('node --loader ./loader.mjs ' + s, { cwd: W + 'tests/backend', stdio: 'pipe', timeout: 180000 }); } catch (_) { failed = true; break; }
  }
  fs.writeFileSync(file, o);
  console.log(`  ${failed ? 'MORTO ' : 'VIVO  '} ${name}`);
  if (failed) killed++; else survivors.push(name);
}
// Mutante de criação (P0-QR-PUBLIC-01): a página pública /qr volta a existir -> a suíte TEM de falhar.
{
  const name = 'QR/ROTA: página pública /qr recriada';
  const page = execSync('git show 7ec701f:public/qr/index.html', { cwd: W });
  let failed = false;
  try {
    fs.mkdirSync(path.dirname(QRP), { recursive: true });
    fs.writeFileSync(QRP, page);
    for (const s of SUITES) {
      try { execSync('node --loader ./loader.mjs ' + s, { cwd: W + 'tests/backend', stdio: 'pipe', timeout: 180000 }); } catch (_) { failed = true; break; }
    }
  } finally { fs.rmSync(path.dirname(QRP), { recursive: true, force: true }); }
  console.log(`  ${failed ? 'MORTO ' : 'VIVO  '} ${name}`);
  M.push([QRP, name]);
  if (failed) killed++; else survivors.push(name);
}
for (const f of Object.keys(orig)) fs.writeFileSync(f, orig[f]);
console.log(`\nmutantes mortos: ${killed}/${M.length} | sobreviventes: ${survivors.length}`);
survivors.forEach((s) => console.log('  sobreviveu: ' + s));
console.log('arquivos restaurados:', Object.keys(orig).every((f) => fs.readFileSync(f, 'utf8') === orig[f]) && !fs.existsSync(QRP));
process.exit(survivors.length ? 1 : 0);
