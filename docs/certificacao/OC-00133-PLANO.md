# OC-00133 — Conquistas à vista: certificações (e metas) na equipe

**Pedido (26/10/2026).** Sugestão do Coordenador de Londrina: *medalhas ou
ícones que representem uma conquista ou meta atingida, para os membros em
destaque*. Complemento do Admin Master: *indicadores de certificação concluída;
na lista de Risartanos, ver quais certificações cada um concluiu — para
remanejar alguém de função, cobrir um colega que faltou, ou como parte da
evolução de carreira.*

Não é defeito: é coisa nova. O dono pediu para fazer (26/10/2026).

## O que já existe (lido no código e no banco)

- **O certificado já é guardado** (`training_certifications`, 0273): pessoa,
  **função**, unidade, turma, data, quem aprovou e o retrato dos números. É
  **por função** — quem é recepcionista e coordenador tem duas certificações
  separadas. A **reciclagem cria um certificado novo** e o antigo fica (o
  histórico conta quantas vezes a pessoa passou).
- **Quem pode ler** (regra do banco): a própria pessoa, o Admin Master e quem
  enxerga aquele Risartano (`can_see_staff` — gerente e franqueado da unidade,
  Franqueadora). É o mesmo público da lista de Risartanos. **Sem migração para
  ler.**
- **Hoje o certificado só aparece escondido:** na ficha do Risartano, por
  unidade, como o motivo *"Missão cumprida"* do sistema real; e no
  Acompanhamento da Certificação (Admin). A lista de Risartanos não mostra nada.
- **Metas:** cada meta tem o resultado CONGELADO no fim (`goal_results`), um
  pódio (os três primeiros pelo % do alvo) e um texto de reconhecimento. ⚠️ A
  regra **R4** das Metas diz que o resultado de cada pessoa só é visto por quem
  pode editar a meta e pela própria pessoa — mostrar medalha de meta a colegas
  mexe nessa regra.

## Proposta

1. **Selo de certificação** (medalha com o nome da função) — um por função
   certificada, com a data e quantas vezes passou (reciclagem). Fica dourado
   enquanto vale; se a pessoa já não tem aquela função, continua aparecendo
   como "certificado em…" — é exatamente o que serve para remanejar ou cobrir.
2. **Na lista de Risartanos:** os selos na linha de cada pessoa e um **filtro
   "Certificado em [função]"** (quem pode cobrir a recepção hoje?).
3. **Na ficha do Risartano:** a seção **Certificações e conquistas** com o
   histórico (função, data, turma, automática ou aprovada por quem).
4. **Para a própria pessoa:** as medalhas dela no Início (ver as próprias
   conquistas é o que a sugestão pede).
5. **Metas (se o dono quiser):** medalha "meta atingida" / "super meta", só
   lida do resultado congelado — nunca recalculada.

Uma regra pura só (`src/lib/conquistas.ts`, com teste) decide o que vira selo,
para a lista, a ficha e o Início nunca discordarem.

## Decisões (perguntas ao dono)

Respondidas pelo dono em 26/10/2026 — as quatro como recomendado:

| | Pergunta | Decisão |
|---|---|---|
| M1 | Quais conquistas viram medalha? | **Só a certificação agora.** Medalha de metas fica para uma etapa seguinte (esbarra na R4 das Metas). |
| M2 | Quem vê? | **Gestores + a própria pessoa** — a regra que o banco já tem (lista e ficha de Risartanos; o Início da pessoa). Sem quadro de destaques para a equipe toda. |
| M3 | Na lista de Risartanos? | **Selo + filtro "Certificado em [função]".** |
| M4 | Função que a pessoa não tem mais? | **Mostrar, em tom mais claro** ("certificada em…"). |

Sem migração. O dono pediu para fazer na mesma hora ("vamos fazer esta
melhoria agora").

## Entregue — 0.349.0 (26/10/2026)

Lista de Risartanos (medalha + filtro), ficha do Risartano e página do login
(seção Certificações), Início (Sua certificação). Regra em
`src/lib/conquistas.ts`; testes em `conquistas-oc133.test.ts` (prova de
quebra 8/8). Evidência EV-223. Medalha de meta: no BACKLOG.
