# Roteiro de teste na tela — Ortodontia (para o Claude executar)

_Escrito em 17/11/2026, sessão "Módulo de Ortodontia". Cobre o que foi entregue
de 0.361.0 a 0.476.0 (ORTO1, ORTO1b, ORTO2, ORTO6 a ORTO9, o prontuário
reorganizado, AP175 e AP176). O resultado de cada execução vai num arquivo
próprio: `docs/ortodontia/ROTEIRO-RESULTADO-aaaa-mm-dd.md`._

## 0. Regras da execução

1. **Só no banco de TREINO.** O app sobe pelo servidor local
   (`npm run servidor:treino`, porta 3100, pasta `.next-test`), que recusa a
   produção. Antes do primeiro clique, conferir no log a linha
   `banco: bsnptybalszjjbhxeejo.supabase.co`. Sem ela, **parar**.
2. **Só na "Risarte Unidade Teste" e só com as contas `@example.com`.** Nunca
   em Londrina, Cambé ou Franchising, onde a equipe treina.
3. **Cada passo tem duas provas:** o que a tela mostra **e** uma consulta ao
   banco. A consulta é só de leitura, e o resultado só conta se ela achou pelo
   menos uma linha. Zero linhas quer dizer que a régua não mediu nada, não
   que está tudo certo.
4. **A data não passa sozinha.** Os passos que dependem do tempo (60/30/15
   dias, manutenção vencida, reavaliação vencida) mexem **só nas datas do caso
   de teste**, pelo banco. Esse atalho fica marcado como **[ATALHO DE DATA]**
   no resultado.
5. **Falhou: registrar e seguir.** O passo vai como ❌ no resultado, com o que
   apareceu e a consulta. O defeito entra no backlog no mesmo dia
   (`npm run backlog -- novo …`), separando o confirmado do suspeito. Nada é
   corrigido no meio da execução: as correções saem em lote, com o OK do dono.
6. **Evidência:** uma foto da tela nos pontos marcados com 📸, salva na pasta
   temporária da sessão (não no repositório) e citada no resultado.
7. **Nada se apaga.** No fim, o caso de teste é **interrompido** e os
   agendamentos que sobrarem são **cancelados**. Os resíduos ficam listados no
   resultado.

### 0.1 Decisões do dono antes de executar

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | A Unidade Teste tem um Coordenador que **não é conta de teste**. Os avisos ao Coordenador (caso fechado, reavaliação vencida) chegariam a ele, no treino. Pode? | Pode, avisando-o antes. Alternativa: tirar o papel dele da Unidade Teste durante o teste, o que é uma mudança de cadastro e só o dono decide. |
| D2 | A configuração da ortodontia do treino está vazia (mensalidade R$ 0, sem procedimento de manutenção). Posso criar um **ajuste só da Unidade Teste**? | Sim. O padrão da rede não é tocado, e o ajuste fica no treino. |
| D3 | O paciente de teste e o caso interrompido ficam no treino como resíduo. Pode? | Sim, com o nome "Paciente Roteiro Ortodontia". |

## 1. Contas e lugares

| Função | Conta | Unidade |
|---|---|---|
| Admin Master | `admin@example.com` | qualquer (trocar para a Unidade Teste) |
| Recepção | `recepcao@example.com` | Unidade Teste |
| Coordenador | `coordenador@example.com` | Unidade Teste |
| Dentista | `dentista@example.com` | Unidade Teste |
| Gerente | `gerente@example.com` | Unidade Teste |
| Planner | `planner@example.com` | Franqueadora Teste |
| Consultor | `consultor@example.com` | Franqueadora Teste |
| Financeiro | `financeiro@example.com` | Franqueadora Teste |

As senhas ficam no `.env.test.local` (`TEST_USER_PASSWORDS`), e nunca vão para
o resultado. Para trocar de conta, usar **Sair** e entrar de novo. Para cada
conta, conferir a unidade ativa no alto da barra lateral.

Telas usadas: `/agenda`, `/atendimento`, `/avaliacao/[cliente]`,
`/planejamento/[cliente]`, `/apresentacao/[cliente]`, `/comercial/[cliente]`,
`/prontuarios/[cliente]`, `/ortodontia` (Painel), `/ortodontia/casos`,
`/ortodontia/casos/[id]`, `/ortodontia/atencao`, `/ortodontia/mensalidades`,
`/ortodontia/configuracao`, `/notificacoes`.

## 2. Preparação (P)

| # | Quem | Ação | Esperado | Conferência no banco |
|---|---|---|---|---|
| P1 | — | Subir `npm run servidor:treino` | Log mostra o banco do treino | — |
| P2 | — | Conferir que o Planner, o Consultor e o Financeiro da Franqueadora Teste alcançam a Unidade Teste | Sim (senão, parar e avisar o dono) | `providers_with_access(<Unidade Teste>, 'commercial_consultant')` traz o consultor de teste; idem Planner |
| P3 | Admin | `/ortodontia/configuracao` → **criar ajuste da Unidade Teste**: mensalidade R$ 200,00, 12 parcelas, dia 10, intervalo 30 dias, 24 meses, procedimento de manutenção "Manutenção de aparelho ortodôntico - aparelho removível", pontualidade 5%, limite de pontualidade 10%, mensalidade mínima R$ 150,00, reajuste 5% | Bloco "Risarte Unidade Teste" aparece, separado do padrão da rede | `ortho_settings` com `clinic_id` = Unidade Teste e os valores digitados; a linha da rede **inalterada** |
| P4 | Recepção | `/prontuarios/novo` → cadastrar "Paciente Roteiro Ortodontia", com CPF de teste (gerador do treino), nascimento 01/01/2000, telefone e endereço completos | Ficha abre, sem "Cadastro incompleto" | `clients` com o nome, `registration_complete = true`, unidade = Unidade Teste |
| P5 | Recepção | Agendar **Avaliação** com o Coordenador de teste, hoje, no próximo horário livre | Agendamento aparece na agenda | `appointments` tipo `evaluation`, `scheduled` |
| P6 | Recepção | `/atendimento` → registrar a chegada | Paciente "em espera" | `attendance_status = waiting`; fase muda para Conversão clínica |

## 3. Do clínico ao plano — ORTO7 (A)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| A1 | Coordenador | `/atendimento` → chamar; `/avaliacao/[cliente]` → preencher a anamnese com **uma condição marcada** (ex.: Diabetes) | Ficha da anamnese salva | `anamnesis_fills` do cliente |
| A2 | Coordenador | Passo 3 do cockpit → **Indicar ortodontia** com observação "classe II" 📸 | Bloco mostra "Ortodontia indicada" | `clinical_evaluations.ortho_indicated = true`, `ortho_indicated_by` = coordenador |
| A3 | Coordenador | Enviar ao Centro de Planejamento | Fase vai para Centro de Planejamento | `clients.journey_phase = planning_center` |
| A4 | Planner | `/planejamento/[cliente]` → cartão **"Ortodontia indicada"** visível 📸 | Mostra a observação do Coordenador | — |
| A5 | Planner | Montar o plano: Opção A com "Aparelho ortodôntico fixo metálico" (1 sessão) **e** uma restauração (para o plano misto) | Itens na opção | `treatment_plan_option_items` com os dois procedimentos |
| A6 | Planner | Bloco **Proposta ortodôntica** da opção: aparelho fixo, 24 meses, manutenção a cada 30 dias, contenção "ambas" | Bloco salvo | `treatment_plan_ortho` da opção com os valores |
| A7 | Planner | Montar a sequência e enviar ao Coordenador | Plano "enviado" | `treatment_plans.status` enviado |
| A8 | Coordenador | Aprovar a opção A | Plano aprovado; fase Conversão comercial | status aprovado; fase `commercial_conversion` |

## 4. Do Comercial ao caso — ORTO8 (B)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| B1 | Recepção | Agendar **Apresentação comercial** com o Consultor de teste; chegada | Agendamento e espera | `appointments` tipo `commercial_presentation` |
| B2 | Consultor | `/apresentacao/[cliente]` → negociação da opção A → bloco **Acordo ortodôntico**: mensalidade **R$ 140,00** (abaixo do mínimo), 12 parcelas, boleto, dia 10, pontualidade 5% 📸 | Aviso de regra: abaixo do mínimo; negociação vai para "aguardando autorização" | `plan_negotiation_ortho` gravado; `plan_negotiations.status = aguardando_autorizacao` |
| B3 | Consultor | Corrigir para **R$ 200,00** | A trava sai; volta a "em negociação" | `evaluate_negotiation_rules` sem violação de ortodontia |
| B4 | Consultor | Aceitar a negociação; registrar o resumo da apresentação | Aceite gravado | negociação aceita |
| B5 | Consultor | Enviar o contrato para assinatura (ZapSign **falsa** do servidor local) | Pacote criado | `signature_packages` do cliente |
| B6 | — | Simular a assinatura: `node scripts/zapsign-simular-webhook.mjs` no pacote | Contrato assinado | `commercial_sales.contract_signed_at` preenchido |
| B7 | Recepção | Receber a entrada (dinheiro) na aba Financeiro do prontuário | Parcela paga | `payment_installments` paga |
| B8 | — | Fechamento: venda fecha sozinha (contrato + pagamento) | **Caso ortodôntico nasce** em "Aguardando início" | `ortho_cases` do cliente, `status = aguardando_inicio`, `origin = venda`, **sem ortodontista**; `ortho_case_terms` com R$ 200,00 / 12 / boleto / 5% |
| B9 | Gerente, Coordenador, Recepção | `/notificacoes` → aviso **"Ortodontia: caso fechado — agendar a instalação"** (aba Ortodontia) 📸 | Aviso presente para os três | `notifications` com o título, link `/ortodontia/casos/<id>`, 3 destinatários de teste (+ o Coordenador real, se D1 = sim) |
| B10 | Gerente | `/ortodontia` (Painel) → "Aguardando início" com **"sem horário"**; Início mostra o cartão "Ortodontia: aguardando instalação sem horário" | Os dois | — |
| B11 | Admin | `/ortodontia/casos` → **não existe** botão "Novo caso" | Ausente | — |
| B12 | — | Sessões do plano nasceram (instalação + restauração) | Duas sessões "a agendar" | `treatment_sessions` do cliente, 2 linhas, `pending` |

## 5. A instalação — AP175 (C)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| C1 | Recepção | Agendar **Sessão de tratamento** da restauração com a Dentista de teste, **antes** da instalação, marcando a sessão da restauração | Agendado | `appointments.treatment_session_id` = sessão da restauração |
| C2 | — | O caso **continua sem ortodontista** (agendar não define) | — | `ortho_cases.orthodontist_id IS NULL`; nenhuma `ortho_maintenances` ligada ao agendamento |
| C3 | Recepção | Agendar **Início de tratamento** marcando a sessão do aparelho, com a Dentista de teste | Painel passa a "instalação dd/mm" | `appointments` tipo `treatment_start` ligado à sessão do aparelho; 0 manutenções ligadas |
| C4 | Recepção + Dentista | Chegada; Dentista chama, escreve a evolução e **conclui** marcando a sessão do aparelho como feita | Atendimento concluído | sessão `done`, `executed_by` = dentista |
| C5 | — | **Caso inicia sozinho** 📸 | Ficha do caso: "Em tratamento", início = hoje, ortodontista = Dentista de teste, cronograma com manutenções previstas, histórico "Instalação concluída (sessão do plano)" | `status = em_tratamento`, `start_date = hoje`, `orthodontist_id` = dentista; `ortho_maintenances` previstas > 0; evento `tratamento_iniciado` |
| C6 | — | **Um repasse só** | — | `provider_payouts` da sessão do aparelho = 1; com `ortho_maintenance_id` deste caso = 0 |
| C7 | — | **Lote de mensalidades** nasceu | Ficha mostra o lote (12, de mês a mês) | `ortho_billing_batches` ativo, 12 `ortho_charges` |
| C8 | Recepção | Concluir a sessão da restauração (C1) | Concluída | **nenhuma** manutenção ligada a esse agendamento; cronograma do caso igual |

## 6. As manutenções na agenda e a evolução — AP176 e ORTO6 (D)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| D1 | Recepção | Ficha do caso → **Agendar** | Agenda abre com **"Manutenção ortodôntica"** já escolhida 📸 | — |
| D2 | Recepção | Mudar o tipo para **Sessão de tratamento** e escolher a Dentista de teste (a ortodontista) | Aparece a pergunta "Se for a manutenção do aparelho…" com **Trocar para Manutenção ortodôntica** 📸 | — |
| D3 | Recepção | Clicar **Trocar**; agendar na data da 1ª manutenção prevista | Tipo volta; agendado | `ortho_maintenances` seq 1 `agendada`, `appointment_id` preenchido, `from_appointment = false` |
| D4 | Recepção | Novo agendamento: **Retorno** com a ortodontista | Não vira manutenção | 0 manutenções ligadas |
| D5 | Recepção | Agendar **Sessão de tratamento** (sessão pendente, se houver; senão criar uma restauração extra no plano) numa semana com manutenção prevista | Aviso **antes** de salvar ("…prevista para dd/mm…"); depois de salvar, a janela prepara a manutenção **em seguida** 📸 | primeiro agendamento sem manutenção |
| D6 | Recepção | Salvar o segundo (manutenção em seguida) com a Dentista de teste | Janela fecha | manutenção prevista daquela semana `agendada`, sem criar extra |
| D7 | Dentista | Atender a manutenção de D3: **Registrar evolução** (fio 0.14 NiTi, observação, próximo passo) e concluir | Manutenção "Realizada" | `ortho_maintenances` `realizada`, `done_by`; 1 `provider_payouts` com `ortho_maintenance_id` |
| D8 | Dentista | `/prontuarios/[cliente]` → abre em **Desenvolvimento Clínico** 📸; a evolução da ortodontia aparece como anotação | Anotação "Ortodontia — manutenção 1: …" | `clinical_progress_notes.ortho_maintenance_id` |
| D9 | Dentista | Ficha do caso e prontuário: **nenhum valor** (mensalidade, contenção) | Sem R$ em lugar nenhum | a leitura de `ortho_case_terms` pela sessão da dentista vem vazia |
| D10 | Coordenador | Mesma ficha: **vê** os valores | R$ 200,00/mês | — |
| D11 | Dentista | Agendar manutenção com **outra dentista** (se houver conta de teste; senão o Coordenador de teste) e concluir | Liga ao caso; repasse para quem fez | `provider_payouts.provider_id` = quem atendeu |

## 7. Mensalidades — ORTO9 (E)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| E1 | Recepção | `/ortodontia/mensalidades` → vê as cobranças, **sem** o botão de baixa | Só leitura | — |
| E2 | Financeiro | Dar baixa na 1ª mensalidade com data **até o vencimento** 📸 | Prévia mostra o desconto de 5% (R$ 10,00); pago R$ 190,00 | `ortho_charges.discount_cents = 1000`, `paid_amount_cents = 19000`; lançamento no razão 1.1.04 pelo líquido |
| E3 | Financeiro | Desfazer a baixa | Volta a "em aberto" | razão volta ao cheio |
| E4 | Gerente | Dar baixa com data **depois** do vencimento | Sem desconto; R$ 200,00 | `discount_cents = 0` |
| E5 | — | **[ATALHO DE DATA]** pôr o vencimento de uma mensalidade em aberto no passado; rodar a rotina (E8) | Ela fica "Atrasada"; selo de atraso na ficha e no prontuário | `status = atrasada` |
| E6 | — | **[ATALHO DE DATA]** pôr a última parcela do lote a 30 dias de hoje; rodar a rotina | Aviso "lote terminando" ao Gerente e ao Financeiro; Atenção mostra o motivo | `ortho_notices` d30 do lote; `notifications` |
| E7 | Gerente | Ficha → **Renovar** o lote (6 parcelas, valor sugerido com o reajuste de 5% = R$ 210,00) | Lote 2 começa no mês seguinte ao fim do 1º | `ortho_billing_batches` seq 2 com R$ 210,00 |
| E8 | — | Rotina diária à mão: `ortho_daily_alerts(<Unidade Teste>)` como Admin | Roda sem erro | retorno da função |
| E9 | Gerente | **Suspender** o caso com motivo | "Suspenso"; mensalidades futuras canceladas; lote encerrado | `status = suspenso`; cobranças futuras `cancelada` |
| E10 | Gerente | **Retomar** | "Em tratamento"; **sem** lote novo automático (emitir à mão) | `status = em_tratamento`; nenhum lote novo |
| E11 | Gerente | **Emitir lote** à mão | Lote novo | `ortho_billing_batches` novo |

## 8. Avisos da rotina — ORTO2 (F)

Todos com **[ATALHO DE DATA]** no caso de teste e a rotina rodada à mão (E8).

| # | Situação montada | Esperado no sino | Conferência |
|---|---|---|---|
| F1 | Manutenção prevista há 10 dias, sem agendamento | "manutenção vencida" para Recepção e Gerente, **uma** | `ortho_case_notices` kind `manutencao_vencida` |
| F2 | Rodar a rotina de novo | **Nenhum** aviso novo | contagem igual |
| F3 | Última manutenção marcada **Faltou** (agenda: "Não compareceu"), nada à frente | "faltou" para Recepção e Gerente; término prorrogado em 30 dias | `extension_days` +30; aviso `faltou` |
| F4 | Reavaliação do caso ontem | "reavaliação vencida" para o Coordenador e a ortodontista | aviso `reavaliacao_vencida` |
| F5 | Mensalidade atrasada (E5) | "mensalidade atrasada" para Gerente e Financeiro | aviso `mensalidade_atrasada` |
| F6 | Agendar a manutenção vencida | Não reaparece | — |

## 9. Faltas, contenção e alta — ORTO1b (G)

| # | Quem | Ação | Esperado | Conferência |
|---|---|---|---|---|
| G1 | Gerente | Ficha → **Desfazer falta** (F3) | Prorrogação some | `extension_days` volta |
| G2 | Gerente | **Entregar contenções**, cobrada R$ 300,00 📸 | "Em acompanhamento"; mensalidades dos meses seguintes canceladas; previstas canceladas; cobrança da contenção | `status = contencao`, `retainer_delivered_at`; `ortho_charges` kind `contencao` |
| G3 | — | Jornada reage (gatilho da 0418): fechamento da ortodontia aberto | Pergunta ao ortodontista / tarefa do Coordenador, conforme a Jornada | `treatment_closures` scope `ortodontia` |
| G4 | Recepção | Agendar **Manutenção ortodôntica** (controle da contenção) | Tipo oferecido em acompanhamento; liga ao caso | manutenção ligada |
| G5 | Gerente | **Dar alta** | "Alta" | `status = finalizado` |
| G6 | — | Prontuário: cartão da ortodontia mostra "Alta"; o tipo "Manutenção ortodôntica" **some** da agenda | — | — |

## 10. Prontuário e quem vê o quê — 0.369.0 (H)

| # | Quem | Ação | Esperado |
|---|---|---|---|
| H1 | Recepção | Abrir o prontuário | Abre em **Cadastro**; painel "Precisa de atenção" com os alertas da anamnese e a mensalidade atrasada; faixa com o cartão da Ortodontia 📸 |
| H2 | Coordenador | Abrir | Abre em **Clínico** |
| H3 | Planner | Abrir | Abre em **Plano** |
| H4 | Dentista | Abrir | Abre em **Desenvolvimento Clínico**; odontograma e plano recolhidos |
| H5 | Recepção | Abrir o aviso "Pedido respondido" de outro paciente (se houver) | O aviso leva à aba do assunto |
| H6 | Admin | Tema escuro (lua) | Selos de situação legíveis 📸 |
| H7 | Dentista | `/ortodontia/mensalidades` e Painel | Sem acesso a valores |

## 11. Limpeza e resultado (I)

| # | Ação | Conferência |
|---|---|---|
| I1 | Interromper o caso (se não estiver em alta), motivo "roteiro de teste" | `status` final registrado |
| I2 | Cancelar os agendamentos futuros do paciente | nenhum `scheduled` do paciente |
| I3 | Remover o ajuste da Unidade Teste na configuração? **Só com o OK do dono** (D2) | — |
| I4 | Parar o servidor local; apagar a `.next-test` se o disco estiver no limite | porta 3100 livre |
| I5 | Escrever `ROTEIRO-RESULTADO-aaaa-mm-dd.md`: cada passo ✅/❌/⏭️, consulta usada, fotos, atalhos de data, resíduos, itens novos no backlog | arquivo no repositório |
| I6 | Commit só do resultado; push | — |

## 12. O que este roteiro NÃO cobre

- A ZapSign real e o Asaas real (o servidor local usa a ZapSign falsa; as
  mensalidades pelo Asaas são da sessão do Asaas).
- O celular (o roteiro roda em 1440 px; repetir H1–H4 em 375 px se sobrar tempo).
- O e-mail e o WhatsApp de verdade.
- A produção: nada aqui toca nela.
