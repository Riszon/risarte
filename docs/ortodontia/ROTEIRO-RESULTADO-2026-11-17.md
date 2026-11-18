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
