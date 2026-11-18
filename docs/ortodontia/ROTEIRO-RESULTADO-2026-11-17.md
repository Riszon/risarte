# Resultado — execução de 17/11/2026

| Passo | Resultado | O que se viu / consulta |
|---|---|---|
| P1 | ✅ | Log do servidor: `banco: bsnptybalszjjbhxeejo.supabase.co` (treino) |
| P2 | ⚠️ | Planner e Financeiro de teste alcançam a Unidade Teste (`unit_scope = all`); o **Consultor de teste não alcança nenhuma unidade** (`unit_scope` nulo, sem `role_unit_access`). Para o bloco B, acesso dado só a essa conta de teste (ver "Mudanças de preparação") |
| P3 | ✅ | Ajuste da Unidade Teste salvo pela tela ("Configuração salva."): R$ 200,00, mínimo R$ 150,00, pontualidade 5% (máx. 10%), reajuste 5%, manutenção "Manutenção de aparelho ortodôntico - aparelho fixo"; a linha da rede ficou igual (R$ 0, sem procedimento) |
| P4 | ✅ | Recepção cadastrou "Paciente Roteiro Ortodontia" na Unidade Teste ("Cliente cadastrado."): RUT-00042, `registration_complete = true`, fase Aquisição |
| P5 | ✅ | Avaliação com o Coordenador de Teste, 17/11 20:30 ("Agendamento criado."); `appointments` tipo `evaluation`, `scheduled` |
| P6 | ✅ | Chegada pela tela ("Chegada registrada…"); fase passou a `clinical_conversion` |
| A1 | ✅ | Coordenador chamou (a tela tentou gravar a consulta; o microfone é bloqueado no navegador de teste, aviso esperado), registrou o consentimento LGPD e salvou a anamnese Geral com Diabetes marcado ("Anamnese salva."); `anamnesis_fills` = 1 |
| A2 | ✅ | Passo 3 → "Indicar tratamento ortodôntico" + "classe II (roteiro de teste)" ("Indicação de ortodontia registrada."); `clinical_evaluations.ortho_indicated = true`, nota gravada, `ortho_indicated_by` = coordenador de teste |
| A3 | ✅ | Passo 8 → "Enviar ao Centro de Planejamento" ("…enviado(a) ao Centro de Planejamento."); fase `planning_center` |
| A4 | ✅ | Planner: cartão "Ortodontia indicada pelo Coordenador" no cockpit; aberto mostra a Avaliação 1, data/hora e "classe II (roteiro de teste)" |
| A5 | ✅ (ajuste) | Plano novo, "Opção A — ortodontia e restauração": "Aparelho ortodôntico fixo metálico" (arcadas superior e inferior; **R$ 0,00 no catálogo do treino**) + "Limpeza (profilaxia)" R$ 180,00 no lugar da restauração (a restauração exigiria marcar dente no odontograma; o plano continua misto) |
| A6 | ✅ | Bloco "Proposta ortodôntica" aparece sozinho quando a opção tem procedimento de Ortodontia; salvo ("Proposta ortodôntica salva."): `treatment_plan_ortho` aparelho_fixo, 24 meses, 30 dias, contenção `ambas`, nota |
| A7 | ✅ | Diagnóstico, objetivos, pilar "Função", prioridade Alta nos dois, sequência confirmada, **diagnóstico por dente finalizado pelo Planner** (exigência do envio: "O diagnóstico por dente ainda não foi finalizado…") e envio ("Plano … enviado para aprovação.") |
| A8 | ✅ (fase a conferir) | Coordenador, prontuário aba Plano: a opção mostra a Proposta ortodôntica (aparelho fixo, 24 meses, 30 dias, placa + fixa); "Aprovar opção" ("…aprovada."); `treatment_plans.status = approved`, opção `approved`. **A fase ficou em `planning_center`**; o roteiro esperava `commercial_conversion` aqui — conferir no bloco B se a fase anda no Comercial (provável expectativa errada do roteiro) |

**Mudança de preparação recusada:** dar à conta de teste do Consultor acesso à Unidade Teste pelo banco foi barrado pela trava de segurança da sessão. Não contornado. O bloco B segue com o **Gerente de teste**, que pelo desenho também fecha o acordo ortodôntico (`save_negotiation_ortho`: Consultor, Gerente ou Admin).
| A9 (faltava no roteiro) | ✅ | Regra R3: depois da aprovação o plano vai ao Comercial. Admin, aba Plano → "Enviar para apresentação" ("Situação atualizada…"); `lifecycle = aguardando_apresentacao`. A fase continua `planning_center`: ela muda na apresentação comercial |
| B | ⛔ bloqueado | O Gerente de teste é mandado de volta ao prontuário ao abrir `/comercial/[cliente]` (o cockpit é do Consultor). O Admin abre o cockpit, que diz "O cliente não está na Conversão Comercial — a negociação abre quando o caso chegar ao Comercial". Para chegar lá falta a apresentação comercial com um Consultor que alcance a Unidade Teste; o de teste não alcança, e dar esse acesso foi recusado pela trava de segurança. **B, C, D, E, F e G não foram executados** |
| H1 | ✅ | Admin e Gerente de teste: prontuário abre em **Cadastro**; painel "Precisa de atenção (1)" com "Condição de saúde relevante marcada — atenção no atendimento", etiqueta "Diabetes" e o botão "Ver anamnese" |
| H2 | ✅ | Coordenador de teste: abre em **Clínico** |
| H3 | ✅ | Planner de teste: abre em **Plano** |
| H4 | ⏭️ | Dentista de teste: "Acesso restrito — Você só tem acesso ao prontuário dos pacientes que você atende" (certo: ainda não atendeu). A aba de abertura dela só se confere no bloco C |
| H6 | ✅ | Tema escuro pelo botão da barra: painel de atenção, etiqueta e pílulas legíveis (foto). Voltei ao tema claro |
| H5, H7 | ⏭️ | Dependem de aviso e de caso; não executados |

## Resumo

- **Executados:** P1–P6, A1–A9, H1–H3, H6. **Bloqueados:** B a G (sem Consultor que alcance a Unidade Teste). **Pulados:** H4, H5, H7.
- **Defeitos do sistema achados:** nenhum.
- **Do roteiro, corrigidos depois desta execução:** faltavam (1) o Planner finalizar o diagnóstico por dente antes de enviar o plano e (2) o "Enviar para apresentação" depois da aprovação; e a fase só muda para Conversão Comercial na apresentação comercial, não na aprovação.
- **Do treino:** a conta de teste do Consultor (`consultor@example.com`, Franqueadora Teste) não alcança nenhuma unidade (`unit_scope` nulo, sem `role_unit_access`).

## Resíduos no treino

- Paciente "Paciente Roteiro Ortodontia" (RUT-00042), Unidade Teste, com anamnese (Diabetes), consentimento, indicação de ortodontia, diagnóstico finalizado, plano aprovado em "aguardando apresentação". Fica para continuar o roteiro.
- A avaliação de 17/11 20:30 ficou **em atendimento** (chamada, não concluída).
- Ajuste da ortodontia da Unidade Teste (R$ 200,00 etc.). O padrão da rede não foi tocado.

## Retomada (autorizada pelo dono)

| Passo | Resultado | O que se viu / consulta |
|---|---|---|
| P2b | ✅ | Com a autorização do dono: `role_unit_access` do papel de Consultor de `consultor@example.com` → Unidade Teste (só no treino; sai na limpeza). `providers_with_access` agora o inclui |
| B1 | ✅ (atalho) | Recepção agendou "Apresentação Comercial" (online) com o Consultor de Teste; hoje já sem horário, entrou 18/11 09:00. **[ATALHO DE DATA]** horário trazido para 17/11 21:35 (logo depois da avaliação, para não conflitar). Chegada registrada; Atendimento mostra a marca "Comercial". Observação do navegador de teste: com a janela escondida, alguns cliques em listas e botões não chegam; pelo teclado funcionam (não é defeito do sistema) |
| A10 (faltava no roteiro) | ✅ | Planner, aba Plano → "Plano liberado pelo Coordenador. Você pode enviar ao Comercial." → **"Enviar ao Comercial (Fase 4)"**; fase `commercial_conversion`. (Sem isso o Consultor é mandado ao prontuário e o paciente não aparece no funil) |
| P2c | ✅ | Só a lista de unidades não bastava: o papel tinha `unit_scope` nulo, e o cockpit lê `user_full_access_clinic_ids`, que exige `unit_scope = 'specific'`. Marcado `specific` (só a Unidade Teste); volta ao nulo na limpeza (`consultor-acesso.mjs --tirar`) |
| B2 | ✅ | Consultor: resumo da apresentação salvo; negociação PIX à vista R$ 180,00 (limpeza) salva; **Acordo ortodôntico** R$ 140,00 / 12 / boleto / dia 10 / 5% → "Acordo fora da regra — enviado ao Gerente da unidade para autorização." Banco: `plan_negotiations.status = aguardando_autorizacao`, motivo "Mensalidade ortodôntica de R$ 140.00 abaixo do mínimo de R$ 150.00"; `plan_negotiation_ortho` 14000/12/boleto/10/5.00. Foto. ⚠️ O motivo aparece na tela com ponto ("R$ 140.00"), igual aos outros motivos da regra comercial (formato do banco) |
| B3 | ✅ | Corrigido para R$ 200,00 → "Acordo ortodôntico salvo."; banco `em_negociacao`, sem violação |
| B4 | ✅ | "Cliente aceitou" → banco `aceita` (o aviso da tela passou rápido demais para ser lido) |
| B5 | ❌ → contornado | **Defeito:** o Consultor de teste (papel na Franqueadora, com acesso à Unidade Teste) não vê o envio do contrato no Fechamento: "A situação da assinatura digital não aparece para a sua função". O banco permite (`signature_can` aceita o papel da Franqueadora com acesso à unidade); a tela usa `pode(session, …, clinicId)`, que só olha a função na própria unidade. Contorno: o Gerente de teste enviou. 1ª tentativa pela ficha (aba Documentos) → ASS-000111, origem `client` |
| B6 | ❌ → contornado | ASS-000111 assinado por todos (simulador, 4 webhooks 200), mas a venda **não** foi marcada: só o pacote com origem `plan_negotiation` fecha a venda. E o Fechamento passou a dizer "Este documento já foi assinado por todos… Não é preciso assinar de novo" — quem enviou pela ficha fica sem caminho, a não ser o papel. Contorno: Gerente, `/apresentacao` → Fechamento → "É um documento novo" com motivo → ASS-000112 (`plan_negotiation`); 4 assinaturas simuladas → `commercial_sales.contract_signed = true`, fonte `assinatura_digital`. Servidor local reiniciado com um segredo de webhook só de teste |
| B7 | ✅ | Recepção, ficha → Financeiro → "Dar baixa" R$ 180,00 em dinheiro, caixa → "Recebimento registrado — cobrança quitada." Banco: parcela `paga` |
| B8 | ✅ | Venda fechou sozinha (`closed_at` preenchido, pagamento `balcao`); fase `treatment_start`. Caso ORT-000032 `aguardando_inicio`, origem `venda`, ortodontista nulo; termos 20000/12/boleto/5.00 |
| B9 | ✅ (ajuste) | Aviso "Ortodontia: caso fechado — agendar a instalação" com link do caso para Gerente de teste, Coordenador de teste e o Coordenador real (D1). **A Recepção de teste não recebeu** porque foi ela quem fechou a venda: a regra não avisa quem fez (`user_id is distinct from v_user`). Visto no sino do Gerente, aba Ortodontia (foto) |
| B10 | ✅ | Gerente: Painel "Aguardando início 1 · 1 sem horário de instalação"; Início com o cartão "Ortodontia: aguardando instalação sem horário" |
| B11 | ✅ (Gerente) | `/ortodontia/casos` sem "Novo caso" para o Gerente. Pelo Admin não conferido: a cópia da senha do Admin de teste foi barrada pela trava de segurança |
| B12 | ❌ | **Defeito:** 4 sessões em vez de 2. Cada item do plano (aparelho e limpeza) ganhou duas sessões iguais (`session_index 1/1`), criadas em duas transações da Recepção com 18 ms de diferença, ao abrir a ficha logo depois do fechamento. A ficha chama `ensure_treatment_sessions` e `topup_treatment_sessions` na mesma abertura; as duas conferem "não existe" sem trava. (O roteiro dizia "instalação + restauração"; o plano tem aparelho + limpeza) |
| C1 | ✅ | Recepção, ficha → Novo agendamento → "Sessão de Tratamento", Dentista de Teste, limpeza (1ª cópia), hoje 22:45, 30 min ("Agendamento criado."). A Unidade Teste atende até tarde: sem atalho de data. "Manutenção ortodôntica" **não** aparece com o caso aguardando início (certo) |
| C2 | ✅ | `ortho_cases.orthodontist_id` nulo; 0 manutenções |
| C3 | ✅ | "Início de Tratamento" com a sessão do aparelho, Dentista de Teste, 23:15. 0 manutenções ligadas; ortodontista ainda nulo. Aviso "conflito entre unidades" (a Dentista tem atendimento em Londrina) — informativo |
| C4 | ✅ | Chegada (Recepção) → Dentista chama → cai na ficha em **Desenvolvimento Clínico** (H4 ✅) → evolução → "Atendimento concluído." Sessão `done`, `executed_by` = Dentista |
| C5 | ✅ | Ficha do caso: "Em tratamento", início 17/11/2026, término 17/11/2028, ortodontista Dentista de Teste, 24 manutenções previstas (1ª 17/12/2026), histórico "Ortodontista responsável assumido…", "Tratamento iniciado… (sessão do plano)", "Lote 1… emitido". Foto |
| C6 | ❌ | **Nenhum** repasse da instalação (`provider_payouts` da sessão = 0; de manutenção = 0). Causa: a cópia pendente da sessão do aparelho (B12) — `_payout_accrue_block` só paga quando todas as sessões do mesmo procedimento estão feitas ou canceladas. Consequência do defeito do B12, não de outro |
| C7 | ✅ | Lote 1 ativo: 12 × R$ 200,00, boleto, 11/2026 a 10/2027, 12 cobranças. ⚠️ **Suspeita (regra a decidir):** a 1ª vence em **10/11/2026**, antes da instalação (17/11): o vencimento é sempre o dia de cobrança do mês, mesmo já passado (`_ortho_emit_batch`, 0335). A cobrança nasce vencida |
| C8 | ✅ | Limpeza concluída (chegada, chamada, evolução). 0 manutenções ligadas; cronograma igual (24). O repasse da limpeza também não nasceu (a cópia pendente dela, B12) |
| D1 | ✅ | Ficha do caso → "Agendar" → `/agenda?cliente=…&tipo=ortho_maintenance`; janela com "Manutenção ortodôntica" e o aviso das sessões a agendar em seguida. Foto. ⚠️ A lista "Sessões do plano a agendar" mostra a cópia do aparelho como se faltasse instalar (B12) |
| D2 | ✅ | Trocado para "Sessão de Tratamento" + Dentista de Teste → "Este paciente tem caso ortodôntico, e este é o ortodontista dele… Trocar para Manutenção ortodôntica". Foto |
| D3 | ✅ | "Trocar" → 17/12/2026 10:00 → "Agendamento criado."; a janela oferece a sessão do plano em seguida (11:00) → "Agora não". Banco: manutenção 1 `agendada`, ligada, `from_appointment = false` |
| D4 | ✅ | "Retorno" com a ortodontista (01/12 10:00): o mesmo aviso aparece; 0 manutenções ligadas |
| D5 | ✅ | "Sessão de Tratamento" (cópia da limpeza) 14/01/2027 09:00: **antes** de salvar, "Este paciente tem manutenção ortodôntica prevista para 16/01/2027. Ao salvar, a janela já prepara a manutenção…"; depois, a janela preparou "Manutenção ortodôntica" 14/01 10:00 com a Dentista. Sessão sem manutenção |
| D6 | ✅ | Salvo: manutenção 2 `agendada` (14/01 10:00), sem extra (total 24) |
| D7 | ✅ | **[ATALHO DE DATA]** manutenção 1 trazida para hoje 23:45. Chegada, chamada; ficha do caso → "Registrar" (fio NiTi 0.14, observação, próximo passo) → "Manutenção realizada e evolução salva."; depois "Concluir atendimento" na ficha. `realizada`, `done_by` = Dentista; **1** repasse (R$ 35,00), sem dobrar ao concluir pelos dois caminhos |
| D8 | ✅ | Ficha abre em Desenvolvimento Clínico com "Ortodontia — manutenção 1 realizada em 17/11/2026 · Fio/arco…". Foto |
| D9 | ✅ | Ficha do caso da Dentista sem R$ ("A situação financeira é vista por quem tem a permissão…"); no banco, como a Dentista, `ortho_case_terms` → 0 linhas |
| D10 | ✅ (banco) | Como Coordenador e Gerente, `ortho_case_terms` → R$ 200,00. A tela do Coordenador não foi aberta |
| D11 | ⏭️ | Não executado (sem outra dentista de teste; ficaria para o Coordenador; tempo) |
| H4 | ✅ | Dentista abre a ficha em Desenvolvimento Clínico |
| H7 | ✅ | Dentista: `/ortodontia/mensalidades` e `/ortodontia` levam a "Atenção", sem valores ("Mostrando só os casos em que você é o ortodontista") |
| E2 | ❌ → Gerente ✅ | **Defeito (mesma raiz do B5):** o Financeiro de teste (Franqueadora) é mandado de `/ortodontia/mensalidades` para "Atenção" quando a unidade ativa é a Unidade Teste; pela "Rede toda" (`?unidade=all`) a lista abre com "Dar baixa", mas ao confirmar: "Você não pode dar baixa nesta mensalidade." O banco permite (`ortho_can_settle` = true para ele); a ação recusa em `canSettleOrtho(session, clinic_id)` → `pode(…, clinicId)`, que só olha a função na própria unidade. Pelo Gerente: mensalidade 12/2026 paga hoje → prévia "desconto de R$ 10,00 (5%) — o paciente paga R$ 190,00" → "Cobrança paga com desconto de pontualidade de R$ 10,00." Banco: `discount_cents 1000`, `paid_amount_cents 19000`; razão 1.1.04 `settled` R$ 190,00. Foto |
| E3 | ✅ | Ícone "Desfazer a baixa" (ficha do caso) → "Baixa desfeita." Banco: `em_aberto`, razão `open` R$ 200,00. Observação: desfaz com um clique, sem confirmar |
| E4 | ✅ | Gerente, mensalidade 11/2026 (venc. 10/11, já "Atrasada" na tela) paga hoje → "Valor integral: R$ 200,00 (o desconto de 5% valia até 10/11/2026)". `discount_cents 0`, pago R$ 200,00 |
| E5 | ✅ | **[ATALHO DE DATA]** mensalidade 01/2027 com vencimento 05/11/2026. Depois da rotina (E8): `atrasada`; selo "Mensalidade atrasada" na ficha e na Atenção |
| E6 | ✅ | **[ATALHO DE DATA]** as parcelas 02/2027–10/2027 com vencimento 17/12/2026 (a rotina mede pela maior data de vencimento do lote, então só mover a última não basta). Rotina: aviso "lote de mensalidades termina em até 30 dias — renovar ou encerrar?" para Gerente de teste, Financeiro de teste e **um Financeiro real da Franqueadora** (André de Paula Costa, no treino). Atenção mostra o motivo |
| E7 | ✅ (ajuste) | Ficha → "Emitir novas mensalidades": 6 × R$ 200,00 → "Lote de mensalidades emitido."; lote 2 11/2027–04/2028, lote 1 `encerrado`/`renovar`. A sugestão é R$ 200,00, **certo**: o reajuste anual só entra com 12 meses de tratamento (`suggestedRenewalAmount`); o roteiro esperava R$ 210,00. ⚠️ A janela continuou aberta depois do sucesso, já falando do lote 2 (convida a emitir de novo) — suspeita de tela |
| E8 | ✅ | `ortho_daily_alerts(Unidade Teste)` como o Gerente de teste → 9 avisos |
| E9 | ✅ | "Suspender" com motivo → "Situação atualizada."; `suspenso`, mensalidades dos meses seguintes `cancelada` (17), lotes 1 e 2 `encerrado`, 22 manutenções previstas `cancelada`; a agendada de 14/01 ficou |
| E10 | ✅ | "Retomar o tratamento" → `em_tratamento`, nenhum lote novo; cronograma completado (22 previstas novas, a partir de 15/02/2027) |
| E11 | ❌ | **Defeito:** "Emitir novas mensalidades" depois da retomada criou o lote 3 em **05/2028–10/2028**, "no mês seguinte ao último" do lote 2 — que a suspensão cancelou inteiro. De 12/2026 a 04/2028 o paciente ficou sem mensalidade nenhuma. O lote novo devia partir do mês seguinte à última cobrança **não cancelada** (ou do mês atual) |
| F2 | ✅ | Rotina de novo → 0 avisos novos |
| F4 | ✅ | **[ATALHO DE DATA]** reavaliação em 16/11. Aviso "Ortodontia: reavaliação vencida" para o Coordenador de teste, a ortodontista (Dentista de teste) e o Coordenador real (D1); `ortho_case_notices` `reavaliacao_vencida` |
| F5 | ✅ | Aviso "Ortodontia: mensalidade atrasada" para Gerente de teste, Financeiro de teste e o Financeiro real; `ortho_case_notices` `mensalidade_atrasada` |
| E1 | ✅ | Recepção: `/ortodontia/mensalidades` mostra o paciente, nenhum botão de baixa nem de desfazer |
| F1 | ✅ | **[ATALHO DE DATA]** a manutenção prevista mais antiga com data 07/11. A Recepção cancelou pela agenda a manutenção de 14/01 ("Status alterado para Cancelado.") — a manutenção voltou a `prevista` sem agendamento (a liberação da 0417 funcionando). Rotina → "Ortodontia: manutenção vencida sem agendamento" para Recepção e Gerente de teste, um de cada; `ortho_case_notices` `manutencao_vencida` |
| F6 | ✅ | Recepção agendou "Manutenção ortodôntica" (hoje sem horário livre; 18/11 00:00) → ligou-se à manutenção vencida (seq 25). Rotina → 0 avisos |
| F3 | ✅ | Agenda → "Ver informações" → "Faltou" → manutenção `faltou`, `extension_days` 30, término 17/12/2028. A rotina só olha faltas até hoje: com o horário em 18/11 00:00 não avisou (certo). **[ATALHO DE DATA]** horário trazido para 17/11 23:59 → "Ortodontia: faltou à última manutenção — reagendar" para Recepção e Gerente. Observação: a tela deixou marcar "Faltou" num horário que ainda não tinha chegado |
| G1 | ✅ | Gerente, ficha → "Desfazer falta" → "Manutenção atualizada."; `extension_days` 0, término 17/11/2028 |
| G2 | ✅ | "Entregar contenções", cobrar R$ 300,00 → "Contenções entregues — tratamento finalizado; a cobrança da contenção foi gerada." `contencao`, `retainer_delivered_at`; mensalidades seguintes `cancelada`; previstas `cancelada`; `ortho_charges` `contencao` R$ 300,00 em aberto |
| G3 | ✅ | `treatment_closures` escopo `ortodontia`, situação `pergunta` (Jornada, 0418) |
| G4 | ✅ | O Gerente de teste não tem "Novo agendamento" na agenda; feito pela Recepção: "Manutenção ortodôntica" oferecida com o caso em acompanhamento; controle em 17/02/2027 10:00 → manutenção 48 `agendada`, `from_appointment = true` |
| G5 | ✅ | "Dar alta" → "Situação atualizada."; `finalizado`, `discharged_at` 18/11. ⚠️ Suspeita: o controle de 17/02/2027 continua `agendada`, ligado a um caso já encerrado (nem cancelado, nem aviso) |
| G6 | ✅ | Prontuário: cartão "Ortodontia · Aparelho fixo · Alta". Na agenda da Recepção, "Manutenção ortodôntica" sumiu dos tipos. ⚠️ O cartão diz "1 mensalidade em atraso", mas o que está em aberto é a cobrança da **contenção** (o rótulo chama tudo de mensalidade) |
| H5 | ⏭️ | Não havia aviso "Pedido respondido" de outro paciente para abrir |

Observação de ambiente: à meia-noite a sessão do treino caiu e o servidor local parou; foi religado e as contas entraram de novo (comportamento já descrito no projeto).

## Limpeza (I)

| Passo | Resultado | O que se fez |
|---|---|---|
| I1 | ✅ | O caso terminou em **alta** (G5); não foi preciso interromper |
| I2 | ✅ | Os 3 agendamentos futuros do paciente cancelados (Retorno 01/12, sessão 14/01, controle 17/02). Nenhum futuro marcado. Ao cancelar o controle apareceu o AP182 |
| I3 | ⏳ | Ajuste da ortodontia da Unidade Teste mantido: remover só com o OK do dono |
| I4 | ✅ | Servidor local parado (porta 3100 livre); a configuração temporária do painel apagada. 11 GB livres; a `.next-test` ficou (o `servidor:treino` a limpa sozinho) |
| Acesso | ✅ | Acesso do Consultor de teste tirado: sem unidade e `unit_scope` de volta ao nulo, como estava antes (`providers_with_access` não o inclui) |

## Resumo da retomada

- **Executados:** B1–B12, C1–C8, D1–D10, E1–E11, F1–F6, G1–G6, H4, H7. **Pulados:** D11 (sem outra dentista de teste), H5 (sem aviso para abrir). **Pelo Gerente em vez do Admin:** B11 (a cópia da senha do Admin de teste foi barrada pela trava de segurança).
- **Defeitos registrados no backlog (18/11/2026):**
  - **AP178 (alta):** a tela confere a permissão só na unidade e barra quem é da Franqueadora: o Consultor não envia o contrato pelo cockpit (B5) e o Financeiro da Franqueadora não dá baixa nas mensalidades da ortodontia (E2). O banco permite os dois.
  - **AP179 (alta):** sessões do plano duplicadas ao abrir a ficha logo depois do fechamento da venda; por isso o repasse da instalação e da limpeza não nasceu (B12, C6).
  - **AP180 (média):** o contrato assinado pela ficha não fecha a venda, e o Fechamento recusa reenviar (B6).
  - **AP181 (alta):** o lote emitido depois de suspender e retomar começa depois do lote cancelado: 17 meses sem mensalidade (E11).
  - **AP182 (média):** cancelar o agendamento devolve a "prevista" a manutenção que nasceu do agendamento (limpeza).
  - **AP183 (baixa, decisão do dono):** achados menores, entre eles a 1ª mensalidade que nasce vencida.
- **O que funcionou como planejado:** o acordo ortodôntico e a trava do mínimo; o caso nascendo da venda, sem ortodontista; a instalação iniciando o caso e definindo a ortodontista (AP175); sessão do plano e Retorno sem virar manutenção (AP175); o tipo "Manutenção ortodôntica", os avisos e o "em seguida" da agenda (AP176); a evolução no prontuário; a Dentista sem valores; um repasse por manutenção; desconto de pontualidade, desfazer e baixa atrasada; os avisos da rotina, um por fato, sem repetir; suspender, retomar, contenção, alta e o tipo sumindo depois da alta.
- **Avisos que chegaram a pessoas reais, no treino:** o Coordenador real da Unidade Teste (combinado em D1) e **um Financeiro real da Franqueadora**, que recebeu "lote terminando" e "mensalidade atrasada". Esse segundo não estava previsto no D1.

## Resíduos no treino (atualizado)

- Paciente "Paciente Roteiro Ortodontia" (RUT-00042), Unidade Teste: caso ORT-000032 em **alta**; venda de R$ 180,00 fechada; pacotes ASS-000111 e ASS-000112 assinados; mensalidades 11/2026 paga, contenção de R$ 300,00 em aberto, as demais canceladas; 2 sessões duplicadas pendentes (AP179); 1 manutenção "prevista" fantasma (AP182).
- A apresentação comercial de 17/11 21:35 ficou "em espera" (não concluída pelo Consultor).
- Avisos de teste no sino das contas de teste, do Coordenador real e do Financeiro real da Franqueadora.
- Ajuste da ortodontia da Unidade Teste (R$ 200,00 etc.), à espera da decisão do dono.
