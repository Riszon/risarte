# Estado do Projeto — Risarte Odontologia (MVP RIZON)

_Atualizado em: 23/07/2026 · Versão do sistema: **0.114.0** · Última migração: **0156**_

> **MÓDULO COMERCIAL — COM5: Venda direta + ajustes ✅ (v0.114.0, migração
> 0156):** (1) **Venda direta na unidade** (`/comercial/venda-direta`): fluxo
> excepcional (urgência, consulta avulsa, limpeza) — **lista configurável** de
> procedimentos vendáveis (flag `procedures.direct_sale`, Admin configura na
> própria tela); a **Recepção fecha** (pagamento), o **Coordenador lança**
> (procedimento), o **Gerente faz os dois** — nada trava; tudo registrado
> (tabela `direct_sales`, entra nos números). Botão "Venda direta" no funil.
> (2) **Perdido/Cancelado** agora mostram **data e quem** marcou. (3) Na tela
> **Planos de Tratamento**, clientes em **Fase 4/5** ganharam o atalho **"Cockpit
> do Consultor"** (time comercial). (4) O funil abre com o filtro **"Todas"** por
> padrão quando a clínica ativa do Consultor é a Franqueadora.

> **MÓDULO COMERCIAL — Ajustes do funil ✅ (v0.113.0, migração 0155):**
> (1) **Escopo por unidade** — o funil `/comercial` agora mostra por padrão só a
> **unidade logada** (corrige o Gerente ver todas as unidades). O time comercial
> e o Admin têm **filtro** (Todas / unidade específica). (2) **Permissões** —
> Gerente/Franqueado da unidade só **VISUALIZAM** o funil (sem cockpit, sem
> botões); o cartão leva à **ficha**. Só quando o Consultor **libera o follow-up
> para a clínica** é que a unidade ganha a ação de **registrar tentativa** (ajuda
> nos contatos); o **fechamento continua sendo do Consultor**. (3) **Funil** — a
> coluna "Follow-up na clínica" saiu; virou um **indicador** ("Conduzido pela
> clínica") na coluna **Follow-up**. **Cancelados** e **Perdidos** viraram
> **botões** com a lista/detalhe. Sequência: A apresentar → Acontecendo agora →
> Apresentados → Follow-up → Fechamentos → Aguardando iniciar → Tratamento
> iniciado. (4) **Cronômetro** ao vivo em "Acontecendo agora". (5) **Histórico do
> funil** por cliente (`commercial_card_events`) — botão no cockpit. Tabela +
> colunas novas no cartão; RPC `commercial_transfer_followup`; guards
> `commercial_is_team`/`commercial_is_unit`.

> **MÓDULO COMERCIAL — COM4: Fechamento (regra de ouro) ✅ (v0.112.0, migração
> 0154):** quando o cliente aceita, aparece o **painel de Fechamento** (na
> apresentação e no cockpit) com o **resumo que vai no contrato** (valor,
> desconto/acréscimo, pagamento/parcelas, **aprovação parcial** = itens não
> aprovados + motivo, e o **resumo da apresentação** do COM2). Marcação
> **manual-primeiro** de **Contrato assinado** (ZapSign depois) e **Pagamento
> confirmado** (ASAAS depois). **Regra de ouro:** só quando os DOIS estão
> marcados a venda é concluída → o cliente vai à **Fase 5** (Aguardando iniciar
> tratamento) e disparam os avisos: **pop-up FORTE à recepção** (novo
> `TreatmentStartPopup` — falar com o cliente e agendar), **Coordenador**
> (acompanhar o tratamento) e **Gerente** (com o **VALOR** da venda). Quando a
> **1ª sessão** é concluída, o cliente vira **"Em Tratamento"** (já existia) e
> agora o **Consultor é avisado** (sai da sua lista ativa) + Gerente. Tabela
> `commercial_sales`; RPC `commercial_close_step`.

> **MÓDULO COMERCIAL — COM3: Kanban + Follow-up ✅ (v0.111.0, migração 0153):**
> a tela **`/comercial`** virou o **kanban do funil comercial** (10 colunas:
> A apresentar → Acontecendo agora → Apresentados → Follow-up → Fechamentos →
> Aguardando iniciar tratamento → Tratamento iniciado + Follow-up na clínica,
> Cancelado, Perdido). As colunas de fechamento e da Fase 5 são derivadas
> (negociação aceita/jornada); as demais vêm do **cartão** (`commercial_cards`).
> Cada cartão tem menu de ações (iniciar apresentação, marcar apresentado,
> iniciar/registrar follow-up, perder/cancelar com motivo), WhatsApp e atalho ao
> cockpit. **Follow-up com cadência configurável** pelo Admin em
> `/admin/regras-comerciais` (nº de tentativas, intervalo, prazo máximo — cascata
> rede→unidade, `commercial_followup_settings`); cada tentativa é **registrada**
> (`commercial_followup_attempts`, canal + resultado + observações) e, ao esgotar
> as tentativas/prazo, o cliente é **encaminhado à Gerente** (coluna "Follow-up na
> clínica" + notificação). O **histórico do plano** passou a aparecer também no
> painel de negociação (Consultor **e Gerente**, útil ao autorizar). Item
> **"Comercial"** no menu para o time comercial + Gerente.

> **MÓDULO COMERCIAL — COM2: Cockpit do Consultor ✅ (v0.109.0, migração 0151):**
> nova tela **`/comercial/[clientId]`** — a mesa de trabalho do Consultor durante
> a apresentação: cabeçalho com cliente/unidade/fase/pilar/selo Empresarial +
> consultor responsável; botões rápidos **WhatsApp** (conversa pré-preenchida),
> **Apresentação do plano** e **Ficha completa**; painel **Apresentação** com
> link do Meet (abrir em 1 clique), **link da gravação do início ao fim**
> (manual-primeiro: o Meet grava e o consultor cola o link; a transcrição por IA
> pluga aqui depois), **Resumo da apresentação** (vai no contrato do fechamento —
> COM4) e considerações; **Planos do cliente** com a situação de cada um;
> **Pendências** (procedimentos em aberto + revisão/reprovados do controle de
> qualidade); **Situação financeira** (placeholder ASAAS); e o **painel de
> negociação** (o mesmo do COM1) na coluna direita — só na Fase 4. A tela de
> apresentação ganhou o atalho "Cockpit do Consultor". Tabela
> `commercial_presentations` (uma mesa por cliente).

> **Negociação multi-plano + GUT colorida + histórico detalhado ✅ (v0.108.0,
> migração 0150):** (1) no painel de negociação os procedimentos ficam em **ordem
> de prioridade GUT** com as **pílulas oficiais coloridas** (Alta vermelho /
> Média amarelo / Baixa verde — mesmas faixas do Planner). (2) **Marcações por
> plano preservadas**: trocar entre plano principal e secundários não perde o que
> foi assinalado — todas as marcações acompanham a devolução; os **totais** da
> negociação contam só o plano selecionado. (3) **Histórico do plano mais
> detalhado**: registra também **"Plano editado"** (diagnóstico/opções/orçamento)
> com o usuário (no máx. 1 evento por autor a cada 30 min) e a linha mostra
> "por Fulano" em todos os eventos.

> **Fix: Replanejamento visível + selo dos excluídos ✅ (v0.107.1, sem
> migração):** dois furos do teste — (1) a situação do plano só aparecia na lista
> de chips quando havia 2+ planos; agora a **"Situação do plano"** aparece SEMPRE
> acima do editor (chip colorido, ex.: "Replanejamento (devolvido pelo
> Comercial)") e a tela **/planos ganhou o chip/contador "Replanejamento
> (Comercial)"**. (2) o selo "Não aprovado pelo cliente" dependia de o Consultor
> clicar "Salvar negociação" antes de devolver; agora **"Devolver ao
> planejamento" salva a negociação automaticamente antes** — os procedimentos
> assinalados acompanham o plano sempre.

> **Ajustes pós-teste da devolução ✅ (v0.107.0, migração 0149):** (1) **BUG
> corrigido** — negociação só existe com o cliente **na Fase 4**: fora dela o
> painel some e o banco bloqueia (WRONG_PHASE). (2) Procedimento excluído pelo
> cliente na negociação ganha o selo **"Não aprovado pelo cliente (Comercial)"**
> no próprio item do plano (editor e resumo). (3) Nova situação de plano:
> **"Replanejamento (devolvido pelo Comercial)"** — o plano devolvido nunca fica
> "aprovado"; refaz todo o ciclo (elaboração → aprovação do Coordenador →
> Comercial), e ao ser **reaprovado** a nota da devolução é limpa (a história
> fica no histórico do plano). (4) As considerações do Consultor **saíram** das
> "informações complementares do Coordenador" e ganharam **pop-up próprio
> "Devoluções do Comercial"** no cockpit do Planner. 68 testes.

> **Devolução ao planejamento completa + HISTÓRICO por plano ✅ (v0.106.0,
> migração 0148):** correção do feedback do dono — as informações da devolução
> não se perdem mais. (1) Ao devolver (Fase 4→3), o plano aprovado é **reaberto
> automaticamente** (mesmo plano, não um novo) e as **considerações do Consultor
> ficam gravadas NO PLANO**, exibidas num **destaque vermelho** no topo do editor
> (cockpit do Planner / ficha) até o plano ser reaprovado. (2) O Planner recebe
> notificação **"Plano DEVOLVIDO pelo Comercial"** que abre **direto o cockpit**
> (o aviso "Novo caso no Centro de Planejamento" também passou a abrir o
> cockpit). (3) **Histórico próprio por plano** (`treatment_plan_events` +
> gatilho automático): criado → enviado ao Coordenador → aprovado/devolvido →
> enviado ao Comercial → apresentado → aceito → em tratamento → concluído →
> devolvido pelo Comercial (com as considerações) → reaberto — com data e autor,
> visível no botão **"Histórico do plano"** junto ao editor (todas as telas).
> Backfill leve dos planos existentes.

> **MÓDULO COMERCIAL — COM1: Negociação + Regras comerciais ✅ (v0.105.0,
> migração 0147):** início do módulo Comercial (briefing em `docs/COMERCIAL.md`).
> (1) **Regras comerciais em cascata** (`/admin/regras-comerciais`, só Admin):
> desconto máx (%), parcelas máx e meios de pagamento — padrão da rede + ajuste
> por unidade. (2) **Painel de negociação** na tela de apresentação: o Consultor
> escolhe o plano (principal ★ ou secundário aprovado = carta na manga), desmarca
> procedimentos que o cliente não aprovou (**aprovação parcial**, guiada pela
> prioridade **GUT**, com **motivo obrigatório**), aplica desconto/acréscimo,
> define pagamento/parcelas e registra o **principal decisor**. Totais ao vivo.
> (3) **Fora da regra → autorização**: a negociação trava em "aguardando
> autorização", o **Gerente da unidade** é notificado e autoriza/nega na própria
> tela. (4) **"Cliente aceitou"** → notifica o Assistente Comercial (fechamento =
> COM4). (5) **Devolver ao planejamento (4→3)** com considerações obrigatórias
> que chegam ao Planner (nova transição na `move_client_phase`; a 4→5 também
> passou a aceitar o consultor da Franqueadora com escopo). (6) **Alerta ao
> Planner** no cockpit da Fase 3 com os procedimentos não aprovados em negociação
> passada. +12 testes unitários (regras comerciais) — total 67.

> **Testes automatizados — camadas 1 + 2 ✅ (v0.104.0, sem migração):** primeiro
> conjunto de **testes unitários** (Vitest, `npm test`, 55 testes em ~3s) travando
> as regras de negócio puras: matriz "quem move a jornada" (`allowedNextPhases`),
> pilar exibido por fase, SLA estourado, tipos de agendamento por fase (inclui
> REVISÃO/REFAÇÃO sempre disponíveis), máscaras CPF/CNPJ/telefone/CEP, dinheiro em
> centavos (formatar/parsear BRL, total do orçamento, preço em cascata), estágio
> do plano (lifecycle > status), categorias de notificação e cascata de SLA/
> inatividade. **CI no GitHub Actions**: a cada push no `main`, roda testes +
> build na nuvem (aba **Actions** do GitHub mostra ✅/❌). O portão de cada entrega
> agora é `npm run build` + `npm test`. E2E (Playwright + banco de teste) fica
> para a preparação de lançamento.

> **Cockpit — Bloco F: histórico completo em pop-ups ✅ (v0.103.0, sem migração):**
> abaixo do painel de status, uma barra "Histórico:" com 3 botões que abrem
> pop-ups sem sair do cockpit: **Desenvolvimento clínico** (anotações de evolução
> dos dentistas), **Atendimentos** (todos os agendamentos, mais recentes primeiro,
> com tipo/data/profissional/situação) e **Planos** (todos os planos com a situação
> de cada um). Cada botão mostra a contagem. Fecha o Bloco F do cockpit.

> **Cockpit — Bloco A: painel de status do cliente ✅ (v0.102.0, sem migração):**
> no topo do cockpit do Coordenador (`/avaliacao/[clientId]`), abaixo do cartão de
> identidade, um painel de status que fica visível durante toda a consulta:
> **andamento do tratamento (%) com barra**, **procedimentos finalizados × em
> aberto**, **último atendimento**, **próximos agendamentos** (contagem + data do
> próximo), **planos em andamento** e **financeiro** (placeholder "Em breve —
> integração ASAAS", até o módulo financeiro existir).

> **Aba "Sessões & Procedimentos" redesenhada ✅ (v0.101.0, sem migração):** a aba
> virou uma **única lista centrada em procedimentos** (fim da divisão em duas
> visões que confundia). No topo: **resumo compacto** (procedimentos concluídos,
> sessões feitas, qualidade, tempo/previsão) + **chips de status com contagem**
> (Em aberto / Agendados / Sem agendamento / Concluídos / Aprovados / Em revisão /
> Reprovados) que **filtram** a lista, além dos filtros de plano/procedimento/
> dentista. Cada procedimento é um cartão com **selo de estado + selo do controle
> de qualidade**, plano, dentista e progresso; ao expandir, mostra as sessões com
> data/profissional e os botões de **agendar** (por sessão ou várias juntas) e
> **sugerir datas da série** — tudo no mesmo lugar.

> **Bloco único "Sessões & Procedimentos" + agenda pré-carregada ✅ (v0.100.0,
> migração 0146):** (1) **refino da recepção** — a notificação para agendar a
> revisão/refação agora abre a **agenda já com o cliente e o tipo REVISÃO/REFAÇÃO
> selecionados** (link `/agenda?cliente=…&tipo=…`), em vez do prontuário. (2)
> **reformulação estética** da aba: os dois blocos separados (linha do tempo +
> procedimentos) viraram **um único cartão** "Sessões & Procedimentos" com
> **filtros compartilhados** (plano / procedimento / dentista) e uma chave para
> alternar **Linha do tempo × Procedimentos**. Na **linha do tempo** cada sessão
> mostra agora **de qual plano** faz parte (selo) e pode ser **filtrada**. Os
> "Tratamentos finalizados" entram no mesmo cartão. Nada de funcionalidade perdida
> (agendar, sugerir datas, agendar juntas, controle de qualidade continuam).

> **Dentista enxerga a ficha + refino do Coordenador + Planner (replan) ✅ (v0.99.0,
> migração 0145):** (A) **BUG corrigido** — o dentista designado para **revisar/
> refazer** um procedimento (controle de qualidade, Fase 6) não conseguia abrir a
> ficha quando ainda não havia agendamento com ele (caso "indicar outro dentista").
> A RLS agora libera o **dentista executor/indicado** de uma revisão/reprovação —
> a aba **Sessões & Procedimentos** aparece. (B) **Refino** — quando o procedimento
> reaberto é **refinalizado**, o **Coordenador é avisado** para refazer o controle
> de qualidade. (C) **Entrega 4 (Planner)** — procedimento **reprovado → "incluir no
> próximo plano"** agora pede o **motivo da troca** (inviabilidade clínica ×
> falha profissional) e, ao **enviar ao Centro de Planejamento**, leva ao **Planner**
> a lista dos procedimentos + motivo como informação complementar (não duplica).
> _Refino ainda pendente: notificação da recepção abrir a agenda já carregada com o
> tipo REVISÃO/REFAÇÃO automático._

> **Reabrir procedimento (backfill) + indicador insistente ✅ (v0.98.0, migração
> 0144):** (fix) os procedimentos marcados como revisão/reprovado-refazer ANTES da
> lógica de reabertura continuavam "finalizados" — a 0144 **reabre** os já marcados
> (revisão cria a sessão de Revisão; reprovado-refazer reabre as sessões). (Entrega
> 3) **indicador insistente** no topo do prontuário quando há procedimento para
> revisar/refazer — só desaparece quando 100% finalizado e aprovado. O **dentista**
> já vê a aba **Sessões & Procedimentos** (mesmo em Fase 6) para finalizar. _Refino
> pendente: avisar o Coordenador automaticamente ao refinalizar + agenda pré-
> carregada REVISÃO/REFAÇÃO na recepção._

> **Reabrir procedimento na revisão/refação ✅ (v0.97.0, migração 0143):** ao
> marcar **Revisão**, o procedimento volta a **"aberto"** (as sessões antigas ficam
> finalizadas; cria uma **sessão de Revisão** a agendar). Ao marcar **Reprovado →
> refazer**, **todas as sessões + o procedimento** voltam a **"aberto"**. Assim o
> procedimento reaparece como pendente na aba Sessões & Procedimentos e no checklist
> (só volta a avaliar quando refinalizado). Novos **tipos de agendamento REVISÃO e
> REFAÇÃO** (a recepção escolhe ao agendar). _Refino: a notificação abrir a agenda
> já carregada + o tipo automático virão em seguida._

> **Controle de qualidade não trava mais a jornada ✅ (v0.96.1, migração 0142):**
> reformulação — revisão/reprovação **não movem** a fase do cliente e **não
> bloqueiam** o envio ao planejamento (reverte a 0141). O cliente segue a jornada
> como o Coordenador definir, levando as pendências. O botão de qualidade só
> **avisa a recepção**. _Próximas entregas do lote: reabrir procedimento +
> agendamento REVISÃO/REFAÇÃO; aba liberada ao dentista + indicador insistente;
> pendência do Planner (replan). Financeiro adiado (regras registradas)._

> **Refação move para a Fase 5 ✅ (v0.96.0, migração 0141) — Entrega 5:** quando
> há procedimentos para **revisar** ou **reprovados para refazer** (mesmo dentista
> ou outro), o botão do controle de qualidade **"Enviar para refação"** avisa a
> recepção **e move o cliente para a Fase 5 (Início de Tratamento)** para reagendar
> a refação com o profissional escolhido. Se o reprovado for **"incluir no próximo
> plano"**, o cliente **fica na Fase 6** e só vai à Fase 3 quando o Coordenador
> enviar ao Centro de Planejamento. **Prioridade:** havendo refação, o **envio ao
> planejamento fica bloqueado** ("envie primeiro para refação"). O dentista
> indicado recebe a notificação com o prontuário. _Falta: o Planner consumir o item
> marcado p/ replanejar + os dados no envio (marca já existe)._

> **Sessões: complemento + "com sessões" + Tratamentos finalizados ✅ (v0.95.0,
> migração 0140):** (1) **complemento de sessões** — procedimentos incluídos no
> plano DEPOIS do início do tratamento não geravam sessões (função rodava uma vez);
> a `topup_treatment_sessions` gera só as que faltam ao abrir a ficha, então o
> procedimento passa a mostrar suas sessões. (2) o botão **"Com sessões"** agora
> **abre todas** as sessões automaticamente, com colapso individual. (3) **Entrega
> 4 — "Tratamentos finalizados":** quando um plano fica **100% aprovado** no
> controle de qualidade, aparece num card de histórico (nº de procedimentos + data
> da aprovação). _Falta a Entrega 5 (reprovado + outro dentista vê o prontuário
> como tarefa)._

> **Sessões & Procedimentos — centrada em procedimentos ✅ (v0.94.0, sem
> migração):** a aba agora lista **todos os procedimentos** dos planos aprovados
> (inclui os **sem sessão gerada** — corrige o "aparecia 4 de 5"). Cada procedimento
> mostra **de qual plano** faz parte, o **estado** (a agendar / em aberto / agendado
> / finalizado), o **status do controle de qualidade** + motivo, e o **dentista
> executor**. Um **toggle** "Procedimentos × Com sessões" abre as sessões de cada
> procedimento; e há **filtros** por **plano**, **procedimento** (busca) e
> **dentista**. _(Entrega 3 de 5 do lote checklist ↔ Sessões & Procedimentos.)_

> **Checklist — fix "aparecia em aberto" + status na aba Sessões ✅ (v0.93.0, sem
> migração):** (fix) a consulta das sessões no cockpit não desambiguava a FK
> `treatment_sessions ↔ appointments` (PGRST201) e voltava vazia — por isso todo
> procedimento aparecia "em aberto"; corrigido com o nome explícito da FK. **Entrega
> 2:** na aba **Sessões & Procedimentos**, cada procedimento mostra o **status do
> controle de qualidade** (Aprovado / Em revisão / Reprovado) definido pelo
> Coordenador, com o **motivo** (revisão/reprovado) — para o dentista que vai
> revisar/refazer ler.

> **Checklist de qualidade — só avalia finalizados ✅ (v0.92.0, migração 0139):**
> no checklist da reavaliação, **todos** os procedimentos do plano aparecem, mas
> só os **finalizados** (todas as sessões realizadas) podem ser avaliados
> (Aprovado/Revisão/Reprovado). Os **agendados** aparecem como "aguardando
> realização"; os **em aberto** ganham um botão **"Solicitar agendamento"** por
> procedimento (avisa a recepção). O RPC também bloqueia avaliar procedimento não
> finalizado. _(Entrega 1 de 5 do lote de ajustes do checklist ↔ Sessões &
> Procedimentos.)_

> **Checklist de qualidade — resolução de Revisão/Reprovação ✅ (v0.91.0, migração
> 0138):** ao marcar um procedimento como **Revisão** ou **Reprovado**, o motivo é
> **obrigatório**. **Revisão** → volta ao **dentista que executou** (sugerido pelas
> sessões, o Coordenador confirma), que recebe **aviso**; a recepção é chamada para
> agendar. **Reprovado** abre um **popup com 3 opções**: (1) o mesmo dentista refaz,
> (2) indicar outro dentista para refazer, (3) incluir no próximo plano (o Planner
> troca o procedimento). Cada opção dispara os **avisos** certos (executor e/ou
> indicado). No fim do checklist, o botão **"Solicitar agendamento à recepção"**
> avisa a recepção (uma vez). _Falta: levar o item marcado p/ replanejar + dados ao
> Planner no envio ao planejamento._

> **Cockpit do Coordenador — Bloco D: checklist de qualidade ✅ (v0.90.0, migração
> 0137):** na **reavaliação**, o passo 3 (Controle de qualidade) mostra o **último
> plano concluído** procedimento a procedimento; o Coordenador marca cada um como
> **Aprovado / Revisão / Reprovado** (com motivo). Quando o plano fica **100%
> aprovado**, ele é **travado** e não pede mais revisão (fica registrado no plano).
> As revisões/reprovações ficam registradas. _Próximo: painel de status do cliente
> (Bloco A)._

> **Cockpit do Coordenador — anamnese + gravação + Orientações (Admin) ✅ (v0.89.0,
> sem migração):** (1) a **anamnese** agora fica **embutida no passo 2** do roteiro,
> sem sair do cockpit. (2) a **gravação da consulta** virou a **primeira ação**: um
> card no topo ("inicie antes de começar"), logo após o consentimento. (3) nova tela
> **Admin › Orientações** (`/admin/orientacoes`) onde o Admin escreve, **com
> formatação**, as orientações de cada função — começando pelo Coordenador Clínico
> (Avaliação/Reavaliação); o texto aparece para o coordenador no cockpit (botão
> "Orientações", só leitura) e vale para **todas** as avaliações da rede. _Próximo:
> checklist de qualidade da reavaliação (Bloco D) e painel de status (Bloco A)._

> **Cockpit do Coordenador — ferramentas embutidas por passo ✅ (v0.88.0, sem
> migração):** cada passo do roteiro agora abre com a **ferramenta daquele momento
> embutida** — passo 2 = considerações, passo 3 = coleta de fotos/exames/link +
> galeria, passo 7 = gravação, passo 8 = enviar ao planejamento; os demais passos
> são só orientação. No topo da coluna ficam o **consentimento (LGPD)** e, na
> reavaliação, a **rodada atual + "Iniciar reavaliação"**. As peças foram extraídas
> em componentes reutilizáveis (`clinical-tools.tsx` + `clinical-upload.ts`), **sem
> alterar a área Clínico da ficha** (que segue usando a ClinicalSection). _Pendente:
> embutir a anamnese no passo 2 e o checklist de qualidade na reavaliação._

> **Cockpit do Coordenador — reformulação, Bloco B ✅ (v0.86.0→0.87.0, migração
> 0136):** **roteiro guiado** da avaliação/reavaliação. O cockpit detecta se o
> cliente está na **Fase 2 (Avaliação)** ou **Fase 6 (Reavaliação)** e mostra a
> **sequência de 8 passos** correspondente, em blocos **encolhe/expande**, com um
> botão **"Ir para as ferramentas"** que rola até a área de coleta. O roteiro é a
> **estrutura informativa** do fluxo — o coordenador **não preenche nada** nele
> (alguns passos, como o quebra-gelo, só orientam). Há uma **"Orientação da rede"**
> sobre a avaliação/reavaliação, **editável pelo Admin Master** (migração 0136,
> `clinical_guidance`), para o coordenador consultar rápido. Os próximos blocos
> (painel de status, gravação+roteiro, checklist de qualidade) penduram nesta
> espinha. _Adiados por dependência: situação financeira/inadimplência (aguarda
> módulo financeiro) e resumo automático por IA._

> **LOTE Avaliações & Planos — Entrega 4 (parte 4B) ✅ (v0.85.0, sem migração):**
> nova aba **"Desenvolvimento Clínico"** no prontuário, para o **dentista
> executor**: mostra o **plano aprovado** (referência da execução) + a **evolução
> clínica** (anotações do dentista), agora **separada** da aba Clínico (que passa
> a ser só a avaliação do Coordenador). Também: cockpit de avaliação com **rolagem
> independente** das colunas, editor de plano sem repetição de "Diagnóstico", e
> blocos do plano **recolhidos por padrão** na visualização (v0.84.1). _A pedido
> do dono, o refino visual de 4A+4B vem em seguida._

> **LOTE Avaliações & Planos — Entrega 4 (parte 4A) ✅ (v0.84.0, sem migração):**
> **Cockpit do Coordenador Clínico** — tela dedicada `/avaliacao/[cliente]` nos
> moldes do cockpit do Planner, em **2 colunas**: à esquerda o **espaço de
> avaliação** (consentimento, rodadas de avaliação com filtro, galeria de mídia,
> considerações, "Iniciar reavaliação", "Enviar ao Centro de Planejamento"); à
> direita os **planos** para **revisão/aprovação** (aprovar/reprovar por opção),
> em leitura. O Coordenador abre pelo **banner na aba Clínico** e pelo link
> **"Cockpit de avaliação"** no **cartão da Jornada** (Fases Conversão Clínica /
> Reavaliação). _Falta a parte 4B: aba "Desenvolvimento Clínico" do dentista
> executor (execução do plano aprovado)._

> **LOTE Avaliações & Planos — Entrega 3 ✅ (v0.83.0, migração 0135):**
> **avaliações/reavaliações versionadas** (rodadas). Antes, a coleta clínica
> (considerações + fotos/exames) se empilhava no cliente sem separar "quando".
> Agora cada avaliação é uma **rodada datada**: **Avaliação 1**, depois
> **Reavaliação 2**, **3**… Cada consideração e cada mídia entra na **rodada
> aberta**. Um botão **"Iniciar reavaliação"** (Coordenador) fecha a rodada atual
> — que fica **congelada e intacta** — e abre a próxima. Na aba **Clínico** há um
> cabeçalho "Rodada atual", **chips de filtro** por rodada (Todas · Aval. 1 ·
> Reaval. 2…) e uma **etiqueta** da rodada em cada consideração. **Backfill
> seguro:** tudo que já existe virou automaticamente a "Avaliação 1" — nada se
> perde. **Consentimento e anamnese continuam contínuos** (não repetem por
> rodada). _Adiado: agrupar a galeria de mídia por rodada (hoje é filtro) e a
> decisão "reavaliação × novo planejamento" ao fim da Fase 5._

> **LOTE Avaliações & Planos — Entrega 2 ✅ (v0.82.0, migração 0134):** o plano
> agora tem uma **linha do tempo única** (situação). Os 4 status internos
> (planejamento / aguardando aprovação / em revisão / aprovado pelo Coordenador)
> são os **primeiros passos** e um campo novo (`lifecycle`) **continua** depois de
> aprovado: **Aguardando apresentação → Apresentado → Aceito/Reprovado pelo cliente
> → Em tratamento → Concluído** (Cancelado/Suspenso ficam **reservados** — telas nas
> Fases 6/7). O `status` antigo **não muda** (segue guiando a fila e a trava 3→4).
> Cada plano mostra **etiqueta colorida** da situação (na ficha, no cockpit e nos
> chips de seleção); há **botões para avançar** a situação, liberados por papel
> (Planner → apresentação; Comercial → apresentado/aceito/reprovado; Dentista/
> Coordenador/Recepção/Gerente → em tratamento/concluído). Ao **enviar ao Comercial
> (3→4)**, os planos aprovados viram "Aguardando apresentação" **automaticamente**.
> Todo movimento fica registrado (`treatment_plan_status_events`) e o Planner é
> avisado quando o cliente aceita/reprova. _Adiado p/ Fase 5: refletir a nova
> situação também na tela `/planos` (hoje ela deriva da jornada)._

> **LOTE Avaliações & Planos — Entrega 1 ✅ (v0.81.0, sem migração):** fim do bug
> destrutivo + base de vários planos. (1) O prontuário/cockpit **listam TODOS os
> planos** do cliente (`loadClientPlans` + `PlanEditorSwitcher`); nenhum é
> escondido. (2) **Editar plano aprovado deixou de destruir**: saiu o "Reabrir"
> (que rebaixava pra rascunho); no lugar, **"Criar cópia para revisar"** gera um
> plano NOVO copiando o aprovado, que continua intacto. (3) **"Novo plano"** cria
> um plano adicional em branco. (4) `createTreatmentPlan(clientId, copyFromId?)`
> sempre cria novo (com duplicação opcional de opções/itens/etapas). O editor
> **remonta por `key`** ao trocar de plano (sem arrastar texto/auto-save entre
> planos). Próximas fases: status ricos, cockpit do coordenador, avaliações
> versionadas, cancelar/suspender, histórico e KPI.

> **Prontuário — aba Cadastro ✅ (v0.80.10, sem migração):** **Dados do cliente**
> reorganizados em seções (Identificação / Contato / Endereço / Observações) com
> ícone dourado + rótulo pequeno e valor em destaque; **ordem dos blocos** com os
> Dados do cliente **primeiro** e os complementos abaixo (Compartilhamento,
> Empresarial, Responsáveis, Dependentes); **Responsáveis** com avatar de iniciais
> e linha mais limpa; cabeçalhos com ícone. Só visual. (1ª aba da rodada do
> prontuário — vamos aba a aba.)

> **Chat Hub — painel de bloqueados ✅ (v0.80.9, sem migração):** o Admin tem um
> botão **"Bloqueados (N)"** no topo da coluna que abre um diálogo com **todos os
> usuários bloqueados** (nome + data) e **Desbloquear** por linha (action
> `listBlockedChatDetails`).

> **Chat Hub — coluna + grupo/individual ✅ (v0.80.8, sem migração):** a **coluna
> de conversas** ganhou fundo `bg-muted` (nítido, não confunde mais com o fundo da
> tela) e a área de leitura ficou `bg-card` (contraste claro). Na lista, **grupo ×
> individual** ficou evidente: equipe = **avatar navy sólido** + **faixa lateral +
> leve tinta azul** na linha + selo "EQUIPE"; individual = **iniciais em círculo
> branco com borda**.

> **Chat Hub — ajustes ✅ (v0.80.7, migração 0133):** (1) **reação única** por
> usuário/mensagem (clicar em outro emoji troca, não soma). (2) **citação clicável**
> — clicar na mensagem citada rola até a original e a destaca. (3) **Bloqueio no
> chat** (migração 0133 `chat_blocked_users`): só o **Admin Master** bloqueia/
> desbloqueia (no popup de membros); o bloqueado **perde o acesso à tela de Chat**.
> (4) **popup de membros** com botão **"Conversar"** por membro (abre conversa
> direta). (5) **coluna de conversas** com fundo distinto da área de leitura. (6)
> **conversa de equipe** com cor/selo "EQUIPE" (lista, cabeçalho e aviso acima do
> campo "vai para TODA a equipe") — reduz risco de mandar no grupo por engano.

> **Refino visual — Chat Hub ✅ (v0.80.6, sem migração):** cabeçalho com ícone de
> balão; **lista de conversas** repaginada estilo WhatsApp — **avatar em círculo**
> (equipe = ícone de grupo; direta = iniciais), **hora da última mensagem** à
> direita (fuso de São Paulo), prévia + selos de não lidas/importante numa 2ª
> linha; **estado vazio** com ícone e texto amigável. Só camada visual — tempo
> real, envio, anexos, reações e recibos intocados.

> **Refino visual — Notificações ✅ (v0.80.5, sem migração):** cabeçalho com
> **sino** + selo de **não lidas**; chips de categoria com **bolinha de cor** (as
> sem itens ficam escondidas) + chip **"Não lidas"** (filtra o que falta ler, via
> `?naolidas=1`); lista com **ícone da categoria em círculo colorido**, não lidos
> com **bolinha dourada**, e **agrupada por data** (Hoje / Ontem / Esta semana /
> Mais antigas) com hora no fuso de São Paulo (determinístico, sem divergência de
> hidratação). Novo mapa `NOTIFICATION_CATEGORY_DOT` em `src/lib/notifications.ts`.

> **Editor — nova opção por botão + carência ✅ (v0.80.4, sem migração):** o
> formulário de **nova opção de tratamento** virou um **botão "Adicionar opção"**
> (abre só ao clicar). O selo **★ Risarte Empresarial** passou a aparecer na
> **identificação do cliente** (cabeçalho do cockpit). Para o Planner: cada
> procedimento com benefício **em carência** (ou bloqueado) mostra um aviso âmbar
> ("Em carência até DD/MM") e a opção recolhida mostra **"N em carência"**.

> **Editor — opções recolhíveis + Resumo navegável ✅ (v0.80.3, sem migração):**
> cada **opção de tratamento recolhe/expande** (seta no cabeçalho; principal abre,
> alternativas recolhem por padrão). Recolhida, mostra um **resumo**: "Plano
> principal" (se for), **prioridade média**, nº de **procedimentos**, **etapas**,
> **sessões**, **tempo de cadeira**, **valor total** e **economia** (Risarte
> Empresarial). O **Resumo do tratamento** virou **navegável entre todos os planos**
> (setas ‹ ›) e ganhou **nº de procedimentos** + **prioridade média** por plano.

> **Editor — cartões de procedimento + etapas ✅ (v0.80.2, sem migração):** cada
> procedimento virou um **cartão nítido** (borda + fundo) com **faixa lateral
> colorida pela prioridade** (vermelho/âmbar/verde) e layout em linhas (nome+valor /
> prioridade / etapa+profissional). A **criação de etapas** virou uma seção
> **recolhível própria** ("Etapas do tratamento (opcional)"), separada do orçamento;
> os cabeçalhos de etapa nos grupos ficaram em **maiúsculas com ícone dourado**.

> **Cockpit + Editor — reformulação ✅ (v0.80.1, sem nova migração):** (1) **Editor
> de plano vira a área principal** em largura total; Resumo, Atendimentos,
> Evidências, Anamnese e Considerações viram uma **barra de botões que abrem
> pop-up** (`PopupCard`). Anamnese marca alerta no botão. (2) **Diagnóstico e
> objetivos** ficam num bloco **recolher/expandir**. (3) **Adicionar procedimento**
> some atrás de um botão **"+ Procedimento"**. (4) **Confirmação antes de excluir**
> opção/procedimento/etapa (`ConfirmDialog`). (5) **Selo Empresarial** virou linha
> discreta. (6) **GUT**: procedimentos **reordenam por prioridade** (maior no topo);
> cada opção mostra a **prioridade média** (`GutAverageBadge` — soma÷qtd →
> Alta/Média/Baixa + média); o selo aparece também em **Atendimentos e sequência**.
> (7) **Arquivos** (foto/raio-x/PDF/vídeo) **ampliam em tela cheia** (lightbox
> estendido + botão "Ampliar"). Prioridades são só para a equipe (nunca ao cliente).

> **Editor de Plano — GUT + auto-save + hierarquia ✅ (v0.80.0, migração 0132):**
> (A) **Hierarquia visual**: cada seção (Diagnóstico, Objetivos, Considerações,
> Opções) com título de ícone dourado; em leitura o texto do Planner vai num
> **painel próprio** (rótulo em cima), separando "campo" de "conteúdo escrito".
> (B) **Auto-salvamento**: Diagnóstico, Objetivos e Considerações **salvam sozinhos**
> (~1s após parar de digitar) com aviso "Salvando…/Salvo ✓"; sumiram os botões de
> salvar. (C) **Prioridade GUT por procedimento** (migração 0132: colunas
> `gut_gravity/urgency/tendency` em `treatment_plan_option_items`, 1..5, opcionais):
> o Planner define G/U/T por item; o sistema calcula **G×U×T** e mostra um **selo
> Alta/Média/Baixa + número** (cortes Alta≥45, Média 18–44, Baixa 1–17 em
> `src/lib/gut.ts`); selo aparece no editor, no resumo do Coordenador e no Resumo do
> tratamento. Ajuda o Comercial a priorizar numa negociação. (D) **Selo Risarte
> Empresarial no cockpit** (antes só na ficha): mostra o selo do programa + economia
> por opção também para o Planner. Apresentação do Comercial recebe o GUT numa
> rodada futura.

> **Cockpit — blocos recolher/expandir ✅ (v0.79.3, sem migração):** para a tela
> não ficar tão longa, cada bloco vira **recolhível** (clique no cabeçalho: seta
> gira, corpo some). Componente reutilizável `CollapsibleBlock`
> (`src/components/collapsible-block.tsx`). Aplicado em **Resumo do tratamento**,
> **Atendimentos**, **Evidências**, **Anamnese** e **Considerações**. Defaults que
> encurtam a tela: Evidências e Considerações **começam recolhidas** (com contador
> ao lado do título); a **Anamnese abre sozinha só quando há alerta de risco**
> (mostra o nº de alertas); Resumo/Atendimentos/Informações do Coordenador abrem
> normalmente. O **Editor do plano** fica sempre visível (é o trabalho principal).

> **Refino visual — Cockpit de Planejamento ✅ (v0.79.2, sem migração):**
> cabeçalho virou **cartão de identidade** (avatar com iniciais + faixa fina na
> **cor da fase** no topo + código/unidade/Fase/Situação/Pilar em uma linha e ações
> à direita), o alerta de **apresentação marcada** virou cartão de urgência (ícone
> em bolha + data por extenso + cronômetro), o **Resumo do tratamento** trocou as
> tags cinzas por **mini-cards com ícone** (sessões / cadeira / etapas), e as seções
> **Evidências / Anamnese / Considerações** ganharam ícone dourado no título; os
> **alertas da anamnese** ficaram com ícone de atenção. Só camada visual.

> **Cor da fase em todo o sistema ✅ (v0.79.1, sem migração):** componente
> reutilizável **`PhaseBadge`** + helper `phaseTintStyle` (`src/components/
> phase-badge.tsx`) que mostram a fase na **cor oficial suavizada** (fundo levinho
> + texto escurecido da própria cor — menos vivo). Aplicado onde a fase aparece:
> **Ficha** (pílula do cabeçalho + seção Jornada), **Agenda** (card + popup de
> informações), **Retornos**, **Prontuários** (lista), **Planejamento** (cockpit),
> **Planos**, e **Relatórios** (selos numerados + mapa de calor por cor da fase).
> O **kanban** ficou como estava (pedido do dono).

> **Refino visual — Jornada/Kanban ✅ (v0.79.0, sem migração):** cada coluna
> (fase) ganhou o **acento de cor oficial da fase** (definido pelo dono): faixa no
> topo + número tingido na cor. Cores em `PHASE_COLORS` (`src/lib/journey.ts`,
> reutilizável): Aquisição #ff5050, Conversão Clínica #ff914d, Centro de
> Planejamento #ffde59, Conversão Comercial #74cc00, Início de Tratamento #00bf63,
> Reavaliação #0cc0df, Acompanhamento #e2a9f1. O **contador da coluna** fica
> **vermelho com N ⚠** quando há SLA estourado. Filtros (unidade/pilar/status) num
> **bloco compacto**. Cards mantidos.

> **Relatórios — ajustes do feedback ✅ (v0.78.1, sem migração):** (1)
> **Agendamentos** menos "tudo igual": situação vira **barra segmentada** colorida
> (total grande + faixa proporcional por situação + legenda) e tipo/profissional/
> unidade em 3 colunas de barras. (2) **Rede por fase**: virou **mapa de calor**
> (intensidade da célula pela quantidade, via `color-mix` sobre `--primary`) +
> coluna **Total** por unidade + grande total. (3) **Produtividade**: números bem
> **maiores** (text-3xl, ícone ao lado) — corrige "dado pequeno em card grande".

> **Refino visual — Relatórios ✅ (v0.78.0, sem migração):** (1) filtros num
> **bloco compacto** e página em `max-w-6xl`. (2) **Agendamentos**: "por situação"
> com **pontinhos de cor** (paleta da Agenda) e "por tipo/profissional/unidade"
> com **barra de proporção** (`BarRow`) + número. (3) **Rede por fase**: cabeçalho
> com **selo numerado** da fase, zebra, célula 0 esmaecida e **linha Total
> destacada**. (4) **Produtividade**: os 5 números viram **cartões com ícone e cor**
> (aprovados=verde, devolvidos=âmbar, tempo médio=navy; `METRIC_TONE`). Só visual.

> **Atendimento — seletor de unidade + indicadores consolidados (H4.16) ✅
> (v0.77.0, sem migração):** (#4) **Admin** (e quem acessa >1 unidade) escolhe a
> unidade **na própria tela** (seletor `?unidade` no cabeçalho e na tela de
> "selecione uma unidade"), sem depender do menu lateral. (#5) opção **"Todas as
> unidades"** → mostra os **indicadores consolidados** de todas as unidades (o
> painel/sala de espera continua por unidade, com aviso para escolher uma).
> Helper `computeAttendanceMetrics(clinicIds[], scopeProvider, período)` reaproveitado
> para 1 unidade ou o consolidado. Quem tem só 1 unidade (recepção/gerente) segue
> exatamente igual (sem seletor).

> **Indicadores — filtro de profissional + rótulo de escopo (feedback) ✅
> (v0.76.3, sem migração):** (1) o filtro **por profissional** do cabeçalho agora
> também **filtra os indicadores** (antes só filtrava o painel): comparecimento,
> conclusão, tempos, produtividade e as ocorrências/trocas passam a respeitar o
> profissional escolhido (`scopeProviderId`). (2) o popup mostra o **escopo**: "Todos
> os profissionais da unidade" / "Profissional: Fulano" / "Somente os seus
> atendimentos" (dentista). Confirmado: dentista "puro" vê só os **seus**
> atendimentos (por `provider_user_id`); gestão vê todos.

> **Indicadores — visual do popup (feedback) ✅ (v0.76.2, sem migração):** cards
> eram muito parecidos e sobrava um sozinho. Reorganizado em **3 seções**: (1)
> **métricas principais** — Comparecimento (verde) e Taxa de conclusão (navy) com
> **barra de progresso** na cor; (2) **indicadores rápidos** — Espera média /
> Atendimento médio / Produtividade em 3 colunas com ícone; (3) **Ocorrências no
> período** num bloco 2×2 (Faltas/Cancelamentos/Desistências/Trocas) — preenche
> sem card órfão. Diálogo um pouco mais largo (`sm:max-w-xl`). `RateCard` +
> `MiniStat` no lugar do `StatCard`.

> **Indicadores — tirar repetição + 2 métricas (feedback) ✅ (v0.76.1, sem
> migração):** o card "Comparecimento" (% de concluídos) e "Concluídos" (nº)
> diziam o mesmo. Agora: **Comparecimento** = quem **apareceu** (check-in) ÷
> agendados, e **Taxa de conclusão** = **concluídos** ÷ agendados — a diferença
> mostra quem veio mas não concluiu. Adicionado **Tempo médio de atendimento**
> (do "chamar" ao "concluir"), fazendo par com o tempo médio de espera. Removido
> o card "Concluídos" repetido.

> **Atendimento — Indicadores (H4.15) ✅ (v0.76.0, sem migração):** botão
> **"Indicadores"** no cabeçalho abre um popup com os números do **período** (dia/
> semana/mês). **Permissão**: dentista vê só os **seus** atendimentos; Recepção/
> Coordenador/Gerente/Admin veem **todos** (aviso de escopo no popup). Cartões:
> **Comparecimento** (concluídos ÷ agendados), **Produtividade** (sessões
> finalizadas — `treatment_sessions` done no período), **Tempo médio de espera**
> (`called_at − checked_in_at`), **Concluídos/agendados**, e **Faltas /
> Cancelamentos / Desistiu de esperar / Troca de profissional** com **lista de
> clientes ao clicar** (troca mostra de→para, da tabela `appointment_provider_swaps`).
> Componente `attendance-indicators.tsx`; cálculo no `page.tsx`.

> **Atendimento — correções do teste (feedback) ✅ (v0.75.1, sem migração):**
> (1) **card na vertical**: dados em cima, botões numa faixa embaixo (o botão não
> fica mais em cima do texto; texto deixa de ficar amontoado nas colunas estreitas).
> (2) **cada coluna rola sozinha** (`max-h` + `overflow-y-auto` no conteúdo), não
> rola a tela toda. (3) **alerta** dos pendentes bem mais curto. (4) **bug do
> concluir**: ao concluir um atendimento de **dia anterior** (pendente), o card
> sumia — o filtro dos pendentes só pegava `scheduled/confirmed`; agora também
> puxa os **concluídos hoje** (`done_at` de hoje), então ficam na coluna
> Concluídos. O aviso "X pendências" conta só as ainda em aberto.
> **Adiado (recurso novo, a planejar):** botão **Indicadores** (popup com taxa de
> comparecimento, produtividade, tempo médio de espera, faltas/cancelamentos/
> desistências/trocas com lista ao clicar; dentista vê só os seus, recepção/
> coordenador/gerente veem todos).

> **Refino visual — Atendimento (sala de espera) ✅ (v0.75.0, sem migração):**
> (1) as 4 etapas viraram um **quadro de fluxo em 4 colunas** (chegar → espera →
> atendimento → concluídos), lendo da esquerda pra direita (`lg:grid-cols-4`,
> empilha em telas menores). (2) cada coluna com a **cor da etapa**: azul (chegar),
> âmbar (espera), violeta (atendimento), verde (concluídos) — acento no topo do
> cartão, ícone e contador coloridos (`ColumnCard` + config `STAGE`). (3) cartões
> dos clientes ganham **acento lateral** na cor da etapa (pendentes seguem em
> vermelho). (4) filtros num **bloco compacto** e página em `max-w-6xl`.

> **Fix — "pulo" da tela ao trocar de aba (de verdade) ✅ (v0.74.3, sem migração):**
> o `scrollbar-gutter: stable` estava no `html`, mas quem rola é o **`<main>`**
> (o `overflow-x-auto` do main força `overflow-y: auto`, então o main é o
> container de rolagem). Movido o `scrollbar-gutter: stable` para o `<main>` no
> layout — a barra vertical passa a ter espaço reservado sempre e o conteúdo não
> desloca ao trocar de aba (altura diferente entre abas fazia a barra aparecer/
> sumir e empurrar o cartão centralizado). Vale para todas as telas.

> **Ficha + largura geral (feedback do dono) ✅ (v0.74.2, sem migração):**
> (1) **pílulas diferenciadas**: Fase (navy) e **Pilar da metodologia** (dourado,
> NOVO) em destaque; unidade/nascimento/idade neutras mas com **ícone colorido**
> (evita ficarem "todas iguais"). (2) **"pulo" da tela ao trocar de aba/tela**
> resolvido com `scrollbar-gutter: stable` no `html` (reserva sempre o espaço da
> barra). (3) **largura padronizada**: telas de conteúdo/lista que estavam
> estreitas (3xl/4xl) foram para **`max-w-6xl`** (a dimensão da ficha) — admin/
> documentos, admin/sla, agenda/planejamento-anual, agenda/retornos, atendimento,
> meu-dia, minha-agenda, notificacoes. **Formulários focados** (2xl: cadastro,
> usuário, perfil, config da agenda, especialidades) e telas já largas (5xl+)
> ficam como estão; arquivos do **Empresarial** não foram tocados (projeto à parte).

> **Ficha — ajustes do cabeçalho (feedback do dono) ✅ (v0.74.1, sem migração):**
> (1) **barra de rolagem das abas escondida** (continua rolável). (2) ficha **bem
> mais larga** (`max-w-6xl`). (3) **cabeçalho reequilibrado**: identidade + selos
> à esquerda, **ações no topo-direito**, e as **pílulas numa faixa própria** de
> largura total (antes tudo empilhava de um lado). (4) pílulas de **nascimento**
> (`Nasc. dd/mm/aaaa`) e **idade** (`64 anos`, idade detalhada no title). (5)
> **tempo de cliente** entre parênteses na data (ex.: "Cliente desde 10/07/2026
> (há 6 dias)"). Helpers `shortAge` + `clientDuration`.

> **Refino visual — Ficha do cliente/prontuário ✅ (v0.74.0, sem migração):**
> (1) **Cabeçalho vira cartão de identidade**: avatar com iniciais (navy + inicial
> dourada; anel dourado no aniversário), nome + **código** em chip dourado, e
> **unidade / idade / fase da jornada** como **pílulas com ícone** (antes eram
> linhas soltas); selos e botões agrupados (Novo agendamento em destaque);
> **símbolo Risarte** como marca d'água discreta. (2) **Abas com acento dourado**:
> aba ativa com sublinhado dourado + ícone por aba (`prontuario-tabs.tsx`), em vez
> do bloco navy cheio. (3) Ficha **um pouco mais larga** (`max-w-3xl`). Helpers
> `initialsOf` + `PHASE_LABELS` no cabeçalho.

> **Agenda — arrastar: aviso de fim fora do horário ✅ (v0.73.1, sem migração):**
> ao arrastar para um horário que **começa dentro do expediente mas termina no
> almoço ou após o fechamento**, o diálogo de confirmação agora mostra um **aviso
> âmbar** (ex.: "termina após o fechamento (18:00)") — antes o `warn` do servidor
> era descartado no arrastar. Confirmar continua liberado (é aviso, não bloqueio);
> após gravar, o mesmo aviso vai num toast e o profissional é notificado (igual ao
> formulário). Helper `overrunWarning` em `agenda-drag.tsx`.

> **Agenda — arrastar o card p/ reagendar (H4.14) ✅ (v0.73.0, sem migração):**
> arrastar-para-remarcar **suave** (baseado em ponteiro: mouse E toque) nas grades
> **Semana por hora** (arrasta p/ outro dia/horário — antes não tinha) e **Dia por
> sala** (substitui o drag nativo, antes duro e sem confirmação). Um clique curto
> continua abrindo a ficha/informações (só vira arrasto após mover ~5px); o card
> segue o cursor com uma **prévia** e o alvo (dia/sala + horário, encaixe de 15 min)
> aparece com uma linha. Ao soltar, **confirmação rápida** (decisão do dono): mostra
> "de → para" e só grava no **Confirmar** — reusa `updateAppointment`, que valida
> fora do horário / dia fechado / cadeira lotada / conflito e recusa com o motivo.
> Módulo novo `agenda-drag.tsx` (`useCardDrag` + `DragPreview` +
> `RescheduleConfirmDialog`). Só card **futuro** arrasta.

> **Agenda — refino visual Bloco 3 ✅ (v0.72.1, sem migração):** (1) **feriado na
> régua de dias** (DayStrip) agora marca "Feriado" com ícone (antes só mudava de
> cor quando a unidade atendia). (2) ícone do feriado: emoji 🎌 trocado por **ícone
> Flag** (semana + dia). (3) filtros **Salas + Profissional** juntos num **bloco
> compacto** (menos espaço). ~~Adiado: arrastar o card p/ reagendar~~ → **feito na
> v0.73.0** (ver nota do H4.14 acima).

> **Agenda — refino visual Bloco 2 ✅ (v0.72.0, sem migração):** (1) **filtro por
> profissional** (`ProviderFilter`, `?profissional=userId`; filtra por profissional
> responsável; opções = staff com papel clínico/consultor/dentista). (2) botões
> secundários agrupados no menu **"Mais ações"** (`AgendaActionsMenu`: Configurar
> agenda / Planejamento anual / Retornos), deixando **Novo agendamento** em destaque
> e Fechar agenda à parte. (3) **nome do feriado** mais visível na semana (chip
> vermelho no cabeçalho do dia, sem truncar).

> **Agenda — refino visual Bloco 1 ✅ (v0.71.0, sem migração):** (1) **atendimento
> conjunto** agora mostra os **nomes** dos profissionais no bloco (era só "Conjunto
> +N"); `JointBadge` compartilhado. (2) **Situações com cor** no popup do
> agendamento (botões + selo da situação atual: azul/verde/cinza/vermelho/laranja).
> (3) **Barras de rolagem** ainda mais discretas (8px, mais transparentes). (4)
> **Cabeçalho da Agenda** redesenhado: cada info numa "pílula" com ícone (unidade ·
> período · **Semana X/total** · nº salas). **Bloco 2 pendente:** nome do feriado na
> linha do tempo (aguardando print do ponto exato), **filtro por profissional**, e
> agrupar/diferenciar os botões (dropdown "Mais ações").

> **Barras de rolagem refinadas ✅ (v0.70.1, sem migração):** em `globals.css`,
> scrollbars finas, arredondadas e discretas em **todas as telas** (Firefox via
> `scrollbar-width/color`; Chromium/Safari via `::-webkit-scrollbar`), com a cor
> derivada de `--muted-foreground`. **Agenda (cores dos blocos, legibilidade,
> cabeçalho):** pendente — feito com o dono olhando ao vivo (grade densa que não
> renderiza na prévia).

> **Sidebar minimizar/expandir ✅ (v0.70.0, sem migração):** botão de alternar no
> topo da sidebar; minimizada = só ícones (`w-16`), rótulos escondidos com tooltip
> (`title`), badges viram pontinho, trocador de clínica/versão ocultos, avatar/Sair
> compactos. Estado salvo em **cookie** (`risarte_sidebar_collapsed`), lido no layout
> (server) para não "piscar". `ChatNavItem`/`NotificationNavItem` ganharam prop
> `collapsed`.

> **Correção ativo/inativo + refino visual da Jornada ✅ (v0.69.0 · migração 0131):**
> **Bug:** o status ativo/inativo (regra da 0020) só era recalculado pelo cron diário
> (3h) — que pode não estar ligado; mover fase/agendar não atualizava na hora.
> **Fix (0131):** `recompute_client_activity_one(client)` + **gatilhos** — recalcula o
> cliente ao **mudar de fase** (trigger em `clients` OF journey_phase/phase_entered_at)
> e ao **criar/alterar/remover atendimento** (trigger em `appointments`); recálculo
> geral uma vez ao aplicar. **Visual da Jornada:** nº da fase na coluna; cartões com
> cantos suaves + hover + fundo vermelho suave no SLA estourado; **sub-status da
> Fase 5** em badge colorida (âmbar = aguardando iniciar, verde = em tratamento);
> **inativo** com borda tracejada + fundo acinzentado; **quadro com altura fixa** e
> colunas que rolam por dentro (barra horizontal sempre visível). Migração a rodar: **0131**.

> **Ajuste (v0.68.1):** a logomarca completa (texto grande branco) ficou "escrita
> demais"; login e sidebar voltaram ao formato **compacto** — **símbolo em dourado**
> (`RisarteMark` com `text-gold`) + "Risarte Odontologia" ao lado. `RisarteWordmark`
> segue disponível para uso futuro.

> **Rodada de refinamento visual (em andamento, guiada pelo dono):** (5) **Menu
> lateral + Logomarca Risarte** ✅ (v0.68.0) — a **logomarca/símbolo reais** da
> Risarte entraram (arquivos brancos em `public/`: `risarte-logo-branca.png` e
> `risarte-simbolo-branco.png`). Componente `RisarteWordmark`/`RisarteMark` usa a
> arte como **máscara** e pinta na cor atual (`bg-current` ← `text-*`), então a mesma
> arte vira branca (fundo navy), navy ou dourada (fundo claro) sem novo arquivo.
> Aplicado: **login** (logomarca branca no painel; navy no cabeçalho do celular),
> **sidebar** (logomarca branca no topo) e **hero da página inicial** (símbolo como
> marca d'água). Sidebar também ganhou **barra dourada** no item ativo + **avatar**
> do usuário no rodapé. Ver [[risarte-logo-usage]].
> (3) **Página
> inicial** ✅ (v0.67.0) — cabeçalho de boas-vindas (faixa navy + dourado): saudação
> pela hora (fuso SP), data por extenso, monograma do usuário, unidade ativa e selo
> Admin Master; cartões com ícones. Login: rodapé passou de "Sistema Risarte" para
> **"riSZon"**.
> (1) **Login**
> ✅ (v0.66.0) — painel de marca navy + dourado à esquerda (monograma R + tagline),
> cartão de acesso à direita, rodapé com versão; no celular vira coluna única.
> (2) **Base — fonte Geist** ✅ (v0.66.1) — corrigido o mapeamento em `globals.css`
> (`--font-sans`/`--font-heading` apontavam para si mesmos → app usava a fonte padrão
> do navegador); agora usa a **Geist** em todas as telas. Próximas telas a combinar
> com o dono.

> **H4.13 — Excluir especialidade ✅ (v0.65.1 · migração 0130):** na tela de
> Especialidades, além de editar/desativar, agora dá para **excluir**. Ao excluir,
> escolhe-se **mover os procedimentos/Risartanos para outra especialidade** OU
> deixá-los **sem especialidade** (RPC `delete_specialty` cascateia com segurança;
> dedup no array do staff). Migração a rodar: **0130**.

> **H4.13 — Bloco 2: Comissionamento em massa + regra ✅ (v0.65.0, sem migração) —
> H4.13 COMPLETO.** Novo painel **"Comissão em massa"** nos Procedimentos (Admin/
> Planner, modo rede): define **% e/ou R$ fixo** por **Todos / Especialidade / Pilar /
> Selecionados** (campo em branco não altera). Cada mudança fica no histórico do
> procedimento (`setCommissionBulk`). **Regra documentada na tela**: a comissão só é
> contabilizada com o procedimento **finalizado**; o **pagamento** é do **módulo
> financeiro (Fase 2)** — aqui é só o cadastro da regra.

> **H4.13 — Bloco 1: Especialidades gerenciáveis ✅ (v0.64.0 · migração 0129):**
> a especialidade deixou de ser texto livre e virou uma **lista padrão gerenciável**
> (tabela `specialties`, nível da rede, já populada + backfill do que existia). Tela
> nova **"Especialidades"** (a partir de *Procedimentos*, `/procedimentos/especialidades`,
> Admin Master + Dentista Planner): **adicionar · renomear · ativar/desativar ·
> reordenar**. **Renomear cascateia** (RPC `rename_specialty`) para os procedimentos
> e Risartanos que usavam o nome antigo. No **procedimento** a especialidade virou
> **lista suspensa** (mantém valor antigo se houver); no **Risartano** as opções vêm
> da lista ativa; **filtros** usam a lista. **Falta o Bloco 2** (comissionamento em
> massa + regra "comissão só com procedimento finalizado"). Migração a rodar: **0129**.

> **H4.11 — Ajustes do Modo apresentação ✅ (v0.63.1, sem migração):** (1) **tela
> cheia de verdade** (Fullscreen do navegador; sai no Esc/botão, e sair da tela
> cheia fecha o modo); (2) **não corta mais** — cada bloco rola dentro do slide
> (altura fixa + rolagem interna) e **cada foto vira um slide** só dela (imagem
> grande, sem cortar); (3) **seletor de fotos antes de apresentar** (todas/algumas,
> com atalhos "Todas"/"Nenhuma"). `buildSlides("scroll"|"present")` +
> `PhotoPicker` reaproveitado (Gamma e apresentação).

> **H4.11 Apresentação 2.0 — Bloco 2: layout 2.0 + Modo apresentação ✅ (v0.63.0,
> sem migração) — H4.11 COMPLETO.** A apresentação (`/apresentacao/[clientId]`) virou
> um **deck de verdade**: **capa 2.0** (marca Risarte + faixa dourada, nome grande,
> código · unidade · data, pilar em selo); cada bloco vira **slide com moldura**
> (título com acento dourado + **rodapé** com marca, paciente e numeração — também
> no PDF); **proposta com o total num cartão** navy em destaque; **fotos com
> legenda** em grade responsiva (lightbox mantido). **PDF** agora sai **um slide por
> página** + numeração. **Modo apresentação** (botão **"Apresentar"**): tela cheia,
> **um slide por vez**, navega pelas **setas do teclado** (→/espaço avança, ← volta,
> **Esc** sai) e por botões, com contador. Tudo em `presentation-view.tsx`
> (`CoverSlide`/`SlideShell` + array `slides`); **sem migração e sem mexer no Gamma**.

> **H4.11 Apresentação 2.0 — Bloco 1: Fotos no Gamma ✅ (v0.62.0, sem migração):**
> as **fotos/exames do paciente agora vão automáticas pro deck do Gamma**. Antes o
> app enviava `imageOptions: noImages`, que **apagava** as imagens embutidas —
> confirmado em teste real na API do Gamma. Agora, quando há fotos, usa
> `webAllImages` + instrução "usar só as imagens fornecidas": o Gamma **preserva só
> as nossas fotos** (sem imagem genérica) e **copia cada uma pro CDN dele** no
> momento da geração — por isso o link assinado (1h) basta e nada de paciente fica
> exposto depois (LGPD ok). Card **"Imagens e exames"** embutido em `buildInputText`.
> Na tela, ao clicar **"Gerar no Gamma"** aparece um **seletor de fotos** (todas
> marcadas por padrão; dá pra desmarcar) e depois **"Gerar deck (N fotos)"**.
> `generateGammaDeck(clientId, photoIds?)`. **Falta o Bloco 2** (layout 2.0 mais
> rico/responsivo da tela + PDF). Requer a `GAMMA_API_KEY` na Vercel pra usar o botão.

> **H4.9 Chat Hub — Lote 3 ✅ (v0.61.0 · migração 0128) — H4.9 COMPLETO.**
> **Insistência até visualizar:** quem envia pode marcar a mensagem como
> **importante** (botão ⚠️ no compositor → a bolha ganha o selo "Importante").
> Enquanto o destinatário não abrir a conversa: (1) **faixa fixa** no topo do
> Chat ("Você tem N importantes não lidas — Ver" pula pra conversa) + **marcador
> âmbar** no canal na lista; (2) **reaviso insistente** em qualquer tela — som
> duplo + pop-up **a cada 60s** (fora do /chat, onde a faixa avisa). Para na hora
> que ele abre a conversa (marca como lida). Coluna `chat_messages.important` +
> RPCs `chat_important_unread()` / `chat_important_unread_total()`. Migração a
> rodar: **0128**. **H4.9 fechado (Lote 1 + R1–R4 + Lote 2 + Lote 3; 0120–0128).**

> **H4.9 Chat Hub — Lote 2 ✅ (v0.60.0 · migração 0127):** **anexos** no chat —
> **arquivo** (clipe → escolhe o arquivo) e **gravar áudio** (microfone). Bucket
> privado `chat-media` (caminho `<channel_id>/<uuid>-nome`, link assinado 1h,
> policies por acesso ao canal); coluna de anexo em `chat_messages` (path/name/
> type/kind); `body` deixou de ser obrigatório (mensagem só com anexo). Render por
> tipo: **imagem** (miniatura clicável), **áudio** (player) e **arquivo** (link com
> baixar). `sendAttachment` + `getMessages` assina os links. Máx. 25 MB. **Falta o
> Lote 3** (insistência até visualizar) — e o H4.9 fecha. Migração a rodar: **0127**.

> **H4.9 Chat Hub — R4b ✅ (v0.59.0 · migração 0126) — H4.9 COMPLETO até o Lote 1.**
> **Configurar quem conversa com quem** (unidade ↔ franqueadora) por função:
> tabela `chat_contact_rules` (par franqueadora×unidade, ausência = permitido);
> tela do Admin **`/admin/chat`** (matriz de funções, salva automático). A trava
> entra em `ensure_direct_chat_channel` (via `chat_can_dm`) e o seletor "Nova"
> respeita a config (`chat_contacts` — inclui contatos cross-nível permitidos;
> mesma unidade sempre; Admin fala com todos). **H4.9 restante:** **Lote 2**
> (áudio/arquivos) e **Lote 3** (insistência até visualizar). Migração a rodar:
> **0126** (todas do Chat Hub: 0120–0126).

> **H4.9 Chat Hub — R4a ✅ (v0.58.0, sem migração nova):** **Admin/franqueadora →
> unidade específica.** No painel "Nova", quem tem escopo de rede vê a seção
> **"Enviar para uma unidade"** (Admin = todas as unidades; franqueadora = as do
> seu escopo — `listReachableUnits`). Por unidade: **"Chat da equipe"** (abre o
> canal da equipe — `openUnitChannel`) ou **"Individual"** (a mesma mensagem vai
> como conversa direta para **cada membro** — `broadcastToUnitMembers`, via
> `chat_channel_people` + `ensure_direct_chat_channel`). **Falta o R4b:** configurar
> **quem conversa com quem** entre unidade ↔ franqueadora (por função). Depois:
> **Lote 2** (áudio/arquivos) e **Lote 3** (insistência até visualizar).

> **H4.9 Chat Hub — R3 ✅ (v0.57.0 · migração 0125):** **reagir** a uma mensagem
> (emoji — `chat_reactions`, chips com contagem, tempo real) e **responder** uma
> mensagem específica (`chat_messages.reply_to` — citação com autor + trecho acima
> da resposta). Ações no hover de cada balão (reagir/responder); prévia de
> "respondendo" no compositor. `getMessages` agora traz reações + citação + nomes
> por RPC. **Correções pós-R2 (0124 + código):** RLS de `chat_reads` liberada p/
> ler a marca do outro (recibo **Lida** azul funciona) + realtime; `touch_presence`
> passou a disparar (`.then`) → "visto por último" funciona; unread conta a MINHA
> marca (fim do "2" fantasma). **Faltam:** R4 (Admin → unidade específica + config
> de contato unidade↔franqueadora), depois **Lote 2** (áudio/arquivos) e **Lote 3**
> (insistência até visualizar). Migrações a rodar: **0121–0125**.

> **H4.9 Chat Hub — Correções R2 ✅ (v0.56.0 · migração 0123):** (1) **recibos**
> agora comparam **por data** (timestamp banco `+00:00` × JS `Z` quebrava a
> comparação por texto) → **Lida** fica azul e **Entregue** não volta pra Enviada;
> (2) **nomes**: mensagens de quem é da franqueadora (Admin/Planner) apareciam
> como "colega"/sem nome porque a RLS de `profiles` barra → agora via RPC
> `chat_channel_people`/`chat_display_names` (SECURITY DEFINER, só p/ membros do
> canal); (3) **presença 3 estados**: online (verde) / **ausente** (âmbar, após 5
> min parado) / offline (**"visto por último"**, `getLastSeen` atualiza a cada 12s);
> (4) **carregamento mais rápido** (consultas por canal em paralelo); (5) dot de
> presença **na lista de contatos**; (6) **"Ver membros"** da equipe; (7) **busca**
> de pessoa/unidade e **filtro** de conversas; (8) **contagem online/ausente/offline
> para o Admin**. **Faltam:** R3 (reagir + responder mensagem), R4 (Admin → unidade
> específica + config de contato unidade↔franqueadora), depois **Lote 2** e **3**.
> Migração a rodar: **0123**.

> **H4.9 Chat Hub — Refinamentos R2 ✅ (v0.55.0 · migração 0122):** **presença** —
> **online agora** (bolinha verde) via Supabase Realtime Presence (canal
> "online-users"; o item do menu marca o usuário e faz ping) + **"visto por
> último"** persistido em `user_presence` (`touch_presence` a cada 60s). **Recibos**
> nas minhas mensagens: **✓ Enviada** → **✓✓ Entregue** (o outro está online ou foi
> visto após) → **✓✓ Lida** (azul, leu após). Cabeçalho da conversa direta mostra
> "online agora"/"visto por último…". `getChannelPeople` traz `lastSeenAt`. **Faltam:**
> R3 (reagir + responder mensagem), R4 (Admin → unidade específica + config de
> contato unidade↔franqueadora), depois **Lote 2** (áudio/arquivos) e **Lote 3**.
> Migração a rodar: **0122**.

> **H4.9 Chat Hub — Refinamentos R1 ✅ (v0.54.0 · migração 0121):** corrigido o
> **contador fantasma** (Admin/franqueadora mostravam dezenas de "não lidas" sem
> mensagens) — badge e lista agora usam o MESMO conjunto (`chat_my_channel_ids`):
> minhas equipes (todas as unidades onde tenho função) + escopo da franqueadora
> (exceto Admin) + diretos + já abertos. **Todas as equipes aparecem** mesmo logado
> em outra unidade. Cada mensagem/cabeçalho mostra **nome** (**"Você"** nas minhas),
> **função + unidade** e **foto** (bucket staff-photos; leitura liberada a
> autenticados). `getChannelPeople` (nome/função/unidade/foto assinada). **Faltam:**
> R2 (presença online + "visto por último" + entregue/lida), R3 (reagir + responder
> mensagem), R4 (Admin → unidade específica + config de contato unidade↔
> franqueadora). Migração a rodar: **0121**.

> **H4.9 Chat interno ("Chat Hub") — Lote 1 (texto) ✅ (v0.53.0 · migração 0120):**
> conversas internas da equipe em **/chat**. **Canal da unidade** (todos com acesso
> à unidade ativa) + **mensagens diretas 1:1**; a franqueadora fica conectada às
> unidades (vê/participa dos canais das unidades pelo escopo pleno). **Tempo real**
> via Supabase Realtime (a publicação é ligada na própria migração). **Badge de não
> lidas** no menu + **pop-up + som** quando chega mensagem (na tela do chat, o
> próprio Chat Hub cuida; fora dela, o item do menu). **Recibo de leitura** (visto)
> e **histórico**. Tabelas `chat_channels`/`chat_channel_members`/`chat_messages`/
> `chat_reads`; RLS por `can_access_chat_channel`; criação por RPC
> (`ensure_unit_chat_channel`/`ensure_direct_chat_channel`); badge por
> `chat_unread_total`. **Falta Lote 2** (áudio/arquivos) e **Lote 3** (insistência
> até visualizar). Migração a rodar: **0120**.

> **H4.8 Planejamento anual da REDE — COMPLETO (Blocos 1 e 2).** **Bloco 1
> (v0.51.0 · migração 0118):** a franqueadora define um calendário que vale para
> **todas** as unidades. Itens da rede = `agenda_plan_items` com `clinic_id NULL` +
> coluna `locked` (trava) + novo tipo `campaign` (informativo, não fecha). Em
> `/agenda/planejamento-anual` a franqueadora cria/edita (RPCs
> `create/update/delete_network_plan_item`, guarda `can_manage_network_plan` =
> Admin ou gestor da franqueadora). Cada item desce para a agenda de todas as
> unidades e bloqueia conforme a trava: **travado** = a unidade não abre por cima;
> **decisão da unidade** = pode liberar um dia avulso; **campanha** = só aviso. A
> tela de planejamento da unidade mostra o calendário da rede em leitura;
> `checkAgendaRules`/`day-strip`/agenda incluem os itens da rede. **Bloco 2
> (v0.52.0 · migração 0119):** **almoço padrão da rede** — a franqueadora define em
> `/agenda/configuracao` (linha `clinic_id NULL` de `clinic_agenda_settings`,
> `saveNetworkLunch`; a policy de escrita foi ampliada para permitir a linha NULL a
> quem gerencia a rede); a unidade herda por cascata e pode personalizar o próprio
> (o editor da unidade mostra o padrão da rede como referência). Migrações a rodar:
> **0118 e 0119**.

> **H4.7 Atendimento conjunto — COMPLETO (Blocos 1 e 2).** Um atendimento pode
> ter 2+ profissionais (cirurgia com auxiliar, 2 especialistas). **Bloco 1 (v0.49.0
> · migração 0116):** continua o **responsável principal** (pelo tipo); no
> agendamento há o campo **"Outros profissionais neste atendimento"**
> (dentistas/coordenadores da unidade, menos o principal); uma sala só; o **limite**
> de profissionais = **nº de cadeiras** da unidade; cada incluído recebe **aviso**
> (`notify_appointment_participants`); o detalhe do agendamento mostra o
> "Atendimento conjunto". Tabela `appointment_participants` + RLS. **Bloco 2 (v0.50.0
> · migração 0117):** o conjunto aparece na agenda de **TODOS** os participantes —
> na **Minha Agenda** do dentista (`provider_multi_unit_agenda` reescrita: traz
> também onde ele é adicional, com selo e papel) e nos **cards da agenda** (selo
> "Conjunto +N"); **aviso suave** se um profissional adicional já estiver ocupado no
> horário (`checkParticipantsBusy`, mesma unidade). Migrações a rodar: **0116 e 0117**.

> **H4.6 Bloco E — agenda multi-unidade (em andamento):** **E1 ✅ (v0.45.0,
> migração 0112)** — dias de atendimento do dentista por unidade (dias da semana
> + datas), no cadastro do Risartano (`staff_clinic_schedule`). **E2 ✅ (0113):**
> aviso de conflito entre unidades no agendamento (Recepção vê aviso vermelho;
> dentista é notificado). **E3 ✅ (0114):** agenda consolidada multi-unidade do
> dentista (`/minha-agenda`, cor por unidade). **E4 ✅ (0115):** aviso da próxima
> semana no fim de semana (aponta p/ Minha Agenda). **Bloco E e o H4.6 (Módulo do
> Dentista) COMPLETOS.**

> **H4.10 / H4.12 / H4.14 ✅ (paralelos ao teste do H4.6):** H4.14 (0110) status
> "Em Tratamento" automático na 1ª baixa; H4.10 (0.43.0) ficha em abas + barra
> lateral fixa; H4.12 (0111) câmera intraoral (captura → prontuário, Coordenador
> e Dentista). Migrações a rodar: **0110 e 0111**.

> **MÓDULO RISARTE EMPRESARIAL — CONSTRUÍDO (Fases 0–8, aguardando teste do dono).**
> Camada B2B (empresas parceiras → colaboradores viram clientes da Jornada), schema
> próprio `empresarial`. Plano aprovado 10/07/2026 (`docs/risarte-empresarial/`).
> Migrações **0096–0103**. Roteiro de teste: `docs/risarte-empresarial/ROTEIRO-TESTE.md`.
>
> - **Fase 0** — fundação: schema + 11 tabelas + RLS + papel `rislife_consultant` (0096–0097).
> - **Fase 1** — cadastros: menu Empresarial; empresas (KPIs/filtros); tela em abas;
>   colaboradores + dependentes; **ponte colaborador→cliente** por CPF (`complete_employee`/
>   `link_dependent`, copia `clinic_id`); **selo** na ficha (0098); import Excel; saída.
> - **Fase 2** — benefícios/preços: config da rede (`/empresarial/configuracoes`) +
>   override por empresa (aba Plano); **motor de benefícios** (cobertura/desconto/
>   frequência/limite/carência/parcelamento); mensalidade + simulador.
> - **Fase 3** — orçamento com benefício: `benefits.ts` (carência/frequência/limite);
>   valor cheio × com programa na ficha; registro de uso ao concluir sessão (0099).
> - **Fase 6** — comercial: funil kanban (`/empresarial/funil`) + linha do tempo +
>   "Hoje do consultor" + fechar→cria empresa; papel RisLife com RLS (0100).
> - **Fase 7** — dashboards: painel do cliente (uso/economia) na ficha; painel
>   consolidado (`/empresarial/painel`); economia por empresa na aba Financeiro.
> - **Fase 8** — Riso+ Social (aba, gatilhos, regra integral/parcial/nenhum) +
>   retenção 5 anos/anonimização (`run_retention`, cron) (0101).
> - **Fase 4** — financeiro/ASAAS: cobrança + split (`settle_billing`) + inadimplência
>   (`mark_overdue_and_suspend`, suspende + bloqueia benefícios); webhook idempotente
>   + Edge Function `asaas-webhook`; **pronto para plugar** `ASAAS_API_KEY` (0102).
> - **Fase 5** — contratos/ZapSign + proposta Gamma: aba Contratos; `zapsign.ts` +
>   Edge Function `zapsign-webhook`; proposta via Gamma (reusa a integração) (0103).
>
> **Pendências do dono:** aplicar **0096→0103** em ordem no SQL Editor + **Settings →
> API → Exposed schemas → `empresarial`**. Para ligar ASAAS/ZapSign/Gamma: cadastrar
> as chaves (`ASAAS_API_KEY`, `ZAPSIGN_API_TOKEN`, `GAMMA_API_KEY`) e fazer deploy das
> Edge Functions. Detalhe do motor de benefícios em `ADENDO-01-motor-de-beneficios.md`.

> **H4.5 Cockpit 2.0 — COMPLETO (Grupo 4).** Lotes 1–5: etapas; linha do tempo +
> resumo (previsto×realizado); sugerir profissional por sessão; juntar sessões
> (na Fase 5 e no planejamento, sessão a sessão, com tempo/sequência/profissional
> editáveis no cockpit); alertas/lembretes (selos + notificações à Recepção).
> Migrações 0087–0095. **Falta só o Pedido 3 do dono** (baixa parcial das sessões
> pelo dentista executor), combinado para o **H4.6**. Detalhe em `docs/ROADMAP.md`
> (fonte da verdade). Próximo: **H4.6 (Módulo do Dentista)**.

> **H4.6 Módulo do Dentista — EM ANDAMENTO.** Plano detalhado aprovado (10/07):
> a "casa" do dentista em blocos **A1 → A2 → A3 → B1/B2 → B3 → C → D → E** (E =
> agenda multi-unidade, item próprio depois). **A1 — Baixa parcial das sessões
> ✅ (v0.35.0, migração 0105):** ao concluir um atendimento COM sessões, abre "O
> que foi feito hoje?"; só o Dentista/Admin confirma o que foi feito; as
> confirmadas são liquidadas (tempo real rateado só entre elas), as não feitas
> voltam para "a agendar" (motivo opcional) e a Recepção é avisada
> (`conclude_attendance_partial`). **A2 — Desenvolvimento Clínico ✅ (v0.36.0,
> migração 0106):** no prontuário, o Dentista escreve as anotações do atendimento
> com salvamento automático ("Salvo às HH:MM"); as anotações viram uma linha do
> tempo (autor + unidade + data) visível a dentistas/Coordenador/Planner
> (`clinical_progress_notes`, append-only). **A3 — Procedimentos do cliente ✅
> (v0.37.0, migração 0107):** seção "Procedimentos" agrupando as sessões em Em
> aberto / Agendados / Finalizados; o Dentista tem o botão "Solicitar agendamento
> à Recepção" (`request_session_scheduling`, notifica a Recepção). **B1/B2 ✅
> (v0.38.0, sem migração):** rota `/meu-dia` (Hoje / Próximos / procedimentos em
> aberto do dentista); prontuário do dentista restrito aos seus pacientes (RLS +
> mensagem amigável `isDentistRestricted`); plano resumido SEM valores
> (`plan-summary-section`). **B3 ✅ (v0.39.0, sem migração):** bloco "Minha
> produção" na tela Meu Dia (filtro de período): concluídos, sessões finalizadas,
> tempo em cadeira realizado × previsto, espera média, em aberto, futuros, NPS
> ("ainda não disponível"). **Bloco B completo.** **Bloco C — Documentos ✅
> (v0.40.0, migração 0108):** o Dentista/Coordenador emite prescrição, atestado,
> declaração e orientações no prontuário (com modelos), e imprime/salva em PDF
> (`/documentos/[id]/imprimir`); modelos da rede geridos em `/admin/documentos`
> (franqueadora). Sem assinatura digital/envio (adiado). **Bloco D — Falar com
> quem planeja ✅ (v0.41.0, migração 0109):** seção "Pedidos ao coordenador"
> (sugerir reavaliação / pedir revisão do plano com alerta insistente + anexos);
> o Coordenador resolve (`clinical_requests`/`clinical_request_media` + RPCs).
> **H4.6 (Módulo do Dentista) COMPLETO** nos blocos A–D. **Falta:** o Bloco E
> (agenda multi-unidade, item próprio depois) e o **teste geral detalhado do
> H4.6** pedido pelo dono.

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

Migrações **0001–0045** escritas; **0001–0043 aplicadas**; **0044–0045 pendentes**.

## 2. O que está em andamento agora

**LOTE G — Agenda (em curso).** Entregue e aguardando teste do dono:
- **G1 — Salas + configuração na unidade:** nova tabela `clinic_rooms` (salas com
  nome por unidade), sala do Coordenador Clínico em `clinic_agenda_settings`,
  configuração da agenda liberada para a **Gerente de Unidade** (RLS + tela em
  `/agenda/configuracao`), e contagem de salas exibida na agenda. Migração 0044.
- **G2 — Agendar com sala:** agendamento passa a ter **sala** (`appointments.room_id`)
  e marca **ONLINE** (`is_online`) para apresentação comercial; regra de ocupação
  **por sala** (uma sala = um cliente por vez); o horário só oferece os **slots
  configurados** (15 min, dentro do funcionamento e dias abertos); encaixe
  (urgência/emergência) livre; sala/ONLINE aparece no **card**; sala padrão do
  Coordenador em avaliação/reavaliação. Migração 0045.

- **G3.1 — Grade de tempo + salas:** visão **Dia** vira grade com **colunas por
  sala** (+ coluna ONLINE / "Sem sala" quando houver) e **régua de tempo** lateral
  (hora + tiques de 15 min); **filtro de salas** por chips (`?salas=id,id,online`,
  vazio = todas) que vale para Dia/Semana/Mês (`day-room-grid.tsx`,
  `room-filter.tsx`). Sem nova migração.
- **G3.2 — Agendamento rápido:** clicar num espaço vazio de uma sala (visão Dia)
  abre o formulário já com **sala + data + horário** preenchidos; o formulário
  ganhou abertura controlada + valores iniciais. Sem nova migração.
- **G3.3 — Arrastar para remarcar:** card **futuro** pode ser arrastado para
  outro horário/sala na visão Dia (chama `updateAppointment`, mantendo duração).
  Filtro de salas agora **preservado** ao trocar de visão/navegar (`agendaHref`
  leva `salas`); mensagem da grade orienta quando não há apresentação ONLINE no
  dia. Sem nova migração.

- **G4 — Fechar agenda:** tabela `agenda_closures` (+ salas/profissionais) e
  `appointments.needs_reschedule`. Botão "Fechar agenda" (Recepção/Gerente/Admin)
  bloqueia período por **unidade / salas / profissionais** (motivo: pessoal,
  evento, manutenção, treinamento) via RPCs SECURITY DEFINER `create_agenda_closure`
  / `delete_agenda_closure`. Bloqueia novos agendamentos **inclusive encaixe**;
  agendamentos existentes no período são **sinalizados** (ícone de alerta no card)
  e geram **notificação** (categoria "Agenda") para a recepção remarcar; remarcar
  com sucesso limpa o alerta. Faixas de fechamento aparecem na visão Dia + banner
  com remover. Migração 0046.

Decisões do dono na G4: Recepção+Gerente+Admin fecham; fechamento bloqueia todos
(inclusive encaixe); afetados são sinalizados (sem cancelamento automático).

- **G5 — Dias de atendimento, feriados e dia avulso:** a agenda mostra **só os
  dias configurados** (Semana esconde dias sem atendimento; Dia mostra aviso
  "não atende"). **Liberar dia avulso** na Configurar agenda (uma ou várias
  datas + escalar quem atende, que recebe notificação) — tabela `agenda_open_days`
  (+ staff). **Feriados nacionais** (fixos + móveis via Páscoa, `lib/holidays.ts`)
  marcados na agenda; a Gerente **confirma** (haverá atendimento? Sim/Não →
  `clinic_holiday_decisions`) e recebe **notificação** de feriados próximos
  pendentes (`notify_pending_holidays`, idempotente). Feriado "não atende"
  bloqueia novos agendamentos; pendente apenas avisa (decisão do dono). RPCs
  `open_special_days`/`remove_special_day`/`decide_holiday`. Migração 0047.

- **G6 — Retornos e controles:** rota `/agenda/retornos` (botão na agenda, para
  Recepção/Gerente/Admin) — lista os **retornos e controles agendados** (tipos
  Retorno/Reavaliação no futuro) e os clientes em **Acompanhamento/Reavaliação
  sem agendamento futuro** ("a lembrar de reagendar", com última visita e botão
  Agendar). Sem nova migração.

**LOTE G (Agenda) COMPLETO (G1–G6).** Migrações do Lote G: **0044–0047**.

**Refinamentos da Agenda — GR1+GR2+GR5 entregues (sem migração, v0.8.0):**
- **GR1 — Agendamento inteligente:** duração mín. 15 min; **próximos horários
  disponíveis** (`getNextAvailableSlots`, 3 + "ver mais", clique confirma) por
  tipo/duração/profissional/sala respeitando dias/horários/feriados/fechamentos/
  ocupação; **"Ver agenda"** virou pop-up de mês com contagem por dia
  (`agenda-peek-dialog`, `getMonthDayCounts`) — clicar no dia preenche a data.
- **GR2 — Cards e arrastar:** ícone **i** no card abre detalhes em leitura
  (`appointment-info-dialog`); ao **arrastar** mostra o horário-alvo; visão
  **Semana** virou **grade de tempo** com régua hora/15min (`week-time-grid`,
  dias em colunas, só dias de atendimento).
- **GR5 — Retornos:** "a lembrar" mostra **dias sem atendimento** com cores/ícones
  pela inatividade do SLA (`resolveInactivity`), **ordenação** (padrão maior
  tempo primeiro) e **quem atendeu por último**.

- **GR3 — Fechamento de agenda (refino, migração 0048):** seletor de data+hora
  igual ao agendamento; **não permite período passado**; **editar** fechamento
  (`update_agenda_closure` com confirmação + histórico antes/depois em
  `agenda_closure_history` + recalcula afetados + notifica); **confirmar** antes
  de remover (`closure-controls`); clicar em área fechada **não abre** agendamento
  — só **aviso** (toast) com motivo e até quando; **ícones de fechamento** na
  Semana (`week-time-grid`) e no Mês (`month-grid`); feriados/dias avulsos também
  marcados no Mês.

- **GR4 — Dia avulso + almoço (migração 0049):** dia avulso ganha **horário de
  início/fim** (selects); **carimbo** (quem/quando liberou + antecedência do
  aviso); **editar** dias futuros (`update_special_day` com histórico
  `agenda_open_day_history` + notifica envolvidos), passados viram **histórico**
  (não edita/remove — bloqueado no RPC); botão **"Ver"** o dia na agenda;
  **horário de almoço** na config (`saveLunchBreak` + colunas em
  `clinic_agenda_settings`) bloqueia agendamento normal no almoço (encaixe livre)
  e aparece como **faixa "Almoço"** no Dia e na Semana; dia avulso em **destaque**
  no Dia/Semana/Mês. Admin Master também faz tudo (RPCs e telas liberadas).

- **GR6 — Planejamento Anual de Atendimento (migração 0050):** tela
  `/agenda/planejamento-anual` (Gerente/Admin) com seletor de ano, **resumo**
  (dias trabalháveis, horas estimadas, contadores por tipo, feriados
  trabalha/fecha/a-decidir), **visão dos 12 meses**, **confirmar feriados** ali,
  e **itens** (`agenda_plan_items`): Recesso, Férias coletivas, Férias
  individuais, Evento, Treinamento, Manutenção — com período, pessoas (férias
  individuais), histórico (`agenda_plan_item_history`) e notificação. Itens
  **fecham a agenda** no período (individuais = só as pessoas), inclusive
  encaixe; um **dia avulso** liberado passa por cima. Só edita/remove futuro.
  Marcação na agenda Dia (banner)/Semana/Mês. RPCs create/update/delete_plan_item.

**Refinamentos GR1–GR6 COMPLETOS.**

- **LOTE H — Cronômetros do Atendimento (sem migração, v0.8.4):** o painel
  `/atendimento` agora tem cronômetros **em tempo real** (tick a cada segundo,
  `attendance-panel.tsx`): **A chegar** liga cronômetro de **atraso** a partir do
  horário se não houve check-in; **Em espera** mostra **há quanto tempo** espera
  (desde o check-in) + se **chegou adiantado/atrasado** e a hora do check-in;
  **Em atendimento** mostra **há quanto tempo** está em atendimento (desde a
  chamada); **Concluído** mostra só o **horário de conclusão** + durações. Usa os
  carimbos já existentes (`checked_in_at`/`called_at`/`done_at`).

**LOTE PRONTUÁRIOS — em curso.**
- **P1 — Renomear + abas (sem migração, v0.8.5):** "Clientes" virou **Prontuários**
  no menu e nos títulos; a **rota** mudou de `/clientes` para `/prontuarios`
  (pasta renomeada + redirecionamento no `next.config.ts` para os links antigos
  não darem 404). A lista virou **abas** (usuário de unidade): **Ativos** (lista +
  filtros + aviso de início de tratamento), **Aniversariantes** (Hoje / Esta
  semana = próximos 7 dias / Este mês, com idade e telefone — `src/lib/birthdays.ts`),
  **Transferidos** e **Compartilhados** (antes eram blocos soltos no rodapé). O
  aviso automático de aniversário para a Recepção é a P2. Franqueadora segue com
  a visão de rede (sem abas de unidade). Sem nova migração.

- **P2 — Aniversariantes + aviso da Recepção (migração 0051, v0.8.6):** ao abrir
  o sistema (página **Início** e aba **Prontuários**), a **Recepção** da unidade
  recebe — **uma vez por dia** — uma notificação com os aniversariantes a
  parabenizar. **Antecipa fim de semana/feriado:** cobre hoje + a sequência de
  dias fechados imediatamente à frente, até o próximo dia de atendimento (usa a
  config da agenda + feriados + dias avulsos). RPC SECURITY DEFINER
  `notify_birthday_clients` (idempotente: dedupe pelo `link` com a data do dia).
  Nova categoria **"Aniversários"** na central de notificações.

- **P3 — Anamnese (migração 0052, v0.8.7):** nova seção **Anamnese** na ficha
  (logo abaixo da Avaliação clínica), preenchida pelo **Coordenador Clínico**
  (ou Admin) com 4 campos livres — **queixa principal, histórico de saúde,
  histórico odontológico, estilo de vida**. Atrás do **consentimento** (LGPD);
  **leitura** para Planner/Gerente/Admin (mesma RLS das considerações). Abre em
  **leitura** com botão **Editar**; guarda **versões anteriores**
  (`clinical_anamnesis_revisions`, "Histórico de versões"). Uma anamnese por
  cliente **por unidade** (a unidade compartilhada mantém a sua). Tabelas
  `clinical_anamnesis` (+ revisões) + RLS.

**LOTE PRONTUÁRIOS COMPLETO (P1–P3).** Migrações: **0051–0052**.

**LOTE ANAMNESE configurável (em curso) — feedback do dono + PDF da ficha.**
Decisões: Admin Master cria as **fichas-padrão da rede**; o Coordenador pode
**acrescentar perguntas** da sua unidade às fichas existentes (sem excluir as da
rede, sem criar fichas próprias). A anamnese de 4 campos (P3) será **substituída**.
- **A1 — Bug do consentimento (v0.8.8, sem migração):** botão **"Preencher
  anamnese"** libera o formulário ao registrar o consentimento, sem recarregar.
- **A2 — Configurador de fichas + ficha "Geral" (migração 0053, v0.8.9):** tabelas
  `anamnesis_templates` + `anamnesis_questions` (clinic_id NULL = pergunta da
  rede; preenchido = acréscimo da unidade) + RLS (Admin escreve a rede;
  Coordenador só acréscimos da sua unidade). Tela **Administração → Fichas de
  Anamnese** (`/admin/anamnese`) para criar/editar fichas e perguntas (tipos:
  Sim/Não, Sim/Não/Não sei, escolha única, lista de marcar, texto curto/longo),
  marcar **campo de detalhe ao "Sim"**, **obrigatória** e **alerta** (com
  mensagem/condição). Ficha **"Geral"** já semeada com as perguntas do PDF.
- **A3 — Preenchimento no prontuário (migração 0054, v0.9.0):** tabelas
  `anamnesis_fills` (versão imutável por preenchimento) + `anamnesis_answers`
  (respostas com a pergunta carimbada) + RLS — **Dentista** entra como
  visualizador (além de Planner/Gerente/Admin); Coordenador preenche. Na ficha,
  o componente `anamnesis-fill.tsx` substitui a anamnese de 4 campos: o
  Coordenador **escolhe a ficha**, responde **clicando** (Sim/Não, listas,
  texto), e pode **adicionar pergunta** (só para o cliente ou salvando na ficha
  da unidade via checkbox → vira pergunta `clinic_id` da unidade). **Alertas**
  das respostas aparecem numa **faixa no topo do prontuário** (`evaluateAlerts`).
  Cada save cria uma **nova versão** (histórico). A anamnese antiga (P3) saiu.
- **A4 — Obrigatoriedade + reavaliação + "sem alterações" (sem migração,
  v0.9.1):** envio ao **Centro de Planejamento** **bloqueado** (botão desabilitado
  + aviso na Avaliação clínica) enquanto a anamnese não estiver preenchida
  (1ª consulta) ou estiver vencida na **reavaliação** (Fase 6, >12 meses). Aviso
  no topo do prontuário cobrando o preenchimento/atualização. "Atualizar" abre a
  ficha **pré-preenchida** (já vinha da A3). Ao salvar sem mudar nada, registra a
  versão como **"sem alterações"** (`no_changes`, comparando a assinatura das
  respostas) — aparece no histórico e no aviso.

**LOTE ANAMNESE COMPLETO (A1–A4).** Migrações: **0053–0054**.

**LOTE PROCEDIMENTOS (em curso) — tempo estimado.**
- **PR1 — Tempo estimado no cadastro (migração 0055, v0.9.2):** coluna
  `procedures.estimated_minutes`; campo **"Tempo estimado (min)"** no cadastro/
  edição, exibição na lista, e na **importação Excel** (nova coluna "Tempo
  Estimado (min)" + larguras de coluna + aba "Instruções" no modelo). Tipo
  `Procedure.estimatedMinutes` propagado (ficha + cockpit do plano).
  Obs.: cabeçalho em negrito/cor no Excel exigiria trocar a lib (exceljs).

**Ampliação (feedback do dono) — "Protocolo de sessões".** Decisões: protocolo
**padrão da Rede** (Admin/Planner) + **personalização por unidade** (Coordenador
Clínico **e** Planner); o dentista **só marca finalizado** e o sistema **calcula
o tempo real** pelo atendimento (Lote H), **rateando por procedimento** quando o
agendamento tem vários. Etapas: **E1** protocolo da Rede; **E2** override por
unidade; **E3** planejamento com sugestões + médias reais (Rede/Unidade/dentista);
**E4** agendamento por sessão; **E5** execução/auditoria + médias derivadas.
- **E1 — Protocolo de sessões da Rede (migração 0056, v0.9.3):** tabela
  `procedure_sessions` (clinic_id NULL = Rede; preenchido = unidade) + RLS
  (Rede=Admin/Planner; unidade=Admin/Planner/Coordenador). No cadastro, botão
  **relógio** abre o **protocolo**: "sessão única" ou "várias sessões", cada
  sessão com **nome** + **tempo (seletor 15/15 min)**, com **soma automática** e
  contagem; salvar recalcula `procedures.estimated_minutes` (total da Rede). O
  campo solto de tempo do PR1 saiu do formulário (o total vem do protocolo; a
  importação ainda define um tempo de sessão única). Lista mostra "N sessões · Xh".
- **E2 + ajustes (sem migração, v0.9.4):** **protocolo por unidade** — no modo
  unidade, o relógio abre o protocolo da unidade (base = padrão da Rede; salvar
  cria a personalização; "Remover personalização" volta ao padrão). RLS já cobria
  (Admin/Planner/Coordenador). O **Coordenador Clínico** agora acessa
  `/procedimentos` **só no modo unidade** (sem catálogo/preços), restrito às suas
  unidades. Ajustes: o **relógio do protocolo** e o **histórico** ficam acessíveis
  também ao **editar** o procedimento; o **histórico** vira um painel reutilizável
  mostrado **só ao clicar** (`ChangeHistory`). Action `clearProcedureSessions`.
  Mais 2 ajustes (v0.9.5): concordância "1 sessão/2 sessões" e linha
  **Rede/Unidade** abaixo do nome do procedimento.
- **E3 — Planejamento com sugestões (migração 0057, v0.9.6):** o item do plano
  (`treatment_plan_option_items`) ganhou **planned_sessions** + **planned_total_minutes**.
  No editor do plano (ficha + cockpit), ao escolher um procedimento o sistema
  **sugere** sessões/tempo da **Unidade** (ou da **Rede**); o Planner **ajusta**
  por procedimento. Mostra a **base sugerida (Rede/Unidade)** e as **médias reais
  (unidade/dentista)** como "sem histórico ainda" (serão preenchidas na E5). Os
  valores planejados seguem para o agendamento por sessão (E4). `protocolByProcedure`
  carregado nas duas páginas; `BudgetItem` ganhou plannedSessions/plannedMinutes.
  Próximas: **E4** (agendamento por sessão), **E5** (execução/auditoria + médias).
- **Ajustes do planejamento (sem migração, v0.9.7):** **botão "Abrir cockpit"**
  na ficha (Planner); **Pilar da Metodologia** no editor do plano com **sugestão
  automática** (maior soma de valor por pilar, entre Saúde/Função/Estética/
  Prevenção) e **confirmação do pilar no envio** ao Coordenador (o Planner pode
  alterar; decisão final é dele) — `suggestTreatmentPillar` + `setTreatmentPillar`;
  ao colocar **2× o mesmo procedimento**, a sugestão de sessões/tempo **reescala
  (base × qtd)** e pede confirmação. (A visualização das sessões pelo Coordenador
  já veio na E3.)
- **E4a — Sessões a agendar na ficha (migração 0058, v0.9.8):** decisões do dono:
  agendar **nos dois lugares** (ficha + agenda) e **gerar na Fase 5**. Tabela
  `treatment_sessions` + `appointments.treatment_session_id` + RPC idempotente
  `ensure_treatment_sessions` (gera uma linha por sessão planejada da **opção
  principal aprovada** quando o cliente entra em Início de Tratamento, com o
  tempo de cada sessão). Painel **"Sessões do tratamento a agendar"** na ficha
  (`treatment-sessions-panel.tsx`): lista por procedimento + status; **"Agendar"**
  abre o formulário já com a **duração** da sessão (`AppointmentFormDialog` ganhou
  `initialDuration`). **E4b** (vínculo sessão↔agendamento + status + sugestão na
  agenda) e **E5** (execução + médias) a seguir.
- **E4b — Vínculo + sugestão na agenda (sem migração, v0.9.9):** ao agendar uma
  sessão, o `createAppointment` grava `appointments.treatment_session_id` e marca
  a sessão como **agendada** (`status='scheduled'`, `appointment_id`). No
  formulário da **Agenda**, ao escolher um cliente, aparecem **chips das sessões
  pendentes do plano** (`getClientPendingSessions`) — clicar preenche a duração e
  vincula o agendamento à sessão. `AppointmentFormDialog` ganhou
  `treatmentSessionId`. **E5** (execução + médias reais) a seguir.
- **E5 — Execução das sessões + médias reais (migração 0059, v0.10.0):** quando o
  dentista **conclui o atendimento** (painel `/atendimento` → `update_attendance`),
  as sessões ligadas ao agendamento viram **"Concluído"** com o **tempo real** de
  atendimento (chamada→conclusão). Quando o agendamento executou **mais de uma
  sessão/procedimento**, o tempo é **rateado** proporcionalmente ao tempo
  planejado de cada um (rateio igual quando não há tempo planejado) — helper
  `settle_treatment_sessions` chamado de dentro do `update_attendance`; colunas
  novas `treatment_sessions.actual_minutes` + `executed_by`. As médias reais
  alimentam: (a) o **editor do plano** — placeholder "sem histórico ainda" agora
  mostra a **média realizada na unidade** (`procedure_real_stats`, considera só
  tratamentos totalmente concluídos); (b) a **agenda** — ao marcar sessões + um
  dentista, mostra a **média real daquele dentista** por procedimento
  (`provider_procedure_minutes` / `getProviderProcedureStats`). O formulário da
  agenda passou a permitir **marcar mais de uma sessão** no mesmo horário (chips
  multi-seleção, duração soma sozinha → cria o caso do rateio;
  `createAppointment` lê `treatment_session_ids`). O painel da ficha mostra
  **"Concluído · durou X min"**. **Lote Procedimentos completo.**
- **Apresentação do plano — Camada 1 (interna) (sem migração, v0.10.1):** decisão
  do dono — **gerar pode ser interno OU externo (Gamma)**; **focar agora na
  Camada 1 (interna)**, deixando a integração com o Gamma para a Camada 2.
  Tela **"Modo Apresentação"** (`/apresentacao/[clientId]` + `presentation-view.tsx`)
  montada da **opção principal aprovada**: capa (cliente/unidade/data/**pilar do
  tratamento**), queixa/condição (diagnóstico + considerações clínicas), imagens
  (URLs assinadas, só dentro do sistema — LGPD), proposta (procedimentos,
  sessões, tempo, valor total) e próximas etapas. Botão **Baixar PDF** (impressão
  isolada via `@media print`). Entrada: botão **"Apresentação"** na ficha
  (Planner/Coordenador/Gerente/**Comercial**, quando o plano está aprovado) e no
  cabeçalho do **cockpit**. Acesso na página: Planner, Comercial, Coordenador,
  Gerente, Admin.
- **Apresentação — Camada 1.1 (mais detalhe) (migração 0060, v0.10.2):** o
  Planner passa a registrar **Objetivos do tratamento** e **Considerações do
  planejamento** no editor do plano (`treatment_plans.objectives` +
  `planning_notes`, action `savePlanNarrative`). A apresentação ganhou as seções
  **Objetivos**, **Considerações do planejamento** e **"Plano de tratamento —
  sessão por sessão"** (lista numerada de todas as sessões, com o nome/o que será
  feito + tempo, puxada do **protocolo** de cada procedimento — unidade > Rede;
  sem protocolo, cai na contagem planejada). Linguagem voltada ao cliente +
  **aviso de fluxo** (só na tela): "plano montado pelo Planner; o Consultor
  Comercial apresenta".
- **Apresentação — Camada 2 (Gamma) (sem migração, v0.10.3):** botão **"Gerar no
  Gamma"** na tela de apresentação. Integração com a **Generate API do Gamma**
  (`https://public-api.gamma.app/**v1.0**/generations`, header `X-API-KEY`,
  `GAMMA_API_KEY` em env): POST devolve `generationId`; o navegador faz **polling**
  de `getGammaStatus` até `completed`, que traz o **gammaUrl** (deck editável).
  Carregamento dos dados extraído para `presentation-data.ts` (compartilhado
  page+action); `actions.ts` monta o texto (markdown, 1 card por bloco com
  `---`), `imageOptions.source=noImages`, `textOptions.language=pt-br`. **Decisão
  do dono (achado técnico):** a API do Gamma **não insere as fotos específicas do
  paciente** — o deck é gerado **sem imagens**; o usuário **abre o gammaUrl,
  adiciona as fotos e exporta PPTX/PDF lá** (as fotos com qualidade seguem no PDF
  interno da Camada 1). Cada geração consome ~**3 créditos** da conta Gamma.
  `logAudit` action `export` entityType `presentation`. **Apresentação do plano
  (lote original) COMPLETA.** Pendência operacional: o dono deve cadastrar
  `GAMMA_API_KEY` nas **Environment Variables da Vercel** para funcionar no ar
  (no local já está no `.env.local`, fora do git).

**TESTE GERAL DO MVP (04/07/2026):** o dono rodou o roteiro completo
(`docs/ROTEIRO-TESTE-GERAL.md`) e devolveu ~60 pontos, todos registrados no
**LOTE H** do `docs/BACKLOG.md` em 4 grupos: **H1** bugs/segurança (10),
**H2** ajustes rápidos (12), **H3** melhorias médias (15), **H4** módulos novos
(14). Ordem combinada: H1 → H2 → priorizar H3/H4 com o dono.

**LOTE H1 — bugs do teste geral (em curso).**
- **H1a — Permissão/acesso (sem migração, v0.10.4):** corrige os 2 itens de
  acesso. **H1.1 Relatórios:** a tela `/relatorios` avaliava o papel de gestão
  em QUALQUER unidade do usuário e confiava só na RLS — uma recepcionista que é
  gerente em outra unidade via a rede toda. Agora o papel vale na **clínica
  ativa** (Admin = tudo; Franqueadora staff/planner/consultor = escopo de
  unidades via `user_full_access_clinic_ids`; Gerente = a unidade ativa;
  Franqueado = as suas) e TODAS as consultas (agendamentos, clientes, planos,
  seletor de unidade) filtram por `clinic_id` dentro do escopo; o item de menu
  (layout) segue a mesma regra. **H1.2 Apresentação p/ o Comercial:** o papel do
  Consultor fica na **Franqueadora** (com escopo de unidades), nunca na clínica
  do cliente — a checagem `hasRoleInClinic(clínica do cliente)` sempre falhava.
  Novo helper `hasRoleWithScopeForClinic` (`src/lib/auth.ts`, usa a RPC
  `user_full_access_clinic_ids`) aplicado em `presentation-data.ts` (acesso à
  tela/Gamma) e no `canPresent` da ficha (botão "Apresentação").
- **H1b — Regras de chamada no atendimento (migração 0061, v0.10.5):**
  **H1.3** um cliente não pode estar em **dois atendimentos ao mesmo tempo** —
  chamar quem já está "Em atendimento" em outro agendamento é bloqueado no
  banco (`CLIENT_BUSY`) e o card em espera troca o botão por "Em atendimento
  com outro profissional". **H1.4** quem chama o cliente é o **profissional do
  agendamento** (ou Admin); o Coordenador vê a sala de espera mas não chama
  cliente de outro profissional (`NOT_PROVIDER`; sem profissional definido vale
  a regra antiga por função). `update_attendance` reescrita (corpo da 0059 +
  travas); botão "Chamar" por linha no painel (`canCallRow`); mensagens pt-BR
  na action `updateAttendance`.
- **H1c — Sessões no agendamento + dia avulso (sem migração, v0.10.6):**
  **H1.5** as sessões do tratamento não "somem" mais: o pop-up **"i"** do card
  mostra as sessões vinculadas (`getAppointmentSessionOptions`); a **edição** do
  agendamento carrega os chips com as sessões vinculadas pré-marcadas + as
  pendentes do cliente (desmarcar devolve a sessão para "a agendar");
  `updateAppointment` sincroniza os vínculos (link/unlink + referência
  principal em `appointments.treatment_session_id`), só quando o formulário
  enviou o campo (arrastar para remarcar não mexe) e registra a mudança no
  audit. **H1.6** o seletor de horário do formulário passou a conhecer o **dia
  avulso** (oferece a janela própria do dia mesmo em dia da semana fechado) e o
  **feriado sem atendimento** (`getDaySchedule`), com aviso na hora de escolher
  a data ("Dia avulso liberado — atendimento das X às Y" / "Feriado sem
  atendimento nesta unidade", adiantando parte do H2.9). A grade do Dia passa
  `activeClinicId` ao editar.
- **H1d — Troca de unidade + autopreenchimento (sem migração, v0.10.7):**
  **H1.7** trocar de unidade no seletor agora **fecha a tela da unidade
  anterior** (`router.push("/")`, para uma ficha da unidade A não continuar
  aberta na B); e o usuário com **mais de uma unidade** (sem Franqueadora, que
  entra direto) **escolhe a unidade no login** numa tela de boas-vindas
  (`ChooseClinicWelcome`, mostrada pelo layout quando não há escolha explícita
  ainda) — `SessionContext.activeClinicExplicit` distingue a escolha real do
  padrão, e o padrão passou a priorizar a **Franqueadora**. **H1.9** o
  autopreenchimento por CPF agora traz **todos os dados** do cliente já
  existente (e-mail, endereço completo, etc.), não só nome/telefone/nascimento
  — `lookupCpfForRegistration` devolve um `ClientAutofill` (respeitando a RLS:
  sem acesso, campos vazios) e o formulário virou controlado nesses campos.

- **H1e — Teto de cadeiras pelo Admin (migração 0062, v0.10.8):** **H1.10** quem
  define quantas salas/cadeiras a unidade tem é o **Admin Master**, no cadastro
  da clínica (`clinics.max_rooms`, campo "Salas de atendimento (cadeiras)" só
  para unidades). A **Gerente** continua nomeando/ativando/desativando e
  escolhendo a sala do Coordenador em "Configurar agenda", mas o botão
  **"Adicionar sala"** some ao atingir o teto e a action `addRoom` bloqueia no
  servidor; o editor mostra "N de M cadeiras". Editar a clínica não deixa
  **reduzir** o teto abaixo das salas já criadas. Backfill: unidades existentes
  recebem `greatest(salas atuais, 4)`.
- **H1f — Encerrar compartilhamento na lista (sem migração, v0.10.9):** **H1.8**
  a aba **Compartilhados** dos Prontuários agora lista os compartilhamentos
  ativos da unidade nos **dois sentidos** (recebidos da outra unidade + enviados
  para outra) com **detalhes** (cliente, clínica dona, unidade compartilhada,
  motivo, desde quando, quem compartilhou) e um botão **Encerrar** por linha
  (`shared-clients-list.tsx` + `endClientShare`). Quem encerra: Recepção,
  Coordenador, Gerente ou Admin (o banco já permitia ambos os lados e já
  **notifica as duas unidades** ao iniciar/encerrar — migração 0038, nada novo
  no banco). O card da ficha (`ClientShares`) já tinha o Encerrar; o problema era
  achá-lo na lista. **LOTE H1 (Grupo 1 — bugs/segurança) COMPLETO (H1.1–H1.10).**

**LOTE H2 — ajustes rápidos do teste geral COMPLETO (sem migração, v0.11.0):**
**H2.1** aba "Ativos" → **"Clientes"** (a contagem soma ativos+inativos).
**H2.2** "Usuários" → **"Risartanos"** (menu + título; rota mantida). **H2.3**
envio do plano **sem etapa de confirmação** do pilar — só exige o pilar definido
(botão desabilitado + dica). **H2.4** depois de ir ao Comercial o **"Reabrir
para edição" some** (`canReopen` exige Fase 3; nota explicativa no lugar).
**H2.5/H2.6** trocar de visão na agenda parte de **HOJE** (Dia abre o dia de
hoje; Mês abre o mês atual) — `AgendaToolbar` usa `todayIso`. **H2.7** na visão
Semana, **clicar no dia** (cabeçalho) abre a visão Dia. **H2.8** card de **15
min** virou compacto de uma linha com o **nome do cliente** visível (Dia +
Semana; `compact` quando altura < 40px). **H2.9** encaixe em dia fechado mostra
**alerta âmbar na escolha da data** (complementa o aviso de feriado/dia avulso
do H1c). **H2.10** clicar em **dia/horário passado** não abre o pop-up — só um
aviso (Dia + Semana). **H2.11** o pop-up **"i"** ganhou **"Alterar situação"**
(cancelar/faltou etc.) para Recepção/Gerente/Admin em qualquer visão — e
cancelamento/falta **devolve as sessões do tratamento** para "a agendar"
(`updateAppointmentStatus`). **H2.12** já saíra no H1c (sessões no "i").

**H4.4 — Tela de Planos de Tratamento (sem migração, v0.11.1):** nova central
**"Planos de Tratamento"** no menu (`/planos`), para gestão/planner/comercial
(escopo por papel na clínica ativa, como /relatorios: Admin = tudo;
Franqueadora = escopo; Coordenador/Gerente = a unidade; Franqueado = as dele).
**Chips coloridos com contadores** por situação — Em planejamento / Aguardando
aprovação / Aprovado—no Centro / Fase comercial / Aguardando iniciar / Em
tratamento / Finalizado — clicáveis para filtrar (situação = status do plano +
fase/sub-status da jornada, `classify()`); **busca por cliente** + filtro de
unidade; tabela com selo colorido, fase, datas e ações (Ficha / Cockpit p/
Planner-Admin); bloco **"Relatório dos planos"**: totais (aprovados, chegaram
ao tratamento Fase 5+, ainda em negociação Fases 3–4) + quadro unidade ×
situação. Decisão do dono: H4.4 primeiro; depois seguir a ordem numérica do
backlog (H3.1 em diante).

## 3. Próximos passos (ordem de prioridade)

> **Roadmap completo com o "como construir" de cada item: `docs/ROADMAP.md`**
> (criado em 04/07/2026 a pedido do dono — ler antes de iniciar cada lote).

1. **H3 em ordem numérica** (decisão do dono, 04/07): ~~H3.1~~ ✅ (v0.11.2,
   formulário reordenado); ~~H3.2~~ ✅ (v0.11.3, "Ver agenda" rica — por dia:
   agendamentos, horários livres p/ o contexto do formulário, feriados,
   fechados, dias avulsos, bloqueios do planejamento anual, com legenda;
   `getMonthAgendaPeek`); ~~H3.3~~ ✅ (v0.11.4, seletor de dias — régua rolável
   `day-strip.tsx` no topo da agenda com disponibilidade verde/vermelho por
   dia, feriados/fechados/avulsos/bloqueios evidentes; clicar abre a visão
   Dia); ~~H3.4~~ ✅ (v0.11.5, migração 0063 — Faltou/Cancelou no "A chegar",
   Desistiu na espera com estado `gave_up`, limite de espera configurável +
   alerta vermelho + notificações repetidas a cada 15 min via
   `notify_attendance_alerts`, aviso diário + banner p/ pendências de dias
   anteriores); ~~H3.5~~ ✅ (v0.11.6, check-in com confirmação — pop-up mostra
   cliente, horário/tipo, profissional e sala antes de registrar a chegada);
   ~~H3.6~~ ✅ (v0.11.7, migração 0064 — troca de profissional de última hora
   no A chegar/Em espera via `swap_appointment_provider`, registro +
   notificações + alerta de frequência); **H3.4b** ✅ (v0.11.8, migração 0065 —
   pendências de dias anteriores carregam para o painel de hoje com "Pendente
   desde DD/MM"; "em atendimento" não concluído bloqueia cadeira+profissional
   via PROVIDER_BUSY/ROOM_BUSY); ~~H3.7~~ ✅ (v0.11.9, migração 0066 —
   visibilidade da SDR: `sdr_accessible_client_ids`; Prontuários/Jornada da SDR
   "pura" só os clientes que ela tocou; ficha bloqueia os demais; agenda
   completa mas nome sem link p/ não-permitidos); ~~H3.8~~ ✅ (v0.12.0, WhatsApp
   manual p/ aniversariantes — painel na aba Aniversariantes com mensagem
   editável {nome} + botão por cliente, e botão no prontuário no dia do
   aniversário; `src/lib/whatsapp.ts`); ~~H3.9~~ ✅ (v0.12.1, migração 0067 — transferência
   notifica sempre o destino, recepção/gerente/coordenador; compartilhamento
   já cobria os 3 papéis das 2 unidades); ~~H3.10~~ ✅ (v0.12.2, migração 0068 —
   enviar ao Planejamento conclui o atendimento automaticamente + avisa a
   recepção + pop-up para agendar a apresentação comercial); ~~H3.11~~ ✅ (v0.12.3, migração 0069 — informações
   complementares ao Centro de Planejamento: card na ficha + notifica o Planner
   + selo "nova info" na fila até abrir o cockpit); ~~H3.12~~ ✅ (v0.12.4, migração
   0070 — mídias: renomear + anotar por foto/arquivo na galeria, excluir com
   confirmação); ~~H3.13~~ ✅ (v0.12.7, cockpit — anamnese em leitura + filtros
   unidade/pilar na fila + rolagem independente das colunas); ~~H3.14~~ ✅
   (v0.12.8, sem migração — sessão agendada na ficha mostra quando/com quem e é
   clicável → abre os detalhes do agendamento); ~~H3.15~~ ✅ (v0.12.9, migração
   0071 — Conversão Comercial verifica apresentação agendada: avisa
   consultor/assistente; sem agendamento → aviso forte à recepção + gerente +
   coordenador; banner/selo no `/planos`; categoria Comercial nas notificações).
   **GRUPO 3 (H3.1–H3.15) COMPLETO**. Em andamento: **AJUSTES PRÉ-GRUPO 4**
   (5 itens do dono) — ~~AJ1~~ ✅ (v0.12.10, migração 0072 — Admin exclui
   cadeira por soft delete; some do futuro, passado marca "(excluída)"); ~~AJ1b~~
   ✅ (v0.12.11, sem migração — cadeiras numa casa só: removido o número de
   `/admin/agenda` e o campo do cadastro da clínica; limite virou campo só do
   Admin em "Configurar agenda"); ~~AJ2~~ ✅ (v0.12.12, migração 0073 —
   agendamento fora do horário permitido: início dentro do horário, fim pode
   passar; alerta a quem agenda + notifica o profissional); ~~AJ3~~ ✅ (v0.12.13,
   sem migração — apresentação marcada + plano não pronto: cronômetro regressivo
   na fila/cockpit/planos, destaque vermelho); ~~AJ4~~ ✅ (v0.12.14, migração 0074
   — banner de /planos clicável filtra; botão "Pedir agendamento" avisa a
   recepção; pop-up na recepção verifica a cada 45s); ~~AJ5~~ ✅ (v0.12.15, sem
   migração — vitrine "Prontos para apresentar" no topo de /planos com selo
   "novo" + acesso rápido). **AJUSTES PRÉ-GRUPO 4 COMPLETOS (AJ1–AJ5).** Em
   andamento: **AJUSTES 2** — ~~AJ6~~ ✅ (v0.12.16, pop-up da recepção
   organizado); ~~AJ11~~ ✅ (v0.12.17, migração 0075 — Consultor recebe
   notificação de plano pronto, incl. franqueadora com escopo, + aviso de
   apresentação agendada); ~~AJ8~~+~~AJ9~~ ✅ (v0.12.18, sem migração — faixas
   cinza dos horários fora do expediente + respiro no topo da grade, Dia e
   Semana); ~~AJ10~~ ✅ (v0.12.19, sem migração — faixa de dias passado/1 ano,
   scroll do mouse, dia fechado mostra motivo + fechamento parcial = alerta);
   ~~AJ7~~ ✅ (v0.12.21, sem migração — "liberar dia avulso" também estende o
   horário de um dia normal: une com o normal, fim opcional, bloqueia o que já é
   normal; helper `effectiveDayHours` no servidor/seletor/faixa/visão Dia).
   **AJUSTES 2 COMPLETOS (AJ6–AJ11).** Iniciado o **GRUPO 4**: **H4.1 Risartanos
   Lote 1** ✅ (v0.13.0, migração 0076 — módulo base `/risartanos`: tabela
   `staff_members`, código automático, cadastro completo, histórico, ativar/
   inativar; acesso Admin+Gerente+Franqueadora); ~~Lote 1b~~ ✅ (v0.13.1,
   migração 0077 — foto do colaborador: bucket privado staff-photos + upload +
   URL assinada + avatar na lista, também no cadastro/v0.13.2); ~~Lote 2~~ ✅
   (v0.14.0, migração 0078 — vínculo Risartano↔cliente por CPF: colunas
   `staff_member_id`/`risartano_active` + gatilhos automáticos; cadastro
   autopreenche do RH (`lookup_risartano_by_cpf`); ficha destaca "★ É um
   Risartano"/"★ Ex-Risartano (inativo)"; inativação registrada no histórico do
   prontuário); ~~Lote 2b~~ ✅ (v0.14.1, migração 0079 — vínculo Risartano↔
   usuário de acesso por e-mail: `staff_members.user_id` + gatilhos + nome
   sincronizado; coluna Acesso em Risartanos, "Criar acesso" pré-preenchido,
   vincular/desvincular manual; `/admin/usuarios` renomeado "Usuários (acesso)"
   com coluna Risartano). Próximo: H4.1 Lote 3 (auditoria); depois H4.2+
   (módulos novos), um a um com o dono (`docs/ROADMAP.md`).
2. Depois, **H4 restantes** (módulos novos) na ordem numérica (H4.4 já feito).
3. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
2. **LOTE H2 (ajustes rápidos)** — 12 itens no `docs/BACKLOG.md`.
3. **H3/H4** — priorizar com o dono (melhorias médias + módulos novos).
4. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
5. **Fase 2 — módulo comercial e além:** apresentação gravada; assinatura digital
   (**ZapSign**) + pagamento (**ASAAS**) com a regra de ouro; **NPS**; WhatsApp
   manual; transcrição/resumo por **IA**; **dashboards com metas**.

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

- **Migrações 0001–0060 aplicadas** (confirmado no teste geral de 04/07/2026).
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
