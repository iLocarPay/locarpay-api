# Testes de backend (handlers de `api/`)

Executam os handlers reais de `api/` contra **fakes em memória** do Firebase Admin SDK.
Sem rede, sem Firestore real, sem credenciais: identidades e dados são fictícios
(`*@example.test`, `ownerA`/`ownerB`). Nada aqui toca o projeto `locarpayapp`.

## Executar

```bash
cd tests/backend
npm test
```

Ou, da raiz do repositório:

```bash
npm run test:backend
```

Requer apenas Node 20+ (sem dependências externas).

## Como funciona

- `loader.mjs` — loader ESM que redireciona `firebase-admin/{app,auth,firestore}` para os
  mocks locais e força os arquivos de `api/` e `lib/` a serem lidos como ESM (o pacote raiz
  é CommonJS por padrão).
- `fakes.mjs` — Firestore em memória: `doc`/`collection`/`where`/`orderBy`/`startAfter`/
  `limit`/`get`/`set`/`update`/`delete`, `runTransaction` e os sentinels `serverTimestamp`,
  `increment` e `delete`. `spies.failCollections` simula indisponibilidade do Firestore.
- `m-app.mjs`, `m-auth.mjs`, `m-firestore.mjs` — os mocks expostos ao código sob teste.
  Token válido no fake: `Bearer valid:<email>` → `uid = uid-<email>`.

## Cobertura atual

`properties.test.mjs` — `api/ilocarpay-properties.js` (PROPERTIES-02A): autenticação,
papéis (master/owner/corretor), isolamento entre imobiliárias, allowlist de campos,
validação (CEP, enums, limites), paginação, transições de status, arquivamento/restauração,
cota `maxProperties`, conflito de `externalRef`, rate limit de escrita, falha do Firestore
e ausência de PII em respostas e logs.
