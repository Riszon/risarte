# Estado do Projeto — Risarte Odontologia (MVP RIZON)

_Atualizado em: 22/06/2026 · Versão do sistema: **0.6.5** · Última migração: **0043**_

> Documento de continuidade entre sessões. Regras de negócio detalhadas ficam em
> `CLAUDE.md`; regras de código em `docs/ARQUITETURA-TECNICA.md`; jornada em
> `docs/JORNADA.md`; fila de pendências em `docs/BACKLOG.md`.

## 1. Fase atual e o que já foi concluído

Fase do plano: **MVP — núcleo clínico (completo)**. A espinha dorsal (Jornada do
Cliente em 7 fases + Centro de Planejamento) está pronta.

**Concluído e validado pelo dono:**
- Etapa 1 — Fundação (Next 16, login, RLS).
- Etapa 2 — Cadastros (clínicas, usuários, clientes, SLAs, máscaras).
- Etapa 3 — Base da Jornada (kanban, agenda, notificações, check-in, atendimento,
  decisões da Fase 5, ativo/inativo).
- LOTE D — ajustes do teste geral.
- Etapa 4 (4.1+4.2) — Coordenador Clínico (consentimento, fotos/exames/vídeo/áudio,
  considerações).
- LOTE E — correções pré-Etapa 5 (modelo SDR, jornada, conflitos de agenda,
  edição/transferência, compartilhamento entre unidades).

**Entregue (aguardando teste final do dono):**
- **Etapa 5 — Centro de Planejamento (completa):** 5.1 fila + estrutura do plano;
  5.2 orçamento por tabela de preços; 5.3/4.3 aprovação por opção + envio ao Comercial.
- **LOTE F (F1–F7):** filtros automáticos; ficha em leitura + botão Editar;
  autopreenchimento no cadastro; compartilhamento (notifica as 2 unidades +
  histórico + encerramento sem 404); **Procedimentos** (campos completos,
  busca/filtros, importação Excel, reajuste em massa, histórico, exclusão =
  desativar); aprovação por opção; fila por situação; central de notificações
  categorizada; **cockpit do Planner**.
- **LOTE B (B1–B6):** agenda **Dia/Semana/Mês**; **config de agenda por unidade**
  (horário + cadeiras); **Relatórios** (resumo de agendamentos, rede por fase sem
  nomes, contadores do Planner).

Migrações **0001–0043** escritas; **0001–0042 aplicadas**; **0043 pendente**.

## 2. O que está em andamento agora

Nada em codificação. Aguardando o **teste final do LOTE B** e a aplicação da
**migração 0043**. Nenhuma etapa nova foi iniciada (regra: não avançar sem o OK
do dono).

## 3. Próximos passos (ordem de prioridade)

1. Aplicar a **migração 0043** e fazer o **teste final do LOTE B**.
2. **Rodada de refinamento visual** — tela por tela, guiada pelo dono (cores,
   espaçamento, textos), agora que o fluxo está completo.
3. **Fase 2 — módulo comercial e além:** apresentação gravada; assinatura digital
   (**ZapSign**) + pagamento (**ASAAS**) com a regra de ouro (venda só com
   documento assinado **E** pagamento confirmado); **NPS** pós-fechamento;
   WhatsApp manual; transcrição/resumo por **IA**; **dashboards com metas**.
4. **Polimentos adiados** (em `docs/BACKLOG.md`): semana começando no domingo +
   esconder fim de semana sem agendamento; foto por webcam; gênero + rótulos;
   offline/sync (PWA).

## 4. Decisões de arquitetura importantes (com justificativa)

- **Stack fixa:** Next.js 16 (App Router) + Supabase + Vercel, região São Paulo.
  → integração simples, custo previsível, dado de saúde no Brasil (LGPD).
- **Banco único multi-tenant** (`clinic_id` + RLS em toda tabela de negócio).
  → pensado para 200 unidades sem refazer.
- **Segurança em 2 camadas, só o banco é confiável:** RLS do Postgres (barreira
  real) + guardas no app (esconder botões / erros amigáveis).
- **Config por unidade em cascata:** padrão da rede (clinic_id nulo) → override
  por unidade. Usado em SLA, prazos, tabela de preços e agenda.
- **Dinheiro em centavos (inteiro).** → evita erro de arredondamento.
- **LGPD:** consentimento antes de coletar; exclusão = anonimização (nunca apagar);
  mídia com URL assinada; relatórios da rede sem nomes; nunca dado pessoal em
  log/URL.
- **Sem migração de dados** (entrada dupla no início); **migrações aplicadas à
  mão** (SQL numerado, copiado em UTF-8, o dono cola no SQL Editor do Supabase).

## 5. Pendências, dúvidas em aberto e pontos de atenção

- **Migração 0043 pendente** de aplicação.
- **Decisões tomadas pelo assistente no LOTE B (o dono confirma no teste):**
  cadeira lotada **bloqueia** o agendamento (exceto urgência/emergência) — se
  preferir só *avisar*, dá para mudar; tempo médio do Planner = criação→aprovação.
- **Fuso horário:** horários são guardados como digitados; pode haver pequena
  diferença em filtros de "hoje/semana" (servidor roda em UTC). Atenção na Fase 2.
- **Infra:** `gh` não funciona nesta rede; push por SSH
  (`git@github.com:Riszon/risarte.git`); operações de repositório o dono faz na web.

## 6. Como retomar numa próxima sessão

1. Pasta do projeto: `C:\Users\Jeferson\MVP RIZON\risarte` (git, branch `main`).
2. Ler `CLAUDE.md` (regras de negócio) e este `ESTADO_DO_PROJETO.md` (onde paramos).
3. Conferir, no rodapé da barra lateral, **versão** e **última migração**; se não
   baterem com este arquivo, aplicar as migrações pendentes.
4. Rodar o app: duplo-clique em **"Iniciar Risarte.bat"** (servidor independente
   do assistente).
5. Banco: o assistente escreve a migração e copia em UTF-8; o dono cola no SQL
   Editor do Supabase, **em ordem**.
6. Fluxo de trabalho: o assistente apresenta um plano curto → espera o OK →
   codifica → dá o roteiro de teste. **Backup definitivo = commit no Git.**

## 7. Protocolo de continuidade (combinado em 22/06/2026)

- **No início de cada sessão:** ler `CLAUDE.md` + este arquivo e dizer, em uma
  frase, onde paramos.
- **Ao final de cada etapa relevante:** atualizar este arquivo (o que foi feito +
  próximos passos).
- **Ao final da sessão:** lembrar o dono de **salvar no Git (commit)** — é o backup
  definitivo.
- **Idioma:** interface e textos em **pt-BR**; código em **inglês**.
