# Deploy — Monitoring Assist em um ambiente Dynatrace

Passo a passo para publicar o app em qualquer tenant.

---

## Pré-requisitos

- **Node.js 18+** (validado com v20/v24 LTS) — `node --version`
- **npm 9+** — `npm --version`
- **Git**
- **URL do tenant** no formato `https://<TENANT_ID>.apps.dynatrace.com`
- Login com **permissão de deploy** no tenant (`app-engine:apps:install`) — o CLI abre o browser para OAuth interativo

---

## 1. Clonar o repositório

```bash
git clone https://github.com/brbenito22/monitoring-assist.git
```

```bash
cd monitoring-assist
```

## 2. Configurar o tenant

Abra `app.config.json` e altere **APENAS** o `environmentUrl`:

```json
{
  "environmentUrl": "https://<TENANT_ID_DO_CLIENTE>.apps.dynatrace.com",
  "app": {
    "id": "my.monitoring.assist",
    "...": "..."
  }
}
```

> ⚠️ **NÃO comite essa mudança.** No upstream o `environmentUrl` fica com o placeholder `<YOUR_TENANT_ID>`. Trabalhe apenas localmente.

Para não correr o risco de commitar por engano:

```bash
git update-index --skip-worktree app.config.json
```

O arquivo deixa de aparecer em `git status`. Para voltar a versionar mudanças nele (adicionar um escopo, por exemplo):

```bash
git update-index --no-skip-worktree app.config.json
```

> **O build falha antes deste passo.** O placeholder `<YOUR_TENANT_ID>` não é uma URL válida, então `npm run build` retorna
> `'environmentUrl' must contain a valid 'environmentUrl'`. É proposital: falha na hora, com mensagem clara, em vez de deixar
> um tenant errado passar despercebido.

## 3. Instalar dependências

```bash
npm ci
```

Use `npm ci` (respeita o `package-lock.json`) em vez de `npm install`. Se der conflito de peer dependency:

```bash
npm ci --legacy-peer-deps
```

## 4. Type-check

```bash
npx tsc --noEmit -p ui/tsconfig.json
```

Precisa passar sem erros antes do deploy.

## 5. Deploy

```bash
npm run deploy
```

O CLI abre o browser para login. Ao final imprime a URL do app:
`https://<TENANT_ID>.apps.dynatrace.com/ui/apps/my.monitoring.assist`

Para desenvolvimento local com hot reload:

```bash
npm start
```

---

## Versionamento

O `dt-app` recusa reinstalar a **mesma versão com checksum diferente**:

```
Cannot install app with version X.Y.Z because the same version is already
installed with a different checksum.
```

Incremente `app.app.version` no `app.config.json` a cada deploy.

---

## Escopos

Os 16 escopos são declarados no `app.config.json` e concedidos na instalação — não há nada a configurar manualmente.

Um escopo **não** pode ser declarado: `automation:workflows:write` é reservado a apps da própria Dynatrace. Tentar declará-lo faz a instalação falhar com:

```
Only apps that are provided by Dynatrace can use the
'automation:workflows:write' scope.
```

Por isso o app monta o payload do workflow para você colar no app **Workflows**, em vez de criá-lo.

---

## Diferenças entre ambientes

O app se adapta, mas o que você vê muda conforme o tenant:

| Situação | Efeito |
|---|---|
| Ambiente Grail-native | Só métricas `dt.*`; nenhuma `builtin:*` |
| Sem Service Detection v2 nem enhanced endpoints | Só key requests têm métrica própria; o resto vira `NON_KEY_REQUESTS` e o app cai para spans |
| RUM ausente ou sintético | Templates de frontend retornam vazio |
| Site Reliability Guardian não instalado | A ação **Guardian** falha ao gravar — instale pelo Hub |
| Sem `openpipeline:events.sdlc:ingest` | O guardian é criado, mas a validação falha com *"Could not start validation"* |

---

## Solução de problemas

**`'environmentUrl' must contain a valid 'environmentUrl'`**
O passo 2 não foi feito. O placeholder ainda está no arquivo.

**`Failed to install the app — HTTP 400`**
Leia a linha seguinte da saída: costuma ser versão repetida (incremente a versão) ou escopo não permitido.

**SLI validado retorna 0 séries**
As entidades selecionadas não emitem essa métrica. Use os templates 🔍 (spans) ou marque os endpoints como key requests.

**`Got more than one result` num objetivo de guardian**
A query precisa retornar um único valor. O app já faz esse colapso — se aparecer, o objetivo foi criado por fora ou por uma versão anterior à 2.18.0.
