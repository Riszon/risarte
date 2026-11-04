# Estado da Rita — assistente virtual de SDR

Documento de quem constrói a Rita (decisão DA1 do `PLANO-FASE-0A.md`).
O produto e as decisões do dono ficam em `DECISOES_RITA.md`; o plano, em
`PLANO-FASE-0A.md`; o que os dados do riSZon têm ou não têm, em
`LEVANTAMENTO_DADOS_RITA_RESULTADO.md`.

- **Schema:** `rita` · **Migrações:** faixa **3000+** ·
  **Versão:** `RITA_VERSION` / `RITA_MIGRATION` em `src/lib/version.ts`.
- **A Rita ainda não fala com ninguém.** A Fase 0A prepara os dados; o canal
  (WhatsApp) é a 0B.

## Onde estamos

| Entrega | Situação | Migrações |
|---|---|---|
| Plano 1 (correções da seção 2, itens 1–7) | ✅ concluído em 04/11/2026 | 0362–0364, 2009–2010, sem migração no item 1 e no 6 |
| **0A.1 Identidade e auditoria** | ✅ concluída: código, treino e produção (04/11/2026) | core **0365**, rita **3000** |
| 0A.2 Interruptor, modo e portão | próxima | 3001 |
| 0A.3 Consentimento e opt-out | — | 3002 |
| 0A.4 Unidade, horários, feriados | — | core 036x |
| 0A.5 Avaliação como dado | — | core 036x + 3003 |
| 0A.6 Escalonamento e avisos | — | 3004 |
| 0A.7 "O que a Rita sabe" | — | — |

## 0A.1 — Identidade e auditoria (Rita 0.1.0, 04/11/2026)

**Quem é a Rita no banco.** Um login técnico `rita@risarte.local`, **sem
senha e com o login bloqueado**, cujo perfil é `full_name = 'Rita (assistente
virtual)'` e `kind = 'agent'`. Nenhuma linha em `user_clinic_roles_all`: pela
regra de linha ela não lê nada. Ela é só **autora**.

- Criada por `scripts/rita-criar-identidade.mjs` (exige `--confirmar`; sem ele,
  só diz o que faria; rodar de novo só confere). **Uma por banco**, cada uma
  com o seu id: o espelho do treino (0260) só copia Risartanos, não a Rita.
- Treino (`bsnptybalszjjbhxeejo`): criada em 04/11/2026.
- Produção (`hvhbijctanrrkxhemlza`): criada pelo dono em 04/11/2026, depois da
  0365 e da 3000 (conferências 1·1·true·true·0 e 1·2·0).

**Como ela vira autora.** Toda função `rita.*` que gravar começa por
`rita.begin_as_agent()`: ela faz `set_config('rita.actor', <id>, true)` e a
auditoria (`public.audit_capture`, 0365) registra `actor = 'assistente'` e
`user_id` = a Rita. Regras da captura:

1. Pessoa logada é sempre ela mesma — `rita.actor` é ignorado.
2. Só vale o id de um perfil `kind = 'agent'`; qualquer outro valor é ignorado
   (cai em `servico`/`sistema`).
3. A auditoria continua sem derrubar a operação.

**Travas.** `rita.*` fechado a `anon` e `authenticated` (schema e funções);
`begin_as_agent` recusa pessoa logada (`NOT_ALLOWED`) e recusa sem a Rita
criada (`RITA_AGENT_MISSING`). `profiles.kind` só muda pela chave de serviço
(`PROFILE_KIND_LOCKED`); uma assistente por banco (`profiles_one_agent`).

**Na tela.** Auditoria: "Rita (assistente virtual)" (`quemFez`,
`NOME_DA_ASSISTENTE`). Risartanos (logins sem cadastro) e a contagem do Chat
a escondem.

**Provas.** Treino, transação desfeita, 12/12 (roteiro na pasta temporária da
sessão, descrito no ESTADO do core, bloco 0.397.0). Quebrando: sem a conferência
do tipo `agent`, a conferência 3 reprova. Régua `rita-identidade.test.ts` (8
testes) provada quebrando 3 vezes (tipo, tela, permissão).

**Diferenças em relação ao plano.** Os números mudaram (o plano dizia 0351; o
core já estava na 0364). O id da Rita **não** foi para `rita.settings` (0A.2):
`rita.agent_id()` lê o perfil `agent`, e a unicidade é do índice.

## Regras para as próximas entregas

- Tabela nova no schema `rita` termina com `select public.audit_attach_all();`
  (a 0365 já incluiu o schema) ou declara o motivo em
  `public.audit_excluded_tables`.
- Função `rita.*`: `security definer`, `set search_path = ''`,
  `revoke execute … from public, anon, authenticated`, `grant … to service_role`,
  e confere `rita.enabled(unidade)` antes de agir (DA4, a partir da 0A.2).
- A API só enxerga o schema `rita` depois de ele entrar em **Exposed schemas**
  no painel do Supabase — necessário só quando um processo chamar `rita.*` pela
  API (0B). Até lá, não expor.
