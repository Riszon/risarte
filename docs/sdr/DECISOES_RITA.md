# Decisões da Rita — respostas ao levantamento

> Responde à seção 6 do `docs/sdr/LEVANTAMENTO_DADOS_RITA_RESULTADO.md` (03/11/2026).
> Coloque este arquivo em `docs/sdr/` no repositório do riSZon. Ele complementa o `SDR_KICKOFF.md`.

**Legenda**
- ✅ **Decidido** pelo Jeferson. Vale como regra.
- 💡 **Recomendado.** Use como padrão, mas confirme comigo antes de implementar algo difícil de desfazer.
- ❓ **Aberto.** Aguardando decisão de negócio. Não implemente: deixe configurável ou pendente.

---

## 1. Respostas às 33 perguntas

### Identidade, acesso e auditoria
| # | Status | Resposta |
|---|---|---|
| 1 | 💡 | Sim, a Rita aparece como **autora nominal** ("Rita (assistente virtual)") na auditoria, na linha do tempo do Indica e em `welcome_contacts`. Adotar a **opção mista (iii)** da seção I5: borda com segredo, funções `rita_*` security definer fechadas a `anon`/`authenticated`, perfil técnico "Rita" sem login como autor, log `rita_actions`. Ajustar `audit_capture` para aceitar autor declarado na transação. |
| 2 | 💡 | Uma Rita para a rede, na **Franqueadora**, com escopo por unidade e interruptor por unidade. |
| 3 | 💡 | **Ligar:** só Admin Master (rede e unidade). **Desligar (pânico):** Admin Master ou Gerente da própria unidade, a qualquer momento. A unidade não liga se a rede estiver desligada. |
| 4 | 💡 | Regra já definida antes: **o Consultor RisLife só acessa as empresas de que é responsável**. Hoje isso não está imposto (`is_program_manager()` inclui `rislife_consultant`). Corrigir, mas como tarefa separada, com plano próprio, porque afeta funil, notificações e cobranças. |

### Avaliação e agenda
| # | Status | Resposta |
|---|---|---|
| 5 | ✅ | A avaliação é **paga**, com valor configurado por unidade no riSZon, mas **não pode ser barreira para o agendamento**. Gratuidade: indicado do Indica +Risos (Avaliação de Boas-vindas); Empresarial conforme os benefícios da empresa; **campanhas de isenção** criadas pela unidade ou pela rede. Quando o paciente diz que o valor é um problema, a Rita oferece a **campanha de isenção ativa** no riSZon; se não houver campanha ativa, passa para a recepção decidir. A Rita nunca isenta por conta própria. Prever no riSZon: campanhas de isenção da avaliação por unidade/rede, com validade e texto aprovado. |
| 6 | 💡 | A avaliação vira **procedimento oficial do catálogo** ("Avaliação"), para reaproveitar o preço por unidade e os benefícios por procedimento do Empresarial e do PPR+. |
| 7 | ✅ | Duração padrão: **60 minutos**, configurável por unidade (cascata). Com mais de um coordenador, a Rita oferece os primeiros horários livres de qualquer um. |
| 8 | ✅ | A avaliação exige **sala e profissional** livres. A Rita só oferece horário em que os dois estão disponíveis. |
| 9 | ✅ | Horário de funcionamento: **padrão sugerido pela rede, cada unidade configura o seu**, inclusive por dia da semana (ex.: sábado diferente). Feriado **sem decisão registrada pela gerente = unidade fechada** para a Rita (ela não oferece horário). Feriados estaduais e municipais também precisam estar no riSZon. |
| 10 | ✅ / 💡 | ✅ O paciente pode **remarcar ou cancelar pela Rita a qualquer momento**, sem limite de antecedência. 💡 Resposta "SIM" à confirmação D-1 marca `confirmed` sozinha; falta continua marcada pela recepção; rotina sinaliza avaliação passada sem check-in. |
| 11 | 💡 | "Fechou" = `commercial_sales.closed_at` (mesma regra do Indica +Risos), lido por função que devolve só verdadeiro/falso. |

### Lead e cadastro
| # | Status | Resposta |
|---|---|---|
| 12 | ✅ | **Leads em geral:** a Rita agenda a avaliação com **pré-cadastro: nome completo, data de nascimento, telefone e unidade**. A recepção completa o restante no dia. Exige ajustar a regra I4 (cadastro completo) **só para a avaliação** agendada pela Rita. **Empresarial:** a Rita completa o cadastro no riSZon antes de confirmar o agendamento (decisão anterior mantida). |
| 13 | ✅ | Sim, a Rita atualiza **campos isolados**, com registro da fonte ("informado pelo paciente via Rita"). |
| 14 | ✅ | Canais: `indica_mais_risos`, `empresarial`, `evento`, `redes_sociais`, `espontaneo`. Prioridade: **Empresarial > Indica +Risos > evento > redes sociais > espontâneo**. |
| 15 | 💡 | Telefone compartilhado: a Rita pergunta com quem está falando antes de usar qualquer cadastro e nunca revela dados de um cadastro encontrado (kickoff 3.1). Texto do consentimento de WhatsApp: com o DPO (aberto). |

### Indica +Risos
| # | Status | Resposta |
|---|---|---|
| 16 | ✅ | Antes de **Validar**, a Rita confere: telefone válido; não é paciente em tratamento; **não é colaborador do Empresarial**; **não é Risartano**; não é indicação duplicada; sem recusa ou opt-out anterior. Colaborador do Empresarial ou Risartano: **Recusar** com o motivo padrão ("colaborador(a) do Risarte Empresarial…" / "colaborador(a) da Risarte, não conta como indicação"). 💡 Agendamento futuro sem check-in: não validar, deixar o motivo e avisar a recepção. |
| 17 | ✅ | O aceite pelo WhatsApp é registrado como **"Aceitou por telefone"** (`registrar_aceite(id, 'telefone')`, que o banco já aceita). O canal real (WhatsApp) fica registrado no contato da linha do tempo. |
| 18 | 💡 | Sim: "não quero contato" bloqueia novas abordagens da Rita para aquele telefone, mesmo em nova indicação. |
| 19 | ✅ | O convite vale 7 dias (`consentimento_prazo_dias=7`). A Rita envia **um único lembrete** dentro do prazo. **A Rita não expira nem recusa por prazo:** a rotina diária do Indica, que já encerra por falta de aceite, continua fazendo isso (evita a colisão do risco 15). Sem reenvio de convite. |
| 20 | ✅ | Quem indicou só é avisado **com autorização do indicado**, em todas as etapas ("agendou", "compareceu", "fechou"). Sem autorização, as mensagens não citam o nome do indicado. As mensagens automáticas atuais violam isso: corrigir (E10). Criar o modelo e o evento "agendou". |
| 21 | ✅ | Benefício do indicado: **Avaliação de Boas-vindas sem custo + 10% no primeiro tratamento fechado**, uma única vez, dentro da validade (`beneficio_validade_dias=60`). A Rita **só informa**; a aplicação é do comercial. |
| 22 | ✅ | Envio por **um único número, o da Rita**. Indicações conduzidas pela Rita **contam para a meta da unidade e para o Risartano que solicitou a indicação** (`risartano_origem_id`). A Rita não entra no ranking. |
| 23 | 💡 | A Rita **consome** a fila `indica.mensagens` (como prevê a migração 2006), acrescentando os campos de envio. |

### Empresarial
| # | Status | Resposta |
|---|---|---|
| 24 | ✅ | A empresa recebe as boas-vindas quando: **fechamento feito (contrato assinado + pagamento da implantação)**, empresa **ativa**, e **colaboradores e dependentes cadastrados no programa**. Empresa suspensa não recebe. |
| 25 | ✅ | Aprova o disparo: **Consultor RisLife responsável pela empresa ou Admin Master**. Uma mensagem de boas-vindas + **um lembrete**; sem resposta, entra em "não contatados" para o consultor acionar o RH. |
| 26 | ✅ / 💡 | ✅ A carência conta **da importação na lista** (como funciona hoje, `joined_at`). 💡 A Rita oferece as unidades da parceria, com `main_clinic_id` como padrão. |
| 27 | ✅ | **Dependente sem CPF** (ex.: criança) pode ser cadastrado e agendado: nome, data de nascimento e vínculo com o titular (muda a regra atual de CPF obrigatório em `dependents`). **Dependente adulto com telefone próprio** pode receber as boas-vindas e agendar diretamente com a Rita. **Dependente menor** é sempre tratado com o titular; a Rita nunca o contata diretamente. |

### Equipe, políticas e infraestrutura
| # | Status | Resposta |
|---|---|---|
| 28 | ✅ / 💡 | ✅ Fora do horário comercial, a transferência fica para o **próximo dia útil**: a Rita avisa o paciente e a recepção da unidade recebe na abertura. Urgência recebe a mensagem de pronto atendimento definida pelo RT. 💡 Alerta de SLA estourado vai ao Gerente da unidade; se persistir, ao Admin Master. |
| 29 | ✅ | O **Admin Master** aprova termos proibidos, respostas com tema clínico e a FAQ, como Responsável Técnico da rede. |
| 30 | ❓ | Política de privacidade, DPO, atrasos, remarcação, faltas, menores: aguardando (formulário Parte 6). |
| 31 | ✅ / ❓ | ✅ **Sem financiamento** de terceiros. ✅ **Não aceita convênios odontológicos de terceiros**, mas a Risarte tem **parcerias** com programas e empresas (ex.: Aliança Unipax, SAF Bom Pastor): cada unidade precisa poder configurar no riSZon as parcerias que tem, além dos programas próprios (Empresarial, PPR+), para a Rita reconhecer e informar. ✅ **Alto valor** (nota do lead): implantes e protocolo; lentes e facetas. ❓ Oferta por unidade, idade mínima e campanhas de paciente: formulário Partes 4 e 3. |
| 32 | ✅ / 💡 | ✅ Na fase Sombra, **nenhum envio**: gera e grava com status `shadow`. 💡 Padrão do repositório: pg_cron monta a fila e o Vercel Cron despacha. Verificar a frequência permitida pelo plano da Vercel. |
| 33 | ✅ | Sim, todas as unidades no fuso de Brasília. |

---

## 2. Correções do sistema atual (independentes da Rita)

O levantamento encontrou problemas que já afetam o riSZon hoje. Tratar em tarefa própria, com plano aprovado, antes ou em paralelo à Fase 0:

1. **Webhook do Asaas** aceita qualquer chamada se `ASAAS_WEBHOOK_TOKEN` não estiver definida. Conferir já se está definida em produção e fazer a função recusar quando faltar.
2. **Indica +Risos avisa quem indicou** que o indicado compareceu e fechou **sem autorização do indicado** (LGPD).
3. **Anonimização do Indica** não limpa `indica.mensagens`; **tokens de convite em claro** em `mensagens.link_caminho`.
4. **Consultor RisLife vê todas as empresas** (pergunta 4).
5. **Agendamento sem trava real** contra conflito simultâneo e **possível erro de fuso** no cálculo de horários livres. Provar o erro de fuso antes de corrigir.
6. **`importEmployees` ignora o limite contratado** de colaboradores.
7. `procedures` com leitura liberada expõe **comissões**.

---

## 3. Ajustes no plano de fases

O levantamento mostrou que a Fase 0 do kickoff ficou grande. Divisão recomendada:

- **Fase 0A — Base de dados e segurança:** identidade da Rita (opção iii), `rita_settings` (interruptor, modo, portão), consentimento e opt-out, dados públicos das unidades, dados da avaliação, rotas de escalonamento, `_rita_notify`, tela "O que a Rita sabe".
- **Fase 0B — Canal WhatsApp:** webhook da Meta (HMAC, idempotente), envio, `rita_outbox`/`rita_inbox`, modo Sombra, segredos.
- **Fase 1 — Sombra:** RPCs de leitura (horários livres, status do cliente, campos faltantes, fila do Indica, elegibilidade do Empresarial, benefícios), FAQ e termos proibidos.

As lacunas da seção 3.3 do levantamento seguem para a Fase 2 em diante.

---

## 4. Consultas agregadas

✅ As 6 consultas da seção 7 do levantamento (só contagens, sem dados de pessoas) estão **autorizadas em produção e no treino**, somente leitura. Reportar os números dos dois ambientes junto com o plano da Fase 0A.
