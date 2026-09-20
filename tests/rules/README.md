# Testes das Firestore Security Rules

Suíte executada contra o **Firestore Emulator** (projeto fictício `demo-ilocarpay-rules`, dados fictícios).
Não toca o projeto real, não usa credenciais e não depende de rede além do download inicial do emulador.

## Pré-requisitos

- Node 20+
- `firebase-tools` ≥ 15 (`npm i -g firebase-tools`)
- **JDK 21+** no `PATH`/`JAVA_HOME` (o firebase-tools 15 recusa JDK 17)

## Executar

```bash
cd tests/rules
npm install
npm test
```

O emulador é iniciado com o `firebase.json` da raiz (`--config ../../firebase.json`), portanto carrega o
`firestore.rules` do repositório; a porta é a padrão do emulador e chega ao teste via `FIRESTORE_EMULATOR_HOST`.
Para avaliar outro ruleset (por exemplo o fonte lido do ruleset implantado), passe o caminho:

```bash
RULES_FILE=/caminho/para/outro.rules npm test
```

## O que é coberto (87 casos)

`brokerChats` (+`messages`), `owners`, `users` (+`savedCards`), `contracts`, `charges` (inclusive cobrança legada sem
`ownerId` e restrição de campos do inquilino), `leads`, `brokers`, `maintenance` (+`messages`, inquilino suspenso),
`messages`, `cardVerifications`, `termsAuditLog`, `config`, `licenses`, `_rateLimits`, `crash_logs` e o catch-all
(`properties`, `_adoptionMetrics`, `doc_uploads`). Papéis: master, owner A/B, corretor A/B (token com e-mail e
`ownerIds`), inquilino ativo/suspenso/outro e anônimo.

Casos marcados como **DÍVIDA** assertam o comportamento atual (para a suíte ficar verde e documentar o problema);
ao corrigir a regra, inverta a expectativa do caso.

## Convenções que a suíte assume (espelham o código)

- `brokerChats.brokerId` = id do documento em `brokers` (slug `email_sanitizado_ownerId6`), nunca o uid.
- Tokens de corretor/inquilino/owner carregam `email`; corretores também `ownerIds` (custom claims do OTP).
- Master = e-mails listados em `isMaster()` nas Rules.
