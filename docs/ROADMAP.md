# Roadmap de construção — o que falta e como será feito

_Criado em 04/07/2026, após o teste geral do MVP e a entrega dos Grupos 1, 2 e
do H4.4. **Ordem decidida pelo dono:** H3.1 → H3.15 em sequência numérica,
depois H4.1 → H4.14 (pulando o H4.4, já entregue)._

Legenda: **[P]** pequeno (horas) · **[M]** médio (1 lote) · **[G]** grande
(vários lotes) · 🗄️ = precisa de migração no banco.

> Itens detalhados também em `docs/BACKLOG.md` (LOTE H). Ao concluir um item,
> marcar lá E atualizar este arquivo. Cada lote segue o ritual: plano curto →
> OK do dono → código → build+lint → commit → roteiro de teste numerado.

## Onde estamos (04/07/2026)

- **Feitos:** H1.1–H1.10 (bugs/segurança), H2.1–H2.12 (ajustes rápidos),
  H4.4 (tela Planos de Tratamento). Versão 0.11.1 · migração 0062.
- **Pendências operacionais do dono:** aplicar a migração 0062 (se ainda não);
  testar H1d–H2 e `/planos`; cadastrar `GAMMA_API_KEY` na Vercel.

## GRUPO 3 — próximo (H3.1 → H3.15)

- [x] **H3.1 Formulário de agendamento reordenado** ✅ (04/07, v0.11.2) —
      cliente → tipo → profissional → sala → sessões → duração → observações →
      **data/horário/sugestões por último**, com o título "Quando será o
      atendimento?" abrindo a etapa final.
- [x] **H3.2 "Ver agenda" rica** ✅ (04/07, v0.11.3) — pop-up do mês mostra por
      dia: nº de agendamentos, nº de **horários livres** (verde/vermelho, para o
      profissional/sala/duração do formulário), feriados (decidido/a confirmar),
      fechados, dias avulsos e bloqueios do planejamento anual (com legenda);
      dias fechados/bloqueados não são clicáveis; clicar num dia disponível
      preenche a data e o seletor lista os horários livres. Action
      `getMonthAgendaPeek` substituiu `getMonthDayCounts`.
- [x] **H3.3 Seletor de dias [M]** ✅ (04/07, v0.11.4) — régua rolável
      (`day-strip.tsx`, 42 dias a partir de hoje) no topo da agenda: por dia,
      bolinha verde (tem sala livre) / vermelha (lotado), nº de agendamentos,
      Fechado/Feriado/Avulso/Bloqueado evidentes, tooltip com o motivo e
      legenda; clicar abre a visão Dia daquela data (preserva filtro de salas).
- [x] **H3.4 Status de atendimento** ✅ (04/07, v0.11.5, migração 0063) —
      "A chegar" ganhou menu **Faltou / Cancelou em cima da hora**; "Em espera"
      ganhou **Desistiu** (estado `gave_up` → status cancelado + aviso ao
      profissional; aparece nos Concluídos com selo vermelho); **limite de
      espera configurável** (Configurar agenda, padrão 20 min) — acima dele o
      timer fica vermelho "Espera longa" e `notify_attendance_alerts` dispara
      avisos que **repetem a cada 15 min** (recepção/coordenador/gerente/
      profissional, dedupe pelo link); atendimentos de **dias anteriores** não
      concluídos geram aviso diário + banner vermelho no painel.
- [x] **H3.5 Check-in com confirmação** ✅ (04/07, v0.11.6) — "Registrar
      chegada" abre um pop-up confirmando **cliente, horário/tipo, profissional
      e sala** antes de concluir (SELECT do painel ganhou sala/ONLINE). Prepara
      o auto check-in do cliente no futuro.
- [ ] **H3.6 Troca de profissional de última hora [M] 🗄️** — botão no
      check-in/espera (recepção/gerente); registra tudo; notifica os 2
      profissionais + coordenador + gerente; alerta se ficar frequente no mês.
- [ ] **H3.7 Visibilidade da SDR [M/G] 🗄️** — SDR vê também clientes que
      transferiu/alterou/agendou (até a reavaliação); Jornada restrita a esses;
      Agenda completa mas sem abrir prontuário não permitido. Nova regra RLS
      ("clientes que a SDR tocou") + ajustes nas telas.
- [ ] **H3.8 WhatsApp aniversariantes [P/M]** — botão wa.me com mensagem
      personalizável no prontuário, na aba Aniversariantes (individual e em
      lote) e na notificação. Manual; automação = Fase 3.
- [ ] **H3.9 Notificações ampliadas [P] 🗄️** — coordenador/gerente/recepção
      também notificados em transferência (entrada/saída) e compartilhamento.
      Ajustar as funções de notificação no banco.
- [ ] **H3.10 Fluxo pós-avaliação do Coordenador [M]** — enviar ao Centro de
      Planejamento (a) conclui o atendimento automaticamente e (b) abre pop-up
      para agendar a apresentação com o Comercial.
- [ ] **H3.11 Informações complementares [M] 🗄️** — espaço no prontuário
      (pós-envio) para o coordenador mandar mais infos ao Planner; notifica o
      Planner; ícone "chegou informação nova" no Centro de Planejamento.
- [ ] **H3.12 Mídias: excluir, renomear e anotar [M] 🗄️** — por foto/arquivo,
      com registro de auditoria (LGPD).
- [ ] **H3.13 Centro/cockpit — melhorias leves [M]** — anamnese no cockpit;
      filtros unidade/pilar na fila; colunas com rolagem independente.
      (Redesign completo = H4.5.)
- [ ] **H3.14 Sessões com data + profissional [P/M]** — sessão agendada mostra
      quando e com quem (ficha + visão do coordenador); clicável → abre o
      agendamento.
- [ ] **H3.15 Comercial: prontos para apresentação [M]** — `/planos` já dá a
      central; falta: notificar o consultor quando o plano chega e, se o
      cliente NÃO tiver apresentação agendada, aviso forte à recepção +
      notificação a gerente/coordenador.

## GRUPO 4 — módulos novos (H4.1 em diante; H4.4 ✅)

- [ ] **H4.1 Risartanos [G] 🗄️** — cadastro completo do colaborador (código
      automático, CPF, nascimento, gênero, estado civil + cônjuge, WhatsApp,
      endereço, foto, "como quer ser chamado", regime CLT/PJ/Estagiário/
      Autônomo); histórico de alterações; auditoria de acessos/ações; vínculo
      com cadastro de cliente (autopreenche; prontuário destaca "é um
      Risartano"). Dividir em 2–3 lotes.
- [ ] **H4.2 Anamnese 2.0 [G] 🗄️** — múltiplas fichas (1 por tipo; atualizar
      não troca o tipo); perguntas obrigatórias; perguntas por gênero
      (pré-requisito: campo gênero no cliente — item adiado entra aqui);
      respostas com opções; campos condicionais; histórico.
- [ ] **H4.3 Protocolo 2.0 + agendamento em série [G] 🗄️** — tempo mínimo
      entre sessões (rede → caso); médias reais do intervalo; previsão de
      conclusão; sugerir as datas de TODAS as sessões ao agendar; Planner
      propõe mudança de protocolo (unidade com confirmação + notificação ao
      coordenador; rede → notifica Admin).
- [x] **H4.4 Tela de Planos de Tratamento** ✅ (v0.11.1).
- [ ] **H4.5 Cockpit 2.0 [G] 🗄️** — redesign; etapas + sessões; sugerir
      profissional; juntar sessões; tempo por/entre sessões; previsão de
      término; alertas/lembretes por sessão e do plano.
- [ ] **H4.6 Módulo do Dentista [G] 🗄️** — dashboard, execução/baixa,
      pendências; histórico do cliente; plano resumido SEM valores; sugestões
      p/ reavaliação (visíveis ao coordenador); pedir revisão do planejamento
      (alerta insistente até resolver).
- [ ] **H4.7 Atendimento conjunto [G] 🗄️** — 2+ profissionais no mesmo
      atendimento (agenda de todos, 1 sala, responsável principal por tipo,
      limite = nº de cadeiras).
- [ ] **H4.8 Planejamento anual da rede [M/G] 🗄️** — feriados/eventos/
      campanhas da franqueadora com flag "decisão travada ou da unidade";
      almoço padrão da rede (cascata).
- [ ] **H4.9 Chat interno [G] 🗄️** — canal da unidade + 1:1; franqueadora ↔
      unidade conectadas; pop-up + som; áudio/arquivos; insiste até visualizar;
      recibo de leitura; histórico. Supabase Realtime; dividir em lotes
      (texto → arquivos → som/insistência).
- [ ] **H4.10 Prontuário em abas + menu fixo [M]** — ficha em abas na sequência
      do fluxo; barra lateral fixa em todas as telas.
- [ ] **H4.11 Apresentação 2.0 + fotos no Gamma [M]** — layout mais rico e
      responsivo; testar fotos no Gamma via links assinados embutidos no texto;
      padrão visual dos decks.
- [ ] **H4.12 Câmera intraoral [M]** — capturar da câmera conectada
      (getUserMedia) e salvar direto no prontuário (bucket clínico).
- [ ] **H4.13 Especialidades + comissionamento [M] 🗄️** — cadastro de
      especialidades (lista padronizada, como o pilar); reajuste em massa do
      comissionamento fixo; regra "comissão só com procedimento finalizado"
      documentada (aplicação = módulo financeiro, Fase 2).
- [ ] **H4.14 Definições de status [P]** — "Início de Tratamento" = plano
      aprovado e nada executado; "Sessão" = já iniciou (consistente em
      agenda/jornada).

## Fora do LOTE H (não esquecer)

| Item | Quando |
|---|---|
| Limpeza dos dados de teste (mantém Admin do dono + catálogo/fichas; backup antes; script avulso, NÃO em migrations/) | Antes de publicar na web (adiado pelo dono) |
| Rodada de refinamento visual (tela por tela, dono guiando) | Depois do LOTE H |
| Fase 2 Comercial: apresentação gravada, ZapSign, ASAAS (regra de ouro), NPS, dashboards com metas | Depois do MVP validado |
| Fase 3: WhatsApp automático, transcrição/resumo por IA | Depois da Fase 2 |
| Adiados antigos: semana começando no domingo; esconder fim de semana vazio; offline/PWA | Encaixar quando fizer sentido |
