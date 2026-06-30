# Roteiro de Teste Geral — Risarte (MVP)

Guia para validar **todas as funções** já implementadas, organizado **por
usuário (papel)**. Cada teste segue o padrão: **Pré-condição → Passos →
Esperado**. Marque ao lado: ✅ ok / ⚠️ problema (anote o que viu).

> Versão alvo no rodapé da barra lateral: **0.10.3 · migração 0060**.

---

## 0. Pré-requisitos (fazer uma vez, antes de tudo)

1. **Aplicar as migrações** no Supabase (SQL Editor) até a **0060** — em especial
   as últimas: **0059** (execução das sessões) e **0060** (objetivos/considerações).
2. **Reiniciar o servidor** (fechar e abrir a janela do `Iniciar Risarte.bat`).
3. Conferir o **rodapé** da barra lateral: deve mostrar **0.10.3 · migração 0060**.
4. (Opcional, só para testar o **Gamma no ar**) cadastrar `GAMMA_API_KEY` nas
   *Environment Variables* da Vercel e refazer o deploy. No computador local já
   funciona.
5. **Usuários de teste** — como **Admin Master**, em `/admin/usuarios`, crie um
   usuário para cada papel abaixo (pode usar e-mails fictícios da sua equipe):
   Recepcionista, SDR, Coordenador Clínico, Dentista Planner, Dentista (executor),
   Consultor Comercial, Assistente Comercial, Gerente de Unidade. As funções da
   Franqueadora (SDR/Planner/Consultor/Assistente) têm **escopo de unidades** —
   teste com escopo "Todas".
6. **Duas unidades** ativas (ex.: Cambé e Londrina) para os testes de
   multi-unidade (compartilhamento e transferência).
7. **Um cliente-cobaia** para percorrer a jornada inteira (Seção 10).

> Dica: faça login com cada papel numa aba anônima diferente, ou saia e entre de
> novo a cada papel.

---

## 1. Admin Master

**1.1 Login e acesso**
- Passos: entre com a conta Admin Master.
- Esperado: vê **todos** os menus; rodapé com versão/migração corretos.

**1.2 Clínicas** (`/admin/clinicas`)
- Passos: crie/edite uma unidade; ative/desative.
- Esperado: a unidade aparece no seletor de "clínica ativa".

**1.3 Usuários** (`/admin/usuarios`)
- Passos: crie um usuário, atribua **papel** + (se for da franqueadora) **escopo
  de unidades**; redefina a senha; ative/desative.
- Esperado: o usuário entra com as permissões certas; desativado não entra.

**1.4 SLAs** (`/admin/sla`)
- Passos: defina um SLA padrão da rede e uma **sobrescrita** para uma unidade.
- Esperado: o prazo da unidade prevalece sobre o da rede.

**1.5 Configurar agenda** (`/agenda/configuracao`)
- Passos: defina **horário**, **dias** e **cadeiras** de uma unidade.
- Esperado: ao agendar, o sistema respeita horário/dia/cadeiras (ver 2.4).

**1.6 Procedimentos** (`/procedimentos`)
- Passos: crie um procedimento (código interno automático, TUSS, especialidade,
  preço padrão/mín/máx, comissionamento, pilar); edite; **importe planilha Excel**
  (botão "Baixar modelo" → preencher → importar); faça um **reajuste em massa**
  (por especialidade/pilar/seleção); **desative** um já usado; veja o **histórico**.
- Esperado: tudo salva; procedimento usado **não** é apagado, só desativado.

**1.7 Protocolo de sessões** (dentro de um procedimento)
- Passos: abra um procedimento para editar; defina o **protocolo da Rede**
  (sessões com nome + tempo, seletor de 15 em 15 min); em uma unidade, faça a
  **personalização da unidade**; veja o **histórico** (clicar para mostrar).
- Esperado: a unidade sobrescreve a Rede; histórico registra as mudanças.

**1.8 Anamnese (fichas)** (`/admin/anamnese`)
- Passos: crie/edite uma **ficha da rede** (perguntas com tipos variados, "detalhe
  quando...", **alertas** por resposta).
- Esperado: a ficha fica disponível para preenchimento na ficha do cliente.

---

## 2. Recepcionista

**2.1 Cadastro de cliente** (`/prontuarios/novo`)
- Passos: comece pelo **CPF**; se o cliente já existir, confirme o **autopreenchimento**.
- Esperado: cliente criado na unidade ativa; reconhece existente.

**2.2 Prontuários — abas** (`/prontuarios`)
- Passos: confira as abas **Ativos / Aniversariantes / Transferidos /
  Compartilhados** e os filtros (aplicam sozinhos, sem botão "Filtrar").
- Esperado: cada aba lista o grupo certo; ficha abre em **modo leitura** com botão
  **Editar**.

**2.3 Notificação de aniversário**
- Pré-condição: cliente com aniversário próximo.
- Esperado: a recepção recebe aviso de aniversário (antecipando fim de
  semana/feriado).

**2.4 Agendar** (`/agenda` → Novo agendamento)
- Passos: agende uma **avaliação**; tente um horário **fora do funcionamento**,
  um **dia fechado** e uma **cadeira lotada**; tente conflito de cliente/profissional.
- Esperado: o sistema bloqueia com mensagem clara (exceto Urgência/Emergência, que
  permitem encaixe); sugere **próximos horários livres**.

**2.5 Atendimento — chegada** (`/atendimento`)
- Passos: registre a **chegada** (check-in) do cliente.
- Esperado: o cliente vai para "Em espera"; o profissional é avisado; aparece a
  **linha do tempo** (espera/atendimento) e quem fez cada passo.

**2.6 Receber fechamento → agendar início**
- Pré-condição: cliente que entrou em **Início de Tratamento (Fase 5)**.
- Esperado: a recepção recebe **notificação** para agendar o início.

**2.7 Agendar sessões do plano**
- Pré-condição: cliente em Fase 5 com sessões geradas.
- Passos: na ficha, painel **"Sessões do tratamento a agendar"** → **Agendar**; OU
  na agenda, ao escolher o cliente, use os **chips das sessões** — marque **mais
  de uma** no mesmo horário (a duração soma sozinha).
- Esperado: a sessão vira **"Agendado"**; várias sessões podem ficar no mesmo
  agendamento.

---

## 3. SDR (Encantador)

**3.1 Cadastro**
- Passos: cadastre um cliente — ele **pertence à unidade escolhida** (código FRA).
- Esperado: cliente criado na unidade; SDR vê **apenas os clientes que cadastrou**.

**3.2 Agendar em outra unidade**
- Passos: agende para o cliente em **outra unidade** (desejo do cliente).
- Esperado: agendamento criado na unidade escolhida.

**3.3 Restrições**
- Esperado: **não** vê botões de mover fase; não acessa atos clínicos/comerciais.

---

## 4. Coordenador Clínico

**4.1 Consentimento (LGPD)**
- Passos: na ficha, registre o **consentimento** (TCLE + termo, com data/hora).
- Esperado: só após o consentimento é possível gravar áudio/fotos.

**4.2 Mídias clínicas**
- Passos: faça **upload** de foto, exame, vídeo e áudio; **grave um áudio**; abra a
  **galeria** (pop-up/lightbox).
- Esperado: arquivos com **links assinados** (não públicos); navegação por setas.

**4.3 Considerações clínicas**
- Passos: escreva e edite as **considerações**.
- Esperado: salvam e ficam visíveis ao Planner.

**4.4 Anamnese**
- Passos: **preencha** a anamnese (obrigatória na 1ª consulta) clicando nas
  opções; force uma resposta que dispara **alerta**; teste **"atualizada sem
  alterações"**; numa **reavaliação >12 meses**, confirme o aviso; **adicione uma
  pergunta da unidade** (e confirme que **não** dá para excluir as perguntas da rede).
- Esperado: alertas aparecem na ficha; bloqueia envio ao planejamento se faltar
  anamnese obrigatória.

**4.5 Enviar ao Centro de Planejamento**
- Passos: clique **"Enviar ao Centro de Planejamento"**.
- Esperado: cliente vai para a fila do Planner; notifica.

**4.6 Aprovar/reprovar plano (por opção)**
- Pré-condição: plano enviado para aprovação.
- Passos: **aprove** uma opção e **reprove** outra (a reprovação **exige
  considerações**); veja só o **total** de cada opção (não o item a item).
- Esperado: o plano só vira "aprovado" quando todas as opções têm decisão e ≥1 é
  aprovada; se todas reprovadas, volta ao Planner.

**4.7 Ver sessões do planejamento**
- Esperado: o Coordenador consegue **visualizar as sessões** previstas no plano.

---

## 5. Dentista Planner

**5.1 Cockpit** (`/planejamento` → abre `/planejamento/[clientId]`)
- Passos: abra a **fila priorizada**; entre no cockpit (2 colunas: **evidências**
  à esquerda, **editor** à direita).
- Esperado: galeria/considerações/consentimento à esquerda; edição sem trocar de tela.

**5.2 Diagnóstico, objetivos e considerações**
- Passos: preencha **Diagnóstico**, **Objetivos do tratamento** e **Considerações
  do planejamento** → salvar.
- Esperado: salvam (entram na apresentação — ver 5.7).

**5.3 Opções do plano**
- Passos: crie a opção **principal** e **alternativas**; use **"Tornar principal"**.
- Esperado: a principal aparece em destaque/primeiro.

**5.4 Orçamento por opção**
- Passos: adicione itens do **catálogo** (busca com sugestões) e **linhas livres**;
  preencha **sessões e tempo planejados**; veja a **base sugerida (Rede/Unidade)**
  e a **média realizada na unidade**; coloque **quantidade > 1** e confirme a
  pergunta de reescala (base × quantidade).
- Esperado: total por opção em R$; sugestões coerentes.

**5.5 Pilar da metodologia**
- Passos: observe o **pilar sugerido automaticamente** (pela soma dos valores); ao
  **enviar para aprovação**, confirme/ajuste o pilar na mensagem.
- Esperado: a decisão final é do Planner; o pilar fica registrado.

**5.6 Fluxo de aprovação**
- Passos: **envie para aprovação** (exige itens lançados); após o Coordenador
  aprovar, **envie ao Comercial** (Fase 3 → 4); teste **"Reabrir para edição"**.
- Esperado: travas funcionam (sem plano aprovado não vai ao Comercial; reabrir
  exige nova aprovação).

**5.7 Apresentação do plano** (`/apresentacao/[clientId]`)
- Pré-condição: plano **aprovado**.
- Passos: botão **"Apresentação"** (na ficha e no cockpit). Confira: capa
  (cliente/unidade/data/**pilar**), diagnóstico/condição, **objetivos**, **plano
  sessão por sessão**, proposta/valor, **considerações do planejamento**, próximos
  passos. Clique numa **foto** (amplia). **Baixar PDF**. **Gerar no Gamma** →
  aguardar ~1 min → **Abrir o deck no Gamma**.
- Esperado: PDF sai **sem o menu** e **com as fotos**; o Gamma gera o deck (sem
  imagens) para você **adicionar as fotos e exportar PPTX/PDF lá**.

---

## 6. Dentista (executor)

**6.1 Agenda e pacientes**
- Esperado: vê **sua agenda** e **seus pacientes**; não vê clientes de outros; não
  move fases nem planeja.

**6.2 Atender** (`/atendimento`)
- Passos: **Chamar** o cliente (vai para "Em atendimento", com cronômetro) e depois
  **Concluir**.
- Esperado: regra **"quem chamou conclui"**; tempos de espera/atendimento registrados.

**6.3 Execução das sessões (tempo real + rateio)**
- Pré-condição: agendamento vinculado a uma (ou **duas**) sessões do tratamento.
- Passos: conclua o atendimento.
- Esperado: a(s) sessão(ões) viram **"Concluído · durou X min"**; com duas no mesmo
  agendamento, o tempo é **rateado** entre elas; alimenta as **médias reais**
  (unidade/dentista) vistas no editor do plano e na agenda.

---

## 7. Consultor Comercial

**7.1 Carteira**
- Esperado: vê **apenas os seus clientes**.

**7.2 Apresentação ao cliente**
- Pré-condição: plano **aprovado** (enviado ao Comercial).
- Passos: na ficha do cliente, botão **"Apresentação"** → apresentar; **Baixar
  PDF**; **Gerar no Gamma** e **adicionar as fotos** no Gamma; exportar.
- Esperado: vê o conteúdo do plano em linguagem para o cliente + aviso de fluxo na
  tela (que **não** sai no PDF).

> Observação: gravação da apresentação, assinatura e pagamento (o "fechamento") são
> da **Fase 2** e ainda não estão no sistema.

---

## 8. Gestão (Gerente de Unidade / Franqueado / Rede)

**8.1 Relatórios** (`/relatorios`)
- Passos: abra os **resumos de agendamentos** (por situação/tipo/profissional/
  unidade), o **rede por fase** (sem nomes de pacientes) e a **produtividade do
  Planner** (planos criados/enviados/aprovados/devolvidos + tempo médio).
- Esperado: Gerente vê **sua unidade**; Rede vê **todas**; Franqueado vê **as
  suas**; nenhum nome de paciente no consolidado de rede.

**8.2 Leitura geral**
- Esperado: visão de leitura da jornada/agenda conforme o escopo; sem editar
  planos nem atos clínicos.

---

## 9. Funções transversais

**9.1 Notificações** (`/notificacoes`)
- Passos: veja as categorias (Plano / Compartilhamento / Início de Tratamento /
  Transferência / Outras), os **contadores clicáveis** e o **filtro**.
- Esperado: cada aviso com **selo de categoria**.

**9.2 Compartilhamento entre unidades**
- Passos: compartilhe um cliente da unidade A com a unidade B; veja o **histórico**;
  **encerre** o compartilhamento (pela B).
- Esperado: **as duas unidades** são notificadas ao iniciar/encerrar; após encerrar,
  a B vê **"Compartilhamento encerrado"** (sem erro 404) e perde o acesso.

**9.3 Transferência A→B**
- Passos: transfira um cliente de unidade.
- Esperado: a ficha/lista mostra a unidade atual; a origem vê o aviso de
  transferência.

**9.4 Jornada / Kanban** (`/jornada`)
- Passos: veja o **kanban por fase**; force um **SLA estourado**.
- Esperado: **badge vermelho** no caso atrasado; mover de fase respeita a **matriz
  de permissão** (cada papel só move o que pode).

**9.5 Agenda — visões e retornos**
- Passos: alterne **Dia / Semana / Mês**; veja `/agenda/retornos` e
  `/agenda/planejamento-anual`.
- Esperado: as visões mudam corretamente.

---

## 10. Jornada ponta a ponta (cliente-cobaia)

Faça **um cliente** percorrer tudo, trocando de usuário a cada etapa:

1. **Recepção/SDR:** cadastra o cliente.
2. **Recepção:** agenda a **avaliação**.
3. **Recepção:** faz o **check-in**; **Coordenador** **Chama** e atende.
4. **Coordenador:** registra **consentimento**, sobe **fotos/exames**, grava
   **áudio**, preenche **anamnese**, escreve **considerações** → **Envia ao
   Centro de Planejamento**.
5. **Planner:** no cockpit, escreve **diagnóstico/objetivos/considerações**, monta
   **opções + orçamento + sessões/tempo**, confirma o **pilar** → **envia para
   aprovação**.
6. **Coordenador:** **aprova** as opções.
7. **Planner:** **envia ao Comercial** (Fase 3 → 4).
8. **Comercial:** abre a **Apresentação**, **Baixa PDF** / **Gera no Gamma**.
9. (Simular o fechamento) **mover para Início de Tratamento (Fase 5)** — as
   **sessões a agendar** são geradas.
10. **Recepção:** **agenda** as sessões (chips; pode juntar 2 num horário).
11. **Dentista:** **chama → conclui** → sessões viram **"Concluído · durou X min"**
    (tempo real, rateado se for o caso).
12. Confira as **médias reais** no editor do plano (próximo planejamento) e a
    **notificação** para agendar a próxima sessão.
13. **Reavaliação (Fase 6):** se precisar, volta ao planejamento; senão segue para
    **Acompanhamento (Fase 7)**.

Ao final, todas as funções do MVP terão sido exercitadas.

---

## Anotações de problemas

| # do teste | Papel | O que aconteceu | Como reproduzir |
|---|---|---|---|
|  |  |  |  |
