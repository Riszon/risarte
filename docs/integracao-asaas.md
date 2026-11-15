# Integração Asaas × riSZon — Especificação

Versão 3 · 10 de novembro de 2026 · Responsável: Jeferson Lopes (Risarte Odontologia)

Este arquivo é a fonte da verdade da integração. Fica em `docs/integracao-asaas.md` no repositório do riSZon.

**O que mudou da versão 2 para a 3.** A versão 3 registra as decisões tomadas na aprovação do plano final da ASA0 (10/11/2026) e o que a ASA0 entregou:

- **Taxa vigente no pagamento.** Vale o percentual da taxa da franquia e a tarifa do Asaas vigentes na data do pagamento. Quando uma taxa ou uma tarifa muda, o riSZon atualiza o split das cobranças em aberto. Isso substitui o "percentual congelado na emissão" (seção 4).
- **Rota mínima de webhook já na ASA0.** A ASA0 entrega a rota que confere o token, grava o evento bruto e responde 200, e a tabela `gateway_webhook_events`. O processamento continua na ASA2 (seção 7).
- **Chave fora da Vercel.** `ASAAS_API_KEY` fica só no `.env.local`, para o roteiro das contas de teste. Em tempo de execução, toda chave vem do Supabase Vault (seção 10).
- **Verificação semanal de cada conta.** Valida a chave, atualiza a situação e as tarifas e evita a desativação por 3 meses sem uso. Falha derruba a prontidão e avisa o Admin Master (seção 9.1).
- **Prontidão.** Entram "antecipação automática desligada, conferida pela API", "split habilitado" como declaração do Admin Master (confirmada sozinha pela ASA3 no primeiro split aceito) e "termo de autorização registrado" (data, quem assinou e observação; anexo e assinatura pelo ZapSign ficam preparados para depois).
- **Matriz 9.3.** A Recepcionista continua podendo registrar recebimento manual. O distrato continua só com o Gerente de Unidade e o Admin Master; o Financeiro da Franqueadora acompanha, sem concluir.
- **Baixa por PIX e boleto (ASA2).** `PAYMENT_RECEIVED` sem `PAYMENT_CONFIRMED` anterior é tratado como baixa e liquidação. Para a D21, a ordem é: marcar pagamento confirmado, fechar a venda, dar baixa.
- **Tarifas.** `acquirer_rates` ganhou o mínimo e o máximo da tarifa percentual (ASA0); a modalidade Pix Automático entra na ASA4B.
- **Pix Automático e cartão recorrente (ASA4B).** Registradas as restrições conferidas na documentação e a alternativa a avaliar (seção 5).
- **Régua.** O custo de SMS, WhatsApp e ligação fica com a conta da unidade; a aba Cobrança e comunicação mostra que cada canal é tarifado.

**Acréscimo à versão 3 — resposta escrita do Asaas (11/11/2026).** A equipe Sucesso de Integrações do Asaas respondeu por escrito às dúvidas técnicas. O registro completo está na **seção 13**; as seções 4, 5, 10, 11 e 12 foram ajustadas. Nada disso muda a ASA0. Em resumo:

- O split percentual incide sobre o valor efetivamente pago (passo 2 da prova do split cumprido).
- Uma entrada de split aceita `percentualValue` e `fixedValue` juntos (o formato da seção 4 está confirmado).
- Estorno total reverte o split; boleto pago pelo QR Code PIX é tarifado como PIX.
- O Pix Automático tem jornada sem pagamento inicial e aceita split com valor variável.
- A tokenização de cartão é nativa, sem liberação.
- A NFS-e de cobrança avulsa é pedida pelo riSZon.

**O que mudou da versão 1 para a 2.** A versão 2 incorpora o relatório de aderência do Claude Code (código real e documentação atual do Asaas) e as decisões tomadas em seguida:

- Reaproveita o que o riSZon já tem (taxas da rede, tarifas por meio de pagamento, split do Empresarial) em vez de criar tabelas paralelas.
- Toda unidade entra como conta vinculada; a criação de subconta fica desligada até o Asaas confirmar a viabilidade para franquias.
- Taxas percentuais incidem sobre todo recebimento, sem condições; SDR e tecnologia são valor fixo mensal.
- Pagamento confirmado apenas sinaliza a situação financeira; não há bloqueio clínico.
- Entram as mensalidades do PPR+ e da Ortodontia e a recorrência (Pix Automático e cartão de crédito recorrente).
- A prova do split passa a ter três passos, porque o sandbox não testa desconto nem multa.

---

## 1. Visão geral

O riSZon passa a emitir todas as cobranças da rede pelo Asaas, com baixa automática e split dos repasses à franqueadora já na origem. Todo recebimento — parcela de tratamento, renegociação, venda direta na clínica, mensalidade do PPR+ ou da Ortodontia, implantação ou mensalidade do Empresarial — nasce no riSZon, vira uma cobrança no Asaas e pode ser enviado ao pagador como link de pagamento.

**O que resolve**

- Fim da baixa manual de parcelas: o Asaas avisa o riSZon quando o pagamento entra.
- As taxas percentuais da franquia saem automaticamente da conta da unidade para a franqueadora, no próprio pagamento.
- Um único padrão de cobrança para as 2 unidades atuais e para as próximas.
- Menos inadimplência com cobrança recorrente automática (Pix Automático e cartão recorrente).
- Base real de recebimentos para o Módulo Financeiro.

**Escopo**

- Boleto, PIX e cartão de crédito (à vista e parcelado).
- Recorrência: Pix Automático e cartão de crédito recorrente.
- Link de pagamento para qualquer recebimento.
- Cobranças do Risarte Empresarial, emitidas pela franqueadora, com split para a RisLife.
- Split das taxas percentuais à franqueadora; cobrança mensal das taxas fixas.
- Lembretes pela régua nativa do Asaas até o WhatsApp da Risarte estar integrado ao riSZon.
- NFS-e pelo Asaas, em fase própria (ASA8).
- Central de Configuração: uma única tela para toda a configuração comercial e financeira.

**Fora desta integração:** remuneração de dentistas, antecipação de recebíveis, negativação, débito recorrente em cartão de débito ou em conta (o Asaas não oferece; o Pix Automático cumpre esse papel) e bloqueio de atendimento por falta de pagamento.

---

## 2. Decisões travadas

Vinte e duas decisões definem o desenho, fechadas entre 9 e 10 de novembro de 2026. Mudar qualquer uma delas exige revisar o modelo de dados.

| # | Tema | Decisão |
| --- | --- | --- |
| D1 | Quem recebe do paciente | O CNPJ da unidade emite e recebe todas as cobranças de paciente. |
| D2 | Contas Asaas | Toda unidade entra como **conta vinculada**: tem a própria conta Asaas e autoriza o riSZon a operá-la. Londrina e Cambé já têm conta. A Risarte Administração tem a conta raiz. A criação de subconta pela franqueadora fica construída, mas desligada, até o Asaas confirmar que é viável para franquias com CNPJ diferente. |
| D3 | Taxas percentuais (split) | Royalties, fundo de marketing, centro de planejamento e comercial são percentuais sobre **todo recebimento** de paciente, sem condições, e saem no split. |
| D4 | Base de cálculo | **Valor efetivamente pago pelo cliente** — com desconto, sobre o valor com desconto; com multa e juros, sobre o valor com multa e juros —, liquidado sempre no próprio split, sem acerto posterior. Percentuais configurados por unidade, com vigência. |
| D5 | Taxas fixas | SDR e tecnologia (sistema) são **valor fixo mensal por unidade**. Ficam fora do split e entram na cobrança mensal da franqueadora para a unidade. |
| D6 | Fundo de marketing | Por enquanto vai para a carteira da franqueadora; a carteira de destino é configurável para quando o fundo tiver conta própria. |
| D7 | Risarte Empresarial | A franqueadora emite as cobranças das empresas. **Implantação: 100% RisLife. Mensalidade: 50% RisLife e 50% Risarte**, sobre o valor pago. Percentuais configuráveis, com exceção por empresa. A unidade não recebe parte; a RisLife repassa ao consultor. |
| D8 | Pagador | A cobrança sai no CPF do responsável financeiro quando houver. Para menor, o responsável é obrigatório. Adulto pode ter um pagador opcional (cônjuge, pai, mãe). Exatamente um responsável fica marcado como financeiro. |
| D9 | Multa, juros e descontos | Vêm do que o riSZon já tem: multa, juros e arredondamento nas configurações financeiras; desconto à vista nas Regras Comerciais; pontualidade como benefício de programa, perdido no atraso; vouchers do Indica. **Carência fixa em zero** (11/11/2026): o Asaas não aplica carência, e o banco recusa outro valor (seção 14). |
| D10 | Cartão parcelado | A unidade absorve a tarifa. O máximo de parcelas vem das Regras Comerciais e das condições do programa do cliente. |
| D11 | Situação financeira | Pagamento confirmado **sinaliza** "em dia" ou "em atraso" na agenda e na ficha do cliente. O riSZon não bloqueia procedimento por falta de pagamento. |
| D12 | Distrato | Nada é cancelado no Asaas antes de o Gerente de Unidade concluir a checklist (pendências, procedimentos feitos × pagos, multa contratual). Só ao efetivar o distrato as cobranças em aberto são canceladas. |
| D13 | Devolução de repasse | Repasses já feitos à franqueadora **não são devolvidos** em distrato nem em estorno. Sem split (até a ASA3), a taxa da rede da baixa estornada continua devida; o Financeiro da Franqueadora e o Admin podem dispensá-la com motivo (16.5). |
| D14 | Comunicação | Régua nativa do Asaas agora; migra para o WhatsApp da Risarte no riSZon depois. |
| D15 | Gatilhos de cobrança | Contrato assinado no ZapSign; renegociação assinada; venda direta na clínica; mensalidades do PPR+ e da Ortodontia; implantação e mensalidade do Empresarial; cobrança mensal da franqueadora à unidade; link avulso. |
| D16 | Link de pagamento | Todo recebimento gerado no riSZon tem link copiável e enviável ao pagador. |
| D17 | Cobranças já existentes | As cobranças em aberto emitidas direto no Asaas **não são migradas**. Vão sendo reemitidas pelo riSZon aos poucos. |
| D18 | Nota fiscal | NFS-e pelo Asaas: a do paciente **a cada parcela recebida**; a de royalties e taxas, **uma nota mensal consolidada por unidade**. O Asaas entra como operador de dados no termo de privacidade. |
| D19 | Central de Configuração | Todas as configurações comerciais e financeiras ficam numa **única tela**, no padrão da rede e por unidade. As telas atuais passam a ser abas dela. |
| D20 | Recorrência | **Pix Automático** e **cartão de crédito recorrente** como meios de pagamento, para crediário, mensalidades do PPR+ e da Ortodontia e mensalidade do Empresarial. Não há débito recorrente. |
| D21 | Fechamento da venda | A confirmação de pagamento do Asaas para a primeira cobrança de um contrato fecha a venda automaticamente, no lugar da confirmação manual. |
| D22 | Reaproveitar o que existe | A integração estende as estruturas atuais (`network_fees`, `split_charges`, `acquirer_rates`, `empresarial.split_rules`, contas a pagar de taxa) em vez de criar tabelas paralelas. Nenhum valor pode ser lançado duas vezes no razão. |

**Regra de ouro:** o riSZon é a fonte da verdade de *o que* cobrar e *quanto repassar*; o Asaas é a fonte da verdade de *o que foi pago*. Nenhuma baixa é feita à mão quando a cobrança existe no Asaas.

---

## 3. Arquitetura de contas e carteiras

Cada unidade tem a própria conta Asaas e entra no riSZon como conta vinculada: o franqueado gera a chave de API na conta dele e o riSZon busca o identificador de carteira (walletId). A Risarte Administração tem a conta raiz, que emite o Empresarial e a cobrança mensal às unidades e recebe os splits.

**Dois fluxos de dinheiro**

```
Paciente ──paga──> Conta da unidade ──split──> Carteira da franqueadora
                   (CNPJ da unidade              (royalties, marketing,
                    emite e recebe)               planejamento, comercial)

Empresa ──paga──> Conta raiz da franqueadora ──split──> Carteira da RisLife
                  (emite o Empresarial)

riSZon: cria as cobranças via API e recebe os webhooks de todas as contas.
```

**Como cada conta entra no riSZon**

| Conta | Titular | Papel no fluxo | Origem no riSZon |
| --- | --- | --- | --- |
| Conta raiz | Risarte Administração | Emite o Empresarial e a cobrança mensal às unidades; recebe os splits | Chave de API cadastrada pelo Admin Master |
| Conta vinculada | Cada unidade (Londrina, Cambé e as próximas) | Emite e recebe todas as cobranças de paciente | Chave gerada pelo franqueado; o riSZon busca o walletId |
| Carteira de repasse | RisLife e outros recebedores | Só recebe split | Apenas o walletId é cadastrado |

**Por que não subcontas.** Depois do período de avaliação do Asaas, gerenciar a chave de uma subconta exige operação BaaS ou filiais com o mesmo prefixo de CNPJ. Franquias têm CNPJ diferente. A criação de subconta fica construída e desligada; no sandbox ela é usada só para criar as contas de teste.

**Cuidados obrigatórios**

- A chave de API dá acesso total à conta da unidade, inclusive a transferências. Exige termo de autorização do franqueado, registrado na Central.
- A chave é colada numa tela do riSZon que grava direto no Supabase Vault. Nunca passa por WhatsApp, e-mail ou chat, e nunca é exibida depois de gravada. Todo uso é registrado.
- Chave sem uso por 3 meses é desativada pelo Asaas; com 6 meses expira. A Central mostra o último uso e avisa antes.
- O split precisa ser habilitado à mão no painel de cada conta emissora (Integrações › Segurança).
- Cada conta precisa de uma chave Pix cadastrada; sem ela, o QR Code vale só até o fim do dia.
- Todas as chamadas ao Asaas saem do servidor, com a chave da conta certa por `clinic_id`.

---

## 4. Regras do split e das taxas

Os repasses percentuais incidem sobre o **valor efetivamente pago pelo cliente** e saem sempre no próprio split, no momento do pagamento, sem acerto posterior.

**Taxas da franquia**

| Taxa | Tipo | Como é cobrada |
| --- | --- | --- |
| Royalties | % sobre todo recebimento | Split |
| Fundo de marketing | % sobre todo recebimento | Split (carteira configurável) |
| Centro de planejamento | % sobre todo recebimento | Split |
| Comercial | % sobre todo recebimento | Split |
| SDR | Valor fixo mensal por unidade | Cobrança mensal da franqueadora à unidade |
| Tecnologia (sistema) | Valor fixo mensal por unidade | Cobrança mensal da franqueadora à unidade |

As taxas já existem no riSZon (`network_fees`, tela `/financeiro/taxas-da-rede`), com percentual por unidade, exceções, campanhas com data e o percentual congelado em cada recebimento (`split_charges`). A integração estende essa estrutura com a carteira de destino e a marca de "retido na origem". Hoje a unidade recebe tudo e paga a rede por conta a pagar mensal; com o split, a taxa percentual retida na origem **não** gera conta a pagar.

**Como o split é montado**

1. **Uma entrada por carteira.** O riSZon soma os percentuais de todas as taxas destinadas à mesma carteira e envia uma única entrada ao Asaas. O rateio por taxa fica registrado no riSZon (`charge_splits`).
2. **Percentual + compensação da tarifa.** O percentual nativo do Asaas incide sobre o valor líquido, depois da tarifa. Para o repasse fechar sobre o valor pago, a entrada leva `percentualValue` = soma dos percentuais e `fixedValue` = soma dos percentuais × tarifa do meio de pagamento. **Formato confirmado pelo Asaas (11/11/2026):** a mesma entrada aceita os dois campos, e o transferido é `fixedValue + netValue × percentualValue / 100`. O desenho exato da compensação para cada tipo de tarifa (fixa, percentual com mínimo e máximo, boleto pago pelo QR Code PIX) é da ASA3 — ver a seção 13.
3. **Tarifa conhecida na emissão.** Toda cobrança sai com o meio de pagamento definido. As tarifas vêm de `acquirer_rates`, preenchidas automaticamente pela consulta de tarifas do Asaas (`GET /myAccount/fees`), com vigência e fim de promoção: a tarifa promocional vale até a data de fim e a cheia já fica cadastrada para o dia seguinte. Tarifa que muda fecha a vigência da anterior; nada é sobrescrito. A tarifa percentual pode ter mínimo e máximo (PIX).
4. **Taxa vigente no pagamento.** Vale o percentual da taxa da franquia e a tarifa do Asaas vigentes na data do pagamento. A cobrança sai com os valores vigentes na emissão; quando uma taxa da franquia ou uma tarifa do Asaas muda (inclusive no fim de uma tarifa promocional), o riSZon atualiza o split das cobranças em aberto. Cobrança já paga não muda. Detalhe na ASA3.
5. **Arredondamento.** Parte fixa com 2 casas e percentual com até 4; a diferença de centavos fica com a unidade.
6. **Teto de segurança.** Antes de emitir, o riSZon confere que a soma dos repasses não passa do valor líquido no pior caso (maior desconto possível). Se passar, a cobrança não sai e o financeiro é avisado.
7. **Cartão parcelado.** O split é aplicado em cada parcela do cartão e liquidado a cada recebimento.
8. **Recebimento fora do split.** Dinheiro, maquininha física, cobranças antigas (D17) e qualquer pagamento sem split geram a conta a pagar de taxa que já existe hoje.
9. **Cobrança mensal à unidade.** Uma vez por mês, a conta raiz emite uma cobrança por unidade com as taxas fixas (SDR e tecnologia) e as contas a pagar de taxa do período. A nota mensal consolidada cobre essa cobrança e os splits recebidos no mês.
10. **Estorno.** O Asaas reverte o split automaticamente no estorno. Como repasses não são devolvidos (D13), o riSZon lança o valor revertido como conta a pagar da unidade.

**Formato da entrada: confirmado pelo Asaas (11/11/2026).** Uma entrada por carteira, com `percentualValue` e `fixedValue` juntos. O teste em sandbox vira só uma confirmação. As alternativas antigas (duas entradas para a mesma carteira, percentual ajustado) saem do desenho.

**Prova do split em três passos**

1. **Sandbox:** pagamento no prazo, nos três meios, e a confirmação do formato da entrada. O sandbox não testa desconto, multa nem juros em boleto e PIX.
2. ✅ **Confirmação por escrito do Asaas (11/11/2026):** o percentual incide sobre o `netValue` do valor efetivamente pago — com desconto, sobre o pago com desconto; com multa e juros, sobre o pago com encargos. Vale para boleto, PIX e cartão; no cartão parcelado, sobre o líquido de cada parcela. A antecipação reduz a base.
3. **Teste real com valores mínimos**, antes do piloto e com aprovação do Jeferson: três cobranças pagas com desconto, no prazo e com multa. Continua valendo, agora como conferência final.

**Empresarial**

- Usa as regras que já existem em `empresarial.split_rules` (padrão e exceção por empresa).
- **Implantação:** 100% para a carteira da RisLife. Como o Asaas só repassa até o valor líquido, a RisLife recebe o valor pago menos a tarifa.
- **Mensalidade:** 50% para a RisLife e 50% para a Risarte, sobre o valor pago. Hoje o cálculo é sobre o valor total; passa a ser sobre o pago.
- O cliente HTTP antigo e a Edge Function de webhook do Empresarial, nunca publicados, são aposentados em favor do cliente e da rota únicos.

**Exemplo ilustrativo** (percentuais e tarifa fictícios): boleto de R$ 1.000,00 com 5% de desconto até o vencimento, tarifa de R$ 2,00 e taxas que somam 8% para a carteira da franqueadora. A entrada vai como 8% + R$ 0,16.

- Pago no prazo, R$ 950,00 → líquido R$ 948,00 → 8% = R$ 75,84 + R$ 0,16 = **R$ 76,00**, exatamente 8% de R$ 950,00.
- Pago em atraso, R$ 1.020,00 → líquido R$ 1.018,00 → R$ 81,44 + R$ 0,16 = **R$ 81,60**, exatamente 8% de R$ 1.020,00.

---

## 5. Meios de pagamento

| Meio | Uso | Observação |
| --- | --- | --- |
| Boleto | Parcelas, mensalidades, Empresarial | Com QR Code Pix quando a conta tem chave Pix |
| PIX | Venda direta, parcelas, link | QR Code na tela ou no link |
| Cartão de crédito à vista ou parcelado | Tratamentos | Ocupa o limite inteiro; até 21x (Visa e Mastercard) ou 12x (demais), dentro do máximo das Regras Comerciais |
| Pix Automático | Crediário, PPR+, Ortodontia, Empresarial | O pagador autoriza uma vez e as cobranças seguintes são debitadas da conta dele |
| Cartão de crédito recorrente | Crediário, PPR+, Ortodontia | O cartão fica tokenizado e é cobrado todo mês; ocupa só o valor do mês |

**Regras da recorrência (D20)**

- O riSZon cria cada cobrança, uma a uma, vinculada à autorização do Pix Automático ou ao token do cartão. O Asaas não gera as cobranças sozinho. Assim o split, os descontos e a multa continuam sob controle do riSZon.
- **Pix Automático:** exige conta PJ aprovada e CNPJ ativo há pelo menos 6 meses; unidades novas só podem usar depois disso. A autorização é criada sem valor fixo, no modo em que o riSZon cria cada cobrança (`MANUAL`), para aceitar desconto, multa e renegociação. Fonte dos dois requisitos: https://docs.asaas.com/docs/faq-2. **O Asaas confirmou (11/11/2026)** que há jornada de autorização **sem pagamento inicial**. Com a autorização prevendo valor variável ou teto, cada cobrança do modo `MANUAL` pode ter valor diferente **e split**. A ASA4B usa essa jornada, e a primeira parcela também sai com split. Se a jornada sem pagamento inicial não estiver disponível numa conta, vale a regra anterior: a primeira parcela gera conta a pagar de taxa. Cada cobrança precisa ser criada entre 2 e 10 dias úteis antes do vencimento, e a autorização pode ser recusada pela instituição do pagador — os dois pontos entram no desenho da ASA4B. A elegibilidade de Londrina e Cambé está com o gerente de contas.
- **Cartão recorrente:** o riSZon guarda só o token devolvido pelo Asaas. Dados de cartão nunca passam pelo banco, pelo servidor nem pelos logs do riSZon.
  - **O Asaas confirmou (11/11/2026)** que a tokenização é nativa, sem liberação. O `creditCardToken` volta ao criar ou pagar uma cobrança com o objeto `creditCard`, e pode ser usado todo mês em `POST /v3/payments` com split.
  - ⚠️ **Mas obter o token enviando o objeto `creditCard` faria os dados do cartão passarem pelo servidor do riSZon, o que a regra proíbe.** Essa parte continua **em aberto**: o Jeferson aguarda do Asaas se o token volta quando o paciente digita o cartão na fatura do Asaas, e qual IP usar na cobrança automática.
  - Até lá, a ASA4B não implementa o cartão recorrente. Fica como alternativa a assinatura nativa do Asaas com split.
- **Falha no débito:** se o débito automático ou o cartão for recusado, a cobrança continua em aberto, o pagador recebe o link pela régua e o gerente da unidade é avisado.
- **Cancelamento:** o pagador pode cancelar a autorização no banco dele; o riSZon recebe o evento, marca o cliente e volta a cobrar por link.
- As tarifas dos dois meios entram em `acquirer_rates`, porque a compensação do split depende delas.

---

## 6. Fluxos de cobrança por gatilho

| Gatilho | Quem dispara | Conta emissora | O que o riSZon cria no Asaas |
| --- | --- | --- | --- |
| Contrato de tratamento assinado (ZapSign) | Automático, pelo webhook do ZapSign | Unidade | Uma cobrança por parcela ou um parcelamento no cartão, com split |
| Renegociação assinada (ZapSign) | Automático, pelo webhook do ZapSign | Unidade | Cancela as cobranças em aberto renegociadas e cria as novas, com split |
| Venda direta na clínica | Recepcionista ou Gerente de Unidade | Unidade | Cobrança avulsa com PIX na tela ou link para o cartão, com split |
| Mensalidade do PPR+ e da Ortodontia | Automático, no ciclo mensal | Unidade | Uma cobrança por mensalidade, com split |
| Implantação do Empresarial | Financeiro da Franqueadora, na adesão | Franqueadora | Cobrança com split de 100% para a RisLife |
| Mensalidade do Empresarial | Financeiro da Franqueadora, uma vez por mês | Franqueadora | Uma cobrança por empresa ativa, com split de 50% para a RisLife |
| Cobrança mensal à unidade | Financeiro da Franqueadora, uma vez por mês | Franqueadora | Uma cobrança por unidade: taxas fixas e contas a pagar de taxa |
| Link avulso | Quem tem permissão de cobrar | Unidade ou franqueadora | Cobrança avulsa no meio de pagamento escolhido por quem emite |

**Passos comuns a todo gatilho**

1. Definir o pagador: o responsável financeiro, quando houver; senão, o próprio cliente.
2. Sincronizar o pagador: buscar por CPF/CNPJ na conta emissora antes de criar; guardar o ID do Asaas.
3. Aplicar multa, juros e descontos conforme a D9. O benefício de pontualidade vai como desconto válido até o vencimento.
4. Criar a cobrança com `externalReference` = ID da cobrança no riSZon (tabela `charges`), que é estável. O ID da parcela não serve, porque hoje as parcelas são apagadas e recriadas antes do recebimento.
5. Travar a parcela que tem cobrança emitida: ela não pode mais ser apagada nem recriada.
6. Gravar o ID do Asaas, o link da fatura, a linha digitável e o PIX copia e cola.
7. Exibir na ficha do cliente com **Copiar link** e **Enviar pelo WhatsApp**.

**Regras de segurança dos fluxos**

- Renegociação só cancela as cobranças antigas depois da assinatura do novo contrato. Hoje a renegociação é manual; a assinatura no ZapSign entra na ASA4.
- **Distrato:** hoje `apply_plan_cancellation` cancela as parcelas em aberto ao efetivar. Passa a exigir a checklist concluída antes de efetivar; só então as cobranças são canceladas no riSZon e no Asaas. Repasses já feitos não voltam.
- **Cobranças antigas (D17):** a parcela com cobrança emitida direto no Asaas fica marcada como *cobrança externa*. Para reemitir, o usuário informa a cobrança antiga e o riSZon a cancela no Asaas, após confirmação, antes de criar a nova.
- Cobrança já paga nunca é cancelada nem editada pelo riSZon.
- Timeout é tratado como resultado desconhecido: o riSZon nunca repete uma criação sozinho; consulta o Asaas pelo `externalReference` antes.
- Falha de envio deixa a cobrança em *Erro de emissão*, numa fila de nova tentativa visível ao financeiro.
- Os gatilhos do Indica em `payment_installments` não podem ser quebrados: toda mudança ali exige `npm run test:indica`.

---

## 7. Webhooks, baixa automática e conciliação

**Eventos ouvidos e efeito no riSZon**

| Evento do Asaas | Significado | Efeito no riSZon |
| --- | --- | --- |
| `PAYMENT_CREATED` | Cobrança criada | Confirma o registro |
| `PAYMENT_CONFIRMED` | Pago, saldo ainda não disponível | Baixa da parcela (**Paga**); se for a primeira cobrança do contrato, fecha a venda (D21); atualiza a sinalização "em dia" |
| `PAYMENT_RECEIVED` | Valor disponível na conta | **Liquidada**; entra no fluxo de caixa |
| `PAYMENT_OVERDUE` | Venceu sem pagamento | **Vencida**; sinaliza "em atraso"; alerta ao gerente |
| `PAYMENT_UPDATED` / `PAYMENT_DELETED` | Alterada ou removida no Asaas | Atualiza ou cancela; registra a origem |
| `PAYMENT_REFUNDED` | Estornada | **Estornada**; split revertido vira conta a pagar da unidade; alerta ao financeiro |
| `PAYMENT_CHARGEBACK_REQUESTED` | Contestação no cartão | Alerta ao Financeiro da Franqueadora |
| `PAYMENT_SPLIT_DONE` | Repasse liquidado | Marca o repasse como liquidado e grava o valor |
| Bloqueio por divergência de split | Split maior que o líquido | Alerta urgente: 2 dias úteis para ajustar |
| Eventos do Pix Automático | Autorização ativada, recusada ou cancelada; débito agendado ou recusado | Atualiza a autorização do cliente |

No cartão de crédito, o `PAYMENT_RECEIVED` chega cerca de 32 dias após a confirmação; por isso a baixa usa o `PAYMENT_CONFIRMED` e o caixa usa o `PAYMENT_RECEIVED`. Em PIX e boleto o `PAYMENT_RECEIVED` pode chegar sem `PAYMENT_CONFIRMED` anterior: nesse caso ele é tratado como baixa e liquidação ao mesmo tempo (a provar em sandbox na ASA2).

**Ordem da D21.** Hoje o banco recusa baixa enquanto a venda não fecha. Na primeira cobrança de um contrato, o riSZon marca o pagamento como confirmado, deixa a venda fechar e só então dá baixa, nessa ordem.

**O que a ASA0 já entregou.** A rota mínima: confere o token, grava o evento bruto em `gateway_webhook_events` (o mesmo evento não entra duas vezes) e responde 200. Token errado ou endereço desconhecido recebe 401, sem ler o corpo. Quem processa o evento é a ASA2.

**Regras técnicas**

- Uma URL por conta: `/api/webhooks/asaas/[ref]`, com identificador opaco, para saber a conta de origem antes de comparar o token. O riSZon cria o webhook pela API, com token gerado por ele.
- Valida o cabeçalho `asaas-access-token`; token inválido é recusado.
- Grava o evento bruto e responde 200 em seguida. Só o 200 conta como sucesso, o prazo de resposta é de 10 segundos e 15 falhas seguidas pausam a fila.
- Processamento idempotente pelo ID do evento. Status só avança, nunca regride (exceto estorno).
- Evento de cobrança que não nasceu no riSZon é registrado e ignorado.
- A baixa usa a função que já existe (`register_payment_receipt`, idempotente por `client_token`).
- O riSZon monitora a fila e avisa o Admin Master se ela pausar.

**Conciliação diária.** Uma rotina noturna, no mesmo padrão da conferência do ZapSign, compara as cobranças do dia em cada conta Asaas com o riSZon. As divergências aparecem num painel para o financeiro resolver.

---

## 8. Modelo de dados

Princípio (D22): estender o que existe. O schema real é validado antes de cada migração. As migrações do Asaas usam a faixa própria 4000+ e são apenas aditivas.

**Estruturas existentes que a integração estende**

| Existente | Mudança |
| --- | --- |
| `network_fees` e tela `/financeiro/taxas-da-rede` | Carteira de destino por taxa; vira a aba Taxas da franquia |
| `split_charges` | Marca de "retido na origem", para não gerar conta a pagar em dobro |
| `acquirer_rates` | Adquirente "Asaas" ligado a cada conta, preenchido pela consulta de tarifas, com mínimo e máximo da tarifa percentual e a origem da tarifa (ASA0); a modalidade Pix Automático e o cartão recorrente entram na ASA4B. O adquirente "Asaas" não vira o padrão da unidade enquanto a integração não emite cobrança |
| `empresarial.split_rules` e `adhesion_billing` | Split sobre o valor pago; ligação com a cobrança nova |
| `payment_installments` | `charge_id`; trava da parcela com cobrança emitida |
| `ppr_charges` e `ortho_charges` | Ligação com a cobrança no Asaas |
| Responsáveis do cliente | Marca de responsável financeiro; IDs estáveis (hoje são apagados e recriados a cada edição); adulto pode ter responsável |
| `clinics` | Campos fiscais (ASA8) |
| `finance_settings` e `commercial_rules` | Sem mudança de dados; as telas viram abas da Central |
| Contas a pagar de taxa | Origem da cobrança mensal à unidade |

**Tabelas novas**

| Tabela | Para que serve |
| --- | --- |
| `gateway_accounts` | Uma linha por conta Asaas: dono, CNPJ, walletId, referência da chave e do token no Vault, modo, ambiente, último uso da chave, termo de autorização |
| Log de uso de chave e log de chamadas | Quem usou a chave, para quê e quando; método, rota, status e duração de cada chamada, sem corpo, chave ou CPF |
| `split_recipients` | Carteiras que podem receber split (franqueadora, fundo de marketing, RisLife) |
| `gateway_customers` | Vínculo do pagador com o cliente Asaas por conta; dono polimórfico (cliente, responsável ou empresa), porque não existe uma entidade única de pessoa |
| `charges` | Cada cobrança emitida, com origem, pagador, meio de pagamento, valor, valor pago, status e links; também as externas (D17) |
| `charge_splits` | O split enviado em cada cobrança, o rateio por taxa e o valor liquidado |
| `payment_authorizations` | Autorizações de Pix Automático por pagador e conta |
| `card_tokens` | Token do cartão recorrente (só o token) |
| `gateway_webhook_events` | Evento bruto e idempotência |
| `reconciliation_issues` | Divergências da conciliação |
| Checklist de distrato | Itens e conclusão antes de efetivar |
| `service_invoices` | NFS-e pedidas ao Asaas (ASA8) |

**Status da cobrança:** Rascunho → Emitida → Paga → Liquidada, com os desvios Vencida, Cancelada, Estornada, Em contestação e Erro de emissão.

---

## 9. Telas e permissões

### 9.1 Central de Configuração

Rotas `/central/rede/[aba]` e `/central/unidades/[unidade]/[aba]`, com uma entrada no menu Administração. Um registro de abas no código: cada fase acrescenta a sua, nenhuma cria tela de configuração à parte.

No nível **Rede**, a franqueadora define o padrão. No nível **Unidade**, cada campo mostra *herdado da rede* ou *personalizado*, com botão para voltar ao padrão. A herança segue o padrão já usado em `finance_settings`: campo vazio na unidade herda da rede.

| Aba | O que reúne | Origem | Fase |
| --- | --- | --- | --- |
| Conta e tarifas | Vínculo da conta Asaas, situação, walletId, chave (só gravação, com data do último uso), webhook, tarifas | Nova | ASA0 |
| Financeiro | Multa, juros, arredondamento e alertas; a carência aparece só para leitura, fixa em zero | `/financeiro/configuracao` | ASA1 |
| Comercial | Desconto à vista, máximo de parcelas, meios de pagamento aceitos, condições por programa | `/admin/regras-comerciais` | ASA1 |
| Cobrança e comunicação | Régua de lembretes do Asaas: avisos, canais e prazos, com o aviso de que cada canal (SMS, WhatsApp, ligação) é tarifado na conta da unidade | Nova | ASA2 |
| Taxas da franquia | Taxas percentuais e fixas por unidade, carteira de destino, vigências | `/financeiro/taxas-da-rede` | ASA3 |
| Empresarial | Percentuais da RisLife na implantação e na mensalidade, exceções | `/empresarial/configuracoes` | ASA5 |
| Fiscal | Inscrição municipal, código de serviço, alíquota, emissão de NFS-e | Nova | ASA8 |

As telas atuais viram componentes compartilhados: ações, tabelas e regras de acesso ficam onde estão; só a moldura muda. As rotas antigas redirecionam para a aba.

**Recursos da Central**

- **Prontidão da unidade:** uma função do banco devolve o que falta. Itens da ASA0: conta validada, walletId, webhook ativo, tarifas, chave Pix, split habilitado no painel, termo de autorização registrado e antecipação automática desligada (conferida pela API); as fases seguintes acrescentam os delas. O Asaas não informa pela API se o split está habilitado: na ASA0 o item é uma declaração do Admin Master, e a ASA3 o confirma sozinha no primeiro split aceito. O termo é registrado pelo Admin Master com data, nome de quem assinou e observação; o anexo e a assinatura pelo ZapSign ficam preparados para depois.
- **Verificação semanal:** uma rotina verifica cada conta uma vez por semana: valida a chave, atualiza a situação e as tarifas e mantém a chave em uso (o Asaas desativa a chave parada há 3 meses). Se a chave for recusada, a prontidão cai e o Admin Master é avisado. Falha passageira (rede, Asaas fora do ar) não derruba nada: a conta é tentada de novo no dia seguinte.
- **Termo antes da chave do Gerente:** o Gerente só grava a chave da própria unidade depois de o termo estar registrado e de a permissão ser liberada; até lá, só o Admin Master. O banco confere as duas coisas. "Pronta para cobrar" exige a lista completa e a marcação do Admin Master, que cai sozinha se um item voltar a faltar. O riSZon não emite cobrança de unidade que não esteja pronta.
- **Histórico:** leitura sobre a trilha de auditoria que já existe, filtrada pelas tabelas de cada aba.
- **Copiar de outra unidade:** ao configurar uma unidade nova (ASA7).

### 9.2 Demais telas

| Tela | Onde fica | Para quê |
| --- | --- | --- |
| Aba Financeiro do cliente | Ficha do cliente | Parcelas com status e pagador, situação "em dia" ou "em atraso", **Copiar link**, **Enviar pelo WhatsApp**, cobrança avulsa, recebimento manual, autorização de Pix Automático ou cartão recorrente, reemitir cobrança externa, iniciar distrato |
| Venda direta | Ficha do cliente (modal) | Valor, descrição e meio de pagamento; PIX na tela ou link |
| Faturamento do Empresarial | Empresarial | Implantações e mensalidades do mês por empresa, emissão em lote |
| Cobrança mensal às unidades | Franqueadora | Prévia por unidade e emissão com nota consolidada |
| Painel de cobranças | Unidade | A vencer, vencidas e pagas; cobranças externas a reemitir; débitos recorrentes recusados; distratos |
| Painel de repasses | Franqueadora | Repasse liquidado por unidade e taxa, conferido contra o percentual sobre o valor pago |
| Conciliação | Franqueadora | Divergências entre Asaas e riSZon |

### 9.3 Matriz de permissões

| Ação | Admin Master | Financeiro da Franqueadora | Gerente de Unidade | Recepcionista | Assistente Comercial | Consultor Comercial | Consultor RisLife |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vincular conta Asaas | Sim | Não | Própria unidade, após o termo registrado | Não | Não | Não | Não |
| Marcar unidade como pronta | Sim | Não | Não | Não | Não | Não | Não |
| Editar taxas da franquia | Sim | Sim | Não | Não | Não | Não | Não |
| Editar multa e juros | Sim | Sim | Não | Não | Não | Não | Não |
| Editar Regras Comerciais | Sim | Não | Não | Não | Não | Não | Não |
| Ver cobranças e enviar link | Rede | Rede | Própria unidade | Própria unidade | Seus clientes | Seus clientes | Não |
| Emitir venda direta e link avulso | Sim | Sim | Própria unidade | Própria unidade | Não | Não | Não |
| Registrar recebimento manual | Sim | Sim | Própria unidade | Própria unidade | Não | Não | Não |
| Renegociar parcelas | Sim | Sim | Própria unidade | Não | Não | Não | Não |
| Iniciar e concluir distrato | Sim | Acompanha, sem concluir | Própria unidade | Não | Não | Não | Não |
| Emitir cobranças do Empresarial | Sim | Sim | Não | Não | Não | Não | Não |
| Emitir cobrança mensal às unidades | Sim | Sim | Não | Não | Não | Não | Não |
| Ver painel de repasses | Rede | Rede | Própria unidade | Não | Não | Não | Não |
| Ver pagamentos das empresas | Rede | Rede | Não | Não | Não | Não | Suas empresas |
| Resolver conciliação | Sim | Sim | Não | Não | Não | Não | Não |

A Recepcionista continua registrando recebimento manual, como hoje (`can_receive_payment`); todo recebimento manual gera conta a pagar de taxa. O distrato continua só com o Gerente de Unidade e o Admin Master, como hoje.

As permissões da Central (`modulo.central` e `acao.central.vincular_conta`) nascem sem papel nenhum: só o Admin Master a enxerga até serem liberadas em Administração › Permissões.

Toda ação de cobrança grava autor, data e motivo na auditoria.

---

## 10. Requisitos técnicos da implementação

| Requisito | Regra |
| --- | --- |
| Ambientes do Asaas | Sandbox em `https://api-sandbox.asaas.com/v3`, chave iniciada por `$aact_hmlg_`; produção em `https://api.asaas.com/v3`, chave `$aact_prod_`. Chave e URL do mesmo ambiente. |
| Autenticação | Cabeçalho `access_token` (não é `Authorization: Bearer`), mais `User-Agent` identificando o riSZon e `Content-Type: application/json`. |
| Cifrão na chave | No `.env.local`, barra invertida antes do cifrão (`\$aact_...`). No painel da Vercel, a chave vai como está. |
| Código | Worktree separado, branch `feat/asaas-integration`. Cada fase aprovada entra no main, escondida atrás de permissão e com a trava de produção desligada. |
| Banco | Banco de treino, migrações só aditivas na faixa 4000+, contas marcadas `environment = 'sandbox'`. A produção só recebe as migrações de uma fase depois de aprovada. |
| Trava de produção | O banco recusa conta `production` enquanto um interruptor, só do Admin Master e ligado na ASA7, estiver desligado (não existe função que o ligue até lá). O cliente HTTP recusa chave `$aact_prod_` e recusa chave e URL de ambientes diferentes; produção só passa com a variável `ASAAS_ALLOW_PRODUCTION=sim`, que não existe em nenhum ambiente até a ASA7. |
| Chave fora da Vercel | `ASAAS_API_KEY` e `ASAAS_BASE_URL` ficam só no `.env.local`, para o roteiro das contas de teste. Em tempo de execução toda chave vem do Vault, pela conta da unidade. Nenhum projeto da Vercel tem a chave do Asaas. |
| Webhook em teste | Terceiro projeto na Vercel, com a branch `feat/asaas-integration` como produção, só as três variáveis do Supabase de treino e `NEXT_PUBLIC_AMBIENTE=treino`, e região São Paulo. Sem `CRON_SECRET` (para as rotinas não rodarem em dobro no treino), sem ZapSign e sem chave do Asaas. O domínio de produção de um projeto fica fora da proteção de deployment, então o Asaas alcança o webhook sem token na URL. |
| Verificação semanal | Rotina diária na Vercel (`/api/cron/gateway-accounts`) que verifica cada conta quando a última verificação tem 7 dias ou mais, ou falhou. |
| Limites da API | 25.000 requisições por conta a cada 12 horas e 50 consultas simultâneas. Erro 429 com espera progressiva pelo `RateLimit-Reset`. Sem consultas repetidas: o estado vem por webhook. |
| Sem cobrança duplicada | Timeout é resultado desconhecido: consultar pelo `externalReference` antes de repetir. O gatilho do ZapSign também é idempotente. |
| Sem cliente duplicado | Buscar por CPF/CNPJ antes de criar o cliente no Asaas. |
| Meio de pagamento na emissão | Toda cobrança sai com o meio definido. A opção em que o pagador escolhe o meio fica desligada. |
| Antecipação | Antecipar um recebível reduz o repasse, porque o percentual passa a incidir sobre o líquido depois da antecipação (confirmado pelo Asaas em 11/11/2026). A antecipação automática fica desligada nas contas das unidades. |
| Lista de IPs autorizados | O Asaas recomenda restringir a chave por IP. Sem IP fixo de saída na Vercel, ativar a lista derruba a integração: **não ativar**. IP fixo custa US$ 100/mês por projeto e é compartilhado entre clientes; decisão de custo na ASA7 (seção 13.2, item 2). |
| Vault | O Supabase Vault nunca foi usado no riSZon. Conferir a extensão nos dois projetos antes da ASA0. A função que lê a chave responde só à chave de serviço. |
| Dados de cartão | Nunca passam pelo banco nem pelos logs do riSZon; só o token do Asaas é guardado. |
| Contas de teste | No sandbox, a conta raiz representa a franqueadora. Só no sandbox, um script cria as contas de teste de Londrina, Cambé e RisLife como subcontas da conta raiz, porque o sandbox não tem as contas reais, e as registra como contas vinculadas. Na produção, Londrina e Cambé são contas vinculadas (D2), não subcontas. Recusa rodar fora do sandbox e do banco de treino. |
| Enviar pelo WhatsApp | Enquanto o WhatsApp da Risarte não estiver integrado, o botão abre o WhatsApp com a mensagem e o link prontos. |

---

## 11. Passo a passo da integração

### Parte A — responsabilidade do Jeferson

- [x] Conta raiz da Risarte Administração no Asaas.
- [x] Contas Asaas de Londrina e Cambé.
- [x] Conta sandbox criada.
- [x] Especificação salva em `docs/integracao-asaas.md`.
- [x] `ASAAS_API_KEY` e `ASAAS_BASE_URL` no `.env.local` — e só lá: nenhum projeto da Vercel recebe a chave do Asaas.
- [x] Vault conferido nos dois bancos (`supabase_vault` 0.3.1 no treino e na produção).
- [x] Sandbox: "BaaS para subcontas" e "Autoaprovação de subcontas" ligadas (Menu do usuário › Minha conta › Configurações › Sandbox). A opção do período de avaliação não aparece nessa tela.
- [x] Terceiro projeto na Vercel (`risarte-asaas`), com a branch `feat/asaas-integration` como produção, para o webhook do sandbox — no ar em 10/11/2026; webhook real recebido.
- [x] **Equipe Sucesso de Integrações do Asaas — respostas técnicas por escrito (11/11/2026).** Registro completo na seção 13.
- [ ] **Gerente de contas do Asaas — ainda em aberto:**
  - Uso da chave de API da unidade pela franqueadora entre CNPJs distintos (contratual e regulatório).
  - **Para o futuro:** abrir as contas das novas unidades como subcontas da franqueadora, mesmo com CNPJ e titular diferentes. Hoje todas as unidades são contas vinculadas (D2); a criação de subconta está construída, mas desligada.
  - O split é revertido em caso de chargeback?
  - Tabelas de tarifas de cada conta e negociação pelo volume da rede.
  - Elegibilidade de Londrina e Cambé ao Pix Automático.
  - Parecer sobre o repasse de 100% da implantação do Empresarial à RisLife.
- [ ] **Equipe de integrações — ainda em aberto (ASA4B):** o token do cartão volta quando o paciente digita o cartão na fatura do Asaas? Qual IP informar na cobrança automática com token?
- [ ] **Em cada conta Asaas (raiz, Londrina, Cambé):** habilitar o split no painel (Integrações › Segurança, com 2FA — o Jeferson vai habilitar nas três), cadastrar uma chave Pix e manter a antecipação automática desligada. **Não** ativar a lista de IPs autorizados (seção 13.2, item 2).
- [ ] **Autorização dos franqueados:** termo ou aditivo em que cada unidade autoriza a franqueadora a operar a conta Asaas dela pelo riSZon e a receber os repasses por split.
- [ ] **Contador:** configuração da NFS-e em cada conta e tratamento fiscal do Empresarial, em que a Risarte emite a cobrança e repassa 100% ou 50% à RisLife.
- [ ] **Termo de privacidade:** incluir o Asaas como operador de dados de pagamento.
- [ ] **RisLife:** walletId da conta Asaas.
- [ ] **Homologação** com o financeiro (ASA7) e **teste real com valores mínimos** do split.
- [ ] **Produção:** chaves de produção cadastradas pela Central.
- [ ] **Régua do Asaas:** avisos e canais para pacientes e empresas.
- [ ] **Piloto:** uma unidade por 30 dias; depois a segunda.

### Parte B — fases de desenvolvimento

| Fase | Entrega | Critério de aceite (em sandbox) |
| --- | --- | --- |
| ASA0 — Fundação | Casca da Central (níveis, herança, histórico, prontidão) e aba Conta e tarifas; `gateway_accounts`, Vault, logs, cliente HTTP, vinculação de conta, tarifas pela consulta do Asaas, travas de ambiente; rota mínima de webhook e `gateway_webhook_events`; verificação semanal das contas; roteiro das contas de teste (migrações 4000 a 4002) | Vincular uma conta sandbox e ver walletId, tarifas e webhook ativos; um evento de teste chega; a chave não aparece em tela, log nem repositório; o Gerente só alcança a própria unidade, e só depois do termo; conta de produção é recusada; com o menu escondido e sem as migrações, a produção abre como hoje |
| ASA1 — Cobrança avulsa e link | Em duas entregas (seção 14). **Entrega 1:** abas Financeiro e Comercial (carência fixa em zero) e responsável financeiro com IDs estáveis. **Entrega 2:** `gateway_customers`, `charges`, cobrança de parcela existente (boleto, PIX ou cartão à vista pela fatura do Asaas), Copiar link e Enviar pelo WhatsApp, cancelar, cobrança externa, recebimento no balcão com cobrança ativa | Link gerado pelo riSZon pago no sandbox, no CPF do responsável quando houver; menus antigos abrem as abas novas; nenhuma cobrança duplicada |
| ASA2 — Webhooks e baixa | Rota por conta, idempotência, baixa pela função existente, fechamento da venda (D21), sinalização "em dia" ou "em atraso", aba Cobrança e comunicação; Painel de cobranças com a visão "A receber do Asaas" (16.8.1) | Pagamento simulado dá baixa, fecha a venda e atualiza a sinalização sem ação humana |
| ASA3 — Split | Aba Taxas da franquia sobre `network_fees`; `split_recipients`, `charge_splits`; marca de retido na origem; teto de segurança; painel de repasses, mostrando por unidade quanto foi recebido com split e quanto por fora (dinheiro, maquininha, cobrança externa), e as dispensas do período (quitação por valor menor) com valor, autor e motivo. Antes de implementar: os cálculos da compensação da tarifa nos três casos e a diferença máxima por meio de pagamento, para aprovação (seção 13.2, item 1); "Repasses a receber" no Painel de repasses (16.8.2) | No prazo, o repasse liquidado é exatamente o percentual sobre o valor pago, nos três meios; formato da entrada confirmado; nenhuma conta a pagar em dobro |
| ASA4 — Gatilhos de contrato | Emissão na assinatura; renegociação assinada no ZapSign; cartão parcelado; venda direta; mensalidades do PPR+ e da Ortodontia; reemissão de cobrança externa; distrato com checklist | Contrato de teste gera N cobranças corretas; distrato só cancela ao efetivar; `npm run test:indica` verde |
| ASA4B — Recorrência | Pix Automático (jornada sem pagamento inicial, com split desde a primeira parcela) e cartão de crédito recorrente: autorização, token, cobrança mensal vinculada, falha e cancelamento. O cartão recorrente só entra quando o token puder ser obtido sem o cartão passar pelo riSZon (seção 13.2, item 3) | Autorização ativa gera débito no ciclo seguinte com split; recusa volta para o link |
| ASA5 — Empresarial | Aba Empresarial sobre `split_rules`; implantação e mensalidade com split para a RisLife; emissão em lote; aposentar o cliente e a Edge Function antigos | Implantação e mensalidade de teste pagas com o repasse correto, sobre o valor pago |
| ASA6 — Cobrança mensal e conciliação | Cobrança mensal a partir das contas a pagar de taxa e das taxas fixas; rotina de conciliação e painel | Fechamento de um mês de teste gera a cobrança certa por unidade, sem duplicar o razão |
| ASA7 — Homologação e produção | Interruptor de produção, roteiro com o financeiro, monitor da fila, Copiar de outra unidade, teste real do split | Piloto de 30 dias sem divergência aberta; Central de cada unidade pronta |
| ASA8 — NFS-e | Aba Fiscal, nota pedida pelo riSZon (`POST /v3/invoices`) a cada recebimento — no momento validado pelo contador (seção 13.2, item 4) —, nota mensal consolidada, webhooks de nota | Nota autorizada em sandbox para cada tipo |

Dependências: ASA2 depende de ASA1; ASA3 de ASA2; ASA4, ASA4B, ASA5 e ASA6 dependem de ASA3. A ASA5 pode andar em paralelo à ASA4.

Método: plano aprovado antes do código, uma fase por vez, testes de cada fluxo, commit ao fim de cada sessão e `ESTADO_DO_PROJETO.md` atualizado.

---

## 12. Pontos pendentes de validação

- [x] **Formato da entrada de split** — uma entrada com `percentualValue` e `fixedValue` juntos, confirmado pelo Asaas (11/11/2026). Na ASA3, só a confirmação em sandbox.
- [x] **Base do percentual com desconto, multa e juros** — confirmado pelo Asaas (11/11/2026). Falta só o teste real com valores mínimos antes do piloto.
- [x] **Tarifa do boleto pago pelo QR Code Pix** — tarifado como PIX; pelo código de barras, como boleto (Asaas, 11/11/2026).
- [ ] **Compensação da tarifa nos três casos (ASA3):** cálculos e diferença máxima por meio de pagamento, apresentados ao Jeferson antes de implementar (seção 13).
- [ ] **Uso da chave entre CNPJs distintos e, para o futuro, subcontas de CNPJ e titular diferentes (gerente de contas).** Hoje todas as unidades são contas vinculadas (D2).
- [ ] **Split em chargeback (gerente de contas).** Estorno total reverte o split (Asaas, 11/11/2026).
- [ ] **Pix Automático (ASA4B):** a jornada sem pagamento inicial e o split com valor variável estão confirmados; faltam a elegibilidade de Londrina e Cambé (gerente de contas), a tarifa e o teste em sandbox.
- [ ] **Cartão recorrente (ASA4B):** a tokenização é nativa; em aberto, o token pela fatura do Asaas (sem o cartão passar pelo riSZon) e o IP da cobrança automática.
- [ ] **Lista de IPs autorizados na chave de API:** avaliada em 11/11/2026 (seção 13); decisão de custo do Jeferson, não antes da ASA7.
- [ ] **Momento da nota do paciente (ASA8):** proposta na seção 13, a validar com o contador.
- [x] **Webhook no terceiro projeto da Vercel (primeiro passo da ASA0)** — o Asaas alcança o endereço de produção do projeto sem token na URL (10/11/2026).
- [ ] **NFS-e (ASA8):** o riSZon chama `POST /v3/invoices` ao receber o pagamento (a emissão automática nativa é só para assinaturas — Asaas, 11/11/2026); faltam as regras de cada prefeitura e a configuração fiscal com o contador.

---

## 13. Resposta escrita do Asaas (11/11/2026) e o que ela muda

A equipe Sucesso de Integrações do Asaas respondeu por escrito às dúvidas técnicas. Nada disso muda a ASA0.

### 13.1 Confirmado pelo Asaas

| Tema | Resposta do Asaas | O que muda no riSZon |
| --- | --- | --- |
| Base do split percentual | Incide sobre o `netValue` do valor efetivamente pago: com desconto, sobre o pago com desconto; com multa e juros, sobre o pago com encargos. Vale para boleto, PIX e cartão; no cartão parcelado, sobre o líquido de cada parcela. A antecipação reduz a base. | Passo 2 da prova do split cumprido (seção 4). O teste real com valores mínimos continua antes do piloto, como conferência final. A antecipação automática continua desligada e é item de prontidão. |
| Formato da entrada | Uma entrada aceita `percentualValue` e `fixedValue` juntos para a mesma carteira: transferido = `fixedValue + netValue × percentualValue / 100`. | Uma entrada por carteira nesse formato (seção 4). O teste de formato em sandbox vira só confirmação. |
| Estorno | Estorno total reverte o split de todas as carteiras automaticamente. | Mantida a regra da D13: o valor revertido vira conta a pagar da unidade. Chargeback segue com o gerente de contas. |
| Tarifas da conta | `GET /v3/myAccount/fees` traz boleto, PIX, transferências e as faixas do cartão parcelado. | É a fonte que a ASA0 já usa (`acquirer_rates`, com vigência). |
| Boleto pago pelo QR Code PIX | Tarifado como PIX; pelo código de barras, como boleto. | Entra no desenho da compensação da ASA3 (13.2, item 1). |
| Pix Automático | Há jornada de autorização sem pagamento inicial. Com a autorização prevendo valor variável ou teto, cada cobrança do modo `MANUAL` pode ter valor diferente e split. | A ASA4B usa essa jornada; a primeira parcela também sai com split (seção 5). |
| Tokenização de cartão | Nativa, sem liberação. O `creditCardToken` volta ao criar ou pagar cobrança com o objeto `creditCard`, e pode ser usado todo mês em `POST /v3/payments` com split. | Ver 13.2, item 3: o jeito de obter o token conflita com a regra do riSZon. |
| Habilitar o split | Precisa ser habilitado no painel de cada conta emissora, com 2FA. | O Jeferson vai habilitar na raiz, em Londrina e em Cambé. Continua como declaração do Admin Master na Central até a ASA3 confirmar sozinha. |
| NFS-e de cobrança avulsa | O riSZon chama `POST /v3/invoices` ao receber o pagamento. A emissão automática nativa é só para assinaturas. | Confirma o desenho da ASA8 (13.2, item 4). |
| Chave sem uso | A chave só é desativada sem uso por 3 meses; uso contínuo, inclusive a verificação semanal, a mantém ativa. | Confirma a verificação semanal da ASA0. |

### 13.2 Para tratar nas fases

1. **ASA3 — compensação da tarifa.** Desenhar a compensação para três casos:
   - tarifa **fixa** (boleto, PIX fixo);
   - tarifa **percentual** (cartão; PIX percentual com mínimo e máximo);
   - **boleto que pode ser pago pelo QR Code PIX**, com tarifa diferente.

   **Regra:** o repasse nunca pode passar do percentual sobre o valor pago. Quando não der para fechar exato, a diferença máxima deve ser de centavos e a favor da unidade. **Mostrar os cálculos e a diferença máxima por meio de pagamento ao Jeferson antes de implementar.**

2. **Lista de IPs autorizados na chave de API.** O Asaas recomenda restringir a chave por IP. **Avaliação (11/11/2026, documentação da Vercel):**
   - **O que existe:** a Vercel tem IP fixo de saída ("Static IPs") nos planos Pro e Enterprise. Custa **US$ 100 por mês por projeto**, mais a transferência de dados cobrada por região.
   - **Os IPs não são exclusivos.** Saem de um conjunto compartilhado por um pequeno grupo de clientes da mesma região, então a lista não identifica o riSZon sozinha: a chave continua sendo a proteção principal.
   - **Alcance:** vale para todos os ambientes do projeto (produção e prévias), com até 3 regiões. Rotinas e funções passam por ele; a montagem só se ligada à parte. Não foi confirmado se São Paulo (gru1) está entre as regiões oferecidas.
   - **Sem IP fixo**, a Vercel não publica faixa de endereços. Ativar a lista no painel do Asaas derrubaria a integração.
   - **Recomendação:** não ativar a lista agora. Reavaliar na ASA7, antes das chaves de produção. Se o Jeferson decidir pelo custo, ligar o IP fixo **só no projeto de produção**, conferir que as chamadas saem pelos IPs novos e só então cadastrar a lista em cada conta de produção. As contas de sandbox ficam sem lista.

3. **ASA4B — cartão recorrente.** Obter o token enviando o objeto `creditCard` faria os dados do cartão passarem pelo servidor do riSZon, o que viola a regra. Em aberto, aguardando o Asaas: o token volta quando o paciente digita o cartão na fatura do Asaas? Qual IP usar na cobrança automática? Até a resposta, o cartão recorrente não é implementado.

4. **ASA8 — momento da nota do paciente.** No cartão, o `PAYMENT_RECEIVED` chega cerca de 32 dias depois da confirmação. **Proposta, a validar com o contador:** a nota do paciente sai no **primeiro** dos dois eventos (`PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`).
   - **Na prática:** no cartão, sai na confirmação; no boleto e no PIX, os dois chegam juntos ou só chega o `RECEIVED`, e a nota sai nele. Assim o paciente não espera um mês pela nota de algo que já pagou, e a regra é uma só para todos os meios.
   - **Se houver estorno ou chargeback depois**, o riSZon pede o cancelamento da nota no Asaas e avisa o financeiro.
   - **A alternativa** — emitir só no `PAYMENT_RECEIVED` — atrasa a nota do cartão em cerca de 32 dias, mas evita cancelar nota em contestação.
   - **Para o contador decidir:** qual dos dois momentos a prefeitura e o regime de cada unidade aceitam.

### 13.3 Ainda com o gerente de contas do Asaas

- Uso da chave de API entre CNPJs distintos (contratual e regulatório).
- Para o futuro: subcontas para as novas unidades, com CNPJ e titular diferentes (hoje todas são contas vinculadas, D2).
- Split em chargeback.
- Tabelas de tarifas e negociação.
- Elegibilidade de Londrina e Cambé ao Pix Automático.
- Parecer sobre o repasse de 100% à RisLife.

A **D2** (todas as unidades como contas vinculadas) continua valendo.

---

## 14. Decisões da ASA1 (11/11/2026)

O plano da ASA1 foi aprovado em **duas entregas**, cada uma entrando no `main` separada: primeiro as abas Financeiro e Comercial e o responsável financeiro; depois a cobrança.

### 14.1 O que se cobra e como

- **Só parcela que já existe** (tratamento, venda direta, renegociação). Cobrança de valor livre fica para a ASA4.
- **Meio de pagamento:** quem emite escolhe entre boleto, PIX e cartão à vista, partindo do meio gravado na parcela. Parcela de cartão parcelado, cartão recorrente ou depósito não emite na ASA1.
- **Cartão só pela fatura do Asaas.** No cartão à vista, o pagador digita o cartão na fatura do Asaas, aberta pelo link. O riSZon não tem campo de cartão nem recebe dados de cartão em nenhuma rota.
- **Sem split até a ASA3.** O recebimento dessas cobranças (baixa na ASA2) gera a conta a pagar de taxa de hoje, para nenhum repasse se perder.
- **Pagador no Asaas:** criado com os avisos desligados e só com nome e CPF, até a ASA2 ligar a régua.
- **Uma cobrança ativa por parcela.** A mesma parcela pode ter várias cobranças ao longo do tempo (por exemplo, o saldo de um pagamento parcial), mas só uma ativa por vez. Não existe `charge_id` em `payment_installments`: a cobrança ativa sai da tabela de cobranças.
- **Modelo pronto para as próximas fases.** `charges` e `gateway_customers` nascem aceitando os meios Pix Automático e cartão recorrente (ASA4B), a empresa como pagadora (ASA5) e as origens PPR+, Ortodontia, Empresarial e cobrança mensal à unidade. Na ASA1 só parcela é emitida; o resto é recusado por regra.

### 14.2 Carência fixa em zero

- Na produção a carência já é zero na rede e nas unidades, e passa a ser **fixa em zero**: o Asaas não aplica carência, e multa e juros contam do dia seguinte ao vencimento.
- Na aba Financeiro, o campo fica só leitura, com o valor e a explicação: "o Asaas não aplica carência; multa e juros contam do dia seguinte ao vencimento".
- O banco recusa carência diferente de zero em `finance_settings`, na rede e na unidade.
- Proteção para dados antigos: parcela com carência maior que zero não é emitida pelo Asaas, com o motivo na tela.

### 14.3 Parcela vencida

- **Conferido no sandbox (11/11/2026):** o Asaas **recusa** vencimento no passado, nos três meios ("Não é permitido data de vencimento inferior a hoje"), e **aceita** vencimento hoje.
- ✅ **Regra aprovada pelo Jeferson (11/11/2026):**
  - quem emite escolhe a nova data, **de hoje até 7 dias corridos à frente**;
  - o valor sai atualizado com a multa e os juros que o riSZon já calcula **até a nova data**, não até o dia da emissão;
  - o desconto de pontualidade não vale (o benefício já foi perdido);
  - a cobrança reemitida vai **sem multa nova**, com os **juros mensais normais** a partir da nova data;
  - se a nova data também passar, a diferença de centavos que o Asaas cobrar a mais é registrada **como juros** na baixa (ASA2);
  - **acima do limite de dias a emissão é recusada**, com a indicação de que o caminho é a **renegociação**;
  - o limite é **configuração da rede** na aba Financeiro da Central, com **padrão 7**.

### 14.4 Pagamento no balcão com cobrança ativa

Quando o paciente paga em dinheiro ou maquininha uma parcela com cobrança emitida, a tela oferece uma ação única: cancelar a cobrança no Asaas e, com o cancelamento confirmado, abrir o recebimento manual. Se a cobrança já estiver paga no Asaas, a ação é recusada. Esse recebimento manual gera a conta a pagar de taxa da unidade, como hoje.

### 14.5 Recebimento manual — a regra pedida e a de hoje

**A regra pedida pelo Jeferson (11/11/2026):**

- a tela já traz o valor devido na data (parcela, menos o benefício de pontualidade se no prazo, mais multa e juros se em atraso), igual ao que o Asaas cobraria;
- a Recepcionista pode receber o valor devido ou um valor menor, como pagamento parcial; não pode dar desconto nem dispensar multa e juros;
- o Gerente de Unidade e o Admin Master podem quitar por valor diferente do devido, com motivo obrigatório e registro na auditoria;
- pagamento parcial é aceito: o valor pago é baixado e o saldo continua em aberto na parcela, podendo ganhar nova cobrança pelo Asaas;
- a conta a pagar de taxa é calculada sobre o valor efetivamente recebido.

**Como é hoje** (`register_payment_receipt`, 0188; `installment_balance`; `apply_receipt_split`, 0370), conferido no código em 11/11/2026:

| Ponto | Hoje | Diferença para a regra pedida |
| --- | --- | --- |
| Valor sugerido | A tela já abre com o saldo atualizado: parcela + benefício perdido + multa + juros na data (`updatedBalanceCents`). | Igual. |
| Quem recebe | Admin Master, Financeiro da Franqueadora, Gerente e Recepcionista da unidade (`can_receive_payment`). | Igual para receber. O Financeiro da Franqueadora também recebe hoje e não é citado na regra pedida — mantido como está. |
| Valor menor | Aceito como **pagamento parcial**: abate principal → benefício perdido → multa → juros; a parcela fica "parcial" e o saldo continua aberto. Multa e juros continuam sobre o valor cheio. | Igual. |
| Valor maior que o devido | Recusado (`AMOUNT_OVER_BALANCE`). | Igual. |
| Desconto ou dispensa na baixa | **Não existe**: "só quita quem paga tudo". Desconto hoje só por **renegociação** (Gerente, Financeiro com autorização do Gerente, Admin). | **Diferença:** a regra pedida cria a **quitação por valor menor**, só para o Gerente da unidade e o Admin Master, com motivo obrigatório e auditoria. |
| Conta a pagar de taxa | Sobre o valor recebido inteiro, inclusive multa e juros (`_apply_fee_split` com o valor da baixa). | Igual. |

**✅ Quitação por valor menor — aprovada pelo Jeferson (11/11/2026):**

- só o **Gerente da unidade** e o **Admin Master**, com **motivo obrigatório**;
- é um recebimento normal do valor pago, mais uma **dispensa** registrada com o motivo, que fecha o saldo;
- a dispensa abate primeiro os juros, depois a multa, depois o benefício perdido e por último o principal;
- só a parte de principal dispensada entra no razão como **Descontos concedidos (1.9.02)**. Multa, juros e benefício perdido nunca chegaram a ser lançados como receita, então dispensá-los não gera lançamento;
- a conta a pagar de taxa é calculada sobre o valor efetivamente recebido;
- **acréscimo:** toda dispensa fica visível para a franqueadora. Na ASA1, a dispensa é gravada com valor por natureza, autor, data e motivo, num registro que o painel consegue ler depois; na **ASA3**, o painel de repasses lista, por unidade, as dispensas do período com valor, autor e motivo.

**A diferença entre parcial e quitação por valor menor:** a Recepcionista recebe o valor devido ou um valor menor como **pagamento parcial** — o saldo continua em aberto, e ela não dá desconto nem dispensa multa e juros. A **quitação por valor menor** fecha o saldo e exige o Gerente da unidade ou o Admin Master.

### 14.6 Decididos em 11/11/2026

A regra da parcela vencida (14.3) e a quitação por valor menor (14.5) foram aprovadas, com os dois acréscimos: o limite de dias da reemissão (padrão 7, na aba Financeiro) e a dispensa visível para a franqueadora (painel de repasses da ASA3).

### 14.7 Permissões

- As três permissões novas da cobrança (ver, emitir, cancelar) nascem só com o Admin Master.
- Na liberação futura, conforme a matriz 9.3:
  - **Financeiro da Franqueadora:** ver, emitir e cancelar na rede toda;
  - **Gerente de Unidade:** ver, emitir e cancelar na própria unidade;
  - **Recepcionista:** ver e emitir na própria unidade;
  - **Assistente Comercial e Consultor Comercial:** ver e enviar o link dos clientes deles.

## 15. Registrado para a ASA4 (11/11/2026)

Pedido do Jeferson ao aprovar a entrega 2 da ASA1. Vale quando a ASA4 for planejada.

### 15.1 O Consultor Comercial não gera nem cancela cobrança

A geração é **automática na assinatura do contrato no ZapSign**. O consultor não tem botão de gerar nem de cancelar cobrança.

### 15.2 O cockpit do Consultor Comercial

Mostra as cobranças das vendas dele, com a situação de cada uma e os botões **Copiar link**, **Enviar pelo WhatsApp**, **Copiar Pix** e a **linha digitável**. Mostra também quando o pagamento da primeira cobrança foi confirmado e a venda fechou (D21).

### 15.3 O fluxo depois da assinatura, por meio de pagamento

- **Boleto:** a primeira cobrança é enviada automaticamente ao pagador; as seguintes são lembradas antes do vencimento, pela régua.
- **Pix:** o cockpit mostra o QR Code da primeira cobrança para pagamento na hora, e o mesmo Pix vai por link; as seguintes vão por link antes do vencimento. No Pix Automático (ASA4B), o pagador autoriza uma vez.
- **Cartão:** o pagador recebe o link da fatura do Asaas e digita o cartão lá. No parcelado, um único pagamento cobre o tratamento; no recorrente (ASA4B), a cobrança é mensal e automática.
- **Contrato com muitas parcelas:** o pagador não recebe todas de uma vez. Recebe só a primeira na assinatura e cada uma das seguintes perto do vencimento.
- **O envio automático usa a régua do Asaas**, ligada na ASA2. A aba Cobrança e comunicação da Central mostra o custo de cada canal.

## 16. Decisões da ASA2 (11/11/2026)

Plano aprovado pelo Jeferson em 11/11/2026, em **duas entregas**. **Entrega 1:** o aviso do Asaas vira baixa (processamento, baixa automática, fechamento da venda pela D21, estorno, duplicidade, avisos, reprocessar). **Entrega 2:** sinalização "em atraso" e a aba Cobrança e comunicação (régua). Migração da entrega 1: **4005**.

### 16.1 O que a documentação do Asaas mostrou

- **Pix não tem "confirmado":** chega só `PAYMENT_RECEIVED`. Boleto: `PAYMENT_CONFIRMED` e depois `PAYMENT_RECEIVED`. Cartão: confirmado no dia, recebido cerca de 32 dias depois.
- **Valor pago com multa e juros:** o Asaas devolve o valor original num campo à parte (`originalValue`); qual campo traz o total pago é provado no sandbox, com uma cobrança vencendo hoje e paga no dia seguinte (a prova leva dois dias).
- **Régua por pagador:** cada pagador no Asaas tem a própria configuração de avisos (eventos, antecedência, canais), editável pela API; não dá para criar nem apagar avisos, só ligar, desligar e trocar canal.
- **Custo de cada canal** vem de `GET /v3/myAccount/fees` (`notification`): no sandbox, SMS R$ 0,50, WhatsApp R$ 0,55, ligação R$ 0,55, Correios R$ 2,91 e mensageria R$ 0,99.

### 16.2 O que cada aviso faz

| Aviso do Asaas | Efeito no riSZon |
| --- | --- |
| Confirmado (boleto, cartão) | Fecha a venda se aberta (D21), dá a baixa; cobrança **Paga** |
| Recebido sem confirmado antes (Pix) | O mesmo e já **Liquidada** |
| Recebido depois de confirmado | **Liquidada**; a data em que o dinheiro cai é a real |
| Vencido | **Vencida**; entra no **resumo diário** da unidade (sem aviso individual) |
| Apagada no painel do Asaas | **Cancelada** com a origem registrada; a parcela destrava; aviso ao Gerente e ao Admin |
| Restaurada | Volta a valer se a parcela não tiver outra cobrança ativa; senão, só aviso |
| Alterada no painel do Asaas | Registra e avisa; se o pagamento vier com valor diferente do emitido, a baixa segue a regra do valor a maior ou a menor (16.3) |
| Estorno total | Estorna a baixa; a parcela volta a ficar em aberto; cobrança **Estornada**; **a taxa da rede continua devida** (16.5); aviso ao Financeiro da Franqueadora e ao Admin |
| Estorno parcial; contestação no cartão | Só avisa; o Financeiro trata à mão (**D**) |
| Chave ou conta com problema | Aviso ao Admin |

- O mesmo aviso nunca é processado duas vezes; a situação só avança (exceto estorno). Aviso de cobrança que não nasceu no riSZon é guardado e ignorado.
- **O webhook responde 200 depois de gravar o aviso**, mesmo que o processamento falhe ou demore. Erro de processamento nunca vira outra resposta, para a fila do Asaas não pausar.
- **Reprocessar o aviso com erro:** na rotina diária, quando chega o próximo aviso da mesma cobrança, e pelo botão **Reprocessar** na lista de avisos com erro (Central, aba Conta e tarifas, Admin).
- A rotina diária confere se o Asaas pausou a fila de avisos e avisa o Admin.

### 16.3 Valor pago diferente do esperado (A)

- **Na emissão:** a multa vai **em reais**, já calculada pelo riSZon sobre o valor cheio, e os juros vão **ajustados na mesma proporção** (juros da parcela × valor cheio ÷ valor da cobrança). Assim a diferença entre o Asaas e o riSZon fica em centavos.
- **A maior:** o que o Asaas cobrar a mais entra como **juros** na baixa (já aprovado na 14.3).
- **A menor até o limite (padrão R$ 0,10):** a parcela fecha sozinha, com a diferença registrada como **"arredondamento (automático)"** — não é dispensa. O limite é configuração da rede na aba Financeiro.
- **A menor acima do limite:** o saldo fica em aberto na parcela, com aviso ao Gerente.

### 16.4 A baixa automática

- **Ordem da D21 numa operação só:** confirma o pagamento na venda → a venda fecha (com a receita, o card comercial, o Indica e os avisos de sempre) → dá a baixa. O fechamento fica registrado com origem **Asaas**. Vale para venda comercial, venda direta e renegociação.
- A baixa segue a regra de sempre (principal → benefício perdido → multa → juros; taxa da rede sobre o valor pago). Quem deu a baixa: **"Asaas (automático)"**.
- **Conta "Asaas" (B):** cada unidade pronta ganha uma conta bancária "Asaas"; toda baixa automática entra nela, e a transferência ao banco aparece na Conciliação.
- **Taxa do Asaas (C):** a taxa e a data em que o dinheiro cai vêm do próprio aviso (valor menos valor líquido; data de crédito), não da tabela de tarifas.
- **Funções internas:** as versões de fechar venda, dar baixa, aplicar a taxa e estornar usadas pelo aviso respondem **só à chave de serviço**, fechadas para usuário logado e anônimo (provado no ensaio). As telas de hoje não mudam.

### 16.5 Estorno e a D13

- No estorno total, a baixa é estornada e a parcela volta a ficar em aberto, mas a **taxa da rede permanece devida** pela unidade (D13: repasse não volta em estorno).
- O **Financeiro da Franqueadora** e o **Admin Master** podem **dispensar essa taxa à mão**, com motivo obrigatório e registro na auditoria (ex.: pagamento em duplicidade devolvido).

### 16.6 Pagamento em duplicidade

- Pagamento de cobrança **já cancelada pelo riSZon** ou de parcela **já baixada** (ex.: boleto pago no banco e, antes da compensação, recebimento no balcão) **não gera baixa em dobro**.
- O riSZon registra **"pagamento em duplicidade"** com o valor, e avisa o Gerente da unidade e o Financeiro da Franqueadora, que decidem entre **devolver** ou **abater em outra parcela**.

### 16.7 Avisos (ajuste 3)

- Parcela vencida: **resumo diário por unidade** e o Painel de cobranças, sem aviso por parcela.
- Aviso individual só para o que exige ação: estorno, contestação, duplicidade, diferença a menor acima do limite, cobrança apagada ou alterada no painel do Asaas.

### 16.8 Entrega 2 — sinalização e régua

- **Selo "Em atraso" (E):** só para quem lida com pagamento — Recepcionista, Gerente de Unidade, Consultor e Assistente Comercial, Financeiro da Franqueadora e Admin Master. Dentistas e auxiliares não veem selo nem valores. Sem selo "Em dia". Aparece no cabeçalho da ficha, na agenda (card e janela do agendamento) e no cockpit da avaliação. Nenhum atendimento é bloqueado (D11).
- **Tolerância do selo:** a parcela só conta como "em atraso" para o selo depois de **3 dias úteis** do vencimento (compensação do boleto). Multa e juros não mudam. O prazo é configuração da rede.
- **Régua (F):** a aba Cobrança e comunicação nasce com **tudo desligado**. Uma unidade só liga algum aviso depois de o **Admin Master declarar na Central** que o termo de privacidade foi atualizado com o Asaas como operador. Ao ligar, o riSZon passa a mandar e-mail e celular dos pagadores daquela unidade ao Asaas e aplica a configuração em cada pagador. A aba mostra o custo de cada canal e uma **estimativa mensal** pelo número de cobranças da unidade.

### 16.8.1 Entrega 2 — Painel de cobranças e "A receber do Asaas" (pedido do Jeferson, 11/11/2026)

**Visão "A receber do Asaas"** — os valores **pagos** que o Asaas ainda **não liquidou** (cobrança Paga, ainda não Liquidada):

- total a receber e a **agenda por data prevista de liquidação**: hoje, próximos 7, 30 e 60 dias, e dia a dia;
- quebra por meio de pagamento: boleto, Pix, cartão à vista, cartão parcelado e, depois, recorrente e Pix Automático;
- no cartão parcelado, **cada parcela do cartão** com a sua data prevista;
- **valor bruto, taxa do Asaas e valor líquido**;
- por unidade para o **Gerente**; a rede toda, com filtro por unidade, para o **Admin Master** e o **Financeiro da Franqueadora**;
- quando chega o aviso de "recebido", o valor **sai** desta visão e **entra na conta "Asaas"** da unidade.

**Lista de cobranças** — todas as cobranças **emitidas pelo riSZon**, com filtro por situação, meio de pagamento, período e unidade. A tela diz com clareza que **cobranças criadas direto no painel do Asaas não aparecem**.

**De onde vêm os dados (conferido na documentação do Asaas em 11/11/2026):**

- **Data prevista de liquidação:** cada cobrança traz `estimatedCreditDate` (prevista) e `creditDate` (efetiva). O riSZon já grava a data no aviso de pagamento (`charges.credit_date`) e a corrige no aviso de "recebido". **Provado no sandbox** no Pix, no boleto e no cartão à vista (cartão de 11/11 com crédito previsto para 14/12).
- **Taxa e líquido:** o aviso traz `value` e `netValue`; a taxa é a diferença (já gravada na baixa).
- **Cartão parcelado:** o Asaas cria **uma cobrança por parcela do cartão**, cada uma com identificador e ciclo próprios. A documentação **não diz** se cada parcela traz a própria data prevista nem se o crédito é mês a mês — **a provar no sandbox quando o cartão parcelado for emitido (ASA4)**. Até lá, a visão mostra cartão parcelado vazio.

### 16.8.2 Registrado para a ASA3 — "Repasses a receber"

No Painel de repasses, a mesma lógica para a franqueadora: os **splits de cobranças já pagas que ainda não foram liquidados**, por data prevista, unidade e taxa, e os **já liquidados no período**.

**De onde vêm os dados (conferido na documentação do Asaas em 11/11/2026):** o split tem situação (`PENDING`, `AWAITING_CREDIT`, `DONE`, `CANCELLED`, `REFUNDED`, `BLOCKED_BY_VALUE_DIVERGENCE`…), valor e `creditDate` **só quando é pago**; o aviso `PAYMENT_SPLIT_DONE` chega por split. **O Asaas não informa data prevista para o split.** Proposta, a confirmar com o Jeferson antes de implementar: usar como data prevista a **data prevista de liquidação da cobrança** de origem (o split é creditado quando a cobrança é liquidada), e conferir a hipótese no sandbox na ASA3.

### 16.9 Provas

- Ensaio no treino em transação desfeita: cada aviso; o repetido; o fora de ordem; a D21 nas três origens; valor a maior, a menor dentro e fora do limite; estorno com a taxa mantida e a dispensa manual dela; duplicidade; as funções internas fechadas para logado e anônimo; `npm run test:indica`.
- Sandbox de ponta a ponta: Pix e boleto pagos pelo sandbox dão baixa e fecham uma venda de teste sozinhos; o pagamento atrasado em dois dias (**✅ 12/11/2026**: boleto de R$ 10,00 com multa de 2% e juros de 1% ao mês, vencido em 11/11 e pago em 12/11 — o Asaas mandou `value` 10,20, `originalValue` 10,00, `interestValue` 0,20; a baixa saiu de R$ 10,20 = 10,00 de principal + 0,20 de multa + 0,00 de juros, porque um dia de 1% ao mês sobre R$ 10 dá menos de meio centavo; `payment.value` é o campo certo e nada mudou no código); o **cartão pago pelo Jeferson** na página da fatura com o cartão de teste do Asaas (**G**).

## 17. Decisões da ASA2, entregas 2 e 3 (12/11/2026)

Plano aprovado pelo Jeferson em 12/11/2026. A ASA2 passa a ter **três entregas**: a 1 (4005, concluída), a **2** (migração **4006**: selo "Em atraso" e Painel de cobranças) e a **3** (migração **4007**: a régua, depois das respostas do Asaas às lacunas da 17.4).

### 17.1 Selo "Em atraso" (entrega 2)

- **Regra:** a parcela em aberto (ou parcial) conta como "em atraso" depois de **3 dias úteis** do vencimento. Dias úteis excluem sábado, domingo e **feriados nacionais** (a compensação bancária segue o calendário nacional). O prazo é configuração da rede, na aba Financeiro da Central. Multa e juros não mudam: contam desde o vencimento.
- **O texto do selo:** "Em atraso há N dias", com N contado **desde o vencimento**; o selo só aparece depois da tolerância. **Sem valor** no selo; o valor continua só na aba Financeiro, para quem já o vê.
- **Onde:** cabeçalho da ficha, card da agenda e janela do agendamento, cockpit da avaliação (no lugar do "Em breve"). Nenhum atendimento é bloqueado (D11).
- **Quem vê, em duas etapas por permissão:** primeiro, só **Admin Master, Gerente de Unidade e Franqueado** (própria unidade). Depois que o Jeferson liberar em Administração › Permissões, também **Recepcionista, Consultor e Assistente Comercial e Financeiro da Franqueadora**. **Dentistas, auxiliares e SDR nunca veem**, mesmo que a permissão seja marcada para eles.
- **Uma regra só:** o aviso "cobrança(s) em atraso" da ficha, o número vermelho da aba Financeiro e o filtro "em atraso" da lista de prontuários usam a mesma tolerância do selo. A aba Financeiro continua mostrando cada parcela como **vencida** desde o vencimento, com multa e juros.
- **Recepcionista na etapa 1 (decisão do Jeferson, 13/11/2026):** sem o selo, mas **continua vendo** o aviso "cobrança(s) em atraso" da ficha, o número vermelho da aba Financeiro e o filtro/marca de Prontuários (a cobrança da recepção, FIN1.1). Conferido no projeto de teste publicado por `npm run test:e2e:publicado`.
- **Manual:** o selo serve para a recepção tratar do pagamento **com discrição, fora da sala clínica**, e **não bloqueia** o atendimento.

### 17.2 Painel de cobranças (entrega 2)

- Em **Financeiro → Cobranças**, duas abas: **"A receber do Asaas"** (16.8.1) e **"Cobranças emitidas"** (todas as emitidas pelo riSZon, com filtros por situação, meio, período e unidade, link para a ficha e planilha; aviso de que as criadas direto no painel do Asaas não aparecem).
- A taxa do Asaas e o valor líquido passam a ser gravados em cada cobrança (antes só no lançamento contábil); as antigas são preenchidas pelos avisos já guardados.
- **Quem vê:** Gerente de Unidade e **Franqueado**, a própria unidade; Admin Master e Financeiro da Franqueadora, a rede com filtro por unidade. A Recepcionista não vê. **Na produção, o painel nasce visível só para o Admin Master** enquanto a integração estiver em testes.
- **Cada download da planilha fica na auditoria**, com quem baixou, quando e com quais filtros.

### 17.2.1 Ajustes do teste do dono (12/11/2026)

- **Dois sentidos para "em atraso":** na aba Financeiro, a parcela passada do vencimento é **"vencida"** ("vencida há N dias", o cartão e o filtro **Vencidas**); "em atraso" fica só para o que passou da tolerância (selo, aviso da ficha, número da aba, filtro de Prontuários).
- **Painel sem termos internos:** só aparecem os meios que o riSZon já emite (boleto, Pix, cartão à vista); os outros entram quando a fase deles existir.
- **Homônimos:** o código do prontuário aparece ao lado do nome no painel e na planilha (coluna **Prontuário**).
- **Auditoria:** os dois registros de cobrança ganharam nomes distintos ("emitir e cancelar" e "registro"); a exportação mostra os filtros com acento e por extenso.
- **Arredondamento automático do Asaas:** o máximo cai de R$ 5,00 para **R$ 1,00** (fecha saldo sem passar pelo Gerente).
- **Parcela "Cartão":** emite como **cartão à vista daquela parcela** (o paciente paga a parcela no cartão pela fatura do Asaas); o que não emite é o **cartão de crédito parcelado** (14.1). A janela de emissão agora diz isso.

### 17.3 Régua (entrega 3)

- A tela segue os **8 avisos fixos** do Asaas por pagador (cobrança criada; 2 lembretes antes do vencimento, em 0/5/10/15/30 dias; linha digitável; 2 avisos de vencida, no dia e em 1/7/15/30 dias; pagamento recebido; cobrança alterada), com os canais e-mail, SMS, WhatsApp e ligação. Correios fica fora.
- A **declaração do Admin Master** sobre o termo de privacidade é feita uma vez, para a rede; sem ela nenhuma unidade liga aviso.
- Ao ligar numa unidade, o riSZon manda e-mail e celular dos pagadores dela e aplica a régua um por um, em segundo plano; pagadores novos nascem com a régua. O telefone só vai como celular quando parecer celular (11 dígitos começando com 9); a tela mostra quantos pagadores estão sem e-mail ou sem celular.
- **Ao desligar**, os avisos são desligados; e-mail e celular **continuam no Asaas** e só são removidos quando a conta da unidade for **desvinculada**.
- **Desligamento individual por pagador**, para o paciente que pedir para não receber avisos, com registro de quem desligou e o motivo; a tela da unidade mostra quantos pagadores estão com os avisos desligados.
- **Quem edita:** só Admin Master e Financeiro da Franqueadora. O Gerente e o Franqueado veem a régua e a estimativa de custo da própria unidade.
- Custo: o preço de cada canal (`GET /myAccount/fees`) e uma estimativa mensal (cobranças da unidade nos últimos 30 dias × avisos ligados × preço).

### 17.4 Lacunas levadas ao Asaas pelo Jeferson — respondidas em 12/11/2026

1. **Mensageria (R$ 0,99 no sandbox):** é a tarifa dos avisos por **e-mail e SMS**, **uma vez por cobrança** (não por aviso) e descontada **só na compensação** do pagamento. **E-mail não é gratuito**: entra na mensageria.
2. **WhatsApp:** nativo, sem contratação nem modelos para aprovar. Sai dos **números oficiais do Asaas**; se o pagador responder, um assistente virtual do Asaas orienta a procurar a empresa (a resposta **não chega à clínica**). Tarifado **por disparo**. Exige `mobilePhone` válido, **saldo disponível** na conta da unidade no momento do envio e que o pagador não tenha bloqueado o número. Vem desligado por padrão.
3. **Sandbox:** e-mail e SMS são **enviados de verdade**. Toda prova no sandbox usa pagador **sem e-mail nem celular**, salvo a prova de envio, que só acontece com contato do Jeferson e com a aprovação dele na hora.
4. **Correios:** é por cobrança, só boleto com vencimento a mais de 15 dias. **Fica fora** da régua.
5. **Avisos desligados** (`notificationDisabled`): o Asaas não envia nada ao pagador, **nem a confirmação de pagamento**.

**Conferido no treino (12/11/2026):** os R$ 0,99 de diferença das cobranças de teste liquidadas (Pix de R$ 6,00 com líquido de R$ 5,01) são a **tarifa promocional do Pix** (R$ 0,99 até 10/02/2027, depois R$ 1,99; boleto também R$ 0,99), não mensageria: os pagadores de teste nasceram com os avisos desligados, e o `netValue` já vem com o desconto no aviso de cobrança criada.

**O que a documentação do Asaas mostrou (12/11/2026)**, sem contradizer a 17.3:

- Os 8 avisos por pagador, com os prazos: lembrete antes do vencimento (`PAYMENT_DUEDATE_WARNING`) em 0, 5, 10, 15 ou 30 dias; vencida (`PAYMENT_OVERDUE`) no dia e outro em 1, 7, 15 ou 30 dias. A API só liga, desliga, troca canal e prazo (`GET /v3/customers/{id}/notifications`, `PUT /v3/notifications/batch`); contato e `notificationDisabled` por `PUT /v3/customers/{id}`.
- Padrão do Asaas: e-mail e SMS em tudo, **ligação** nos dois avisos de vencida, WhatsApp desligado, e **e-mail para a conta da unidade** em "recebida" e "vencida". O riSZon grava todos os canais explicitamente; o padrão do Asaas nunca vale.
- **Cota:** 25.000 requisições **por conta** a cada 12 horas, 50 GET simultâneos por conta e limites próprios em alguns endpoints (429). O saldo da conta sai de `GET /v3/finance/balance`. **Não há aviso (webhook) de falha de envio de notificação.**
- O pagamento traz `transactionReceiptUrl` ("comprovante de confirmação, recebimento, estorno ou remoção"); os avisos de pagamento guardados no treino já o trazem.

### 17.5 Decisões da entrega 3 — a régua (12/11/2026)

Plano aprovado pelo Jeferson em 12/11/2026. Migração **4007**; core 0.439.0, Asaas 0.6.0. Começa já: na produção nenhuma unidade tem conta Asaas até a ASA7, então nada é enviado antes disso.

- **D1. Avisos para a unidade desligados.** Os e-mails e SMS que o Asaas manda para a conta da unidade (`*EnabledForProvider`) ficam desligados em todos os avisos: o riSZon já avisa (baixa automática, resumo diário, Painel de cobranças).
- **D2. Uma régua só, da rede.** Admin Master e Financeiro da Franqueadora definem os avisos, prazos e canais uma vez, na aba Cobrança e comunicação da Rede. A unidade só **liga ou desliga**. Régua por unidade fica para quando alguém pedir.
- **D3. Ao ligar numa unidade**, as cobranças já abertas passam a receber os **próximos** lembretes; "cobrança criada" não é reenviada. A tela avisa antes de confirmar.
- **D4. E-mail do responsável financeiro:** campo opcional no cadastro do responsável. Responsável que também é cliente usa o e-mail da ficha dele quando o campo estiver vazio.
- **D5. "Não receber avisos de cobrança" vale para o CPF na rede toda**, em todas as contas Asaas em que ele for pagador. Registra quem, quando e o motivo.
- **D6. Conta desativada** (`gateway_accounts.status = 'disabled'`) apaga e-mail e celular dos pagadores dela no Asaas; a forma de apagar é provada no sandbox antes.
- **D7. Quem desliga e quem religa os avisos de um pagador:** **desligar** — Recepcionista, Gerente de Unidade, Financeiro da Franqueadora e Admin Master, com motivo; **religar** — só Gerente, Financeiro e Admin.
- **D9. O lembrete do dia é fixo** (aprovado pelo Jeferson em 12/11/2026). Medido no sandbox: o Asaas aceita no 1º lembrete 5, 10, 15 ou 30 dias antes; o **2º lembrete só no dia do vencimento**; a vencida do dia só no dia; o 2º aviso de vencida 1, 7, 15 ou 30 dias depois. A documentação dava 0/5/10/15/30 para os dois lembretes. A tela mostra o 2º lembrete como "no dia", sem escolha.
- **Canal só com o contato** (medido no sandbox): o Asaas recusa ligar o e-mail de um pagador sem e-mail. E-mail só vai ligado com e-mail; SMS, WhatsApp e ligação só com celular. Quando o contato chega na ficha, o pagador volta à fila.
- **D10. Trava fora da produção** (pedido do Jeferson, 12/11/2026). O sandbox envia e-mail e SMS de verdade e o treino tem pacientes com contato que pode ser de gente real. Em toda conta que não é de produção, o servidor só manda ao Asaas o e-mail e o celular da **lista de permitidos** (variável `ASAAS_SANDBOX_CONTATOS_PERMITIDOS`, só no servidor, separados por vírgula), que **começa vazia**. Pagador sem contato permitido fica com os avisos **desligados** no Asaas (`notificationDisabled: true`), mesmo com a régua da unidade ligada. A trava é de código (`travaForaDaProducao`), não depende dos dados do treino. Para o envio real de teste, o Jeferson inclui o próprio e-mail e celular.
- **D8. Padrão inicial da régua da rede:** e-mail e SMS ligados em todos os avisos; WhatsApp só no primeiro aviso de vencida (o do dia); ligação desligada em tudo. A régua nasce assim, mas **nenhuma unidade nasce ligada** (16.8).

**Custo na tela (ajuste 1).** Dois blocos separados, com os preços lidos da conta **da unidade** (`GET /myAccount/fees`, `notification`):

- **E-mail e SMS (mensageria):** preço × cobranças **pagas** estimadas (as pagas da unidade nos últimos 30 dias), **uma vez por cobrança**, se houver qualquer aviso por e-mail ou SMS ligado. Explicação: "cobrada uma vez por cobrança, só quando ela é paga".
- **WhatsApp e ligação:** preço por disparo × avisos ligados naquele canal × cobranças emitidas nos últimos 30 dias, **paga ou não**. Explicação: "cobrado a cada envio".

**WhatsApp sem trava (ajuste 2).** O canal fica disponível. A tela informa que a mensagem sai de um número do Asaas, que respostas não chegam à clínica e que o envio depende de saldo na conta Asaas da unidade. A unidade com WhatsApp ligado e **saldo zero** (lido de `GET /v3/finance/balance` na rotina diária das contas) ganha alerta na aba e aviso ao Gerente e ao Admin. O Asaas **não avisa falha de envio**: isso não aparece.

**Comprovante próprio (ajuste 4), na 4007.** A cobrança paga ganha o link do comprovante do Asaas (`transactionReceiptUrl`, gravado pelo aviso de pagamento e preenchido nas antigas pelos avisos guardados). Na ficha, a cobrança paga mostra **"Ver comprovante"** e **"Enviar comprovante pelo WhatsApp"** (abre o WhatsApp com a mensagem pronta para o telefone do pagador). Vale com a régua desligada e para quem pediu para não receber avisos — é a clínica quem envia.

**Aplicação em segundo plano.** Fila de pagadores processada por uma rotina a cada 10 minutos: até 50 pagadores por conta por vez, 3 chamadas cada (contato, leitura dos avisos, gravação). Pior caso: 50 × 3 × 6 × 12 = **10.800 chamadas a cada 12 horas por conta**, menos da metade da cota de 25.000; as outras rotinas (contas, emissão) somam poucas dezenas. Ao receber 429, a rotina para aquela conta até a próxima volta. Entram na fila: a unidade ligada ou desligada, a régua alterada, e-mail ou telefone alterados na ficha ou no responsável, o pedido de não receber avisos e a conta desativada. Pagador novo nasce já com a régua se a unidade estiver ligada.

**Celular:** só vai ao Asaas o número com DDD + 9 + 8 dígitos (11 dígitos, o terceiro é 9). A tela mostra quantos pagadores estão sem e-mail, sem celular ou com os avisos desligados.

**Provas.** Ensaio no treino em transação desfeita; testes das contas puras; sandbox **sem envio** (pagador sem e-mail nem celular): ler os 8 avisos, gravar e conferir, ligar e desligar `notificationDisabled`, apagar o contato (D6). Envio real só com aprovação do Jeferson na hora.

**Para a ASA3 (pedido do Jeferson):** verificar no sandbox se a mensageria reduz o `netValue` da cobrança (e portanto a base do split percentual) ou é debitada à parte, com uma cobrança paga com aviso por e-mail ligado para o contato do Jeferson, com a aprovação dele na hora. Se não ficar claro, o Jeferson pergunta ao Asaas.

**Prova de envio real (13/11/2026):** na emissão, a régua foi aplicada antes da cobrança (contato, leitura dos avisos e gravação da régua, depois `POST /payments`), e o Jeferson recebeu por e-mail e SMS os avisos de "cobrança criada" e de "pagamento recebido". Os outros pagadores de Londrina, sem contato na lista de permitidos, não receberam nada.

**Conferido no sandbox (13/11/2026, com a aprovação do Jeferson na hora):** cobrança Pix de R$ 8,00 do LDN-00068, com a régua aplicada (contato do Jeferson, e-mail e SMS ligados) antes da emissão, paga pela simulação do sandbox (`POST /v3/sandbox/payment/{id}/confirm`). O `netValue` veio R$ 7,01: só a taxa do Pix (R$ 0,99), igual às cobranças de teste com os avisos desligados. O extrato da conta (`GET /v3/financialTransactions`) tem só duas linhas para a cobrança ("Cobrança recebida" R$ 8,00 e "Taxa do Pix" −R$ 0,99): **nenhum débito de mensageria**, nem no `netValue` nem à parte. **Inconclusivo para a produção:** o sandbox pode não cobrar a mensageria. Antes do split da ASA3, o Jeferson pergunta ao Asaas se, na produção, a mensageria sai do `netValue` da cobrança (e entra na base do split) ou é debitada à parte no extrato.

---

## 18. Decisões da ASA3 — Split (13/11/2026)

Plano aprovado pelo Jeferson em 13/11/2026, em **três entregas**: (1) o split na emissão; (2) as cobranças em aberto (fila de atualização, divergência, estorno, bloqueio); (3) o Painel de repasses (recebido com split × por fora, dispensas, repasses a receber). O teste real com valores mínimos fica para antes do piloto, com a aprovação do Jeferson.

### 18.1 O que se mediu antes

- **Taxas da franquia na produção (13/11/2026):** royalty 6%, fundo de propaganda 2%, centro de planejamento 3%, comercial 6% (**17%** sobre cada real recebido); sistema e suporte R$ 250,00 e SDR R$ 550,00 por mês. Londrina e Cambé seguem a rede. Nenhuma campanha.
- **Tarifas do Asaas por conta** (`acquirer_rates`, com vigência): Pix e boleto R$ 0,99 até 10/02/2027 e R$ 1,99 depois (uma conta de teste já sem promoção); cartão à vista 2,99% + R$ 0,49 (promoção 1,99% + R$ 0,49).
- **Documentação do Asaas:** o split incide sobre o `netValue`; a carteira da própria conta emissora não entra; o split de cobrança em aberto muda por `PUT /v3/payments/{id}` reenviando `splits` (lista vazia **desliga** o split); split acima do líquido bloqueia a cobrança por 2 dias úteis e depois é cancelado; avisos `PAYMENT_SPLIT_DONE`, `PAYMENT_SPLIT_DIVERGENCE_BLOCK` e `PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED`.

### 18.2 A conta da compensação (S1, S2 e ajuste 1)

Para cada carteira com percentual **p** e tarifa **T = a × V + b** (a = parte percentual, b = parte fixa):

- `percentualValue` = **q = p ÷ (1 − a)**, arredondado **para baixo** em 4 casas;
- `fixedValue` = **F = q × b**, arredondado **para baixo** no centavo.

O Asaas transfere F + q × (V − aV − b) = p × V: **exato para qualquer valor pago**, com desconto ou com multa. Com tarifa fixa (Pix, boleto), a = 0 e a conta vira a da S1 (q = p, F = p × tarifa). **Boleto (S2):** usa a menor tarifa entre código de barras e QR Code Pix. **Tarifa percentual com mínimo e máximo:** a e b da faixa do menor valor possível.

Comparação no cartão (17%, uma ou duas carteiras; método A = percentual p e F pela tarifa do menor valor; método B = o adotado acima, a escolher pelo Jeferson):

| Parcela | Cenário | Diferença A | Diferença B |
|---|---|---|---|
| R$ 500 | no prazo | R$ 0,09 a 0,14 | R$ 0,01 a 0,02 |
| R$ 500 | multa 2% + juros 1% (30 dias) | R$ 0,14 a 0,21 | R$ 0,01 a 0,02 |
| R$ 5.000 | no prazo | R$ 0,85 a 1,28 | R$ 0,01 a 0,02 |
| R$ 5.000 | multa 2% + juros 1% (30 dias) | R$ 1,36 a 2,04 | R$ 0,01 a 0,02 |

As diferenças são sempre **a favor da unidade** (o repasse nunca passa do percentual). No método B o erro é de até **2 centavos por carteira**: até 1 pelo F arredondado para baixo e, em parcelas grandes (a partir de uns R$ 5.000), mais 1 pelo corte do percentual em 4 casas (0,0001% × líquido). O do método A cresce com o valor e passa da tolerância da S5. **Escolhido: método B** (Jeferson, 13/11/2026), uma fórmula só para Pix, boleto e cartão. **Proteção:** se houver mais de uma tarifa vigente entre a emissão e o vencimento (início ou fim de promoção), vale a menor parte percentual e a menor parte fixa; a fila da entrega 2 corrige quando a tarifa muda.

**Promoção com a cobrança em aberto (testes, 14,72% + 1,83%, Pix de R$ 500,00):** emitida na promoção (R$ 0,99) e paga depois do fim (R$ 1,99): repasse R$ 0,16 e R$ 0,03 abaixo do devido, a favor da unidade. O inverso (cheia na emissão, promoção começando antes do vencimento): pago na cheia, os mesmos R$ 0,16 e R$ 0,03 a favor da unidade; pago na promoção, até 1 centavo.

### 18.3 Decisões

- **S1.** F = percentual × tarifa, arredondado para baixo no centavo (generalizado em 18.2).
- **S2.** Boleto: a menor tarifa entre código de barras e QR Code Pix.
- **S3.** Mensageria **fora** do F até a resposta do Asaas (o Jeferson envia a pergunta em 13/11/2026).
- **S4. Não existe desconto de pontualidade nas taxas da franquia.** O split retém o **percentual cheio**. O recebimento fora do split vira conta a pagar de taxa e entra na cobrança mensal da franqueadora à unidade (ASA6): paga em dia, valor cheio; em atraso, com multa e juros. A **multa e os juros da cobrança à unidade** ficam configuráveis na aba Taxas da franquia, **no nível da rede**; os percentuais são do Jeferson, conforme o contrato de franquia.
  - **Hoje (13/11/2026):** o desconto de pontualidade está em `network_fees.punctuality_discount_percent` (rede e exceção da unidade), aplicado só no pagamento da conta a pagar até o vencimento (`payable_punctuality_discount`, 0235). Na produção, está **zerado** em todas as taxas (rede, Londrina e Cambé). As contas a pagar de taxa **não têm multa nem juros calculados**: só os campos para informar à mão o que foi pago (`paid_fee_cents`, `paid_interest_cents`, conta 4.2.01).
- **S5.** Diferença **a menor** de até **R$ 0,10 por cobrança** é absorvida, sem conta a pagar; acima disso, vira conta a pagar da unidade. O limite é configuração da rede. Repasse **a maior** vira divergência para o Financeiro da Franqueadora. **O valor que vale é o liquidado no aviso `PAYMENT_SPLIT_DONE`**: o riSZon grava e compara com o esperado (ajuste 2).
- **S6.** Só emite com split a unidade com o split habilitado declarado e a conta pronta; sem isso, a cobrança sai como hoje. O primeiro split aceito confirma o "split habilitado" na prontidão. A franqueadora não faz split para si mesma.
- **S7.** As quatro taxas percentuais vão para a carteira da conta raiz; o fundo de propaganda tem carteira configurável (D6), começando na raiz; RisLife na ASA5.
- **S8.** Data prevista dos "Repasses a receber": a data prevista de liquidação da cobrança de origem, conferida no sandbox.

### 18.3.1 A taxa retida já nasce paga (pedido do Jeferson, 13/11/2026)

A baixa de uma cobrança com split nasce com a taxa **retida** (`_split_charge_born_retained`, pela referência "Asaas <id>" da baixa): a conta a pagar de taxa do mês **nem é criada** quando tudo foi retido. Antes ela nascia e era cancelada logo depois ("sem valor apurado no mês"), dando a impressão de que o custo não existia. O apurado do mês (`network_fee_summary.retained_cents`) mostra **"pago no split"** em cada taxa; o custo está no razão (despesa da unidade, liquidada) e no resultado.

### 18.4 Entre a entrega 1 e a 2

Enquanto a fila de atualização não existir, uma mudança de taxa (percentual, campanha ou tarifa do Asaas) com cobrança em aberto **não muda o split já enviado**: a diferença cai na S5 (a menor, conta a pagar acima de R$ 0,10; a maior, divergência). O manual diz isso.

### 18.5 Prova

Percentuais de exemplo **diferentes por taxa e não redondos** (para pegar erro de rateio e de arredondamento), com um caso de **duas carteiras** (o fundo de propaganda com carteira própria). Sandbox: os três meios, o formato da entrada e o arredondamento do Asaas.

### 18.5.1 Prova no sandbox (13/11/2026, aprovada pelo Jeferson)

**Parte 1 — formato e arredondamento, direto na API** (`scripts/asaas-prova-split-sandbox.mjs`). Conta de teste de Londrina; pagador sem e-mail e sem celular, avisos desligados (nada enviado); split para a franqueadora (14,72%) e para a conta de teste **"Fundo de Propaganda Teste"** (1,83%). ⚠️ O caso de duas carteiras **só prova que o split funciona com o fundo em carteira própria, no futuro**: hoje o fundo vai para a franqueadora (D6), e a RisLife nunca é destino de taxa de paciente (D7). Pix e boleto pagos pela simulação do sandbox; cartão pela API com o cartão de teste publicado pelo Asaas. Antes, o Jeferson habilitou o split na conta principal do sandbox (sem isso o Asaas recusa a cobrança com split).

| Meio | Pago | Tarifa | Carteira | Enviado | Devido | Liquidado | Diferença |
|---|---|---|---|---|---|---|---|
| Pix | 8,17 | 0,99 | franqueadora | 14,72% + 0,14 | 1,20 | 1,19 | 0,01 |
| Pix | 8,17 | 0,99 | fundo (própria) | 1,83% + 0,01 | 0,15 | 0,14 | 0,01 |
| Pix | 500,00 | 0,99 | franqueadora | 14,72% + 0,14 | 73,60 | 73,59 | 0,01 |
| Pix | 500,00 | 0,99 | fundo (própria) | 1,83% + 0,01 | 9,15 | 9,14 | 0,01 |
| Pix | 1.234,56 | 0,99 | franqueadora | 14,72% + 0,14 | 181,73 | 181,72 | 0,01 |
| Pix | 1.234,56 | 0,99 | fundo (própria) | 1,83% + 0,01 | 22,59 | 22,58 | 0,01 |
| Boleto | 500,00 | 0,99 | franqueadora | 14,72% + 0,14 | 73,60 | 73,59 | 0,01 |
| Boleto | 500,00 | 0,99 | fundo (própria) | 1,83% + 0,01 | 9,15 | 9,14 | 0,01 |
| Boleto | 987,65 | 0,99 | franqueadora | 14,72% + 0,14 | 145,38 | 145,37 | 0,01 |
| Boleto | 987,65 | 0,99 | fundo (própria) | 1,83% + 0,01 | 18,07 | 18,06 | 0,01 |
| Cartão | 500,00 | 10,44 | franqueadora | 15,0188% + 0,07 | 73,60 | 73,59 | 0,01 |
| Cartão | 500,00 | 10,44 | fundo (própria) | 1,8671% + 0,00 | 9,15 | 9,14 | 0,01 |
| Cartão | 1.234,56 | 25,05 | franqueadora | 15,0188% + 0,07 | 181,73 | 181,72 | 0,01 |
| Cartão | 1.234,56 | 25,05 | fundo (própria) | 1,8671% + 0,00 | 22,59 | 22,58 | 0,01 |

- **Formato confirmado:** uma entrada por carteira com `percentualValue` e `fixedValue` juntos; o Asaas aceitou nos três meios.
- **Arredondamento do Asaas: PARA BAIXO** (trunca o percentual × líquido no centavo). Nos casos que distinguem os dois modos: 1,19690 → 1,19; 145,37635 → 145,37; 18,06588 → 18,06; 73,59604 → 73,59. A conta simulada do riSZon (`repasseSimulado`) passou a truncar também.
- **Resultado:** o repasse **nunca passou do devido**; a diferença foi de **1 centavo por carteira** em todos os casos (o truncamento do Asaas somado ao F para baixo), dentro da tolerância de R$ 0,10.
- **Cartão:** o split fica `AWAITING_CREDIT`/`PENDING` até a liquidação do cartão (cerca de 32 dias); o valor já vem calculado na cobrança.

**Parte 2 — de ponta a ponta no projeto de teste.** Taxas do treino iguais às da produção (royalty 6%, fundo 2%, planejamento 3%, comercial 6%; as quatro para a carteira da franqueadora; ficaram assim). Cobrança Pix de R$ 6,00 do LDN-00069 (responsável financeiro sem e-mail e sem telefone), emitida pelo caminho do servidor com a sessão da Recepcionista de teste e paga pela simulação do sandbox:
- **Split gravado:** uma carteira (franqueadora), 17% + R$ 0,16, com o id do Asaas; "split habilitado" de Londrina confirmado sozinho.
- **Avisos:** `PAYMENT_SPLIT_DONE` chegou **antes** do `PAYMENT_RECEIVED` e os dois foram processados sem erro (`split_liquidado`, `baixa`).
- **Liquidado R$ 1,01 × devido R$ 1,02** (17% de R$ 5,01 = 0,8517 → 0,85 + 0,16): 1 centavo, absorvido (S5).
- **Retido na origem:** as 4 taxas (R$ 0,36 + 0,12 + 0,18 + 0,36) retidas inteiras; as contas a pagar de taxa do mês ficaram **sem valor** — nada em dobro.
- **Razão:** 8 lançamentos liquidados — despesa da unidade (2.6.01 a 2.6.04) e receita da franqueadora (1.3.01, 1.3.03, 1.3.05, 1.3.06).

### 18.6 Pendências com o Asaas que afetam a ASA3

- [ ] Mensageria no `netValue` (produção) — perguntado pelo Jeferson em 13/11/2026.
- [ ] Cartão de débito na fatura de cobrança `CREDIT_CARD` (se aceitar, a tarifa do débito entra como a menor).
- [x] Arredondamento do `percentualValue` × `netValue` — **para baixo** (medido no sandbox em 13/11/2026, 18.5.1).
- [ ] Split em chargeback (gerente de contas).

### 18.7 Entrega 2 — as cobranças em aberto (plano aprovado em 13/11/2026; migração 4009)

**Escopo:** (1) a **fila** que atualiza o split das cobranças em aberto quando a taxa do dia muda; (2) **estorno** total com split e **bloqueio** por divergência; (3) a **visão da unidade** na aba Taxas da franquia (D19) e o fim da tela antiga.

**Decisões (U1–U9, aprovadas como propostas, com os ajustes do Jeferson):**
- **U1. Gatilhos:** padrão da rede ou acordo da unidade (percentual, ligada/desligada); campanha criada, alterada ou apagada; destino da taxa; tarifa nova do Asaas (inclusive o fim da promoção em 10/02/2027); rodada diária. Mudança que não altera a conta **não** chama o Asaas.
- **U2. Rodada diária às 00:05 (Brasília).** Pagamento entre 00:00 e o fim da rodada, no dia da mudança, cai na S5.
- **U3.** Cobrança emitida sem split que passou a poder ter: a fila **acrescenta** o split.
- **U4. Nunca tirar o split automaticamente** (a lista vazia desliga tudo); aviso ao Financeiro. Taxa que vai a zero sai do split, as outras ficam. **Exceção (ajuste 3):** se **todas** as taxas da unidade forem a zero **por decisão registrada** (isenção ou campanha), o riSZon pode enviar a lista vazia **com confirmação do Financeiro ou do Admin e registro na auditoria**. Em qualquer outro caso, nunca.
- **U5.** Cartão confirmado fora da janela do Asaas (até 1 dia útil antes do crédito, sem antecipação): sai da fila; a diferença cai na S5.
- **U6. Estorno total com split (D13):** o retido já liquidado é estornado no razão (a unidade recebe de volta, a franqueadora devolve) e a taxa volta a ser devida na conta a pagar; a dispensa manual (16.5) continua. **Ajuste 4:** verificar na documentação e no sandbox o que acontece quando a carteira que recebeu o split não tem saldo para devolver; se o estorno falhar ou ficar pendente, o riSZon avisa o Financeiro. Estorno parcial e chargeback continuam à mão.
- **U7. Bloqueio por divergência:** o riSZon refaz o split para caber no líquido real e reenvia dentro dos 2 dias úteis; avisa se falhar. **Ajuste 5:** a diferença em relação ao devido segue a S5 (acima da tolerância, conta a pagar da unidade).
- **U8. "Atualizar agora"** na aba Taxas da franquia (Admin e Financeiro): roda a fila da unidade na hora. **Ajuste 6:** cada uso vai para a auditoria (quem, quando, unidade, quantas cobranças mudaram).
- **U9.** Visão da unidade na Central: Gerente e Franqueado só leem; a tela antiga sai.

**Ajustes:**
1. **Atualizar o split sem efeito para o pagador:** provar no sandbox que o `PUT /payments/{id}` só com o split não dispara o aviso "cobrança alterada" da régua, não muda o link da fatura, a linha digitável nem o Pix copia e cola, e não reinicia o registro do boleto. Se disparar ou mudar, **parar e apresentar a alternativa antes de construir a fila**.
2. **Ordem da fila:** primeiro as já vencidas e as de vencimento mais próximo. Estimar o tempo da fila no fim da promoção (10/02/2027) com o volume de uma unidade cheia.
7. **Histórico por cobrança:** na ficha, a cobrança mostra quando o split foi atualizado e por qual motivo (taxa, campanha, destino ou tarifa).

**Mantido:** fila a cada 10 minutos com até 50 cobranças por conta, parando no limite de chamadas.

**Prova do ajuste 1 (13/11/2026, sandbox):** `PUT /payments/{id}` só com o split, em Pix e boleto: link da fatura, PDF do boleto, nosso número, linha digitável, Pix copia e cola, vencimento e valor **iguais**, e **nenhum** `PAYMENT_UPDATED` (de onde nasce o aviso "cobrança alterada"); o boleto não foi registrado de novo. Controle (só o vencimento): veio `PAYMENT_UPDATED` e a linha digitável mudou. **Aprovado pelo Jeferson: a fila segue como planejada.** (`scripts/asaas-prova-split-put-sandbox.mjs --put`)

**Achado do ajuste 4 (13/11/2026, sandbox):** o estorno pedido pela API fica **`AWAITING_CRITICAL_ACTION_AUTHORIZATION`** até alguém da conta autorizar com o código (SMS). Por isso:

#### 18.7.1 O estorno nasce no riSZon (decisão do Jeferson, 13/11/2026)

1. Na ficha do paciente, a pessoa autorizada pede o **estorno total** de uma cobrança paga, com **motivo obrigatório**.
2. O riSZon envia o pedido ao Asaas pela API. A cobrança fica **"Estorno aguardando autorização"**, com a orientação de autorizar no Asaas (e o link para o lugar certo do painel, se houver).
3. A pessoa autoriza no Asaas com o código que recebe.
4. Com o aviso de estorno concluído, o riSZon aplica a **U6**: estorna a baixa e o retido no razão; a taxa volta a ser devida pela unidade (D13), com a dispensa manual do Financeiro e do Admin.

- **O riSZon nunca pede, recebe nem guarda o código de autorização.** A tela diz isso.
- **Permissão nova "Pedir estorno":** nasce com o Admin Master. Na Central, a unidade indica quem tem o acesso de autorização do Asaas — por padrão o **Franqueado**; o Admin Master pode liberar para o **Gerente** da unidade. Só essas pessoas veem o botão.
- Estorno **aguardando autorização há mais de 1 dia útil**: aviso a quem pediu e ao Financeiro da Franqueadora. Quem pediu pode **cancelar o pedido** enquanto pendente, se o Asaas permitir.
- Estorno **recusado ou com falha** (ex.: saldo insuficiente): a cobrança volta para "Paga"; aviso a quem pediu e ao Financeiro.
- Estorno feito **direto no painel do Asaas** continua tratado pelos avisos, como hoje. Estorno parcial e chargeback continuam à mão.
- **Auditoria:** pedido, autor, motivo e resultado.
- **A verificar (documentação e sandbox):** onde o titular autoriza a ação crítica (painel, aplicativo); se o pedido pendente pode ser cancelado pela API; o estorno de boleto (dados bancários do pagador) e de cartão confirmado; os avisos do Asaas em cada etapa. **Prova:** duas cobranças pela conta principal do sandbox (split para a carteira de Londrina, com saldo; e para a do Fundo de teste, sem saldo); o Jeferson autoriza no painel — **o código nunca passa pelo riSZon nem pela sessão**.

#### 18.7.2 Ritmo da fila (decisão do Jeferson, 13/11/2026)

- **150 cobranças por rodada** (10 min), parando no limite de chamadas; **as vencidas e as de vencimento mais próximo primeiro**. Estimativa: unidade com ~3.600 cobranças em aberto (300 contratos × 12 parcelas) → ~4 h no fim da promoção (10/02/2027), usando menos da metade da cota do Asaas.
- **Diferença causada por mudança de TARIFA do Asaas**, em cobrança paga enquanto ainda estava na fila aguardando atualização, é **absorvida** (sem conta a pagar). Vale **só para tarifa**; mudança de taxa da rede ou de campanha continua na S5.
- A tela mostra o **andamento da fila por unidade**: quantas faltam e a previsão de término.

#### 18.7.3 Prova do estorno com split (13/11/2026, sandbox, autorizado pelo Jeferson no painel)

Conta principal do sandbox, duas cobranças Pix de R$ 20,00 pagas e estornadas por inteiro (`scripts/asaas-prova-estorno-raiz-sandbox.mjs`):

| Caso | Split | Estorno | Split depois | Carteira que recebeu o split |
|---|---|---|---|---|
| E1 | 14,72% para Londrina (com saldo) | `DONE` | `REFUNDED` (R$ 2,79) | devolveu R$ 2,79 (2.739,44 → 2.736,65) |
| E2 | 1,83% para o Fundo de teste (**sem saldo**) | `DONE` | `REFUNDED` (R$ 0,33) | **ficou negativa: −R$ 0,33** |

- **Carteira recebedora sem saldo:** o estorno **não falha nem fica pendente**; o Asaas debita a carteira mesmo assim e ela **fica negativa**. Na rede, a carteira é a da franqueadora (conta raiz).
- **Avisos:** `PAYMENT_REFUNDED` (o Pix foi direto, sem `PAYMENT_REFUND_IN_PROGRESS`); **nenhum** `PAYMENT_SPLIT_CANCELLED` — o split aparece como `REFUNDED` dentro da cobrança.
- **Antes da autorização:** o pedido fica `AWAITING_CRITICAL_ACTION_AUTHORIZATION` e a cobrança continua `RECEIVED`. A autorização é pelo token SMS ou do aplicativo do Asaas.
- **Cancelar pedido pendente pela API: não existe** na documentação (o cancelamento aparece no extrato como `REFUND_REQUEST_CANCELLED`, sem aviso pelo webhook).
- **Boleto:** rota própria (`POST /payments/{id}/bankSlip/refund`) que devolve um link (`requestUrl`) para o **pagador** informar os dados bancários e enviar documentos; pode ser **negado** (`PAYMENT_REFUND_DENIED`, ainda não assinado pelo riSZon).
- **Cartão:** estornável confirmado ou recebido; até 10 dias úteis na fatura do pagador.

#### 18.7.4 Estorno — decisões finais (Jeferson, 13/11/2026)

1. **Saldo negativo:** depois de cada estorno com split, o riSZon confere o saldo da conta que recebeu e avisa o Financeiro da Franqueadora se ficou negativo; a rotina diária também confere. **Aviso preventivo:** saldo da conta da franqueadora abaixo de um **mínimo configurável na rede** avisa o Financeiro — nasce em branco (sem aviso) até o Jeferson definir. **Pendência com o Asaas:** o que acontece com conta de saldo negativo na produção (tarifa, bloqueio ou prazo para cobrir).
2. **Pedido pendente:** sem botão de cancelar (o Asaas não cancela pela API); a tela orienta a cancelar no painel do Asaas ou a não autorizar. A rotina diária consulta os pedidos pendentes: cancelado → a cobrança volta para "Paga" e avisa quem pediu; pendente há mais de 1 dia útil → o aviso de 18.7.1.
3. **Boleto:** o pedido mostra o link do Asaas com "Copiar link" e "Enviar pelo WhatsApp"; a cobrança fica **"Estorno aguardando o pagador"**; negado (`PAYMENT_REFUND_DENIED`) → volta para "Paga" e avisa quem pediu e o Financeiro. A tela explica que o pagador informa os dados bancários direto no Asaas e que o riSZon não recebe esses dados. O pagador é o **responsável financeiro**, quando houver.
4. **Pix e cartão:** pedido no riSZon, autorização no Asaas pelo titular, U6 com o aviso de concluído. O riSZon nunca pede o código.

#### 18.7.5 Webhook sem recriação manual (Jeferson, 13/11/2026)

- A verificação de cada conta compara os avisos assinados no Asaas com a lista que o riSZon espera e **corrige sozinha, pela API**.
- A mesma correção roda **logo depois de cada entrega** que muda a lista (a rotina de 10 minutos confere a versão da lista).
- Webhook desatualizado **derruba a prontidão** da unidade até ser corrigido, e a Central mostra o motivo.
- O botão manual "Criar o webhook" continua, como recurso.

#### 18.7.6 Prova da entrega 2 no sandbox (13/11/2026, código real do servidor)

- **Webhook que se corrige sozinho:** a rotina conferiu as 4 contas de teste com webhook e corrigiu a lista pela API (versão 2, com `PAYMENT_REFUND_DENIED`); o webhook de Londrina passou a ouvir o estorno negado. Sem clique de ninguém.
- **A fila:** cobrança de boleto do LDN-00066 emitida pelo caminho da tela (17% + R$ 0,16). Royalty do treino de 6% → 6,5%: a cobrança entrou na fila (motivo taxa); a rodada mudou o split no Asaas para **17,5% + R$ 0,17**; de volta a 6%, voltou para 17% + R$ 0,16. Link da fatura, nosso número, vencimento e valor **iguais**; nenhum `PAYMENT_UPDATED`; o histórico da cobrança registrou as duas atualizações. A mesma rodada **acrescentou o split (U3)** às 3 cobranças de teste de Londrina emitidas antes do split habilitado.
- **Estorno de boleto: LACUNA.** O Asaas recusou: *"Não é possível efetuar o estorno pois o seu cliente não possui um celular válido."* O estorno de boleto exige o **celular do pagador cadastrado no Asaas** (o riSZon cria o pagador só com nome e CPF; o celular só vai pela régua). **Parado para decisão do Jeferson** antes de adaptar.

#### 18.7.7 Estorno de boleto com o celular do pagador (Jeferson, 13/11/2026)

1. No pedido de estorno de boleto, o riSZon envia ao Asaas o **celular do pagador** que está na ficha (o responsável financeiro, quando houver). A tela mostra, antes de confirmar, **qual número** será enviado e avisa que o Asaas vai mandar um **SMS** com o link.
2. Sem celular válido na ficha, o botão fica desabilitado e explica que é preciso cadastrar antes.
3. Enviar o celular **não liga avisos**: os avisos do pagador ficam como estavam (`notificationDisabled` mantido). **Prova no sandbox com o celular do Jeferson, com a aprovação dele na hora.**
4. **Limpeza:** com a régua da unidade **desligada**, o celular é apagado no Asaas (`mobilePhone: ""`, o método da D6) quando o estorno é concluído, negado ou cancelado; com a régua ligada, fica.
5. Exige a **declaração do termo de privacidade** (a da régua). Sem ela, o estorno de boleto não sai pelo riSZon e a tela orienta a fazer no painel do Asaas.
6. No sandbox vale a **lista de permitidos** (D10).
7. **Auditoria:** celular enviado (por quem, quando) e apagado — **sem o número**.
8. O manual (13g.7) explica o passo a passo e o que o pagador recebe.

**Correção da 4008 dentro da 4009 (13/11/2026):** o razão da taxa retida lançava a receita numa "franqueadora qualquer" (com mais de uma clínica do tipo franqueadora, a conta bancária não batia e o aviso de split dava erro); e uma carteira recebedora **sem clínica** (o fundo com conta própria) fazia o razão recusar. Agora a receita vai para a clínica dona da conta que recebeu o split (sem clínica: a da conta raiz). Na produção ainda não há cobrança com split, então nada foi afetado.

**Prova do estorno de boleto (13/11/2026, celular do Jeferson, aprovada na hora):** o riSZon enviou o celular ao Asaas (`PUT /customers`, aceito; avisos do pagador continuaram **desligados**; nenhuma mensagem chegou ao Jeferson). O Asaas então recusou o estorno por OUTRO dado: *"Não é possível efetuar o estorno pois o seu cliente não possui um e-mail válido."* **O estorno de boleto exige celular E e-mail do pagador no Asaas.** **Decisão do Jeferson (13/11/2026): o e-mail vai junto, com as mesmas regras do celular** (mostrado antes de confirmar; sem e-mail válido, o botão diz o que falta; avisos como estavam; apagado no fim com a régua desligada; termo; lista de permitidos; auditoria sem o endereço). **E em todo erro o motivo aparece na tela** (o riSZon passa a mostrar a descrição do Asaas nos dados recusados — só na tela, nunca no registro). (A primeira tentativa foi feita no riSZon Treino, que roda a versão publicada, sem o botão; os dados gravados lá valeram porque o banco é o mesmo.)

**Prova do estorno de boleto concluída (13/11/2026, 19:25, com o celular e o e-mail do Jeferson, aprovada na hora):** boleto de R$ 6,00 do LDN-00066 (pagador: o responsável financeiro, com "Não receber avisos" ativo). O riSZon enviou celular e e-mail ao Asaas mantendo os avisos **desligados**; o Asaas aceitou o estorno (`AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION`) e devolveu o link; a ficha mostra "Estorno aguardando o pagador" com "Copiar link" e "Enviar pelo WhatsApp". O Jeferson recebeu **o link por e-mail** (nenhum SMS, nenhum aviso de cobrança). Auditoria sem os dados. Régua de Londrina ligada: o contato fica no Asaas (regra 4). **Cartão (R$ 7,00, mesmo paciente):** o estorno foi concluído na hora no sandbox, **sem pedir autorização do titular** (o Pix ficou aguardando o código); o riSZon desfez a baixa e marcou a cobrança como estornada.

**Achado (13/11/2026):** o "Estornar baixa" manual do riSZon desfaz a baixa de uma parcela **paga pelo Asaas** só no riSZon — no Asaas o pagamento continua recebido. A parcela fica "Em aberto" e "Paga pelo Asaas" ao mesmo tempo, com "Gerar cobrança no Asaas" de novo (risco de cobrar duas vezes). **Decisão do Jeferson (13/11/2026): bloquear.** Pessoa logada não estorna a baixa de cobrança paga pelo Asaas (gatilho `payment_receipts_block_manual_gateway_reversal`, erro `GATEWAY_RECEIPT`; a tela troca o botão pelo aviso); o aviso de estorno do Asaas continua desfazendo a baixa. A parcela de 16/11 do LDN-00066 teve a baixa refeita no treino.

### 18.8 Entrega 3 — Repasses da franquia (plano aprovado pelo Jeferson em 13/11/2026; migração 4010)

Painel da franqueadora e de cada unidade (9.2, 14.5 e 16.8.2) que lê o que as entregas 1 e 2 gravam. Quase sem tabela nova: portas de leitura, a tela e a planilha. **Nome: "Repasses da franquia"**, para não confundir com o "Repasses" dos dentistas.

**Partes do painel** (período, filtro de unidade):

0. **Resumo no topo (ajuste 3).** Uma linha por unidade: taxa devida no período, paga no split, a receber, em conta a pagar aberta e em conta a pagar vencida. Na visão da rede, com o total. **(ajuste 6)** No topo da visão da rede, o saldo atual da conta Asaas da franqueadora, com alerta de saldo negativo ou abaixo do mínimo.
1. **Recebido com split × por fora.** Por unidade: com split; Asaas sem split (com o motivo); por fora (dinheiro; maquininha e outros cartões; depósito e Pix manual; cobrança externa). Para cada parte: taxa devida, paga no split e na conta a pagar. **(ajuste 2)** O percentual de cada parte sobre o total recebido da unidade, comparado com a média da rede.
2. **Liquidado por unidade e taxa, conferido contra o percentual.** **(ajuste 1)** A conferência é **por cobrança**: o devido e o liquidado das MESMAS cobranças, nunca o total devido do período contra o total liquidado do período. O filtro é pela **data do pagamento**; o que ainda não foi liquidado aparece como "a receber", não como diferença. Falta dentro da tolerância (S5) = "absorvida". **(ajuste 5)** Enquanto o Asaas não responder se a mensageria sai do `netValue`, uma falta sistemática de até p × R$ 0,99 nas unidades com e-mail ou SMS ligados aparece com nota própria, não como divergência.
3. **Repasses a receber (16.8.2).** Splits de cobranças pagas ainda não liquidados, por data prevista (a data de crédito da cobrança, S8), unidade e taxa; depois da data prevista, marca "atrasado".
4. **Divergências e ocorrências.** Falta acima da tolerância (virou conta a pagar), repasse a maior, split cancelado ou bloqueado, estorno com a taxa de volta à conta a pagar (D13), dispensa de taxa no estorno. Cada linha com link para a ficha; nada se abate nem se dispensa aqui (ASA6).
5. **Dispensas do período (14.5).** Quitações por valor menor e arredondamentos: valor por natureza (principal, benefício, multa, juros), autor, data e motivo.
6. **Planilha** de cada parte; cada download na auditoria (quem, quando, filtros).

**Decisões:**
- **P1.** "Repasses da franquia", em Financeiro → Rede; Gerente e Franqueado veem a mesma tela só com a própria unidade.
- **P2.** Admin Master e Financeiro da Franqueadora: a rede inteira. Gerente e Franqueado: a própria unidade. Na produção nasce visível **só para o Admin Master** enquanto a integração estiver em testes; o dono libera em Administração → Permissões.
- **P3.** Mês atual por padrão; outro mês ou intervalo. Recebido pela data do pagamento; liquidado pela data em que o Asaas liquidou o split.
- **P4.** "A receber" pela data prevista de crédito; "atrasado" depois dela.
- **P5.** Divergências só mostram e levam à ficha.
- **P6.** Download da planilha na auditoria.
- **P7.** Categorias de "por fora": dinheiro; maquininha e outros cartões; depósito e Pix manual; cobrança externa; Asaas sem split.

**Provas:**
- Ensaio no treino (transação desfeita), provado quebrando: cada parte com números conhecidos (taxas não redondas, duas carteiras, falta acima da tolerância, repasse a maior, estorno, dispensa); quem vê o quê; planilha na auditoria. **(ajuste 4)** Os totais do painel batem com o razão (despesa da unidade e receita da franqueadora por taxa) e com o Painel de cobranças no mesmo período; divergência entre eles **reprova** o ensaio.
- Teste no projeto de teste com as cobranças já pagas das provas anteriores (sem nova cobrança paga no sandbox).

## 19. ASA4 — Gatilhos de contrato: PLANO (14/11/2026, APROVADO com ajustes — 19.9; revisão de 19.11 a 19.15 APROVADA em 14/11/2026 — 19.16)

Pedido do Jeferson (14/11/2026): entregas pequenas, cada uma com migração, ensaio e teste; envio da primeira cobrança automático e reenvio por quem fechou a venda; contratos assinados antes da ASA4 continuam manuais; contrato com muitas parcelas sem disparar o aviso de todas; idempotência do aviso da ZapSign.

### 19.1 O que a documentação do Asaas diz (conferido em 14/11/2026): três pontos que mudam o pedido

1. **"Cobrança criada" sai para TODA cobrança criada, na hora.**
   - O aviso é configurado por cliente (pagador), não por cobrança.
   - Não tem prazo: `scheduleOffset` só existe no lembrete antes do vencimento (0, 5, 10, 15, 30 dias) e no de vencida.
   - A cobrança não tem campo para calar o aviso. Só o cliente tem `notificationDisabled`, que cala tudo.
   - Fontes: docs.asaas.com/docs/notificacoes-padroes, /reference/criar-nova-cobranca, /reference/atualizar-notificacao-existente.
   - **Consequência:** criar todas as parcelas na assinatura com o aviso ligado manda o link de todas de uma vez. A alternativa está em 19.4.
2. **Não há histórico de envio por cobrança.**
   - Nenhum endpoint lista as mensagens enviadas de uma cobrança, e não há aviso (webhook) de mensagem enviada.
   - Existe só a **visualização**: `GET /payments/{id}/viewingInfo` (data em que o pagador abriu a fatura ou o boleto) e os avisos `PAYMENT_CHECKOUT_VIEWED` / `PAYMENT_BANK_SLIP_VIEWED`.
   - Também **não há endpoint de reenvio** da notificação.
   - Fontes: /reference/informacoes-sobre-visualizacao-da-cobranca, /docs/webhook-para-cobrancas.
   - A proposta está em 19.3.
3. **Existe um limite diário de criação de cobranças por conta.**
   - Ele é consultável em `GET /payments/limits`. O exemplo da documentação mostra 10; o valor real é definido por conta.
   - Além dele, a cota geral é de 25.000 chamadas por conta a cada 12 h.
   - Fontes: /reference/recuperando-limites-de-cobrancas-1, /reference/rate-e-quota-limit.
   - O impacto está em 19.5.

### 19.2 As entregas (cada uma com migração, ensaio no treino, prova no sandbox e teste na tela)

> **Revisão de 14/11/2026:** a nova ordem proposta, com o cartão parcelado logo depois da entrega 1, está em 19.13.

| Entrega | O que entrega | Migração |
|---|---|---|
| **1** | Cobrança nascendo na **assinatura do contrato de tratamento** (ZapSign) e na **venda direta**. A **primeira** é enviada pelo Asaas; as seguintes são criadas perto do vencimento (19.4). Também: registro de "link enviado"; avisos de link não enviado (régua desligada); **Cobranças da venda** no comercial (Copiar link, WhatsApp, Pix, situação e "venda fechada" pela D21). | 4011 |
| **2** | **Renegociação assinada**: o termo vai pela ZapSign; as cobranças antigas só são canceladas depois da assinatura do termo; as novas nascem pela mesma regra da entrega 1. | 4012 |
| **3** | **Cartão parcelado**: um pagamento no cartão cobrindo o tratamento (parcelamento do Asaas, split por parcela). Prova no sandbox das datas de crédito de cada parcela (pendência da seção 17). | 4013 |
| **4** | **Mensalidades do PPR+ e da Ortodontia** (`ppr_charges`, `ortho_charges`): criadas perto do vencimento pela mesma rotina da entrega 1. | 4014 |
| **5** | **Reemissão de cobrança externa**: a que foi paga por fora volta a ser cobrada pelo Asaas, sem duplicar. | 4015 |
| **6** | **Distrato com checklist** (D12): nada é cancelado no Asaas antes de o Gerente concluir a checklist; ao efetivar, cancela as cobranças em aberto de todos os tipos acima. | 4016 |

**Por que essa ordem:**
- A 2 reaproveita o gatilho da assinatura logo em seguida.
- A 3 é o meio de pagamento mais usado depois de boleto e Pix.
- A 4 reaproveita a rotina "criar perto do vencimento".
- A 5 é pequena.
- O distrato fica por último porque precisa cancelar cobranças de todos os tipos.

### 19.3 Entrega 1: o envio, o reenvio e o registro

**Quem é "quem fechou a venda":**
- no contrato, o **Consultor da negociação** (`plan_negotiations.consultant_id`);
- na venda direta, **quem a registrou** (`direct_sales.created_by`).

**Régua ligada na unidade:**
- O aviso "cobrança criada" continua **ligado no padrão da rede** (já é assim desde a 4007), e o Asaas manda a **primeira** cobrança logo após a criação.
- A cobrança mostra **"Enviada pelo Asaas (e-mail/SMS) em DD/MM HH:MM"**. É o que o riSZon sabe com certeza: no momento da criação, a régua estava ligada, o pagador tinha contato e não estava na lista de recusa.
- **Não é confirmação de entrega**, porque o Asaas não expõe histórico (19.1 item 2).
- Quando o pagador abre a fatura, aparece **"Aberta pelo pagador em DD/MM"** (avisos `PAYMENT_CHECKOUT_VIEWED`/`PAYMENT_BANK_SLIP_VIEWED`).

**Régua desligada na unidade:** o Asaas não envia, e o primeiro envio fica com quem fechou a venda.

**Reenvio e primeiro envio pelo riSZon:**
- Botões: **Copiar link**, **Enviar pelo WhatsApp** (abre o WhatsApp com a mensagem pronta e o link), **Copiar Pix** e a **linha digitável**.
- Cada um **registra o envio** (cobrança, canal, quem, quando) numa tabela nova, `charge_link_sends`.
- A cobrança mostra o último envio: "Enviada pelo riSZon por Fulano (WhatsApp) em DD/MM HH:MM".

**Avisos de link não enviado (só com a régua desligada):**
- (a) **1 dia útil** depois da criação sem nenhum envio registrado → aviso para quem fechou a venda.
- (b) faltando **2 dias úteis** para o vencimento sem envio → aviso também para o **Gerente da unidade**, que pode enviar no lugar.
- Dias úteis contam os feriados nacionais (função do banco já existente, `_payout_add_business_days`).
- Roda na rotina que já passa a cada 10 minutos.

**Permissão de quem fechou a venda (conferido):**
- Hoje o Consultor, inclusive o da Franqueadora com escopo em todas as unidades, **lê as parcelas** da venda dele (0403, `can_see_sale_schedule`), mas **NÃO lê as cobranças** (`charges_select` = só quem vê o financeiro).
- A entrega 1 abre **uma porta própria**, `sale_charges_read`. Ela devolve, **só das cobranças daquela venda**: a situação, o vencimento, o valor, o link, o Pix, a linha digitável e o registro de envio.
- Quem passa por ela: quem fechou a venda, o Gerente da unidade, o Admin Master e o Financeiro da Franqueadora.
- **A regra de leitura das cobranças (0403) não muda.**
- O envio passa por outra porta, `charge_link_sent`, que confere a mesma coisa.

**Onde aparece:**
- Um bloco **Cobranças da venda** na tela do comercial do cliente (o cockpit atual, por cliente) e na venda direta.
- Situação por cobrança: *Agendada para DD/MM* (ainda não criada no Asaas, 19.4), *Aguardando pagamento*, *Paga*, *Vencida*, *Cancelada*.
- "**Venda fechada**" quando a D21 fechou a venda. O fechamento já existe: `_gateway_confirm_sale`, 4005.

### 19.4 Contrato com muitas parcelas: a alternativa (precisa da aprovação antes de construir)

Como o Asaas não permite calar o "cobrança criada" por cobrança (19.1 item 1), **criar todas as cobranças no Asaas na assinatura** faria o pagador receber o link de todas de uma vez.

**Proposta A (recomendada): criar no Asaas só a primeira na assinatura; as seguintes, por uma rotina diária, X dias antes de cada vencimento.**
- Na assinatura, **todas as parcelas já existem no riSZon** (como hoje) e aparecem na venda como *Agendada para DD/MM*.
- A **primeira** (a de vencimento mais próximo, e qualquer outra que vença dentro do prazo X) é criada na hora → o Asaas manda o link.
- As **seguintes** são criadas pela rotina diária **X dias antes do vencimento**. O "cobrança criada" do Asaas chega então perto do vencimento, que é exatamente o "link perto do vencimento" pedido. Depois vêm os lembretes normais da régua (10 dias antes e no dia).
- **X = 15 dias** no padrão da rede, configurável de 11 a 30.
  - X precisa ser **maior que o 1º lembrete** (10 dias); senão o pagador recebe dois avisos no mesmo dia.
  - O banco recusa X ≤ lembrete 1.
- O split, a multa, os juros e o desconto de pontualidade são calculados **no dia da criação**, com as taxas vigentes. A fila da ASA3 já trata mudança depois disso.
- Se a rotina falhar, a cobrança fica *Agendada* e o Financeiro é avisado; a próxima rodada tenta de novo (idempotente, 19.6).
- Vale também para a venda direta e, na entrega 4, para as mensalidades do PPR+ e da Ortodontia.

**Alternativas descartadas** (nenhuma das duas cumpre o pedido com segurança):
- **B:** criar todas com o pagador calado (`notificationDisabled`). O Asaas não mandaria nem a primeira, nem os lembretes.
- **C:** ligar o aviso, criar a primeira, desligar e criar as demais.
  - O momento em que o Asaas dispara o aviso não está documentado; desligar logo depois pode calar a primeira.
  - A troca vale para todas as cobranças do pagador, inclusive de outras vendas.

**A provar no sandbox antes de construir:**
- Sem envio real (pagador sem celular, e-mail example.com): o "cobrança criada" de uma cobrança com vencimento distante sai na criação, confirmando 19.1.
- Com aprovação na hora: um envio real para o e-mail do Jeferson, para ver a mensagem.

### 19.5 Cota e limite do Asaas num dia com muitas assinaturas

**Chamadas por cobrança criada: de 3 a 8.**
- procurar o pagador por CPF;
- aplicar a régua do pagador (3 chamadas, só quando muda);
- procurar pela referência antes de criar;
- criar;
- ler o QR Code do Pix.

**Com a proposta A:**
- Um dia com **30 assinaturas** numa unidade dá ≈ 30 cobranças × 8 = **240 chamadas**.
- Soma-se a rotina diária: as parcelas que chegam a X dias, cerca de 1 por contrato ativo por mês.
- Tudo muito abaixo das **25.000 a cada 12 h**.

**Sem a proposta A (todas na assinatura):**
- 30 contratos × 24 parcelas = **720 cobranças criadas no dia** (~2.300 chamadas).
- Cabe na cota, mas pode **estourar o limite diário de criação de cobranças** da conta (19.1 item 3).

**Proteção:**
- Antes de criar em lote, a rotina lê `GET /payments/limits`. Se faltar limite, para, deixa *Agendada* e avisa o Financeiro.
- Em resposta 429/403 do Asaas, espera e tenta na rodada seguinte, sem martelar.

**A conferir:**
- o limite diário real da conta sandbox (só leitura);
- o limite da produção (pergunta ao gerente de contas, para a ASA7).

### 19.6 Idempotência: o aviso da ZapSign duas vezes não gera cobrança em dobro

Três travas, todas no ensaio:
1. **ZapSign:** o evento repetido já é recusado pela chave do evento (`signature_events.event_key`, 0397). Volta `duplicate` e nada acontece.
2. **Gatilho:** a emissão automática é registrada **uma vez por venda** (índice único na negociação / venda direta). Um segundo pacote assinado da mesma venda (reenvio) não emite de novo.
3. **Cobrança:** continuam valendo o índice único "uma cobrança ativa por parcela" (4004) e a procura pela referência no Asaas antes de criar (4005).

O ensaio manda o mesmo aviso **duas vezes**, dois avisos **ao mesmo tempo** e um **segundo pacote** assinado da mesma negociação. Espera **uma** cobrança por parcela.

### 19.7 O que NÃO muda / regras

- **Contratos assinados antes da ASA4 continuam com emissão manual.**
  - A emissão automática só vale para pacote **assinado depois** da data em que a 4011 for ligada na unidade (gravada na configuração).
  - Nada é emitido em lote para os antigos.
- Só emite se a **unidade estiver pronta** (conta Asaas ativa) e a parcela for de **boleto ou Pix**.
  - Cartão parcelado fica para a entrega 3.
  - Parcela em dinheiro, maquininha ou depósito não vai ao Asaas.
- Continuam as travas da emissão manual: contrato assinado, pagador e CPF, carência zero e teto do split.
- Continua a **trava fora da produção**: o sandbox só envia para os contatos permitidos.
- A emissão automática roda **sem usuário**; o banco registra "assinatura do contrato" como origem.
- A emissão manual da ficha continua para os casos fora da regra.
- A RisLife nunca é destino de taxa de paciente.
- ⚠️ A 4004 recria `charges_select` com a regra antiga. A 4011 **não toca** nas regras de leitura, e o ensaio confere que a 0403 continua valendo.

### 19.8 Decisões pedidas ao Jeferson

1. **Proposta A** (19.4): criar no Asaas só a primeira na assinatura e as seguintes X dias antes do vencimento, no lugar de "todas na assinatura".
2. **X = 15 dias** no padrão da rede.
3. **"Enviada pelo Asaas"** = régua ligada + contato + sem recusa no momento da criação, com "Aberta pelo pagador" quando o Asaas avisar, já que não há histórico de envio na API (19.1 item 2).
4. **Venda direta:** a cobrança nasce quando o parcelamento da venda direta é salvo **e** o contrato está marcado como assinado na venda. A venda direta não passa pela ZapSign, e a emissão exige contrato assinado.
5. A **ordem das entregas 2 a 6** (19.2).

### 19.9 APROVAÇÃO (Jeferson, 14/11/2026)

**Plano aprovado**, com as cinco decisões de 19.8 como propostas:
1. A **proposta A** é o padrão.
2. O prazo padrão é de **15 dias**, configurável de 11 a 30.
3. "Enviada pelo Asaas" segue a regra de 19.3, e a tela diz que **não é confirmação de entrega**.
4. Na venda direta, a cobrança nasce com o parcelamento salvo e o contrato marcado como assinado.
5. A ordem das entregas 2 a 6 é a de 19.2.

**Ajustes:**
1. **Janela na assinatura.** Além da primeira, nasce na hora toda parcela que já vence dentro do prazo (15 dias).
2. **Meio de pagamento.**
   - A emissão automática vale só para **boleto, Pix ou cartão à vista**.
   - Dinheiro, maquininha ou depósito não geram cobrança no Asaas: nem na assinatura, nem na venda direta, nem na rotina.
   - Ver 19.10 item 1.
3. **Pagamento adiantado.** Uma parcela futura ainda sem cobrança continua podendo ser cobrada à mão pelo botão "Gerar cobrança no Asaas" da ficha.
4. **Reenvio guiado pelo "Aberta pelo pagador".**
   - Com a régua ligada: se a primeira cobrança não foi aberta até **1 dia útil antes do vencimento**, quem fechou a venda recebe um aviso para reenviar.
   - Com a régua desligada, valem os avisos de 19.3.
5. **Mudança do prazo.** O prazo novo vale só para as cobranças ainda não criadas.

**Acréscimo A: duas formas de emitir, escolhidas no fechamento da venda (só boleto).**
- **Forma 1, "Um boleto por mês"** (padrão): a proposta A.
- **Forma 2, "Todos os boletos agora"**:
  - Todas as parcelas em boleto são emitidas na assinatura, **sem nenhum aviso de criação**.
  - Os lembretes, o aviso do dia, o de vencida e a confirmação de pagamento continuam normais.
  - A entrega é feita por quem fechou a venda, numa mensagem só pelo riSZon.
- **Quem escolhe:** quem fechou a venda, o Gerente, o Financeiro da Franqueadora e o Admin Master. A escolha fica na auditoria.
- **Limite diário:** a emissão respeita o limite de criação de cobranças; o que passar sai no dia seguinte, com aviso na tela.
- **Troca de forma:**
  - de 1 para 2: emite o que falta;
  - de 2 para 1: cancela as não pagas, com confirmação.
- **Textos da tela** (para quem fecha e para o cliente): os do Jeferson, de 14/11/2026. O manual traz a mesma explicação, com o exemplo de um contrato de 12 parcelas.

**Acréscimo B: rotina diária em camadas.**
- Dois agendadores independentes.
- A folga do prazo recupera a falha, começando pelo vencimento mais próximo.
- Um vigia separado.
- A lista de pendências com o motivo, para o Gerente e o Financeiro.
- O botão "Rodar agora" na Central, com auditoria.
- A parada perto do limite diário.
- O mesmo desenho nas outras rotinas de que a cobrança depende.

### 19.10 O que a conferência de 14/11/2026 achou (antes de codificar)

**1. Venda direta paga na hora, no balcão: o parcelamento não diz onde a parcela é paga.**
- Os meios da parcela são: `pix`, `boleto`, `cartao`, `cartao_parcelado`, `credito_recorrente` e `deposito_avista` (0178).
- Não existe "dinheiro" nem "maquininha": dinheiro hoje é só meio do **recebimento**, não da parcela.
- `pix` e `cartao` tanto podem ser pagos pelo link do Asaas quanto no balcão (Pix na conta, maquininha).
- **Proposta:** cada parcela ganha **"Onde paga: Asaas (link) / Balcão"**.
  - Boleto é sempre Asaas.
  - Depósito é sempre Balcão.
  - Em Pix e cartão, quem monta o parcelamento escolhe; o padrão é Asaas no contrato e **Balcão na venda direta**.
- Na venda direta paga na hora: o parcelamento é salvo com "Balcão" → nenhuma cobrança vai ao Asaas → a Recepção dá a baixa como hoje (dinheiro, maquininha, Pix na conta).

**2. Forma 2: a prova "desligar, criar e religar não envia nada" NÃO dá para fazer sem envio real.**
- A API não tem histórico de mensagens enviadas (19.1 item 2).
- A documentação não diz se o aviso de criação sai na hora ou vai para uma fila que só olha a configuração no momento do disparo.
- Se for fila, religar cedo demais pode deixar sair todos os avisos.
- Desligar o aviso **do pagador** também cala a cobrança de **outra venda** dele criada no intervalo.
- **Alternativa proposta: um "cadastro do carnê" no Asaas.**
  - Na forma 2, o riSZon cria no Asaas um **segundo cadastro do mesmo pagador**, só para os boletos daquele contrato.
  - Nesse cadastro, o aviso "cobrança criada" nasce e **fica desligado para sempre**; os demais avisos seguem a régua.
  - Não há liga-desliga, não há corrida e outra venda do pagador não é afetada.
  - O que precisa ser provado no sandbox, **sem envio**: que o Asaas aceita dois cadastros com o mesmo CPF na mesma conta (pagador sem contato).
- **Prova com envio real, só com aprovação na hora, só para o e-mail do Jeferson (sem celular):**
  - uma cobrança de controle com o aviso ligado (o e-mail deve chegar);
  - três cobranças pelo caminho escolhido (nenhum e-mail de "cobrança criada" pode chegar em 30 minutos).
- Vale para os dois caminhos e prova também 19.1 item 1.

**3. Entrega dos boletos da forma 2: o Asaas não junta cobranças avulsas.**
- O carnê em PDF (`GET /installments/{id}/paymentBook`) só existe para o **parcelamento** do Asaas, que exige parcelas de valor igual. Não há carnê para cobranças avulsas, nem criação em lote.
- Cada cobrança devolve `bankSlipUrl` (o PDF do boleto) e `invoiceUrl`. A documentação não diz se são públicos nem se expiram.
- **Proposta: uma página do riSZon com a lista** (vencimento, valor, "Abrir boleto" e linha digitável de cada parcela).
  - O endereço é impossível de adivinhar e expira depois do último vencimento.
  - A página mostra só o primeiro nome do paciente.
  - Quem fechou a venda manda esse link numa mensagem só (WhatsApp ou cópia).
- Se o sandbox mostrar que o `bankSlipUrl` abre sem login, a página ganha **"Baixar todos em PDF"**: o riSZon junta os PDFs na hora, com o mesmo recurso que já junta os PDFs das assinaturas.

**4. Limite diário de criação de cobranças.**
- **Sandbox (lido em 14/11/2026, só leitura):** 5.000 por dia em cada conta (Franqueadora, Londrina, Cambé, Fundo de Propaganda Teste, RisLife Teste).
- **Produção:** pergunta do Jeferson ao Asaas, para Administração, Londrina e Cambé.
- Script: `scripts/asaas-prova-limites-sandbox.mjs`.

**5. Os agendadores.**
- **Treino:** o `pg_cron` está instalado (1.6.4), com 17 rotinas do banco; o `pg_net` (chamada HTTP de dentro do banco) está **disponível, mas não instalado**. Na produção, a conferir pelo Jeferson no SQL Editor.
- **Segundo agendador:** o `pg_cron` chama, pelo `pg_net`, o **mesmo endereço** da rotina na aplicação, em outro horário.
  - A senha da chamada é gerada pelo banco e guardada no Vault; ninguém a vê nem a copia.
  - **Ele não depende do cron da Vercel**, mas o trabalho (as chamadas ao Asaas) roda na aplicação, que está na Vercel.
  - Se a Vercel inteira cair, nenhum dos dois cria cobranças. Por isso existe o vigia.
- **O vigia é só banco** (`pg_cron`, sem Vercel). Ele confere a rodada do dia e as parcelas na janela sem cobrança e sem motivo, e avisa o Admin Master e o Financeiro da Franqueadora.
- Rodar a criação **inteiramente sem a Vercel** exigiria reescrever as chamadas ao Asaas numa função do Supabase, com dois códigos para o mesmo dinheiro. **Não recomendado.**
- **As rotinas de que a cobrança depende, hoje:**

| Rotina | Hoje | Proposta |
|---|---|---|
| Fila do split e virada do dia das campanhas (`gateway-split-diario`, 00:05) | só o cron da Vercel | 2º disparo pelo `pg_cron` às 01:35 + vigia |
| Fila da régua (`gateway-regua`, a cada 10 min) | só o cron da Vercel (a próxima rodada cobre a falha de uma) | vigia: sem rodada há 1 hora → aviso |
| Verificação das contas (`gateway-accounts`, diária às 06:40, cada conta a cada 7 dias) | só o cron da Vercel | 2º disparo pelo `pg_cron` às 08:10 + vigia |
| Preços agendados (`risarte-precos-agendados`, 00:05) | só `pg_cron` (banco) | vigia |
| **Nova:** criação das cobranças da proposta A | — | cron da Vercel às 07:00 + `pg_cron` às 09:30 + vigia às 11:00 |

- Toda rodada passa a ser gravada numa tabela de rodadas (rotina, início, fim, origem: Vercel, banco ou "Rodar agora", e números). É dela que o vigia lê.

**6. Em qual entrega entra a forma 2.**
- **Entrega 1:** o resto do plano, sem a forma 2.
- **Entrega 1B, logo depois:** a forma 2, com o caminho que passar na prova de 19.10 item 2.

**7. Prova sem envio do "cadastro do carnê" (14/11/2026): 6/6.**
- Script: `scripts/asaas-prova-cadastro-duplo-sandbox.mjs`. Londrina, sandbox, pagador sem contato, sem cobrança.
- O que passou:
  - o Asaas aceita um segundo cadastro com o mesmo CPF na mesma conta;
  - "cobrança criada" desligado só nele, com os demais avisos intactos;
  - o cadastro principal fica intocado.
- **Cuidado que entra no código:** a busca por CPF devolve **os dois**. A emissão normal precisa usar sempre o cadastro principal gravado em `gateway_customers` e nunca o do carnê, que é marcado como tal.
- **Falta, com envio real:** a prova de que nenhum e-mail de "cobrança criada" sai pelo cadastro do carnê.

### 19.11 Venda direta: Asaas, dinheiro ou permuta (APROVADA pelo Jeferson em 14/11/2026 com os ajustes A, B e C; revisão abaixo para aprovar antes de codificar)

**Aprovado:**
- o meio por parcela (Asaas, Dinheiro ou Permuta);
- a permuta como proposta;
- a baixa à mão só em dinheiro ou permuta;
- o contrato de tratamento só depois do cartão parcelado pelo Asaas, numa decisão própria.

Esta seção substitui "Onde paga: Asaas / Balcão" (19.10 item 1).

**Regra:**
- O Asaas é o canal oficial de pagamento.
- Na venda direta, toda parcela é paga pelo Asaas (boleto, Pix ou cartão), com duas exceções: **dinheiro** e **permuta**.
- **Exceção provisória (ajuste A):** até o cartão parcelado pelo Asaas estar pronto e aprovado (entrega 2, 19.13), a maquininha continua na venda direta **só para o cartão parcelado**.

**Como é hoje (conferido no código):**
- **O meio é da venda, não da parcela.**
  - O editor do parcelamento só mexe em data e valor, e a parcela herda o meio da venda (`save_payment_schedule`, 0374, linha 309).
  - O banco já aceita um meio por parcela; a tela é que não manda.
- **A maquininha:**
  - O adquirente é gravado na parcela ao salvar a venda (`apply_settlement_projection`, 0199), inclusive em boleto e Pix.
  - A taxa sai pelo meio da baixa (`applyFeeToReceipt`).
  - A baixa da ficha oferece qualquer meio para qualquer parcela.
- **"Depósito à vista"** (`deposito_avista`) é tratado igual ao Pix em tudo o que diz respeito à venda; não vai ao Asaas.
- **Permuta** não existe.
- **O dinheiro** tem a conta "Caixa (dinheiro)" por unidade (0317). Não existe "depositado / não depositado".
- **As taxas da rede** incidem sobre **o valor de cada baixa**, de qualquer meio, inclusive parcial (`_apply_fee_split`, 0370). O que não foi retido vira conta a pagar da unidade (4008).
- **Baixa à mão exige venda já fechada.**
  - A trava `payment_receipts_require_closed_sale` (0203) recusa a baixa em venda direta ou contrato sem `closed_at`.
  - Hoje, quem recebe em dinheiro precisa antes marcar "pagamento confirmado" à mão.
  - Só a confirmação do Asaas fecha a venda sozinha (`_gateway_confirm_sale`, 4005).
- **Baixa à mão em parcela com cobrança ativa no Asaas é recusada** (`CHARGE_IN_GATEWAY`, 4004).
  - Hoje é preciso antes clicar em "Recebeu no balcão", que confere no Asaas e cancela (`cancelarNoAsaas`).
  - Se o Asaas receber depois do cancelamento, o valor vai para "pagamentos em duplicidade" (4005).

**A regra da venda direta nova (entrega 1, migração 4011):**
1. **Meio por parcela**, numa coluna "Como paga" do parcelamento:
   - **Asaas** (padrão): boleto, Pix ou cartão à vista;
   - **Dinheiro**;
   - **Permuta**;
   - provisório: **Cartão parcelado (maquininha)**.
2. **Novos valores** `dinheiro` e `permuta` na parcela e na venda, e `permuta` na baixa. Só acrescentar; nada é apagado.
3. **Deixam de ser oferecidos na venda direta nova:** depósito à vista, crédito recorrente e o cartão de maquininha fora do cartão parcelado. Vendas e baixas antigas ficam como estão.
4. **Adquirente:** a venda direta nova só grava adquirente nas parcelas de cartão parcelado (maquininha).
5. **Baixa à mão de parcela de venda direta nova:**
   - aceita só **dinheiro** e **permuta**;
   - aceita **cartão parcelado** só nas parcelas desse meio, enquanto a maquininha for permitida;
   - o banco recusa o resto, só para baixas novas;
   - as parcelas pelo Asaas recebem a baixa pelo aviso do Asaas.
6. **Pago na hora, no balcão:**
   - **Dinheiro:** baixa com recibo, e o valor entra no Caixa.
   - **Pix:** QR Code na tela; o aviso do Asaas dá a baixa e fecha a venda.
   - **Cartão:** link da fatura do Asaas. O paciente digita o cartão lá, nunca no riSZon.
7. **O banco passa a conferir a regra do à vista** (hoje só a tela confere) — ver a tabela do ajuste B.

**Ajuste B: o desconto à vista, antes e depois.**
- **Como é hoje:** o desconto à vista **não depende do meio**, depende do **número de parcelas**.
  - Em **1×**: desconto automático da regra comercial (`commercial_rules.cash_discount_percent`, da unidade ou da rede, limitado ao teto). No PPR+, vale o percentual à vista do plano.
  - Em **2× ou mais**: nenhum desconto automático; só manual, até o teto. No PPR+, o percentual da faixa.
  - Só **Pix** e **depósito à vista** podem ser 1×, e por isso só eles têm o desconto à vista.
  - O dinheiro à vista é lançado hoje como "depósito à vista", com a baixa em dinheiro.
- **A regra nova** mantém o desconto pelo número de parcelas e **troca o depósito à vista pelo dinheiro**, com o mesmo percentual.

| Meio | Hoje, 1× | Hoje, parcelado | Venda direta nova, 1× | Venda direta nova, parcelado |
|---|---|---|---|---|
| Pix | desconto à vista automático | só manual, até o teto | **Asaas Pix:** o mesmo desconto à vista | o mesmo de hoje |
| Depósito à vista | **o mesmo do Pix** | só manual | não oferecido | não oferecido |
| Dinheiro | não é meio de venda (entra como "depósito à vista") | não é meio de venda | **exatamente o desconto do depósito à vista de hoje** (= o do Pix) | só manual, até o teto |
| Boleto | não permitido | só manual | não permitido (como hoje) | **Asaas boleto:** o mesmo de hoje |
| Cartão | não permitido | só manual | não permitido (como hoje) | **Asaas cartão à vista por parcela:** o mesmo de hoje |
| Cartão parcelado | não permitido | só manual (maquininha) | não permitido | maquininha até a entrega 2, depois Asaas: o mesmo de hoje |
| Crédito recorrente | não permitido | só manual | não oferecido | não oferecido |
| Permuta | não existe | não existe | **sem desconto à vista automático** (só manual, até o teto, e só pelo Gerente ou Admin Master) | só manual, até o teto |

- Os percentuais do PPR+ (à vista e por faixa) e a regra do Empresarial (sem desconto de pagamento) não mudam.
- "1×" é a venda inteira numa parcela. Entrada mais parcelas nunca teve desconto à vista, e continua sem.
- O contrato de tratamento não muda: continua com Pix e depósito à vista no 1×.

**Ajuste C: troca de meio e fechamento da venda.**
1. **Parcela prevista no Asaas, e o paciente paga em dinheiro no balcão.**
   - A Recepcionista registra a baixa em dinheiro, e **o próprio registro cancela a cobrança no Asaas**: uma ação só, no lugar de "Recebeu no balcão" e depois "Registrar baixa".
   - A ordem:
     1. confere no Asaas;
     2. se já foi paga lá, **recusa a baixa em dinheiro** e mostra "paga pelo Asaas em DD/MM";
     3. senão, cancela no Asaas, marca a cobrança como cancelada e registra a baixa.
   - Se o cancelamento falhar, nada é registrado e a tela diz por quê. Nunca fica "baixa em dinheiro com cobrança viva".
   - Se o paciente pagar o boleto depois do cancelamento, o valor cai em "pagamentos em duplicidade" (já existe), para devolução. Nunca vira segunda baixa.
   - **Valor:** a Recepcionista recebe o **valor devido** que o riSZon mostra, ou parte dele, e não dá desconto (regra já aprovada).
   - **Pagamento parcial:**
     - a cobrança do Asaas é cancelada do mesmo jeito;
     - o restante fica na parcela, com "Como paga: Asaas";
     - uma nova cobrança do restante nasce na hora, se a parcela vence dentro do prazo (15 dias), ou pela rotina.
   - A troca fica registrada (quem, quando, de qual meio para qual).
2. **Parcela prevista em dinheiro, e o paciente quer Pix, boleto ou cartão.**
   - A Recepcionista, o Gerente ou quem fechou a venda troca "Como paga" para Asaas (com o tipo), e a cobrança é **gerada na hora**, fora do prazo da rotina.
   - Pix mostra o QR Code; cartão abre o link da fatura.
3. **Troca para permuta:** só o **Gerente** ou o **Admin Master**, com descrição. Se houver cobrança ativa no Asaas, ela é cancelada antes, como no item 1.
4. **A baixa em dinheiro ou permuta fecha a venda, como a confirmação do Asaas: CONFIRMADO que hoje NÃO fecha.**
   - Hoje, a baixa à mão é recusada enquanto a venda não está fechada (0203).
   - **Proposta:** na venda direta nova e no contrato com a entrega 1, a baixa em dinheiro ou permuta de parcela da venda faz o mesmo que `_gateway_confirm_sale`:
     - marca "pagamento confirmado", com a origem "balcão" ou "permuta" e quem registrou;
     - se o contrato está assinado, **fecha a venda** (`closed_at`), com os mesmos efeitos de hoje: lançamentos da venda, fase do paciente, avisos e abertura da Ortodontia;
     - depois registra a baixa, tudo na mesma transação.
   - **Contrato não assinado:** a baixa é recusada, com "assine o contrato antes de receber". É a mesma regra da emissão no Asaas, que também exige contrato assinado.
   - **No contrato de tratamento:** vale do mesmo jeito, com a negociação aceita.
5. **Benefício de pontualidade na parcela por permuta: não se aplica (concordo com a proposta).**
   - O benefício é a parte do desconto do programa que o paciente **perde se atrasar** (`apply_sale_benefit_risk`, 0192): a parcela leva uma cota que volta a ser cobrada no atraso. Cartão fica de fora, porque não atrasa.
   - Pela regra de hoje, um meio novo entraria **com** risco. A 4011 põe a permuta junto do cartão: **nenhuma cota de benefício em risco**.
   - A parcela por permuta vale o combinado, sem perda por atraso, multa nem juros.

**Permuta (entrega 1):**
- **Baixa:** só o **Gerente da unidade** ou o **Admin Master**, com descrição obrigatória (o que foi trocado e com quem). Tudo vai para a auditoria.
- **Taxas:** as quatro percentuais incidem sobre o valor, como em toda baixa. Sem retenção, viram conta a pagar da unidade (ASA6).
- **Contabilidade:** receita como em qualquer baixa; o "recebido" entra numa conta **"Permutas"** por unidade, fora do caixa e da conciliação.
- **Painel de repasses:** categoria própria, **Permuta**, com a lista do período para o Financeiro da Franqueadora. Hoje, a permuta cairia em "externa".

**Dinheiro na entrega 1 (antes do boleto de depósito):**
- A baixa em dinheiro entra no Caixa da unidade, como hoje.
- O **painel do dinheiro parado** e o aviso de 2 dias úteis (19.12 item 7).
- **"Registrar depósito"** à mão (19.12, F5).

**Se a mesma regra valer para o contrato de tratamento: o que muda (NÃO alterar sem decisão).**
- **Cartão parcelado:** com a entrega 2, o contrato ganha o cartão parcelado pelo Asaas, ao lado da maquininha.
- **Crédito recorrente:** espera a ASA4B, que depende da resposta do Asaas sobre o token.
- **Outros pontos que leem o meio:** `BENEFIT_SAFE_METHODS`, o Empresarial (`CARD`), as mensalidades da Ortodontia e do PPR+, a renegociação, o painel do comercial e as categorias dos repasses.
- **Recomendação:** decidir depois da entrega 2.

### 19.12 Dinheiro: boleto de depósito (APROVADO o desenho pelo Jeferson em 14/11/2026, com os ajustes D, E e F; entrega própria, 1C)

**Aprovado:**
- entrega própria (1C);
- a unidade como pagadora;
- split em valor fixo;
- um boleto por depósito.

**O boleto de depósito, na entrega 1C:**
1. **"Gerar boleto de depósito"** para os recebimentos em dinheiro ainda não depositados (o caixa do dia). Valor = a soma.
   - Pela Recepcionista ou pelo Gerente, com auditoria.
2. **Pagador: a própria unidade**, com o CNPJ da conta, sem e-mail nem celular, com `notificationDisabled`.
   - O paciente nunca aparece.
   - Pessoa jurídica: boleto até R$ 500.000; pessoa física, até R$ 5.000.
   - Provado no sandbox, 8 de 8 (`scripts/asaas-prova-pagador-deposito-sandbox.mjs`).
   - **Na produção: pergunta ao Asaas (F2).**
3. **Quando o Asaas confirma:**
   - os recebimentos ficam "depositados";
   - o valor passa do Caixa para a conta Asaas (6.3.01, fora do resultado).
4. **Split em valor fixo:** retém a taxa ainda não paga daqueles recebimentos e abate a conta a pagar, sem cobrar em dobro (F1).
5. **Tarifa:** a do boleto pago.
   - Sandbox: R$ 0,99 até 10/02/2027, depois R$ 1,99.
   - Produção: a conferir (F6).
   - Emitir e cancelar é grátis.
6. **Limite (ajuste D):** confirmado; ver abaixo.
7. **Controle:**
   - painel por unidade com o dinheiro não depositado, por recebimento e por dias parado;
   - aviso ao Gerente e ao Financeiro da Franqueadora depois de **2 dias úteis**;
   - linha própria no Painel de repasses.
   - O painel começa na data em que a 4011 é ligada; o dinheiro antigo no Caixa não entra como "parado".

**Ajuste E: por que R$ 165,50 e não R$ 170,00.**
- O exemplo anterior usou as **taxas de teste do sandbox** (6,37 + 1,83 + 2,91 + 5,44 = **16,55%**), escolhidas diferentes de propósito para a prova da ASA3.
- As **taxas de produção** (18.1) são: royalty **6%**, fundo de propaganda **2%**, centro de planejamento **3%** e comercial **6%** = **17%**, todas para a conta da Franqueadora (decisão S7).
- A taxa incide sobre **o valor de cada baixa**, inclusive a parcial (`_apply_fee_split`).

**Exemplo com as taxas de produção, com um recebimento parcial:**
- **O caixa do dia:**
  - Recebimento A: parcela de R$ 700,00, paga inteira em dinheiro.
  - Recebimento B: parcela de R$ 500,00, paga **em parte**: R$ 300,00 em dinheiro. Os R$ 200,00 restantes ficam na parcela.
  - Caixa: **R$ 1.000,00**.

| Taxa | A (R$ 700,00) | B (R$ 300,00, parcial) | Total |
|---|---|---|---|
| Royalty 6% | 42,00 | 18,00 | 60,00 |
| Fundo de propaganda 2% | 14,00 | 6,00 | 20,00 |
| Centro de planejamento 3% | 21,00 | 9,00 | 30,00 |
| Comercial 6% | 42,00 | 18,00 | 60,00 |
| **Total 17%** | **119,00** | **51,00** | **170,00** |

- **Boleto de R$ 1.000,00**, com split fixo de **R$ 170,00** para a conta da Franqueadora e tarifa **T** (R$ 0,99 no sandbox; na produção, a conferir).
- **A unidade recebe R$ 1.000,00 − 170,00 − T = R$ 829,01** com T = 0,99, ou **R$ 828,01** com T = 1,99.
- **Razão da unidade:**
  - saída do Caixa de 1.000,00 e entrada na conta Asaas de 1.000,00 (fora do resultado);
  - taxa retida de 170,00 (`split_retained`);
  - tarifa T como despesa bancária.
- **Franqueadora:** receita de 170,00 (`split_retained_revenue`).
- **Conta a pagar de taxa da unidade:** 170,00 a menos. **Total cobrado: 170,00, uma vez só.**
- **Os R$ 200,00 restantes de B:** quando forem recebidos, geram mais R$ 34,00 de taxa, cobrados nessa baixa e em nenhuma outra.

**Ponto F1: a cobrança mensal (ASA6) com um boleto de depósito aberto.**
- **Regra:** cada taxa de cada recebimento tem **um dono só** de cada vez. O banco grava a situação dela:

| Situação da taxa | Quem cobra |
|---|---|
| **a pagar** | entra na próxima cobrança mensal |
| **no depósito** (boleto de depósito aberto) | o split do boleto; a cobrança mensal **não** a inclui |
| **retida** (boleto pago) | já paga, não entra em mais nada |
| **faturada** (já está numa cobrança mensal) | a cobrança mensal; o boleto de depósito **não** a inclui no split |

- **Como cada caso termina:**
  - Boleto de depósito vencido ou cancelado: a taxa volta de "no depósito" para "a pagar" e entra na próxima cobrança mensal, com o mês de origem.
  - A troca de situação é feita no banco, numa transação só, com a linha travada, e o ensaio confere a corrida (boleto e fechamento ao mesmo tempo).
- **A conta, com as taxas do exemplo:**
  - 30/11: caixa de R$ 1.000,00 → taxa R$ 170,00 → boleto de depósito gerado → a taxa fica "no depósito".
  - 01/12: a ASA6 fecha novembro. As taxas a pagar de novembro somam R$ 2.000,00, mais os R$ 170,00 do depósito. **A cobrança mensal sai de R$ 2.000,00**, sem os 170,00.
  - 02/12: o boleto é pago → R$ 170,00 retidos pelo split → a taxa fica "retida". **Total cobrado: 2.000,00 + 170,00, uma vez cada.**
  - Se, no lugar disso, o boleto vencer e for cancelado em 05/12: os R$ 170,00 voltam a "a pagar" e entram na cobrança de dezembro como "taxa de novembro (depósito não pago)".
  - **Caso inverso:** o dinheiro de 30/11 só é depositado em 03/12, depois do fechamento. Os 170,00 estavam "a pagar" em 01/12 e foram **faturados** na cobrança mensal. O boleto de 03/12 sai **sem split** desses 170,00, e a unidade recebe R$ 1.000,00 − T.
- Enquanto a ASA6 não existe, vale o mesmo para a conta a pagar de hoje: o split só retém taxa de conta a pagar ainda aberta, e a conta a pagar cai no mesmo valor.

**Limite do pagamento em dinheiro (ajuste D): CONFIRMADO na norma.**
- **Resolução CMN 4.648, de 28/03/2018** (DOU de 02/04/2018). Texto lido no original do Banco Central; a consulta de normativos do BC mostra "não revogada".
  - **Art. 1º:** as instituições financeiras não podem receber, a partir de 28/05/2018, boleto de valor **igual ou superior a R$ 10.000,00** pago com dinheiro em espécie.
  - **Parágrafo único:** boleto **abaixo** de R$ 10.000,00 em espécie só pode ser recusado se houver **indício de tentativa de burlar** essa proibição.
- **Regra no riSZon:**
  - **Nenhum boleto de depósito de R$ 10.000,00 ou mais.** O banco recusa a criação.
  - O caixa a depositar chegou a R$ 10.000,00 → aviso ao **Gerente** e ao **Financeiro da Franqueadora**. A tela diz o que fazer:
    - depositar o dinheiro **na agência, direto na conta bancária da unidade** (depósito em conta não é pagamento de boleto);
    - registrar o depósito com o comprovante (**"Registrar depósito"**, o mesmo da entrega 1);
    - as taxas desses recebimentos seguem para a cobrança mensal da unidade (ASA6), sem split.
  - **Não quebrar:** o riSZon nunca divide o caixa em vários boletos, e o banco recusa um segundo boleto de depósito com recebimentos do mesmo dia enquanto houver outro aberto. Dividir para ficar abaixo de R$ 10.000,00 é exatamente o "indício de burlar" do parágrafo único.
  - Continua o aviso **"pague na agência, não na lotérica"** acima de R$ 5.000,00.
  - O depósito é **diário**. O aviso de dinheiro parado continua em **2 dias úteis**, e o depósito diário mantém o caixa longe do limite.

**Ponto F2: a unidade como pagadora na produção.**
- O sandbox aceitou. A produção pode recusar, ou a área de risco pode estranhar, uma cobrança em que o pagador é o próprio dono da conta.
- **Pergunta para o Jeferson enviar ao Asaas:**

> Somos uma rede de clínicas em que cada unidade tem a sua própria conta Asaas, no CNPJ da unidade (conta vinculada), operada pelo nosso sistema pela chave de API, com autorização do franqueado. Cada unidade recebe pagamentos em dinheiro no balcão e precisa levar esse dinheiro à sua conta Asaas. Queremos emitir, uma vez por dia, um boleto na conta da unidade em que o **pagador é a própria unidade** (o mesmo CNPJ titular da conta), sem notificações (`notificationDisabled`), com split para a conta da franqueadora, e pagá-lo em dinheiro na agência ou na lotérica. Perguntas: (1) Na produção, a API aceita cobrança em que o CPF/CNPJ do pagador é o do titular da conta? (2) Esse uso (depósito do próprio caixa por boleto) é permitido pelos termos e pela análise de risco do Asaas, ou pode gerar bloqueio da conta? (3) O valor recebido cai como receita de cobrança normal, com a tarifa de boleto pago da nossa conta? (4) Se não for permitido, qual é o meio recomendado pelo Asaas para levar dinheiro em espécie para a conta (depósito, Pix a partir de outra conta, outro produto)?

- **Se a resposta for "não":** a 1C não sai como boleto.
  - O dinheiro é depositado na **conta bancária da unidade**, e o Gerente registra o depósito com o comprovante (entrega 1).
  - As taxas desses recebimentos seguem para a cobrança mensal (ASA6), sem split.
  - Não recomendo um "cadastro interno" pessoa física: o boleto ficaria limitado a R$ 5.000 e poria o CPF de alguém num pagamento que não é dele.

**Ponto F3: isolamento do boleto de depósito.**
- **Tipo próprio de cobrança** (`deposito_caixa`), sem parcela de paciente e sem venda.
- Não gera nota fiscal (a nota já é do atendimento), selo de atraso, multa, juros, desconto ou aviso: o cadastro tem `notificationDisabled`, e a cobrança nasce sem multa, sem juros e sem desconto.
- **Não fecha venda** (D21).
- **Não é receita nova:** no razão é transferência do Caixa para a conta Asaas (6.3.01, fora do resultado). Só a tarifa é despesa bancária.
- **Não aparece** na lista de recebíveis de pacientes, na régua, no Painel de recebíveis, nas Cobranças da venda nem na ficha. Aparece só no painel do dinheiro e no Painel de repasses, em linha própria.
- O ensaio confere cada um desses pontos.

**Ponto F4: boleto de depósito vencido sem pagamento.**
- **Vencimento:** no próximo dia útil.
- Se não foi confirmado até **3 dias úteis depois do vencimento** (o prazo da compensação do boleto), o riSZon:
  1. confere a situação no Asaas;
  2. se continua não pago, **cancela sozinho**;
  3. os recebimentos voltam a "não depositado";
  4. a taxa reservada volta a "a pagar" (19.12 item 4).
- Se o Asaas confirmar depois de cancelado (pago no último minuto), o aviso do pagamento é tratado: o depósito é registrado, e o Financeiro é avisado para conferir.
- O dinheiro parado continua contando dias desde o recebimento, não desde o boleto: o aviso de 2 dias úteis não "zera" com um boleto vencido.

**Ponto F5: "Registrar depósito" à mão, na entrega 1.**
- **A transferência entre contas do Financeiro NÃO serve como está** (conferido):
  - Ela só nasce de uma **linha do extrato importado** na Conciliação (`transfer_bank_transaction_with_cash_box`, 0317), marcando "É com o Caixa".
  - Não tem comprovante.
  - Não diz **quais** recebimentos foram depositados: move um valor solto.
  - A Recepção não a vê; quem a usa é o Admin Master, o Financeiro da Franqueadora e o Gerente.
- **Proposta: "Registrar depósito" no painel do dinheiro.**
  1. O **Gerente** (também o Financeiro da Franqueadora e o Admin Master) escolhe os recebimentos em dinheiro que foram depositados.
  2. Informa a data, a conta bancária da unidade e o **comprovante**, obrigatório: foto ou PDF, guardado em pasta privada, como os anexos de hoje.
  3. O riSZon lança a transferência do Caixa para o banco (6.3.01, fora do resultado), marca os recebimentos como "depositados" e registra na auditoria.
  4. O valor depositado precisa ser igual à soma escolhida; diferença só com justificativa.
- **Quando o extrato do banco for importado,** a Conciliação reconhece a linha como esse depósito e só a liga a ele, **sem lançar a transferência de novo**. O ensaio confere que o mesmo dinheiro não sai do Caixa duas vezes.
- **Desfazer:** só o Gerente e o Admin Master, com motivo. Os recebimentos voltam a "não depositado".
- As taxas desses recebimentos seguem **a pagar**, para a cobrança mensal (sem split).

**Ponto F6: tarifa de boleto da produção.**
- Não consigo ler: a chave de produção só existe a partir da ASA7.
- **Conferência do Jeferson antes da 1C:** no painel do Asaas da produção, Minha conta → Taxas → "Boleto pago". Ou a pergunta vai junto com a do F2.
- A 1C não começa sem esse valor anotado aqui.

**⛔ A 1C CONTINUA BLOQUEADA (registro de 15/11/2026, decisão do Jeferson):**
- Ela só começa com **as duas respostas** anotadas aqui:
  - **F6:** a tarifa de "Boleto pago" no painel de produção de **Londrina e de Cambé**. O Jeferson vai olhar e passar os valores.
  - **F2:** a resposta do Asaas sobre a unidade como pagadora (pergunta 11 da lista em `docs/asaas/perguntas-ao-asaas.txt`).
- A migração **4016 fica reservada** para ela.
- Enquanto isso, a próxima entrega é a da renegociação (4017, seção 19.28).

### 19.13 Nova ordem das entregas e das migrações (ajuste A, APROVADA)

**Pedido:** o cartão parcelado pelo Asaas vem logo depois da entrega 1, antes da renegociação. Até ele estar pronto e aprovado, a maquininha continua na venda direta **só para o cartão parcelado**.

| Ordem | Entrega | Antes | O que entrega | Migração |
|---|---|---|---|---|
| 1 | **1** | 1 | Meio por parcela (Asaas, dinheiro, permuta e, provisório, maquininha só no cartão parcelado); permuta; dinheiro no Caixa; painel do dinheiro parado; "Registrar depósito"; troca de meio (19.11). | **4011** |
| 1 | **1** | 1 | Gatilhos: cobrança na assinatura (ZapSign) e na venda direta, a rotina da proposta A, o envio e o reenvio, as Cobranças da venda, a tabela de rodadas, o 2º disparo e o vigia. | **4012** |
| 2 | **2, cartão parcelado** | 3 | Cartão parcelado pelo Asaas (parcelamento do Asaas, split por parcela, prova das datas de crédito da seção 17). Ao ser aprovado, a **chave da rede "maquininha na venda direta" é desligada**: a venda direta nova deixa de oferecer a maquininha. | **4013** |
| 3 | **1B, forma 2** | 1B | "Todos os boletos agora", com o cadastro do carnê e a página da lista. Depende da prova com envio real (19.15). | **4014** |
| 4 | **1C, boleto de depósito** | 1C | O dinheiro vai à conta Asaas por boleto, com split da taxa. Depende das respostas do Asaas (19.12, F2 e F6). | **4015** |
| 5 | **3, renegociação** | 2 | Renegociação assinada pela ZapSign. | **4016** |
| 6 | **4, mensalidades** | 4 | PPR+ e Ortodontia perto do vencimento. | **4017** |
| 7 | **5, reemissão** | 5 | Cobrança paga por fora volta ao Asaas. | **4018** |
| 8 | **6, distrato** | 6 | Distrato com checklist. | **4019** |

**Por que a entrega 1 tem duas migrações:**
- A 4011 (meios) é a base de tudo e pode ser testada sozinha na tela, sem Asaas.
- A 4012 (gatilhos) depende dela.
- Ambas sobem juntas para a produção, numa entrega só, com um teste só.

**O cartão parcelado na venda direta, nesse meio-tempo:**
- **Na entrega 1:** "Cartão parcelado (maquininha)" é o único caso de maquininha na venda direta nova.
  - O adquirente é gravado só nessas parcelas.
  - A baixa à mão aceita cartão parcelado só nelas.
  - Todo o resto já segue a regra nova.
- **Na entrega 2:** o cartão parcelado passa a sair pelo Asaas.
  - Depois do teste e da aprovação do Jeferson, o Admin Master desliga a chave.
  - As vendas antigas na maquininha continuam como estão até a última parcela.
- **No contrato de tratamento:** a entrega 2 também oferece o cartão parcelado pelo Asaas, **ao lado** da maquininha. Tirar a maquininha do contrato continua sendo decisão própria (19.11).

### 19.14 Agendador do banco na produção: o `pg_net` (ajuste G, APROVADO; instalação só com o "pode" na hora)

**Situação:** a produção tem o `pg_cron` e **não tem** o `pg_net` (conferido pelo Jeferson). Nada é instalado na produção sem a aprovação dele na hora.

**O passo (no dia da entrega, com o "pode" do Jeferson):**
1. No SQL Editor da produção: `create extension if not exists pg_net;`
   - O mesmo pode ser feito pelo painel: Database → Extensions → `pg_net` → Enable.
2. Conferência: `select extname, extversion from pg_extension where extname = 'pg_net';` → uma linha.
3. Só depois disso a migração da entrega cria as rotinas do `pg_cron` que chamam o endereço da aplicação.
   - A migração **não instala** a extensão. Se o `pg_net` faltar, ela para com um erro claro, sem criar nada pela metade.

**O risco:**
- O `pg_net` cria o esquema `net` e um processo do banco que faz as chamadas HTTP em segundo plano. As respostas ficam guardadas por 6 horas e depois são apagadas sozinhas.
- Ele é uma extensão oficial do Supabase, a mesma que os "Database Webhooks" usam.
- **Não mexe** em nenhuma tabela, regra ou função do riSZon.
- O uso é pequeno: algumas chamadas por dia.
- O que precisa de cuidado é a **senha da chamada**:
  - gerada pelo próprio banco e guardada no **Vault**;
  - ninguém a vê nem a copia;
  - a aplicação confere a mesma senha, lida do Vault pelo servidor;
  - a resposta da chamada não guarda dado de paciente.

**Como desfazer:**
1. Tirar as rotinas: `select cron.unschedule(jobname) from cron.job where jobname like 'risarte-gateway-%';`
2. Remover a extensão: `drop extension pg_net;`
   - Apaga o esquema `net` e as chamadas na fila.
   - Nenhum dado do riSZon é perdido.
3. O cron da Vercel continua sozinho, como hoje.

**Continuam valendo:**
- **Segredo no Vault:** a senha da chamada do banco para a aplicação e a chave do serviço de e-mail ficam no Vault. Nenhuma fica no código, no GitHub ou em log.
- **Vigia separado:** é só banco (`pg_cron`). Não chama a aplicação e não depende da Vercel.
- **Aviso por e-mail fora do aplicativo:**
  - Hoje o e-mail sai pela Resend, a partir da aplicação, na Vercel. Se a Vercel cair, o aviso no sino do riSZon ninguém vê e o e-mail da aplicação não sai.
  - Por isso o vigia manda o e-mail **direto do banco para a Resend, pelo `pg_net`**, sem passar pela Vercel.
  - A chave da Resend precisa estar no Vault: o Jeferson a grava ele mesmo no SQL Editor (`select vault.create_secret(...)`), sem mostrá-la a ninguém.
  - Sem o `pg_net`, o vigia só consegue avisar dentro do aplicativo.
- **O segundo disparo cobre também:**
  - a fila do split e a virada do dia das campanhas (`gateway-split-diario`): 2º disparo às 01:35;
  - a verificação das contas (`gateway-accounts`): 2º disparo às 08:10;
  - a criação das cobranças da proposta A: 2º disparo às 09:30.
  - A fila da régua não ganha 2º disparo, porque roda a cada 10 minutos; o vigia avisa se ficar 1 hora sem rodada.
  - Os horários estão em Brasília.

### 19.15 Prova com envio real (autorizada pelo Jeferson em 14/11/2026, com condições)

**Condições:**
- Só para o e-mail do Jeferson, sem celular.
- Aviso antes de disparar, e espera do "pode" dele.

**O que prova:**
- O cadastro do carnê (19.10 item 2): um cadastro com o aviso "cobrança criada" desligado não manda esse aviso.
- 19.1 item 1: o "cobrança criada" sai na hora, mesmo com vencimento distante.

**Onde:** conta sandbox de Londrina. O e-mail vem do Asaas em nome dela.

**Como:**
1. **Pagador de controle**: e-mail do Jeferson, sem celular.
   - Só o aviso "cobrança criada" por e-mail fica ligado; os demais avisos, desligados.
   - Uma cobrança de boleto de **R$ 5,00**, com vencimento daqui a 45 dias.
2. **Cadastro do carnê**: mesmo e-mail e mesmo CPF de teste do pagador de controle.
   - "Cobrança criada" desligado, e-mail e SMS.
   - Os demais avisos ficam como a régua, mas não disparam na janela da prova: o vencimento é daqui a 45 dias e o primeiro lembrete é aos 30 dias, no máximo.
   - Três cobranças de boleto: **R$ 5,01**, **R$ 5,02** e **R$ 5,03**, com vencimento daqui a 45, 75 e 105 dias.
3. **Espera de 30 minutos.** O Jeferson confere a caixa de entrada e o spam.
4. **Limpeza:**
   - os dois cadastros recebem `notificationDisabled` antes de qualquer remoção;
   - depois, as quatro cobranças são removidas;
   - o script confere que a remoção aconteceu.

**O que o Jeferson deve receber: 1 e-mail.**
- O aviso de nova cobrança de **R$ 5,00**, de Londrina (Teste).

**O que NÃO deve receber:**
- nenhum e-mail de **R$ 5,01**, **R$ 5,02** ou **R$ 5,03**;
- nenhum lembrete de vencimento, de vencida ou de pagamento;
- nada no celular.

**Resultado:**
- **Passou:** chegou exatamente o de R$ 5,00, e nenhum dos outros três em 30 minutos.
- **Falhou:**
  - chegou algum dos outros três → o cadastro do carnê **não** serve, e a forma 2 volta para decisão;
  - não chegou nem o de R$ 5,00 → a prova não vale (envio do sandbox), e repete com o "pode" do Jeferson.

**Fora da conta:** mensagens do Asaas sobre a própria conta (não de cobrança), se houver.

**Ensaio sem envio (14/11/2026):**
- Script: `scripts/asaas-prova-envio-real-sandbox.mjs --ensaio`.
- Resultado: **3 de 3**.
- O que confirmou:
  - os dois cadastros nascem sem celular nem telefone;
  - no controle, só "cobrança criada" fica ligado, e só por e-mail;
  - no carnê, "cobrança criada" fica desligado.
- O ensaio usou um e-mail example.com e não criou cobrança, então nada foi enviado.
- O disparo real (`--disparar`) espera o "pode" do Jeferson.

### 19.16 APROVAÇÃO da revisão (Jeferson, 14/11/2026)

- **Aprovadas as seções 19.11 a 19.15:**
  - venda direta;
  - desconto à vista;
  - troca de meio e fechamento da venda;
  - boleto de depósito com os pontos F1 a F6;
  - nova ordem das entregas;
  - agendador do banco;
  - prova com envio real.
- O Jeferson respondeu "segue" à pergunta "aprova a revisão de 19.11 a 19.15, ou tem ajustes?".
- **Continuam dependendo do Jeferson na hora:**
  - o "pode" do disparo real (19.15);
  - a instalação do `pg_net` na produção (19.14);
  - a migração no SQL Editor.
- **Continuam dependendo do Asaas:**
  - a pergunta F2;
  - a tarifa F6, que é condição da 1C.
- **A construção começa pela 4011** (entrega 1, parte 1).

**Resultado da prova com envio real (14/11/2026):**
- **Disparo:** às 18:24:44, com o "pode" do Jeferson.
- **O que chegou:** só o e-mail de **R$ 5,00** (controle). Nenhum de R$ 5,01, 5,02 ou 5,03 (carnê).
- **Limpeza:** às 18:26:43, 5 de 5. Os cadastros foram calados e depois as cobranças e os cadastros foram removidos.
- **⚠️ Janela observada: ~2 minutos, e não os 30 previstos.**
  - A resposta do Jeferson chegou cedo, e a limpeza rodou sem conferir o horário.
  - **O que a prova mostra mesmo assim:**
    - o aviso de criação sai em menos de 2 minutos, com vencimento a 45 dias (confirma 19.1 item 1);
    - no mesmo intervalo, o cadastro do carnê não mandou nada.
  - **Por que o resultado vale para o carnê:**
    - no cadastro do carnê, o aviso nasce desligado e nunca é religado;
    - mesmo que o Asaas use uma fila que só olha a configuração na hora de enviar, ela encontraria o aviso desligado;
    - o risco de fila era do caminho "desligar, criar e religar", descartado em 19.10.
  - **Se o Jeferson quiser a janela completa:** repetir com o mesmo script e limpar só depois de 30 minutos.
- **Conclusão:** o cadastro do carnê serve para a forma 2 (entrega 1B, migração 4015). **Prova aceita pelo Jeferson** (14/11/2026); em 15/11/2026, ele conferiu a caixa de entrada e o spam mais de 7 horas depois do disparo: nenhum dos 3 e-mails do carnê chegou (19.27).

### 19.17 Construção da entrega 1, parte 1 (4011), em 14/11/2026

**Situação:**
- Construída, aplicada no treino e enviada ao projeto de teste.
- A produção espera a parte 2 (4012): as duas sobem juntas, com um teste só (19.13).

**Provas:**
- **Ensaio no treino** (`scripts/asaas-ensaio-asa4-entrega1-meios.mjs`): **60 de 60**, numa transação desfeita.
- **Provado quebrando:**
  - `--quebrar=fechamento`: 6 falhas;
  - `--quebrar=permuta`: 6 falhas.
- **Testes:** 26 novos (`asaas-asa4-entrega1-meios.test.ts`).
- **Bateria:** `npm test` (com as réguas de auditoria e de tema escuro), lint e `npm run verificar` passaram.

**O que entrou:**
- Venda direta nova (`method_rule = 'asa4'`):
  - meio por parcela, com a coluna "Como paga";
  - à vista em Pix, dinheiro ou permuta;
  - depósito à vista e crédito recorrente recusados;
  - maquininha só no cartão parcelado, pela chave da rede;
  - adquirente só nessa parcela.
- Baixa à mão na venda nova só em dinheiro ou permuta (e cartão parcelado na parcela de maquininha).
- A baixa em dinheiro ou permuta **fecha a venda** (origem "balcão" ou "permuta"). Sem contrato assinado, é recusada.
- A baixa em dinheiro **cancela antes** a cobrança ativa no Asaas e é recusada se a cobrança já foi paga lá.
- **Troca de meio** ("Trocar meio" na ficha):
  - para permuta, só o Gerente ou o Admin Master, com descrição;
  - para Pix, boleto ou cartão, a cobrança é gerada na hora.
- **Permuta:**
  - entra na conta "Permutas";
  - fica **fora do fluxo de caixa, do saldo e da conciliação**;
  - não leva cota de benefício;
  - tem categoria própria e lista "Permutas do período" nos Repasses.
- **Dinheiro no caixa** (Financeiro → Dinheiro no caixa):
  - os recebimentos não depositados, com a marca "parado" depois de 2 dias úteis;
  - aviso diário pelo `pg_cron` (09:00) ao Gerente e ao Financeiro da Franqueadora;
  - "Registrar depósito" com comprovante obrigatório (pasta privada `depositos`) e motivo para diferença;
  - "Desfazer" pelo Gerente ou Admin Master, com motivo; recusado se já conciliado.
  - A tela avisa "agência" a partir de R$ 10.000 (Resolução CMN 4.648/2018) e "prefira a agência" acima de R$ 5.000.

**Decisões de construção, para o Jeferson conferir no teste:**
1. O cancelamento automático da cobrança na baixa em dinheiro vale para **qualquer** parcela com cobrança no Asaas, não só para a venda nova. Antes era preciso clicar em "Recebeu no balcão".
2. O fechamento pela baixa em dinheiro ou permuta vale para **toda** venda direta e todo contrato aceito.
3. Nas vendas antigas, a permuta também pode ser registrada, pelo Gerente ou pelo Admin Master, com descrição.
4. **Pagamento parcial em dinheiro de parcela que estava no Asaas:** a cobrança é cancelada, e o restante fica na parcela.
   - Na parte 1, a cobrança nova do restante sai pelo botão "Gerar cobrança no Asaas".
   - Na parte 2, sai sozinha (na hora, se vence dentro do prazo, ou pela rotina).
5. A tela "Dinheiro no caixa" fica no módulo Financeiro: Gerente, Financeiro da Franqueadora e Admin Master. A Recepção registra o dinheiro na ficha, como hoje.
6. A chave "maquininha no cartão parcelado" e o prazo do dinheiro parado já existem no banco (`sale_method_settings`), mas ainda **sem tela**. A chave só é desligada na entrega 2, e a tela entra com ela.

### 19.18 Construção da entrega 1, parte 2 (4012), em 14/11/2026

**Situação:**
- Construída, aplicada no treino e enviada ao projeto de teste, junto com a parte 1.
- **Versão:** core 0.449.0, Asaas 0.10.0.

**Provas:**
- **Ensaio no treino** (`scripts/asaas-ensaio-asa4-entrega1-gatilhos.mjs`): **44 de 44**, numa transação desfeita.
- **Provado quebrando:**
  - `--quebrar=marca`: 6 falhas;
  - `--quebrar=cancelada`: 1 falha.
- **O 2º disparo foi provado no ensaio criando o `pg_net` dentro da transação e desfazendo depois.** O treino continua sem o `pg_net`.
- **Testes:** 20 novos (`asaas-asa4-entrega1-gatilhos.test.ts`). A bateria inteira, o lint e o `npm run verificar` passaram.

**O que entrou:**
- **A marca da venda** (`sale_auto_charges`, uma por venda):
  - nasce quando o contrato é assinado (ZapSign ou papel) ou quando a venda direta nova é marcada como assinada;
  - só se a unidade já estava **ligada**. Venda assinada antes continua manual.
- **Proposta A:**
  - na hora, nascem as parcelas que vencem dentro do prazo (15 dias);
  - as seguintes nascem pela rotina (Vercel às 07:00; banco às 09:30, com o `pg_net`).
  - Contrato: boleto e Pix. Venda direta nova: boleto, Pix e cartão à vista.
  - Cobrança cancelada à mão não volta sozinha. O restante de um pagamento parcial em dinheiro volta.
- **Limite diário:** lido antes de criar (`GET /payments/limits`), com reserva de 10% (no mínimo 20) para a emissão manual. A rotina para depois de 3 erros seguidos na mesma conta.
- **Rodadas** gravadas (cobranças, split diário, contas, régua), lista de pendências com o motivo e "Rodar agora", na tela **Financeiro → Cobranças automáticas**.
- **Vigia** só no banco, de hora em hora.
- **Segundo disparo:**
  - `routine_second_dispatch_enable()` cria as rotinas onde o `pg_net` existe;
  - a senha é gerada no Vault e conferida pelo servidor;
  - o endereço da aplicação é configurado na tela.
- **Cobranças da venda:**
  - "Enviada pelo Asaas", "Aberta pelo pagador" e o registro dos envios;
  - avisos de link não enviado (régua desligada) e de primeira cobrança não aberta (régua ligada).

**O que falta antes da produção:**
1. **Teste do Jeferson no projeto de teste.** Para não enviar nada a ninguém:
   - ligar Londrina em Financeiro → Cobranças automáticas;
   - usar uma venda direta nova de um cliente com CPF e **sem** e-mail e celular.
2. **Na produção, nesta ordem:**
   1. a 4011;
   2. a 4012;
   3. o `main`.
3. **Endereço da aplicação e `pg_net`:**
   - o endereço só vale com o `pg_net`;
   - o `pg_net` da produção só com o "pode" do Jeferson (19.14), e depois `select public.routine_second_dispatch_enable();`.

**Prova de ponta a ponta no sandbox (14/11/2026, a pedido do Jeferson): 3 de 3, nada enviado a ninguém.**
- **Teste:** `src/lib/__tests__/asaas-asa4-entrega1.integracao.test.ts`, com `ASAAS_INTEGRACAO=sim`, banco de treino, conta sandbox de Londrina.
- **Pagador:** um cliente novo, com CPF de teste gerado na hora, **sem e-mail e sem celular**. O Asaas não tinha para onde mandar.
- **O que confirmou:**
  - o caminho real do servidor (`criarCobrancasAutomaticas` → `_charge_prepare_system` → `emitirNoAsaas`) criou no Asaas **só as 2 parcelas do prazo** (boleto em 5 dias e Pix em 10 dias); a de 40 dias ficou agendada;
  - cada uma com a referência do riSZon (`externalReference`), origem "venda_direta", sem usuário;
  - nenhuma marcou "Enviada pelo Asaas", porque o pagador não tinha contato;
  - **rodar de novo não criou nada** (idempotente);
  - as rodadas ficaram gravadas (origem "gatilho");
  - o limite diário foi lido antes (`GET /payments/limits`, 200).
- **Limpeza:** todas as cobranças da prova foram apagadas no Asaas (6 de 6, em 3 execuções), e a chave da unidade voltou como estava (desligada). Ficaram no treino 3 vendas de prova canceladas e 3 clientes "Prova ASA4 sem contato".
- ⚠️ **O sandbox do Asaas falhou hoje no QR Code do Pix para QUALQUER cobrança, inclusive uma antiga de 11/11:** "Ocorreu um erro desconhecido", depois de 30 segundos.
  - A cobrança Pix nasce assim mesmo, com o link da fatura (o paciente paga por ele), mas sem o "copia e cola".
  - É o comportamento da emissão de sempre (ASA1), não da 4012.
  - **Proposta para depois:** a rotina de 10 minutos tenta buscar de novo o QR Code que faltou.

### 19.19 Entrega 2 — cartão parcelado pelo Asaas: PLANO REVISADO (14/11/2026; APROVADO pelo Jeferson com ressalvas — 19.20)

**Aprovado pelo Jeferson (14/11/2026):**
- a prova com envio real, só para o e-mail dele, sem celular, num 3×, com aviso antes e o "pode" na hora (19.19.8);
- o meio separado da maquininha (`cartao_parcelado_asaas`);
- cancelar ou estornar só o parcelamento inteiro nesta entrega, com o ajuste E (19.19.5).

#### 19.19.1 O que o sandbox mostrou

Primeira prova (`scripts/asaas-prova-cartao-parcelado-sandbox.mjs`), que fecha a pendência da seção 17:

| Pergunta | O que o Asaas fez |
|---|---|
| Valor de cada parcela (3× de R$ 150,01) | R$ 50,00, R$ 50,00 e **R$ 50,01**: a sobra fica na **última** |
| Vencimentos | Mês a mês, no mesmo dia, a partir do 1º vencimento |
| Situação depois do pagamento | As parcelas ficam **confirmadas no mesmo dia** (o cartão é cobrado uma vez) |
| Crédito | **Mês a mês**, cerca de 30 dias depois de cada vencimento |
| Split | **Em cada parcela**, sobre o líquido dela, creditado com a parcela |
| Cancelar antes de pagar | `DELETE /installments/{id}` apaga o parcelamento inteiro |
| Estorno depois de pago | `POST /installments/{id}/refund`: todas as parcelas ficam estornadas |

**Prova da tarifa** (`scripts/asaas-prova-tarifa-parcelado-sandbox.mjs`, ajuste A):
- 3×, 6×, 12× e 21× de R$ 3.000,00, todos pagos com o cartão de teste;
- 8 parcelamentos, todos estornados no fim; pagador sem contato, apagado no fim.

**Prova do cartão recusado** (`scripts/asaas-prova-cartao-recusado-sandbox.mjs`): ver 19.19.7.

#### 19.19.2 Ajuste A — a conta do split no parcelado

**A parte fixa da tarifa (R$ 0,49) sai UMA vez por parcelamento, rateada entre as parcelas.** Medido no sandbox:

| Parcelamento | Soma das tarifas medida | Se a parte fixa saísse uma vez | Se saísse em cada parcela |
|---|---|---|---|
| 3× | R$ 75,18 | R$ 75,19 | R$ 76,17 |
| 6× | R$ 75,18 | R$ 75,19 | R$ 77,64 |
| 12× | R$ 90,12 | R$ 90,19 | R$ 95,58 |
| 21× | R$ 98,92 | R$ 99,19 | R$ 108,99 |

**A regra exata, conferida centavo a centavo nas 42 parcelas.** Para a parcela de valor **V**, num parcelamento de **n** parcelas, com a tarifa da faixa **a% + b**:

- tarifa da parcela = **a × V cortado no centavo + b ÷ n cortado no centavo**;
- líquido da parcela = V − tarifa da parcela.
- Exemplo, 3× a 2,49% + R$ 0,49: R$ 24,90 + R$ 0,16 = R$ 25,06 → líquido R$ 974,94.

**O Método B no parcelado.** É a fórmula da 18.2, com a parte fixa da parcela no lugar de b. A mesma entrada vale para todas as parcelas.
- `percentualValue` = **q = p ÷ (1 − a)**, cortado em 4 casas;
- `fixedValue` = **F = q × (b ÷ n cortado no centavo)**, cortado no centavo;
- o Asaas transfere, em cada parcela: F + q × líquido da parcela.

**A tabela pedida** (R$ 3.000,00, 17% para a franqueadora):
- as tarifas são as **cheias** do Asaas, que valem na produção sem promoção: 3,49% (2× a 6×), 3,99% (7× a 12×) e 4,29% (13× a 21×), sempre + R$ 0,49;
- a mesma conta com a promoção do sandbox (2,49%, 2,99% e 3,29%) **deu exatamente o que o Asaas cobrou e mandou para a franqueadora** em cada parcela.

| Parcelas | Valor da parcela | Tarifa da parcela | Líquido | q / F | A franqueadora recebe | 17% da parcela | Diferença (a favor da unidade) |
|---|---|---|---|---|---|---|---|
| 3× | R$ 1.000,00 | R$ 35,06 | R$ 964,94 | 17,6147% / R$ 0,02 | R$ 169,99 | R$ 170,00 | R$ 0,01 |
| 6× | R$ 500,00 | R$ 17,53 | R$ 482,47 | 17,6147% / R$ 0,01 | R$ 84,99 | R$ 85,00 | R$ 0,01 |
| 12× | R$ 250,00 | R$ 10,01 | R$ 239,99 | 17,7064% / R$ 0,00 | R$ 42,49 | R$ 42,50 | R$ 0,01 |
| 21× (1ª a 20ª) | R$ 142,85 | R$ 6,14 | R$ 136,71 | 17,7619% / R$ 0,00 | R$ 24,28 | R$ 24,28 | R$ 0,00 |
| 21× (21ª, com a sobra) | R$ 143,00 | R$ 6,15 | R$ 136,85 | 17,7619% / R$ 0,00 | R$ 24,30 | R$ 24,31 | R$ 0,01 |

- **Diferença:** de R$ 0,00 a R$ 0,01 por parcela, sempre a favor da unidade, dentro da tolerância de R$ 0,10 (S5). Medido no sandbox: o mesmo, nas 42 parcelas.
- **Custo da tarifa para a unidade em R$ 3.000,00:**

  | Parcelas | Com a tarifa cheia | Com a promoção do sandbox |
  |---|---|---|
  | 2× a 6× | R$ 105,18 | R$ 75,18 |
  | 12× | R$ 120,12 | R$ 90,12 |
  | 21× | R$ 128,95 | R$ 98,92 |

**De onde vêm as tarifas por faixa e onde ficam:**
- vêm da consulta de tarifas de cada conta no Asaas (`GET /myAccount/fees`, campos `upToSixInstallmentsPercentage`, `upToTwelveInstallmentsPercentage`, `upToTwentyOneInstallmentsPercentage`, as promoções `discount…` com `discountExpiration` e a parte fixa `operationValue`);
- ficam gravadas em `acquirer_rates`, por faixa (2–6, 7–12, 13–21), com a vigência: a promoção até o fim, e a cheia a partir do dia seguinte;
- aparecem na **Central → aba Conta e tarifas → "Tarifas do Asaas por meio de pagamento"** e em **Financeiro → Adquirentes**;
- ninguém digita: a Central lê da conta.
- **A tarifa que vale:** a da data da **aprovação do cartão**, porque o Asaas cobra o parcelamento inteiro de uma vez. Se a promoção acabar entre a criação e o pagamento, vale a proteção da 18.2: a menor parte percentual. A diferença fica a favor da unidade e cai na S5.
- ⚠️ **As tarifas reais de cada unidade na produção** só aparecem depois que a conta dela for lida pela Central. Os números cheios acima são os da tabela pública do Asaas.

#### 19.19.3 Ajuste B — a mensageria

O sandbox não mostrou nenhuma cobrança de mensageria: os pagadores não tinham contato, então nada foi enviado. A documentação pública só diz que o pacote de e-mail e SMS é descontado depois que o cliente paga. Ela **não diz**:
- se a mensageria sai uma vez ou por parcela;
- se entra no líquido usado no split.

**Na prova com envio real (19.19.8) eu meço três coisas:**
- o líquido de cada parcela contra a regra da 19.19.2;
- os lançamentos da conta (`GET /financialTransactions`), à procura da tarifa de mensageria;
- se ela aparece uma vez ou em cada parcela.

**O que muda conforme o resultado:**
- **Se a mensageria sair por parcela:**
  - o cartão parcelado usa sempre o **cadastro sem avisos** (o do carnê, 19.10 item 2);
  - o link vai **uma vez**, por quem fechou a venda (Cobranças da venda);
  - o comprovante ao paciente é o **do riSZon**.
- **Se sair uma vez:** o parcelamento usa o cadastro normal, com a régua da unidade.
- **Se o sandbox não cobrar mensageria:** eu digo isso, e o cartão parcelado fica no cadastro sem avisos até a resposta do Asaas. É o lado seguro: nunca se paga a mensageria em dobro.
  - **Pergunta para o Asaas:** "No parcelamento no cartão de crédito (`installmentCount`), a tarifa de mensageria (e-mail/SMS, R$ 0,99) é cobrada uma vez por parcelamento ou em cada parcela? Ela é descontada do `netValue` da parcela, e por isso entra na base do split, ou sai à parte do saldo da conta?"

#### 19.19.4 Ajuste C — a taxa das parcelas ainda não creditadas

**O problema:**
- as parcelas recebem a baixa todas juntas, na aprovação do cartão;
- o split só retém a taxa no crédito de cada uma, mês a mês;
- hoje a baixa com split já nasce com a taxa "retida" (18.3.1). No parcelado, isso diria "retida" para parcelas que só serão creditadas daqui a 20 meses.

**Três situações para a taxa de cada parcela (uma linha por parcela e por taxa, nunca duas):**

| Situação | Quando | Vira conta a pagar? | Entra na cobrança mensal (ASA6)? | Onde aparece |
|---|---|---|---|---|
| **a reter pelo split** | parcela confirmada, crédito no futuro, split agendado no Asaas | não | não | Painel de repasses, em "a receber pelo split", com a data prevista de cada crédito |
| **retida** | o Asaas liquidou o split da parcela (`PAYMENT_SPLIT_DONE`, valor gravado e comparado, S5) | não | não | Painel de repasses, "recebido com split"; no apurado do mês, "pago no split" |
| **a cobrar da unidade** | o split da parcela não aconteceu ou foi revertido: estorno, contestação perdida, divergência cancelada pelo Asaas, ou diferença acima de R$ 0,10 | sim | sim | Contas a pagar de taxa da unidade |

**Regras, para que nenhuma parcela seja cobrada duas vezes:**
1. A taxa da parcela é **uma linha por parcela e por taxa**. Um índice único no banco impede uma segunda linha.
2. A situação só anda para frente: "a reter" vira "retida" ou "a cobrar"; "retida" só vira "a cobrar" no estorno ou na contestação perdida. Nunca volta para trás.
3. A conta a pagar de taxa nasce **só** da situação "a cobrar", e uma vez só (ligada à linha).
4. O aviso repetido do Asaas não muda nada (a mesma idempotência dos avisos de hoje).
5. **Dispensa:** só o Financeiro da Franqueadora ou o Admin Master, à mão, com motivo, na auditoria (a porta da ASA3).

**O ensaio prova, quebrando** (ensaio no treino):
- um 12× aprovado gera 12 linhas "a reter" e nenhuma conta a pagar;
- o 1º crédito deixa 1 "retida", e o mesmo aviso de novo não muda nada;
- um split cancelado deixa 1 "a cobrar" e 1 conta a pagar; o aviso repetido não gera a segunda;
- o estorno no 5º mês: 4 "retidas" e 8 "a reter" viram "a cobrar" (19.19.5), sem nenhuma em dobro.

#### 19.19.5 Ajuste E — estorno e contestação

**A desistência no meio do tratamento, até a entrega 6.** Só existe o estorno inteiro. Proponho:
- **O caminho, sem mexer no cartão:**
  - o parcelamento continua;
  - a unidade devolve ao paciente a parte não usada, por **Pix da conta da unidade**;
  - a devolução fica registrada no riSZon como **devolução ao paciente**: conta a pagar paga, ligada à venda, com o comprovante.
- **Quem autoriza:** o Gerente pede, com o motivo e o valor; o **Financeiro da Franqueadora ou o Admin Master** autorizam.
- **A taxa da rede:** continua devida sobre o valor recebido, pelo split de cada parcela, normalmente.
- **O ônus da unidade:** devolve agora e recebe as parcelas mês a mês.
- **Alternativa:** a API do Asaas **aceita estorno parcial** do parcelamento (`POST /installments/{id}/refund` com `value`), e ele pode vir já nesta entrega, com a mesma autorização. Isso mudaria a decisão 3. **Recomendo o caminho acima**, e o estorno parcial na entrega 6, junto com o distrato.

**Estorno inteiro depois de meses, com a regra travada (a taxa continua devida).** Exemplo: 12× de R$ 250,00, tarifa cheia, estornado depois do 4º crédito.

| | Parcelas 1 a 4 (creditadas) | Parcelas 5 a 12 (ainda não creditadas) |
|---|---|---|
| A unidade já recebeu | 4 × R$ 239,99 = R$ 959,96 | nada |
| O split já repassou | 4 × R$ 42,49 = R$ 169,96 | nada (agendado) |
| No estorno, o Asaas | debita das contas que receberam, e reverte o split da franqueadora (R$ 169,96) | cancela o crédito e o split agendado |
| Tarifa do Asaas | não volta (R$ 40,04) | não volta (R$ 80,08) |
| Taxa da rede no riSZon | 4 × R$ 42,50 = **R$ 170,00 a cobrar da unidade** | 8 × R$ 42,50 = **R$ 340,00 a cobrar da unidade** |

- **Total a cobrar da unidade: R$ 510,00**, que são os 17% do valor confirmado.
- A unidade também perde a tarifa do Asaas: R$ 120,12.
- Se a conta da unidade não tiver saldo para o estorno, o Asaas recusa. O riSZon mostra "saldo insuficiente na conta da unidade", e nada muda.
- **Dispensa:** só o Financeiro da Franqueadora ou o Admin Master, à mão, com motivo.
- ⚠️ **Li a regra "a taxa continua devida" sobre o valor confirmado inteiro** (R$ 510,00). Se valer só para o que já foi creditado, seriam R$ 170,00.

**Contestação pelo titular do cartão (chargeback):**
- **Como chega:** avisos do Asaas `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE` e `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`.
  - A contestação perdida termina em `PAYMENT_REFUNDED`.
  - O prazo para mandar documentos vem em `deadlineToSendDisputeDocuments`.
- **O que o riSZon faz:**
  - marca as parcelas como **"em contestação"**, sem desfazer a baixa;
  - mostra o prazo;
  - avisa o Gerente da unidade, quem fechou a venda, o Financeiro da Franqueadora e o Admin Master: no aviso e de novo 2 dias úteis antes do prazo.
- **A defesa:** nesta entrega, pelo painel do Asaas, com o link na tela. O envio dos documentos pelo riSZon (`POST /chargebacks/{id}/dispute`, até 11 arquivos) fica para depois.
- **Perdida:** igual ao estorno inteiro, com a taxa a cobrar da unidade e a dispensa só à mão.
- **Ganha:** as parcelas voltam ao normal.
- **A documentação não diz:**
  - se a contestação é por parcela ou do parcelamento inteiro;
  - se o Asaas reverte o split já repassado.
  - **Pergunta para o Asaas:** "Num parcelamento no cartão com split, a contestação (chargeback) vem por parcela ou pelo parcelamento inteiro? Se o titular ganha, o Asaas reverte o split já creditado na carteira de destino (como no estorno) ou debita tudo da conta emissora? E as parcelas ainda não creditadas?"

#### 19.19.6 Ajuste D — antecipação de recebíveis

**O que a documentação diz** (docs.asaas.com, "Split em cobranças antecipadas"):
- na parcela antecipada, o split é calculado sobre o **líquido depois da antecipação**: a tarifa do Asaas e a taxa da antecipação saem antes;
- com antecipação automática e split de valor fixo, o Asaas usa a maior tarifa do cartão;
- o split de cobrança confirmada não muda depois de antecipada.

**O efeito na conta:**
- a franqueadora recebe **menos** que os 17%, porque a base cai;
- exemplo: parcela de R$ 250,00, antecipada 6 meses a cerca de 1,15% ao mês, perde cerca de R$ 17 de base. A franqueadora recebe uns R$ 3,00 a menos.

**Proposta:**
- a antecipação é escolha e custo da unidade;
- a diferença acima de R$ 0,10 vira "a cobrar da unidade" (S5), pelo valor liquidado no `PAYMENT_SPLIT_DONE`;
- a Central lê se a antecipação automática está ligada (`GET /anticipations/configurations`) e mostra o aviso na prontidão da unidade.

**A documentação não diz:**
- se o split da parcela antecipada é pago no dia da antecipação ou na data original;
- se a data prevista de crédito muda.

Na construção, eu tento a antecipação no sandbox (simulação e pedido). Se não der, fica a pergunta:
- **Pergunta para o Asaas:** "Numa parcela de cartão parcelado com split, antecipada (automática ou pedida), o split é creditado na carteira de destino no dia da antecipação ou na data original de crédito? O `estimatedCreditDate`/`creditDate` da cobrança muda? Qual evento avisa a liquidação do split nesse caso?"

#### 19.19.7 Os outros pontos

1. **Custo do parcelamento no fechamento.** Antes de confirmar, o Consultor vê uma tabela por número de parcelas:
   - a tarifa do Asaas que a unidade absorve;
   - os 17% da rede;
   - o que sobra para a unidade.
   - A conta usa a regra da 19.19.2 e as tarifas vigentes da conta da unidade.
2. **Teto de parcelas.**
   - O máximo vem da regra comercial (`max_installments` do plano, e a regra da rede e da unidade), que já existe e pode ser **menor** que o do Asaas.
   - O riSZon usa o menor entre a regra e 21×. Acima de 12×, avisa que só vale para Visa e Mastercard (confirmado na documentação).
   - O Asaas não tem um teto por conta (não está na documentação), e não precisa: o riSZon manda o número exato de parcelas.
3. **Link não pago.**
   - O link vale até ser pago ou cancelado. O cartão vencido continua pagável: a documentação mostra o caminho vencida → confirmada.
   - **Avisos:** os da entrega 1 (1 dia útil sem envio; 2 dias úteis antes do vencimento; não aberta). E mais: **vencido sem pagamento**, aviso no dia útil seguinte para quem fechou a venda e o Gerente.
   - **Sem cancelamento automático:** o Gerente cancela ou troca o meio.
   - **A venda só fecha com a aprovação do cartão** (`PAYMENT_CONFIRMED`, D21). Nenhum outro aviso fecha.
4. **Cartão recusado** (provado no sandbox):
   - no parcelamento criado sem cartão, como o do link, duas tentativas recusadas (número inválido e cartão vencido) não criaram nada;
   - a terceira, com o cartão aprovado, confirmou as 3 parcelas, com **o mesmo parcelamento e as mesmas parcelas** (3 cobranças no total).
   - ⚠️ O sandbox não tem um cartão "recusado pelo banco"; as recusas foram de validação. O limite de tentativas não está na documentação.
5. **Entrada em Pix ou dinheiro, e o resto no cartão parcelado:** funciona.
   - Só as parcelas com o meio "cartão parcelado pelo Asaas" formam o bloco. A entrada é uma cobrança à parte (Pix ou boleto, pela regra da entrega 1) ou dinheiro.
   - O editor exige que o bloco tenha parcelas seguidas, mês a mês, e mostra os valores iguais, com a sobra na última.
6. **Maquininha na venda direta:**
   - só o Admin Master desliga, na Central, depois do teste e da aprovação do Jeferson;
   - a chave `card_machine_direct_sale` (4011) muda por `sale_method_settings_set` (só Admin), com a auditoria;
   - a entrega 2 só põe a chave na tela;
   - as vendas antigas na maquininha continuam até a última parcela.

#### 19.19.8 Prova com envio real (autorizada; dispara só com o "pode" na hora)

**Como:**
- na conta de teste de Londrina, um pagador com **só o e-mail do Jeferson** (vindo de `PROVA_EMAIL`, nunca no código), **sem celular**;
- os avisos do pagador ficam só em **e-mail**, com SMS, WhatsApp e voz desligados;
- um parcelamento **3× de R$ 15,00**, pago pela API com o cartão de teste do Asaas. O e-mail do titular do cartão fica `@example.com`, que ninguém recebe;
- **Medido:**
  - quantos e-mails de "nova cobrança" saem;
  - quantos de "pagamento confirmado" saem;
  - a mensageria (19.19.3).
- **Limpeza:** desligo os avisos do pagador antes de estornar, para não sair e-mail de estorno; depois estorno e apago o pagador.

**O que o Jeferson deve receber:** **de 2 a 6 e-mails do Asaas**:
- "nova cobrança": 1, se for um por parcelamento, ou 3, se for um por parcela;
- "pagamento confirmado": 1 ou 3.

**O que NÃO deve receber:** nenhum SMS nem WhatsApp, nenhum e-mail de estorno ou de cancelamento, e nenhum lembrete de vencimento (as parcelas já nascem pagas).

#### 19.19.9 O que a entrega 2 faz (migração 4013)

1. **O meio novo:** `cartao_parcelado_asaas` nas regras de meio da 4011.
   - Na venda direta nova, na coluna "Como paga".
   - No contrato, ao lado da maquininha.
2. **Um bloco por venda:**
   - um parcelamento no Asaas, com valores iguais e a sobra na última;
   - datas mês a mês, no dia do 1º vencimento;
   - nasce **inteiro na assinatura**, pela mesma porta da entrega 1. O cartão é cobrado uma vez.
3. **A baixa:**
   - todas as parcelas do bloco recebem a baixa na aprovação, com a data prevista de crédito de cada uma vinda do Asaas;
   - a taxa nasce "a reter pelo split" (19.19.4);
   - a 1ª parcela fecha a venda.
4. **O split por parcela,** pela 19.19.2.
5. **O cálculo do custo no fechamento** (19.19.7, item 1).
6. **Cancelar e estornar só o parcelamento inteiro,** com a taxa "a cobrar" pela 19.19.5. A devolução ao paciente fica registrada.
7. **A contestação:** as parcelas ficam "em contestação", com os avisos e o prazo.
8. **A antecipação:** a leitura da configuração e o aviso na prontidão.
9. **O aviso do link vencido** sem pagamento.
10. **A chave da maquininha** na Central.
11. **Provas:**
    - o ensaio no treino, provado quebrando: as três situações da taxa, sem nada em dobro;
    - a prova de ponta a ponta no sandbox: venda direta com entrada em Pix e 3× no cartão, a baixa das 3, as datas de crédito, o split por parcela, o estorno e o cancelamento;
    - a prova com envio real (19.19.8).

#### 19.19.10 Decisões pedidas ao Jeferson

1. **Desistência até a entrega 6:** devolução por Pix da conta da unidade, registrada e autorizada pelo Financeiro da Franqueadora ou pelo Admin Master (recomendado)? Ou trazer o estorno parcial do Asaas já para esta entrega?
2. **Estorno inteiro:** a taxa continua devida sobre o **valor confirmado inteiro** (no exemplo, R$ 510,00), ou só sobre as parcelas **já creditadas** (R$ 170,00)?
3. **Link vencido:** sem cancelamento automático, só avisos, e o Gerente decide?
4. **O "pode" da prova com envio real (19.19.8):** de 2 a 6 e-mails para você, e nada no celular.

### 19.20 APROVAÇÃO do plano revisado da entrega 2 (Jeferson, 14/11/2026)

Aprovado o plano da 19.19, com as respostas **1a, 2a, 3a e 4a**. As ressalvas abaixo **valem por cima** da 19.19.

**1a. Desistência até a entrega 6: a unidade devolve por Pix e registra.**
- **Autorização:** só com a do Financeiro da Franqueadora ou do Admin Master.
- **Anexo obrigatório:** o registro exige o **distrato ou termo de devolução assinado**. Sem o anexo, a devolução não é registrada.
- **Aviso na tela:** o paciente pode contestar a compra no cartão depois de receber o Pix.
- **O cartão:** as parcelas continuam pagas, e a taxa da rede continua devida.

**2a. Estorno inteiro: a taxa continua devida sobre o valor confirmado inteiro.**
- Segue a regra travada.
- **Dispensa:** só o Financeiro da Franqueadora ou o Admin Master, à mão, com motivo.
- **Antes de confirmar, a tela do pedido de estorno mostra o que a unidade perde:**
  - o valor devolvido;
  - a tarifa do Asaas que não volta;
  - a taxa da rede que continua devida.

**3a. Link vencido: só avisos, e o Gerente decide.**
- **O aviso se repete a cada 7 dias** enquanto o link estiver aberto, para quem fechou a venda e para o Gerente.
- **A rotina diária do split cobre o parcelamento em aberto** (confirmado no sandbox, abaixo):
  - hoje, a virada do dia (`/api/cron/gateway-split-diario`, `_gateway_split_enqueue_daily` da 4009) põe na fila as cobranças cujo split muda no dia (campanha que começa ou acaba, fim de promoção de tarifa);
  - a fila (`rodarFilaDoSplit` em `src/lib/asaas/split-servidor.ts`) aplica parcela a parcela, por `PUT /payments/{id}`;
  - **A 4013 estende:** o parcelamento em aberto entra na fila **uma vez** (não por parcela) e é aplicado pela porta do parcelamento inteiro, `PUT /installments/{id}/splits`. Isso também vale para a tarifa que muda na Central (nova leitura de `/myAccount/fees`).
- **A tarifa usada em todas as parcelas é a do dia da aprovação do cartão:**
  - o Asaas calcula a tarifa do parcelamento inteiro na aprovação, e o líquido das parcelas sai dela;
  - na aprovação (`PAYMENT_CONFIRMED`), o riSZon lê o líquido de cada parcela e confere com a tarifa vigente naquele dia;
  - se o split enviado foi calculado com outra tarifa, o riSZon corrige o split do parcelamento inteiro (`PUT /installments/{id}/splits`). O sandbox aceitou essa troca **depois** do cartão aprovado.
  - **Exceção:** a parcela já antecipada, porque o Asaas não deixa mudar o split depois da antecipação. Aí vale a regra da antecipação, abaixo.

**Prova no sandbox da troca do split** (`scripts/asaas-prova-split-parcelamento-aberto-sandbox.mjs`; pagador sem contato, nada enviado; estornado e apagado):

| Passo | Resultado |
|---|---|
| Parcelamento 3× R$ 300 sem cartão, split 17,6147% + R$ 0,02 (tarifa cheia) | as 3 parcelas com esse split; repasse calculado R$ 17,16 (acima dos 17%: o líquido já era o da promoção) |
| `PUT /installments/{id}/splits` com 17,4341% + R$ 0,02 (promoção) | aceito; **as 3 parcelas** mudaram; repasse R$ 16,99 cada |
| `PUT /payments/{id}` só na 3ª parcela | aceito; só a 3ª mudou |
| Cartão aprovado | o split que valeu em cada parcela foi o último enviado |
| `PUT /installments/{id}/splits` depois de aprovado | aceito |

O líquido mostrado antes do pagamento (R$ 97,35) já era o da tarifa vigente, e ficou o mesmo depois da aprovação. O fim da promoção entre a criação e a aprovação não dá para provar no sandbox. Por isso, a conferência é feita na aprovação, como acima.

**4a. Prova com envio real:** autorizada. O resultado está na 19.21.

**Antecipação (aprovada):**
- A diferença vira **"a cobrar da unidade"**. É a **única exceção** à regra de a taxa sair sempre do split.
- **Aviso na Central,** na unidade com antecipação ligada: o que muda (a franqueadora recebe menos no split, e a diferença vira conta a pagar) e **quanto custa a mais**, com um exemplo pela taxa de antecipação da conta.
- Continuo tentando provar no sandbox **quando** o split da parcela antecipada sai.

**Pendências registradas:**
- Recusa do cartão **pelo banco**: não provada no sandbox. Entrou na lista da homologação (ASA7) em `docs/asaas/ESTADO.md`.
- As perguntas ao Asaas estão numa lista só, em 19.22.

### 19.21 Prova com envio real do cartão parcelado (14/11/2026, com o "pode" do Jeferson)

**Script:** `scripts/asaas-prova-envio-parcelado-sandbox.mjs`.
- **O ensaio antes,** sem criar cobrança nem enviar nada: o cadastro sem celular nem telefone, e só "cobrança criada" e "pagamento" ligados, só por e-mail ao pagador. Nenhum aviso para a conta.
- **O disparo,** às **22:42:39** de Brasília, na conta de teste de Londrina:
  - um pagador com só o e-mail do Jeferson;
  - um parcelamento **3× de R$ 15,00** criado sem cartão, como o do link da fatura;
  - pago pela API às **22:43:06**, com o cartão de teste do Asaas. O e-mail do titular do cartão é `@example.com`.

**Medido:**
- **As 3 parcelas,** de R$ 5,00, ficaram confirmadas na hora. O líquido de cada uma foi de R$ 4,72, **igual à regra da 19.19.2 sem mensageria** (R$ 0,12 + R$ 0,16 de tarifa).
- **Os lançamentos da conta** (`GET /financialTransactions`, novembro inteiro, 56 lançamentos) **não têm nenhuma tarifa de mensageria**: nem desta prova, nem da prova de envio da 19.16. Os únicos tipos são `PAYMENT_FEE`, `PAYMENT_RECEIVED`, `PAYMENT_REVERSAL`, `REFUND_REQUEST_FEE` e as transferências internas.
- **Conclusão: o sandbox não cobra mensageria.** Não dá para saber, por ele, se ela sai por parcela ou por parcelamento, nem se entra no líquido do split. Vale a 19.19.3: até a resposta do Asaas (19.22, pergunta 1), o cartão parcelado usa o **cadastro sem avisos**, o link vai uma vez por quem fechou a venda, e o comprovante ao paciente é o do riSZon.
- **E-mails recebidos pelo Jeferson (informado por ele):** **1** e-mail de "cobrança criada", que mostra o parcelamento inteiro (3× R$ 5,00), e **1** de "pagamento confirmado". Nenhum SMS, WhatsApp ou e-mail de estorno.
  - **O aviso do Asaas sai uma vez por parcelamento, não por parcela.** Isso responde a antiga pergunta 2, que saiu da 19.22.
  - O cadastro sem avisos continua no cartão parcelado até a resposta sobre a mensageria (19.22, pergunta 1). Se a mensageria também sair uma vez, o parcelado pode voltar ao cadastro normal, com a régua da unidade, com a aprovação do Jeferson.

**Limpeza (22:50:02, depois da contagem):** os avisos do cadastro foram desligados antes do estorno. Depois as 3 parcelas foram estornadas (REFUNDED) e o cadastro removido.

### 19.22 Perguntas ao Asaas (lista única, pronta para enviar)

**Lista completa e atualizada (15/11/2026):** `docs/asaas/perguntas-ao-asaas.txt`, com **20 perguntas** (1 a 15 para a equipe de integrações, 16 a 20 para o gerente de contas), cada uma com o contexto em uma linha. **Enviada pelo Jeferson** depois de corrigi-la:
- as unidades são **contas vinculadas** (conta própria no CNPJ da unidade, operada pela chave de API com autorização do franqueado), e não subcontas;
- acrescentou a pergunta 15, **split em assinatura**: dá para alterar o split de uma assinatura ativa e das cobranças já geradas e ainda não pagas?;
- a pergunta das subcontas (17) passou a ser sobre o futuro: abrir as contas das novas unidades como subcontas, mesmo com CNPJ e titular diferentes.
- Juntou as 8 perguntas abaixo e as outras que estavam espalhadas na especificação:
  - a mensageria nas cobranças avulsas (18.6);
  - o cartão de débito na fatura (18.6);
  - a F2 (19.12);
  - o limite diário da produção (19.5 e 19.15);
  - o token e o IP do cartão recorrente (ASA4B);
  - as perguntas ao gerente de contas (13.3).
- O split na contestação (13.3 e 18.6) entrou na pergunta 5 da lista.
- A tarifa de "Boleto pago" (F6) entrou na pergunta 18, mas o Jeferson vai lê-la no painel.
- **Numeração nova:** a lista de baixo é a antiga. Vale a numeração do arquivo.

**A lista antiga (as 8 perguntas da entrega 2 e da 1B):**

1. **Mensageria no parcelamento.** No parcelamento no cartão de crédito (`installmentCount`), a tarifa de mensageria (e-mail/SMS, R$ 0,99) é cobrada **uma vez por parcelamento ou em cada parcela**? Ela é descontada do `netValue` da parcela, e por isso entra na base do split, ou sai à parte do saldo da conta? Quando é cobrada: na confirmação do cartão ou no crédito de cada parcela?
2. **Split na antecipação.** Numa parcela de cartão parcelado com split, antecipada (automática ou pedida), o split é creditado na carteira de destino **no dia da antecipação ou na data original de crédito**? O `estimatedCreditDate`/`creditDate` da cobrança muda? Qual evento avisa a liquidação do split nesse caso?
3. **Contestação no parcelamento.** Num parcelamento no cartão, a contestação (chargeback) vem **por parcela ou pelo parcelamento inteiro**?
4. **Split na contestação.** Se o titular ganha a contestação, o Asaas **reverte o split já creditado** na carteira de destino (como no estorno) ou debita tudo da conta emissora? E nas parcelas ainda não creditadas, o split agendado é cancelado?
5. **Estorno de parcelamento com parcelas já creditadas.** No `POST /installments/{id}/refund` de um parcelamento com parte das parcelas já creditadas, de qual saldo sai o valor (da conta emissora inteiro, ou proporcional ao que cada carteira recebeu)? O que acontece se a conta emissora não tiver saldo? Há prazo máximo para estornar uma compra no cartão?
6. **Tentativas no link.** Na fatura de um parcelamento no cartão, depois de uma recusa do banco emissor, o pagador pode tentar de novo no mesmo link? Há limite de tentativas? A recusa gera alguma tarifa?
7. **Tarifa na aprovação.** A tarifa do cartão parcelado (percentual da faixa + parte fixa rateada) é calculada pela tabela vigente **no dia da aprovação** do cartão, mesmo que a cobrança tenha sido criada antes, durante uma promoção?
8. **Boleto removido e pago.** Depois do `DELETE /v3/payments/{id}` de um boleto, o Asaas faz a baixa dele no banco (CIP)? Em quanto tempo o código de barras deixa de ser pagável? Se o pagador pagar mesmo assim (código de barras ou QR Code Pix do boleto), o valor é creditado na conta? A cobrança volta (`PAYMENT_RESTORED`) e chega `PAYMENT_RECEIVED` com a mesma `externalReference`? *(acrescentada em 15/11/2026, 19.27)*

### 19.23 Construção da entrega 2, parte 1 (4013), em 14/11/2026

**Prova antes de desenhar: a referência de cada parcela** (`scripts/asaas-prova-referencia-parcelas-sandbox.mjs`; pagador sem contato, nada enviado):
- a referência (`externalReference`) do POST vai para **todas** as parcelas;
- cada parcela aceita a **sua** referência (`PUT /payments/{id}`), e o parcelamento continua o mesmo, com o split em cada parcela;
- depois do cartão aprovado, cada parcela **mantém** a sua referência.
- **Por isso o desenho é uma cobrança do riSZon por parcela,** cada uma ligada à sua parcela no Asaas e agrupadas por `charges.installment_block`. O aviso, a baixa, a tarifa e o split de hoje valem parcela a parcela, sem mudar o recebimento dos avisos.
- ⚠️ **Sandbox:** com parcelas de R$ 10, o cartão de teste foi recusado várias vezes ("Transação não autorizada"), com e sem a troca da referência; com R$ 100, aprovou. As provas usam valores maiores.

**O que a 4013 faz:**
1. **O meio `cartao_parcelado_asaas`:**
   - entra nas regras de meio de `direct_sales`, `payment_installments` e `plan_negotiations`;
   - a venda direta nova sempre o aceita;
   - a parcela do bloco **não vira cobrança sozinha** (`USE_O_PARCELAMENTO`) e não aceita baixa à mão (`PARCELADO_ASAAS_SO_PELO_ASAAS`);
   - as portas por parcela do cancelar e do estornar recusam a parcela do bloco.
2. **O bloco:**
   - `_card_block_check` confere o que o Asaas faz: 2 a 21 parcelas, 1º vencimento até o dia 28, mês a mês, valores iguais com a sobra na última. Roda dentro de `apply_settlement_projection`, ao salvar o parcelamento da venda direta ou do contrato.
   - A previsão de crédito é o vencimento + 30 dias; a data certa vem do Asaas na aprovação.
3. **Nasce inteiro:**
   - `_card_blocks_due` lista a venda marcada na assinatura (a marca da entrega 1), sem prazo;
   - `_card_block_prepare_system` (servidor) e `charge_block_prepare` (à mão, a mesma permissão da emissão por parcela) criam as cobranças do bloco, uma por parcela;
   - o valor é o devido em dia, sem desconto, multa nem juros;
   - `charge_block_retry` é o "Tentar de novo".
4. **O servidor** (`src/lib/asaas/parcelamento.ts`):
   - **o cadastro do pagador:** cadastro **sem avisos** do parcelamento (referência `riszon-parcelado:<bloco>`; a busca pelo CPF da régua o ignora);
   - **a criação:** o split pelo Método B com a parte fixa rateada; o parcelamento (`installmentCount` + `totalValue`), com a referência do bloco; tempo esgotado leva a nova consulta, nunca a repetir o POST;
   - **a gravação:** a conferência de cada parcela (valor e vencimento); a troca da referência de cada parcela pela da sua cobrança; o split e a emissão de cada uma;
   - **cancelar e estornar inteiro:** `DELETE /installments/{id}` e `POST /installments/{id}/refund`.
5. **A baixa:**
   - `_gateway_on_paid` grava a baixa como `cartao_parcelado`;
   - `_gateway_apply_fee` grava a tarifa como `credito_parcelado`;
   - a 1ª parcela fecha a venda.
6. **O split:**
   - `_charge_split_plan` manda o número de parcelas e a faixa;
   - `_charge_split_inputs` e `split.ts` usam a faixa do parcelado e b ÷ n.
7. **A taxa a reter:**
   - `_split_charge_awaiting` marca a taxa como a reter quando o split da parcela está agendado (enviado ou bloqueado) e sem valor liquidado;
   - `network_fee_summary` ganhou `awaiting_cents`; Taxas da rede mostra "a reter pelo split".
8. **As telas e o estorno:**
   - `card_block_fee_table` dá a tabela do custo no fechamento: venda direta e contrato (`components/commercial/custo-do-parcelado.tsx`);
   - `_card_block_summary` e o bloco do parcelamento nas Cobranças da venda (`components/commercial/parcelamento-da-venda.tsx`): um link só, gerar, tentar de novo, cancelar e estornar;
   - `card_block_refund_preview` mostra o que a unidade perde antes do estorno;
   - a chave da maquininha está na **Central › Rede › Comercial** (`sale_method_settings_set`, só o Admin Master, na auditoria).

**Provas:**
- **Ensaio no treino** em transação desfeita (`scripts/asaas-ensaio-asa4-entrega2.mjs --confirmar`): **34/34**.
- **Provado quebrando:**

  | Modo | Resultado |
  |---|---|
  | `--quebrar=bloco` | 3 falhas |
  | `--quebrar=parcela` | 5 falhas |
  | `--quebrar=areter` | 3 falhas |

- **Ponta a ponta no sandbox** (`asaas-asa4-entrega2.integracao.test.ts`, caminho real do servidor, pagador sem contato, cadastro sem avisos): **5/5**.
  - **A criação:** venda direta com entrada em Pix e 3× no cartão. A assinatura criou **4 cobranças**: a entrada e o parcelamento inteiro, com as 3 parcelas ligadas.
  - **No Asaas:** cada parcela com a referência da sua cobrança e com o split; o cadastro sem avisos, sem e-mail e sem celular.
  - **O pagamento:** com o cartão de teste. As **3 baixas chegaram sozinhas** pelo aviso do Asaas, como "cartão parcelado", com a tarifa do parcelado e 3 datas de crédito.
  - **O estorno inteiro:** as 3 parcelas ficaram estornadas. A taxa da rede ficou **mantida e devida** (R$ 17 por parcela de R$ 100, 0 retido), por isso virou a cobrar da unidade, como na regra 2a.
  - **O cancelamento:** um 2º parcelamento não pago foi cancelado inteiro.
  - **Limpeza:** as cobranças de teste foram estornadas ou canceladas no sandbox, incluindo as entradas em Pix.

**Ficou para a parte 2 (migração 4014):**
- a devolução por Pix registrada com o distrato ou termo anexado e a autorização (1a);
- a contestação com o prazo e o aviso repetido 2 dias úteis antes. Hoje a parcela já fica "em contestação" e o aviso sai (4005), mas sem o prazo;
- o aviso de antecipação ligada na Central;
- o aviso do link vencido a cada 7 dias (3a);
- a correção do split na aprovação pela tarifa do dia (`PUT /installments/{id}/splits`).
  - Até lá, a fila da virada do dia atualiza o split parcela a parcela (`PUT /payments/{id}`, provado) enquanto o parcelamento está em aberto.

**A nova numeração** (a entrega 2 ficou com duas migrações, 4013 e 4014; as seguintes andam um número):

| Entrega | Migração |
|---|---|
| 1B | 4015 |
| 1C | 4016 |
| Renegociação | 4017 |
| Mensalidades | 4018 |
| Reemissão | 4019 |
| Distrato | 4020 |

### 19.24 Construção da entrega 2, parte 2 (4014), em 15/11/2026

**O que a 4014 faz:**
1. **A devolução por Pix (1a):**
   - tabela `card_block_returns`; pasta privada `devolucoes` (ver e enviar: quem cuida das contas a pagar da unidade, o Financeiro e o Admin; apagar: ninguém);
   - **pedir:** `card_block_return_request` (Gerente, Financeiro ou Admin):
     - só no parcelamento pago;
     - o valor até o pago menos o já pedido ou autorizado;
     - o motivo;
     - o **termo assinado obrigatório**, conferido na pasta e da mesma unidade;
     - avisa o Financeiro e o Admin;
   - **decidir:** `card_block_return_decide` (só o Financeiro da Franqueadora ou o Admin Master):
     - autorizada vira conta a pagar 1.9.03, aberta, para pagar pelo Pix da unidade com o comprovante;
     - negada exige o motivo;
     - avisa quem pediu;
   - o parcelamento continua pago e a taxa da rede continua devida.
2. **A contestação com prazo:**
   - colunas `chargeback_deadline`, `chargeback_status` e `chargeback_checked_at`;
   - o servidor (`conferirContestacoes`) lê `GET /payments/{id}/chargeback` → `deadlineToSendDisputeDocuments`;
   - `chargeback_alerts_run` avisa uma vez por parcelamento: Gerente, quem fechou a venda, Financeiro e Admin. Avisa quando chega e 2 dias úteis antes do prazo.
3. **O link vencido:** `card_block_overdue_alerts_run` avisa quem fechou a venda e o Gerente no dia útil seguinte ao 1º vencimento e de 7 em 7 dias. Não cancela sozinho.
4. **O split na aprovação:**
   - `_card_blocks_split_to_check` lista os parcelamentos aprovados, ainda não conferidos e sem split liquidado;
   - o servidor (`conferirSplitDosParcelamentos`) refaz o split pela tarifa **do dia da aprovação**. Se for diferente do enviado, troca o split do parcelamento inteiro (`PUT /installments/{id}/splits`) e grava em cada parcela;
   - `split_checked_at` marca o parcelamento conferido.
5. **As telas:**
   - Cobranças da venda: a devolução (pedir com o anexo, autorizar ou negar, abrir o termo) e o prazo da contestação;
   - Central › Conta e tarifas: o aviso da antecipação ligada, com o que muda e o exemplo de custo.
6. **A rotina de 10 em 10 minutos** (`api/cron/gateway-regua`) roda o split na aprovação, a leitura das contestações e os dois avisos.

**Provas:**
- **Ensaio no treino** em transação desfeita (`scripts/asaas-ensaio-asa4-entrega2-parte2.mjs --confirmar`): **31/31**.
- **Provado quebrando:**

  | Modo | Resultado |
  |---|---|
  | `--quebrar=termo` | 7 falhas |
  | `--quebrar=autoriza` | 2 falhas |
  | `--quebrar=aviso` | 6 falhas |

- **Sandbox, pelo caminho real do servidor** (`asaas-asa4-entrega2-parte2.integracao.test.ts`, pagador sem contato): **2/2**.
  - **O split:** parcelamento emitido com a tarifa cheia (17,6147%) e aprovado na promoção. A conferência trocou o split das 3 parcelas no Asaas para 17,4341% e gravou no riSZon; rodar de novo não mexe.
  - **A contestação:** a leitura não quebra.
  - **Limpeza:** o parcelamento estornado no fim.
- **O que o sandbox não deixa provar:**
  - **A antecipação** (`scripts/asaas-prova-antecipacao-parcelado-sandbox.mjs`): o Asaas recusou a simulação e o pedido, porque a conta de teste não é aprovada para antecipar (`cannotAnticipate`). A pergunta 2 da 19.22 continua.
  - **A contestação:** o sandbox não simula. O prazo real só aparece na homologação (ASA7).

### 19.25 Entrega 1B — forma 2, "Todos os boletos agora": PLANO (15/11/2026; APROVADO com os pontos da 19.26; migração 4015)

**O que já estava aprovado:** o acréscimo A da 19.9, o cadastro do carnê (19.10 item 2, provado em 19.16) e a página com a lista (19.10 item 3).

**O que conferi antes de escrever:**
- **A fatura** (`invoiceUrl`) abre **sem login** no sandbox: HTML, 200.
- **O PDF do boleto** (`bankSlipUrl`) falhou no sandbox: 504 em 4 tentativas, durante cerca de 80 segundos (`scripts/asaas-prova-pdf-do-boleto-sandbox.mjs`). É a mesma instabilidade do QR do Pix (19.18). **Não dá para provar o "Baixar todos em PDF" agora.**
- **Seus textos da tela de 14/11** estão guardados e entram como estão.

**1. A escolha no fechamento:**
- Aparece quando a venda tem parcelas em **boleto** e a unidade está ligada em Cobranças automáticas.
- Vale no contrato (Fechamento) e na venda direta nova.
- **Forma 1, "Um boleto por mês"**, é o padrão: a entrega 1, como hoje.
- **Quem escolhe:** quem fechou a venda, o Gerente da unidade, o Financeiro da Franqueadora e o Admin Master. A escolha fica na auditoria.
- **Os textos** são os seus, para quem fecha e para o cliente, com o prazo da rede no lugar dos "15 dias".

**2. A emissão da forma 2:**
- Na assinatura, ou na hora da escolha se já assinado, nascem **todos os boletos em aberto** da venda.
- **O cadastro do carnê:** os boletos nascem num cadastro próprio no Asaas, o **cadastro do carnê**, um por pagador e por conta.
  - Nele, o "cobrança criada" fica **desligado para sempre**.
  - Os outros avisos (lembretes, aviso do dia, vencida e confirmação de pagamento) seguem a régua da unidade, com o mesmo contato do cadastro principal.
  - Quando a régua ou o contato do pagador mudam, a fila da régua aplica nos dois cadastros.
- **O cadastro principal** continua intocado: as outras vendas do pagador seguem normais.
- **A busca pelo CPF** ignora o cadastro do carnê, como já ignora o do cartão parcelado.
- **Pix e cartão da mesma venda** continuam na forma 1, pelo prazo.

**3. O limite diário:** cada boleto conta no limite. O que passar sai na rodada seguinte, sozinho, e a tela diz "N boletos saem amanhã (limite diário)".

**4. A entrega ao cliente, numa mensagem só:**
- **A página da lista** no riSZon:
  - **O endereço:** impossível de adivinhar (só o resumo do código fica gravado). Expira **5 dias depois do último vencimento**.
  - **O conteúdo:** só o primeiro nome do paciente e, para cada boleto, vencimento, valor, situação (a pagar, pago, vencido), **Abrir boleto** (a fatura do Asaas) e a linha digitável com "Copiar".
  - **Nunca mostra** CPF, endereço nem outra venda.
- **Nas Cobranças da venda,** quem fechou a venda tem:
  - **Copiar link da lista** e **WhatsApp**, com a mensagem pronta;
  - **Gerar novo link**, que invalida o anterior.
- **O envio fica registrado**, e cada boleto mostra "Na lista enviada por Fulano em…".
- **"Baixar todos em PDF":** fica **fora** até o PDF do boleto abrir sem login, no sandbox ou na homologação (ASA7).

**5. Trocar de forma** (as mesmas pessoas, com confirmação, na auditoria):
- **De 1 para 2:** emite pelo cadastro do carnê os boletos que faltam. Os já emitidos continuam onde estão.
- **De 2 para 1:**
  - cancela no Asaas os boletos **não pagos que vencem fora do prazo**;
  - os que vencem dentro do prazo ficam; a rotina recria os outros, um por mês, com o aviso de criação;
  - esse cancelamento não conta como "cancelado à mão";
  - a confirmação diz quantos serão cancelados.

**6. As Cobranças da venda e o painel:**
- **Cobranças da venda:** mostram a forma escolhida, a lista e o link.
- **A lista de pendências** (Financeiro → Cobranças automáticas): aponta o boleto da forma 2 que ficou para depois, com o motivo (limite diário, erro do Asaas…).

**7. As provas:**
- **Ensaio no treino**, provado quebrando: a escolha e quem pode; os 12 boletos de um contrato de 12 parcelas no cadastro do carnê; Pix e cartão fora; o limite diário deixando o resto para o dia seguinte; a troca de 2 para 1 cancelando só os de fora do prazo, sem marcar "à mão"; a página expirando e o link novo invalidando o antigo.
- **Ponta a ponta no sandbox,** sem envio (pagador sem contato):
  - 12 boletos no cadastro do carnê, com o "cobrança criada" desligado nele;
  - o cadastro principal intocado;
  - a página com os 12;
  - a troca de 2 para 1;
  - no fim, tudo cancelado.
- **Prova com envio real:** a do carnê já foi feita e aceita (19.16). Se você quiser, repito com 12 boletos para o seu e-mail, com a janela de 30 minutos completa. **Proposta: não repetir.**

**Decisões pedidas ao Jeferson:**
1. **De 2 para 1:** cancelar só os boletos **fora do prazo** (recomendado: não cancela e recria o que já vence logo)? Ou **todos os não pagos**, e os do prazo renascem com o aviso de criação?
2. **"Baixar todos em PDF"** fica fora até o PDF do boleto abrir sem login (recomendado)?
3. **A página expira 5 dias depois do último vencimento**, e "Gerar novo link" invalida o anterior?
4. **A forma 2 só para venda com a unidade ligada** (automática; recomendado)? Para a venda assinada antes de ligar, continua o botão manual por parcela.
5. **A prova com envio real de 12 boletos:** não repetir (recomendado), ou repetir com a janela de 30 minutos?

### 19.26 APROVAÇÃO da 1B e os pontos acrescentados (Jeferson, 15/11/2026)

**Aprovado o plano da 19.25,** com as cinco recomendações: 1a, 2a, 3a, 4a e 5a. Os pontos abaixo **valem por cima** da 19.25.

#### 19.26.1 Boleto que deixa de valer depois de entregue ao cliente

**A regra:**
- nenhum boleto de parcela que mudou ou deixou de existir continua pagável;
- o boleto é cancelado no Asaas **na mesma operação**, e, quando a parcela continua existindo com outro valor ou data, um boleto novo é emitido;
- a página da lista mostra a situação nova;
- quem fechou a venda e o Gerente recebem aviso para reenviar o link.

**O que já existe e segura tudo (4004):** enquanto a parcela tem cobrança viva no Asaas, o banco **recusa**:
- mudar o valor, o vencimento, o meio ou o pagador;
- cancelar, renegociar ou apagar a parcela (`payment_installments_charge_lock`, erro `CHARGE_ACTIVE`);
- dar baixa à mão (`payment_receipts_charge_lock`, erro `CHARGE_IN_GATEWAY`).

Ou seja: hoje nada muda com o boleto vivo; a operação é recusada. O que a 1B acrescenta é **cancelar no Asaas dentro da própria operação**, em vez de obrigar a cancelar antes, à mão.

**Caso a caso:**

| Caso | Hoje | Na 1B (a mesma operação) | A página da lista |
|---|---|---|---|
| **Renegociação** (o fechamento põe as parcelas como "renegociada") | recusado (`CHARGE_ACTIVE`) | o fechamento da renegociação cancela no Asaas os boletos em aberto das parcelas renegociadas e depois fecha. As parcelas novas seguem a forma 1 | o boleto fica "Substituído pela renegociação — não pague" |
| **Distrato** (hoje, o Cancelamento do plano; o distrato completo é da entrega 6) | recusado (`CHARGE_ACTIVE`) | aplicar o cancelamento cancela no Asaas os boletos em aberto e depois cancela as parcelas | "Cancelado — não pague este boleto" |
| **Quitação antecipada** | não há porta própria: ou o paciente paga os boletos antes do vencimento (o boleto vale; nada muda), ou a quitação é feita pela renegociação à vista | o primeiro jeito não muda nada; o segundo é o caso da renegociação | paga, ou substituída pela renegociação |
| **Dinheiro no balcão** | já cancela no Asaas antes da baixa (4011); se o boleto já foi pago lá, a baixa é recusada | o mesmo; no pagamento parcial, o boleto do **restante** nasce na hora pelo cadastro do carnê | "Pago no balcão"; o restante aparece com o boleto novo |
| **Permuta** | recusado (`CHARGE_IN_GATEWAY`) | a baixa em permuta (Gerente ou Admin) cancela no Asaas antes, como o dinheiro | "Pago (permuta)" |
| **Troca de vencimento ou de valor** (o "Personalizar" do parcelamento, que apaga e recria as parcelas; depois de qualquer baixa, só pela renegociação) | recusado (`CHARGE_ACTIVE`) | salvar o parcelamento novo cancela no Asaas os boletos em aberto da venda, salva, e a forma 2 emite os boletos novos pelo cadastro do carnê | o **mesmo link**, com os boletos novos; os antigos somem da lista |
| **Quitação por valor menor** (Gerente ou Admin) | recusado (`CHARGE_IN_GATEWAY`) | cancela no Asaas antes de dar a baixa | "Quitado por valor menor" |

**Na ordem segura:**
- **Primeiro cancela no Asaas, depois muda o riSZon.** Se o Asaas disser que o boleto já foi pago, nada muda, e a tela explica.
- Se o cancelamento passar e a mudança do riSZon falhar, o boleto já está cancelado (não pagável), e a parcela fica sem cobrança com o motivo na lista de pendências.
- Esses cancelamentos levam o motivo da operação ("renegociação", "cancelamento do plano", "parcelamento alterado", "dinheiro", "permuta", "valor menor") e **não contam como "cancelado à mão"**.

**O aviso de reenvio:** quando a lista muda (boleto cancelado, substituído ou novo), quem fechou a venda e o Gerente recebem "A lista de boletos de Fulano mudou: reenvie o link". É um aviso por lista por dia.

**O ensaio no treino, provado quebrando**, em cada um dos 6 casos:
- a operação com o boleto vivo é recusada;
- com o cancelamento na mesma operação, ela passa, e o boleto fica cancelado e fora da lista como pagável;
- o aviso de reenvio sai uma vez;
- **quebrando a trava:** com a trava tirada (`--quebrar=trava`), a operação passa com o boleto vivo, e o ensaio tem de reprovar.

#### 19.26.2 Split dos boletos futuros

**A rotina diária do split cobre todos os boletos em aberto da forma 2.**
- A virada do dia (`gateway-split-diario`, 00:05) põe na fila toda cobrança **emitida ou vencida** cujas entradas do split mudam no dia (`_charge_split_inputs`: a tarifa vigente sai da janela quando `valid_to` passa).
- A fila aplica no Asaas por `PUT /payments/{id}`, com 150 por conta a cada 10 minutos.
- O 2º disparo pelo banco e o vigia valem para ela (entrega 1).

**A conta, num boleto de R$ 500,00 da forma 2 que vence em 20/03/2027:**
- **Tarifa em Londrina:** R$ 0,99 até 10/02/2027 e R$ 1,99 a partir de 11/02/2027. Taxas da rede: 17%.

| Momento | Tarifa na janela | Split enviado | Se pago nesse período | A franqueadora recebe | 17% de R$ 500 | Diferença |
|---|---|---|---|---|---|---|
| Emitido em 15/11/2026 | de R$ 0,99 a R$ 1,99 (vale a menor, 18.2) | 17% + R$ 0,16 | até 10/02 (tarifa R$ 0,99; líquido R$ 499,01) | R$ 84,83 + R$ 0,16 = R$ 84,99 | R$ 85,00 | R$ 0,01 |
| 11/02/2027, a virada do dia refaz | só R$ 1,99 | 17% + R$ 0,33 | em 20/03 (tarifa R$ 1,99; líquido R$ 498,01) | R$ 84,66 + R$ 0,33 = R$ 84,99 | R$ 85,00 | R$ 0,01 |
| Se a virada **não** rodar | — | ficou 17% + R$ 0,16 | em 20/03 | R$ 84,66 + R$ 0,16 = R$ 84,82 | R$ 85,00 | R$ 0,18 |

- **Se a virada não rodar,** a diferença passa da tolerância de R$ 0,10 e vira **a cobrar da unidade** (S5).
- O vigia avisa no mesmo dia que a rotina não rodou, e a rodada seguinte corrige os boletos ainda não pagos.
- O ensaio da 1B prova que os 12 boletos de um contrato entram na fila da virada.

#### 19.26.3 Segurança da página da lista

| Item | Como fica | Estava na 19.25? |
|---|---|---|
| Link impossível de adivinhar | 32 bytes aleatórios (256 bits) no endereço; o banco grava **só o resumo** (SHA-256), nunca o código | sim |
| Pode ser revogado | **Revogar** e **Gerar novo link** (o anterior para na hora), por quem fechou a venda, o Gerente, o Financeiro e o Admin, na auditoria; expira sozinho 5 dias depois do último vencimento | sim (o "Revogar" sozinho é novo) |
| Cada acesso registrado | data e hora de cada abertura, com o resumo do IP (nunca o IP aberto) e o navegador abreviado. Quem fechou a venda vê "Lista aberta em…" | **novo** |
| Limite de tentativas | endereço errado: 20 por hora por IP, depois a página recusa (429). Endereço certo: 60 aberturas por hora, depois recusa até a hora seguinte | **novo** |
| Fora dos buscadores | `noindex, nofollow` na página e no cabeçalho (`X-Robots-Tag`), `/boletos/` fora do `robots.txt`, sem cache (`no-store`) e sem o endereço passado a outros sites (`Referrer-Policy: no-referrer`) | **novo** |
| Só os dados mínimos | primeiro nome, vencimento, valor, situação, "Abrir boleto" e linha digitável. Sem CPF, sem sobrenome, sem endereço, sem outra venda | sim |

- **Um cuidado que não depende do riSZon:** o "Abrir boleto" abre a fatura do **Asaas**, e ela mostra os dados do pagador que o boleto exige. É o mesmo que acontece hoje, quando o link vai sozinho.

#### 19.26.4 Avisos e contato

- **"Não abriu até 1 dia útil antes do vencimento",** na forma 2: conta **qualquer um dos dois**, o acesso à página da lista **ou** a abertura de uma fatura (o aviso `PAYMENT_CHECKOUT_VIEWED`/`PAYMENT_BANK_SLIP_VIEWED` do Asaas), para o 1º boleto que vence.
  - **Proposta:** os dois, porque o paciente pode abrir o boleto direto do link guardado.
  - Sem nenhum dos dois, quem fechou a venda recebe o aviso para reenviar.
- **Mudança de e-mail ou celular do pagador:** a fila da régua aplica no **cadastro principal e no do carnê**, no mesmo item, com o mesmo contato. No carnê, o "cobrança criada" continua desligado. Provado no ensaio (os dois na fila) e no sandbox (os dois com o contato novo).
- **Unidade com a régua desligada:**
  - o cadastro do carnê fica como o principal: sem contato e sem avisos;
  - **o primeiro envio do link é sempre de quem fechou a venda.** Na forma 2 isso vale com a régua ligada também, porque o Asaas nunca manda o aviso de criação;
  - **os alertas já aprovados valem para a lista:** 1 dia útil sem envio, aviso para quem fechou a venda; faltando 2 dias úteis para o 1º vencimento sem envio, também o Gerente;
  - o envio da lista conta como envio de cada boleto dela.

#### 19.26.5 A prova do cadastro do carnê (com envio real)

**Foi feita com envio real** (19.16):

| | |
|---|---|
| Data | **14/11/2026** |
| Disparo | 18:24:44, com o seu "pode" |
| Conta | sandbox de Londrina, só para o seu e-mail, sem celular |
| Saiu | **1 e-mail**: a "nova cobrança" de **R$ 5,00** (o controle, com o aviso ligado). Você confirmou "só o de R$ 5,00" |
| Não saiu | nenhum dos **3** do cadastro do carnê (**R$ 5,01, R$ 5,02 e R$ 5,03**) |
| Limpeza | 18:26:43 |

- **Conferência do Jeferson em 15/11/2026,** mais de 7 horas depois do disparo, incluindo o spam: **nenhum dos 3 e-mails do carnê** (R$ 5,01, R$ 5,02 e R$ 5,03) chegou. **A prova vale e não precisa repetir** (19.27).
- A decisão 5 continua (a).

#### 19.26.6 "Baixar todos em PDF"

Fica fora da 1B. O teste do PDF do boleto sem login entrou na lista da homologação (ASA7), em `docs/asaas/ESTADO.md`.

### 19.27 APROVAÇÃO da 19.26 e a construção da 1B (4015), em 15/11/2026

**Aprovado pelo Jeferson (15/11/2026):** a 19.26, com três pontos que entram na especificação e na construção, sem novo plano.

**1. Falha no meio da operação.**
- Se o boleto foi cancelado no Asaas e a mudança no riSZon falhou, a parcela **não fica sem boleto em silêncio**:
  - vira uma **operação interrompida** (`boleto_op_failures`);
  - **avisa quem fez e o Gerente** da unidade;
  - aparece em **Financeiro › Cobranças automáticas** com **Reemitir os boletos** e **Marcar como concluída** (com a nota do que foi feito);
  - nas Cobranças da venda, um aviso aponta para lá.
- O cancelamento da operação não conta como "à mão": a parcela que continua existindo volta à rotina, e a reemissão recria o boleto.

**2. O pagamento de um boleto que o riSZon cancelou.**
- **O que o Asaas faz:** a documentação **não diz**. Ela não fala em baixa no banco ao excluir, em pagamento depois da exclusão, em crédito na conta, nem em que aviso chega.
  - Ela só diz que a exclusão serve para a cobrança que não deve mais ficar disponível para pagamento, que a exclusão não manda `PAYMENT_BANK_SLIP_CANCELLED` e que existe a restauração (`PAYMENT_RESTORED`).
  - A pergunta foi para a lista (19.22, pergunta 8).
- **O que o riSZon faz hoje (desde a 4005):** um aviso de pagamento numa cobrança cancelada **não dá baixa**. O valor fica guardado como **pagamento em duplicidade** (`gateway_payment_surpluses`, motivo `cobranca_cancelada`), e a ficha oferece "abater em outra parcela" ou "devolvido".
- **Na 4015, o alerta da regra:** vai para o Gerente da unidade e o Financeiro da Franqueadora. Diz o **valor**, a **parcela** (número e vencimento) e o **que fazer**: "o dinheiro está na conta da unidade e não deu baixa; abata numa parcela em aberto ou registre a devolução".
- E se o Asaas avisar que **restaurou** uma cobrança cancelada (`PAYMENT_RESTORED`), sai um alerta na hora, antes de qualquer pagamento.

**3. Confirmação antes de cancelar.**
- As operações que agora cancelam boletos sozinhas mostram antes **"Esta operação cancela N boletos já entregues ao cliente…"**:
  - a baixa em dinheiro ou permuta;
  - a quitação por valor menor;
  - a renegociação (ao salvar e ao autorizar);
  - o cancelamento do plano;
  - salvar o parcelamento de novo (vencimento ou valor);
  - a troca da forma 2 para a 1.
- Sem o "sim", nada muda.
- **As permissões não mudam:** o servidor tenta a operação primeiro, e a permissão é conferida dentro dela, antes da trava. Só a operação que passou da permissão e parou na trava chega à confirmação e ao cancelamento.

**Decisões registradas:**
- **"Não abriu":** conta o acesso à página da lista **ou** a abertura de uma fatura. O acesso à lista marca "aberta" nos boletos dela.
- **A prova do carnê vale** (19.26.5): nenhum e-mail do carnê chegou em mais de 7 horas.
- **Renegociação de venda na forma 2:** no fechamento da renegociação, a escolha da forma é oferecida de novo. **Fica para a entrega da renegociação** (4017).

**O que a 4015 faz:**
1. **A forma na venda:** `direct_sales.boleto_mode` e `plan_negotiations.boleto_mode` (`mensal`, o padrão, ou `todos`).
   - `sale_boleto_mode_set` diz quem pode escolher: quem fechou a venda, o Gerente, o Financeiro e o Admin. A troca fica na auditoria.
   - A forma 2 exige a unidade ligada e pelo menos um boleto.
   - De 2 para 1, devolve os boletos do carnê que vencem **fora do prazo** (1a).
2. **A forma 2 na rotina:**
   - `_auto_charge_due` pega todos os boletos da venda na forma 2, sem prazo;
   - `_charge_prepare_system` marca `via_carne`;
   - `_auto_charge_cancelled_by_hand` ignora o cancelamento do sistema (`cancel_system`).
3. **O cadastro do carnê:**
   - fica em `gateway_carne_customers`; `_gateway_carne_save` põe a régua do pagador na fila;
   - o servidor (`cadastroDoCarne` em `src/lib/asaas/cobranca.ts`) cria o cadastro com a referência `riszon-carne:`, sem avisos e sem contato;
   - a fila da régua (`aplicarNoAsaas`) aplica o contato e os avisos nos dois cadastros, com o "cobrança criada" sempre desligado no carnê;
   - a busca pelo CPF ignora os cadastros auxiliares (`ehCadastroAuxiliar`).
4. **A lista:**
   - as tabelas `boleto_lists`, `boleto_list_accesses` e `boleto_list_misses`;
   - as portas `boleto_list_issue` (só o resumo do código), `boleto_list_revoke`, `boleto_list_sent` (o envio conta para cada boleto) e `_boleto_list_read` (limites, validade, registro, "aberta");
   - a página `/boletos/[código]`: pública, `noindex`, `X-Robots-Tag`, `no-store` e `no-referrer`, com `/boletos/` fora do `robots.txt`.
5. **"A lista mudou":** um aviso por lista por dia, a quem fechou a venda e ao Gerente, quando um boleto da lista é cancelado ou criado.
6. **O servidor** (`src/lib/asaas/boletos-da-operacao.ts`):
   - `comBoletosCancelados` faz a tentativa, a confirmação, o cancelamento no Asaas e no riSZon, a repetição e a pendência;
   - `cancelarBoletosDoSistema` cuida da troca de forma;
   - as cinco operações passam por ele (baixa, renegociação ao salvar e ao autorizar, cancelamento do plano, parcelamento);
   - as seis telas pedem a confirmação (`src/lib/confirmar-boletos.ts`).
7. **As telas:**
   - nas Cobranças da venda, a forma, com os seus textos para quem fecha e para o cliente, e a lista: gerar ou gerar novo link (o link aparece uma vez), Copiar, WhatsApp, Revogar e "aberta N vezes";
   - em Financeiro › Cobranças automáticas, as operações interrompidas.

**Provas:**
- **Ensaio no treino** em transação desfeita (`scripts/asaas-ensaio-asa4-1b.mjs --confirmar`): **41/41**. Cobre:
  - a escolha, quem pode, a unidade desligada e a auditoria;
  - os 12 boletos sem prazo pelo carnê, com o Pix no prazo;
  - a virada do split pegando os 12;
  - o carnê pondo a régua na fila;
  - a lista: o mínimo, o acesso registrado e "aberta", o limite de 20 por IP, o link novo invalidando o antigo, a revogação e o envio contando para cada boleto;
  - os 6 casos: com o boleto vivo, recusado; depois do cancelamento da operação, passa, e a lista mostra a situação nova;
  - o "à mão" contra o do sistema;
  - o aviso de reenvio, uma vez;
  - a troca de 2 para 1, só fora do prazo;
  - a operação interrompida, com o aviso, a lista de pendências e a conclusão;
  - o boleto cancelado pago, com valor, parcela e o que fazer, para o Gerente e o Financeiro;
  - a restauração;
  - as portas fechadas.
- **Provado quebrando:**

  | Modo | Resultado |
  |---|---|
  | `--quebrar=trava` | 8 falhas |
  | `--quebrar=mao` | 1 falha |
  | `--quebrar=pendencia` | 1 falha |
  | `--quebrar=lista` | 2 falhas |

- **Sandbox, 12 boletos, pelo caminho real do servidor** (`asaas-asa4-1b.integracao.test.ts`, pagador sem contato): **4/4**.
  - a assinatura criou os 12 de uma vez, todos pelo cadastro do carnê, sem "Enviada pelo Asaas";
  - no Asaas, os 12 estão num único cadastro `riszon-carne:`, sem contato e sem o aviso de criação; o cadastro principal não tem nenhum deles;
  - a página da lista mostrou os 12, com o link e a linha digitável;
  - na troca de 2 para 1, só os de fora do prazo foram cancelados no Asaas, como cancelamento do sistema;
  - no fim, os 12 ficaram cancelados.
- **O que não foi provado no sandbox:**
  - **A limitação:** os 6 casos não passaram pela tela, porque as portas exigem a sessão de quem faz. No banco, os 6 estão provados no ensaio. No servidor, o cancelamento é o mesmo da troca de forma, que foi provado no sandbox.
  - **O teste do Jeferson** cobre esses casos pela tela (roteiro no relatório).

### 19.28 Entrega 3 — renegociação assinada pela ZapSign: PLANO (15/11/2026; migração 4017; APROVADO com ajustes em 15/11/2026: 19.28.9 e 19.28.10; a construção espera o "pode" do Jeferson)

**Pedido do Jeferson (15/11/2026):**
- pular a 1C, que fica esperando o Asaas com a 4016 reservada;
- planejar a renegociação, com a escolha da forma oferecida de novo no fechamento;
- mostrar no plano:
  - o que acontece com as taxas da rede já retidas das parcelas renegociadas;
  - como fica a parcela vencida que entra na renegociação, com multa e juros;
  - o que muda para a venda na forma 2, com a página da lista.

**O que a especificação já decidiu:**
- D15 e 19.10, entrega 2: "as cobranças antigas só são canceladas depois da assinatura do termo; as novas nascem pela mesma regra da entrega 1";
- seção 7: "Renegociação só cancela as cobranças antigas depois da assinatura do novo contrato";
- 19.26.1: a renegociação cancela no Asaas os boletos das parcelas renegociadas na mesma operação, depois da confirmação;
- 19.27: na venda na forma 2, a escolha da forma é oferecida de novo no fechamento.

#### 19.28.1 Como funciona hoje (conferido no código)

1. **Quem faz:** `save_renegotiation` (0190). Pode renegociar o Gerente da unidade, o Financeiro da Franqueadora e o Admin Master (`can_renegotiate`).
2. **O valor de partida:** para cada parcela escolhida, `installment_balance` no dia, que dá:
   - o que falta do valor;
   - o benefício perdido (o desconto de pontualidade que deixa de valer com o atraso);
   - a multa: `late_fee_percent`, 2% por padrão, sobre o valor;
   - os juros: `monthly_interest_percent`, 1% ao mês por padrão, por dia de atraso.
3. **O desconto:** a diferença entre o original e o novo total.
   - Acima do limite da rede, ou dado por quem não é Gerente, espera a autorização do Gerente (`authorize_renegotiation`).
4. **Sem autorização pendente, a renegociação é aplicada na hora** (`apply_renegotiation`):
   - as parcelas antigas ficam "renegociada";
   - as novas nascem com `renegotiation_id`;
   - o razão recebe a multa e os juros incorporados (4.1.01), o benefício perdido (1.1.01) e o desconto (1.9.02) ou o acréscimo (4.1.01).
5. **Os boletos vivos das antigas (4015):** são cancelados no Asaas nessa mesma hora, depois da confirmação.
6. **O termo:** é **impresso** (`/renegociacoes/[id]/acordo`). As etapas "acordo assinado", "cobrança emitida" e "pagamento confirmado" são marcadas à mão.
7. **As parcelas novas não ganham cobrança sozinhas:** `_auto_charge_due` ignora parcela com `renegotiation_id`.
8. **Os meios da tela de renegociação** ainda são os antigos: boleto, Pix, recorrência no cartão, cartão parcelado (maquininha) e depósito.

**Diferença entre hoje e a especificação:** hoje o boleto antigo é cancelado **antes** de o paciente assinar. A 4017 inverte isso: nada antigo é cancelado antes da assinatura.

#### 19.28.2 O fluxo novo

1. **Montar e salvar.** É a mesma tela, com as mesmas pessoas e o mesmo cálculo.
   - Com desconto acima do limite, ou dado por quem não é Gerente: a autorização do Gerente vem **antes** do envio, como hoje.
2. **"Aguardando assinatura".**
   - A renegociação ganha esse estado novo.
   - **Nada muda nas parcelas antigas:** elas continuam em aberto, e os boletos delas continuam valendo.
   - As antigas ficam presas a ela: não entram em outra renegociação (`RENEGOTIATION_PENDING`, estendido a este estado).
   - Os valores ficam **congelados no dia do salvamento** (19.28.4).
3. **O termo pela ZapSign.**
   - Modelo novo nas Assinaturas: "Termo de renegociação", tipo `renegotiation`, origem `payment_renegotiation`.
   - O texto sai do termo impresso de hoje e nasce como **texto provisório**, como os outros modelos, até a revisão do jurídico.
   - O envio é o mesmo dos contratos, com os mesmos signatários e a mesma regra de autenticação.
   - **Antes de enviar,** a tela diz: "Quando o cliente assinar, N boletos já entregues serão cancelados." Se for 0, não pergunta.
4. **Assinado (webhook da ZapSign, a mesma porta do contrato):**
   1. Primeiro, o Asaas: os boletos vivos das antigas são cancelados (`comBoletosCancelados`, motivo "renegociação"). Se algum já estiver pago, tudo para (item 6).
   2. Depois, o banco, numa transação só:
      - as antigas ficam "renegociada";
      - as novas nascem;
      - os lançamentos do razão são feitos;
      - a etapa "acordo assinado" fica marcada, com a origem "assinatura digital".
   3. Por fim, as cobranças das novas nascem pela regra da entrega 1, com a forma escolhida (19.28.5).
   - O aviso repetido da ZapSign não aplica duas vezes: a guarda é o `applied_at`, que já existe.
5. **Recusado, cancelado ou vencido na ZapSign:**
   - a renegociação fica "não assinada";
   - as antigas voltam a poder ser renegociadas;
   - nada no Asaas muda;
   - quem enviou e o Gerente recebem um aviso.
6. **O paciente paga uma parcela antiga antes de assinar:**
   - qualquer baixa numa antiga **cancela a renegociação pendente**, porque o acordo deixou de bater;
   - o termo é cancelado na ZapSign;
   - quem negociou e o Gerente recebem o aviso "O cliente pagou uma parcela da renegociação antes de assinar: refaça o acordo".
   - Se o pagamento chegar **depois** da assinatura, com o boleto já cancelado, vale o alerta da 4015 ("Pagaram um boleto que o riSZon tinha cancelado").
7. **Falha no meio** (Asaas cancelou e o banco não aplicou): vira operação interrompida, com aviso e o botão "concluir", como na 4015.
   - **Termo assinado e não aplicado é a pior situação:** o aviso diz isso com essas palavras.
8. **Sem ZapSign (exceção).** Recomendo manter o termo impresso só como exceção:
   - só o Gerente ou o Admin Master;
   - com o PDF assinado anexado, obrigatório, numa pasta privada;
   - ao anexar, o caminho é o mesmo do item 4.

#### 19.28.3 As taxas da rede das parcelas renegociadas

- **Regra de hoje (`_apply_fee_split`, 0370):** a taxa da rede nasce em cada **baixa**, sobre o valor da baixa, uma vez só por baixa.
  - Ela não depende da parcela continuar viva: renegociar não devolve nem refaz taxa de baixa já feita.
- **O que já foi pago antes da renegociação:**
  - a taxa dessas baixas fica como está: retida pelo split, se a baixa veio pelo Asaas, ou na conta a pagar da unidade, se veio fora dele;
  - essas baixas eram dinheiro recebido, e a renegociação só trata o que falta.
- **O que falta e vai para as parcelas novas:**
  - paga taxa só quando cada parcela nova for paga, sobre o valor pago;
  - com o split na origem, se for pelo Asaas, ou na conta a pagar, se for em dinheiro.
- **Nunca em dobro:** a parcela antiga renegociada não tem mais baixa, então não gera taxa. O boleto antigo cancelado não liquidou split, então não há nada a desfazer no Asaas.
- **Multa e juros incorporados pagam taxa quando recebidos.** É o mesmo que acontece hoje quando a parcela atrasada é paga com multa: a base é o valor da baixa.
- **Desconto da renegociação:** reduz a base das taxas futuras. Não devolve taxa de baixa anterior.
- **Cartão parcelado pelo Asaas:** a parcela de um bloco continua sem poder ser renegociada (4015). É preciso cancelar ou estornar o parcelamento antes. Por isso, a "taxa a reter" do parcelado nunca entra numa renegociação.

**Exemplo com as taxas de produção (17%):**

| | Parcela A | Parcela B |
|---|---|---|
| Valor | R$ 500,00 | R$ 500,00 |
| Situação em 15/11 | venceu em 15/10, 31 dias de atraso, nada pago | vence em 15/12, R$ 300,00 já pagos em dinheiro |
| Taxa já cobrada | nenhuma | 17% de 300 = **R$ 51,00**, na conta a pagar da unidade |
| Entra na renegociação | 500,00 + multa 10,00 + juros 5,17 = **515,17** | **200,00** |

- **Renegociação:** 715,17 em 3 parcelas de **R$ 238,39**.
  - Taxa de cada parcela nova, se paga: 14,30 + 4,77 + 7,15 + 14,30 = **R$ 40,52**.
  - Nas três: **R$ 121,56**.
- **Total de taxa dessa dívida:** 51,00 + 121,56 = **R$ 172,56**.
  - Sem atraso nenhum, seriam 17% de 1.000,00 = R$ 170,00.
  - A diferença de R$ 2,56 é a taxa sobre os R$ 15,17 de multa e juros, com 1 centavo de arredondamento em cada uma das 4 taxas.
- **Com desconto de R$ 15,17** (o Gerente dispensa a multa e os juros): o novo total é 700,00, a taxa das novas é R$ 119,00, e o total volta a **R$ 170,00**.

#### 19.28.4 A parcela vencida, com multa e juros

- **No salvamento,** `installment_balance` calcula, no dia:
  - **multa:** `late_fee_percent` (2% por padrão) sobre o valor da parcela, mais o benefício perdido;
  - **juros:** `monthly_interest_percent` (1% ao mês por padrão), dividido por 30, vezes os dias de atraso, descontada a carência;
  - **benefício perdido:** o desconto de pontualidade, se a parcela tinha.
- **O termo mostra cada valor separado:** valor, benefício perdido, multa, juros, desconto e o novo total. Isso já existe no termo impresso.
- **Valores congelados no dia do salvamento:**
  - entre o salvamento e a assinatura, a multa e os juros **não** crescem no acordo;
  - o termo diz "valores calculados em dd/mm/aaaa".
- **Prazo do termo** (recomendação):
  - até **5 dias corridos**, e nunca depois do 1º vencimento novo;
  - vencido o prazo, o termo é cancelado e é preciso refazer o acordo, com o cálculo do dia.
  - Assim, os juros que o acordo deixa de cobrar são no máximo os de 5 dias.
- **Enquanto espera,** a parcela antiga continua com o boleto dela, que tem a multa e os juros do Asaas (`fine` e `interest`). Se o paciente pagar esse boleto, vale o item 6 de 19.28.2.
- **No razão, na aplicação:**
  - a multa e os juros entram como receita financeira (4.1.01), como hoje;
  - o benefício perdido entra em 1.1.01;
  - o desconto, em 1.9.02;
  - os juros do parcelamento novo (Tabela Price), em 4.1.01.
- **As parcelas novas,** se atrasarem, têm multa e juros próprios, pela mesma regra de qualquer parcela. No Asaas, a cobrança nova sai com a multa e os juros dela.
- **Dispensar multa e juros** é dar desconto. A regra de autorização continua a de hoje.

#### 19.28.5 A forma dos boletos e a página da lista (decisão 3b: um link só por venda)

- **A escolha da forma:** se as parcelas novas têm boleto, o fechamento oferece de novo "Um boleto por mês" ou "Todos os boletos agora", com os mesmos textos e as mesmas pessoas da 1B.
  - Já vem marcada a forma da venda de origem.
  - Se as antigas vierem de vendas com formas diferentes, vem marcado "Um boleto por mês".
  - A escolha fica gravada na renegociação (`payment_renegotiations.boleto_mode`) e vale para as parcelas novas.
- **Forma 2 na renegociação:** na assinatura, todos os boletos novos nascem de uma vez, pelo cadastro do carnê, como na 1B.
- **A página da lista (decisão 3b): um link só por venda.**
  - **A regra:** a lista da venda passa a mostrar os boletos novos da renegociação e marca os antigos como "Substituído pela renegociação — não pague". É a mesma regra da troca de vencimento.
  - O link continua o mesmo, e sai o aviso "A lista de boletos mudou: reenvie o link".
- **Como a lista acha as parcelas novas:** hoje ela lê as parcelas pela venda (`negotiation_id` ou `direct_sale_id`), e a parcela de renegociação não tem venda. Por isso, a 4017 grava na renegociação **as vendas de origem** (`origin_negotiation_ids` e `origin_direct_sale_ids`).
  - O cálculo é feito no salvamento e segue a cadeia: a renegociação de uma renegociação herda as vendas da primeira.
  - A lista da venda lê as parcelas dela e as das renegociações que vêm dela.
- **Nenhum impedimento de segurança.** A lista continua mostrando só o primeiro nome, o valor, o vencimento, a situação e o boleto, do mesmo cliente, com o mesmo código, o mesmo limite, a mesma revogação e fora dos buscadores.
  - O prazo da lista passa a ser o último vencimento das parcelas novas mais 5 dias.
- **Um ponto técnico para você decidir: a renegociação que junta parcelas de duas vendas** do mesmo cliente.
  - **(a) recomendado:** os boletos novos aparecem na lista de cada venda de origem, e as duas recebem o aviso "A lista mudou". O cliente que guardou qualquer um dos links vê tudo, e nenhum boleto fica sem lista.
  - **(b)** aparecem só na lista da venda mais recente, e a outra mostra as antigas como substituídas.
- **A venda que não tinha lista:** a venda estava na forma 1 e a renegociação escolheu a forma 2.
  - O botão "Gerar link da lista" aparece nas Cobranças da venda, como na 1B, e quem negociou envia.
- **Forma 1 na renegociação:** os boletos novos nascem um a um, perto de cada vencimento, pela rotina da entrega 1. Se a venda tem lista, eles aparecem nela quando nascem, e as antigas aparecem como substituídas.
- **Antes da assinatura:** a lista não muda, porque nada foi cancelado.

#### 19.28.6 Os meios das parcelas novas (decisão 4a, com permuta)

- **Entram:**
  - Pix, boleto e cartão à vista, pelo Asaas;
  - cartão parcelado pelo Asaas, com as regras do bloco (2 a 21 parcelas, mês a mês, nasce inteiro na assinatura);
  - dinheiro;
  - **permuta**, com o controle da 4011:
    - só o Gerente ou o Admin Master (`_is_manager_or_admin`);
    - descrição obrigatória (`PERMUTA_DESCRIPTION_REQUIRED`);
    - não vira cobrança, e a baixa é a da permuta.
- **Ficam fora:** a recorrência no cartão (ASA4B) e o depósito.
- **A maquininha (ponto 3 abaixo):** fica na renegociação enquanto a chave da rede "maquininha na venda direta" (`sale_method_settings.card_machine_direct_sale`) estiver ligada, com o adquirente como hoje.
  - Quando o Admin Master desligar a chave, ela sai da venda direta e da renegociação ao mesmo tempo.
- **Quitação antecipada à vista** continua sendo uma renegociação de 1 parcela, por Pix ou cartão.

#### 19.28.7 O que a 4017 faz

1. **A renegociação:**
   - estados novos: "aguardando assinatura", "não assinada" (recusada ou cancelada na ZapSign), "expirada" e "cancelada pelo pagamento";
   - colunas novas:
     - `boleto_mode`;
     - `sign_deadline`, o prazo do termo;
     - `origin_negotiation_ids` e `origin_direct_sale_ids`;
     - `external_confirmed_by`, `external_confirmed_at` e a lista das cobranças externas confirmadas;
   - `save_renegotiation` deixa de aplicar na hora;
   - `apply_renegotiation` só roda com o termo assinado (webhook) ou com o PDF anexado (exceção).
2. **A ZapSign:**
   - o tipo de modelo `renegotiation`, a origem `payment_renegotiation` e o modelo provisório;
   - o prazo de assinatura do documento igual ao `sign_deadline`;
   - `signature_apply_webhook` ganha o ramo da renegociação:
     - assinado → aplica;
     - recusado ou cancelado → "não assinada";
     - vencido → "expirada".
3. **A rotina diária:** expira a renegociação vencida sem assinatura, cancela o termo na ZapSign e avisa (ponto 2).
4. **A trava:** a baixa numa parcela presa a uma renegociação pendente cancela a renegociação, cancela o termo e avisa. Antes disso, a tela da baixa pede a confirmação (ponto 2).
5. **A cobrança externa:** a confirmação do Gerente antes do envio (ponto 1), com `charge_unmark_external` na mesma operação e na auditoria.
6. **As cobranças novas:**
   - `sale_auto_charges` ganha `renegotiation_id`;
   - `_auto_charge_due` aceita parcela de renegociação marcada;
   - o contrato da renegociação é o termo assinado;
   - `_sale_boleto_mode` lê a renegociação.
7. **A lista:** `_boleto_list_read`, o aviso "A lista mudou" e `boleto_list_issue` passam a seguir as vendas de origem (19.28.5).
8. **A tela:**
   - os meios (19.28.6);
   - a escolha da forma no fechamento;
   - o envio do termo com as duas confirmações (boletos que serão cancelados e cobranças externas);
   - o estado da renegociação na ficha, com "Reenviar", "Cancelar envio" e "Anexar termo assinado";
   - o aviso na baixa.
9. **O que muda de momento:** o cancelamento da 4015 na renegociação sai do salvamento e da autorização e passa para a assinatura.

#### 19.28.8 Provas

- **Ensaio no treino**, em transação desfeita, **provado quebrando**. Os modos pedidos pelo Jeferson:
  - `--quebrar=assinatura`: a assinatura deixa de cancelar os boletos antigos e de criar os novos → o ensaio tem de reprovar;
  - `--quebrar=pagamento`: a baixa na antiga antes da assinatura deixa de cancelar a renegociação → tem de reprovar;
  - `--quebrar=expira`: a rotina deixa de expirar o termo vencido → tem de reprovar;
  - `--quebrar=falha`: a falha no meio deixa de virar operação interrompida → tem de reprovar.
- **E os casos:**
  - salvar não cancela nada;
  - aviso repetido da ZapSign não aplica duas vezes;
  - recusa libera as antigas;
  - cobrança externa sem a confirmação recusa o envio, e a confirmação fica na auditoria;
  - taxa já retida intocada, e taxa das novas só na baixa, sobre o valor pago;
  - desconto no principal com a autorização de hoje;
  - multa e juros congelados;
  - o benefício (19.28.10, ponto 4);
  - a lista da venda com os boletos novos e as antigas marcadas, inclusive na renegociação de duas vendas;
  - a permuta só com Gerente ou Admin e com descrição;
  - a maquininha só com a chave ligada;
  - as permissões de hoje.
- **`npm run test:indica`**, além do `npm test`, do `lint` e do `verificar`.
- **Sandbox do Asaas, sem envio:** a renegociação de uma venda na forma 2, com 12 boletos. A assinatura simulada pela porta do webhook cancela os antigos, cria os novos pelo carnê, e a mesma lista mostra os dois.
- **ZapSign:** o envio real do termo só com o "pode" do Jeferson, para o e-mail dele.

#### 19.28.9 Decisões do Jeferson (15/11/2026)

1. **Prazo do termo: 1a.** Até 5 dias corridos, nunca depois do 1º vencimento novo.
2. **Termo impresso: 2a.** Só como exceção, pelo Gerente ou pelo Admin Master, com o PDF assinado anexado.
3. **Lista na forma 2: 3b.** Um link só por venda. A lista da venda mostra os boletos novos e marca os antigos como "Substituído pela renegociação — não pague".
4. **Meios: 4a, com a permuta.** Pix, boleto, cartão, cartão parcelado pelo Asaas, dinheiro e permuta (só o Gerente ou o Admin Master, descrição obrigatória). Ficam fora a maquininha, a recorrência e o depósito; a maquininha só sai quando a chave da rede for desligada (19.28.10, ponto 3).
5. **Parcela antiga paga antes da assinatura: 5a.** A renegociação e o termo são cancelados, com aviso para refazer.

#### 19.28.10 Os pontos acrescentados pelo Jeferson (15/11/2026)

**1. Cobrança antiga emitida fora do riSZon.**
- **Hoje:** a parcela com cobrança marcada como externa (`charge_mark_external`, 4004) trava a renegociação (`CHARGE_ACTIVE`), e a 4015 não a cancela, porque ela não está no Asaas pelo riSZon. A tela mostra só "Não foi possível salvar".
- **Na 4017:**
  - ao enviar o termo, a tela lista as cobranças externas das parcelas antigas, com parcela, vencimento, valor e a nota da marcação;
  - ela diz: "Estas cobranças foram emitidas fora do riSZon. Cancele cada uma no painel do Asaas antes de enviar o termo.";
  - **o Gerente** (ou o Admin Master) marca "Cancelei no painel do Asaas" em cada uma;
  - sem isso, o envio é recusado (`EXTERNAL_NOT_CONFIRMED`).
- **Na confirmação,** a marcação externa é desfeita (`charge_unmark_external`, motivo "cancelada no painel do Asaas para a renegociação"), na auditoria, com quem confirmou e quando.
- Se mesmo assim essa cobrança for paga, o pagamento não chega ao riSZon, porque ela é externa. A baixa é dada à mão, e aí vale a regra de pagamento antes ou depois da assinatura.

**2. Entre salvar e assinar.**
- **Na ficha:** a faixa "Renegociação aguardando assinatura", com o prazo e quem negociou.
  - Ela aparece para os papéis que lidam com pagamento (`can_receive_payment`): Recepção, Gerente, Financeiro da Franqueadora e Admin Master.
  - Em cada parcela presa, aparece a marca "Em renegociação".
- **Na baixa** de uma parcela presa, a tela avisa: "Esta parcela está numa renegociação aguardando assinatura. Registrar este pagamento cancela o acordo." A baixa só segue com a confirmação. Ela não amplia quem pode dar baixa.
- **Os avisos de cobrança vencida do Asaas nesses dias:**
  - **o que acontece:** a régua do Asaas é do cadastro do pagador, não da cobrança. Nesses até 5 dias, os boletos antigos continuam valendo e o Asaas continua mandando os avisos da régua (lembrete antes, no dia, vencida e novo aviso de vencida), conforme a régua da unidade. Isso é verdade: até assinar, o cliente deve aquelas parcelas.
  - **o que eu não recomendo:** desligar os avisos do cadastro nesses dias. Isso desliga os avisos de todas as outras cobranças do cliente e depende de religar depois. Mudar o vencimento dos boletos antigos também não: o Asaas manda "cobrança alterada" e muda a multa.
  - **a proposta:**
    - a mensagem que leva o termo diz, em uma linha: "Até você assinar, os boletos atuais continuam valendo. Se pagar algum deles antes de assinar, o acordo é cancelado e refeito.";
    - o prazo curto (5 dias) limita a sobreposição;
    - na assinatura, os antigos são cancelados e os avisos deles param.
- **Prazo vencido sem assinatura:**
  - a rotina diária marca a renegociação como "expirada" e cancela o termo na ZapSign;
  - nada muda nas parcelas antigas, nem os boletos delas;
  - as antigas voltam a poder ser renegociadas;
  - **quem negociou e o Gerente** recebem o aviso "Renegociação expirada sem assinatura: as parcelas antigas continuam valendo".
- **O responsável pelo envio:** **quem negociou** (`created_by`) envia e reenvia o termo e o link, como na venda. Ele recebe os avisos de recusa, expiração e assinatura, e o Gerente recebe cópia.

**3. O contrato de tratamento antigo e a maquininha.**
- **A regra:** a renegociação assinada a partir da 4017 segue a regra nova, mesmo que a venda seja antiga. As parcelas novas ganham cobrança automática pela regra da entrega 1.
  - Elas só nascem no Asaas se a unidade estiver ligada em Cobranças automáticas e com a conta pronta, como qualquer cobrança.
- **Em que ponto está o cartão parcelado pelo Asaas:**
  - o código e o banco estão na produção desde 15/11/2026 (4013 e 4014, versão 0.451.0);
  - mas **nenhuma unidade tem conta Asaas de produção**: as chaves de produção só entram na ASA7, com a sua aprovação;
  - você ainda não testou o parcelado pela tela.
  - **Ou seja: na produção, ele ainda não funciona de verdade.**
- **Por isso, a maquininha fica na renegociação até lá.**
  - Ela segue a mesma chave da rede que já controla a maquininha na venda direta.
  - A chave sai só com a decisão do Admin Master, depois de o parcelado funcionar na produção.
  - Assim a venda direta e a renegociação mudam juntas.

**4. O benefício de pontualidade.**
- **A regra de hoje** (conferida em `installment_balance` e `apply_renegotiation`):
  - **parcela antiga em dia:** entra pelo valor dela, que já é com o benefício. O benefício **não é perdido**, porque não houve atraso.
  - **parcela antiga vencida:** o benefício perdido (`benefit_discount_cents`) entra no valor de partida, separado no termo, e vai ao razão em 1.1.01, "Benefício perdido incorporado em renegociação".
    - O Gerente pode dispensá-lo como desconto, com a autorização de hoje.
  - **parcelas novas:** nascem **sem benefício em risco** (`benefit_discount_cents` = 0). Se atrasarem, pagam só a multa e os juros delas, sobre o valor da parcela.
- **Mantida.** A 4017 não muda essa regra, e o ensaio confere os três casos.

**5. O desconto no principal.**
- **Confirmado: continua com a autorização de hoje** (`save_renegotiation`):
  - desconto acima do limite da rede (`commercial_rules.max_discount_percent`, da unidade ou da rede) espera a autorização do Gerente;
  - qualquer desconto dado por quem não é Gerente também espera;
  - o Gerente decide em `authorize_renegotiation`, e só depois disso o termo é enviado.
- **Confirmado: a taxa da rede incide sobre o valor efetivamente pago.** A base é o valor de cada baixa (`_apply_fee_split`, `p_amount_cents` = `amount_cents` da baixa).
  - O desconto reduz o que será pago e, por isso, a taxa.
  - A taxa das baixas feitas antes da renegociação não muda.

**6. O ensaio:** os quatro modos de quebra pedidos e o `npm run test:indica` estão em 19.28.8.

#### 19.28.11 Várias vendas: decisão 3a com a condição do pagador e as respostas às dúvidas (15/11/2026)

**Decisão do Jeferson: 3a, com uma condição.**
- **A regra:** na renegociação de duas ou mais vendas, os boletos novos aparecem na lista de cada venda de origem, e todas recebem o aviso "A lista mudou".
- **A condição:** o boleto novo só aparece na lista de uma venda se o pagador dessa venda for o mesmo pagador da renegociação.
  - Se forem pagadores diferentes, a lista daquela venda mostra só as parcelas antigas como "Substituído pela renegociação — não pague", sem os boletos novos e sem valores do acordo.
  - O ensaio prova esse caso.
- **Aprovados como estão:**
  - os avisos do Asaas ligados entre salvar e assinar, com a frase no termo;
  - a maquininha sai da renegociação junto com a chave da venda direta;
  - o benefício de pontualidade e o desconto no principal seguem as regras de hoje.

**Como o riSZon sabe quem é o pagador (conferido):**
- O responsável financeiro é **do cliente**, não da venda: `client_guardians.is_financial`, no máximo um por cliente (4003).
- Cada cobrança grava o pagador do dia em que foi emitida: `charges.payer_kind`, `payer_guardian_id` e `payer_cpf` (4004).
- A renegociação exige o mesmo cliente (`CLIENT_MISMATCH`). Por isso, hoje, as vendas de uma mesma renegociação têm o mesmo pagador.
  - **A exceção real** é a troca do responsável financeiro entre a venda e a renegociação: os boletos da venda saíram no nome do responsável antigo, e os novos saem no nome do atual.
- **Na 4017:**
  - a lista guarda o pagador dela (`boleto_lists.payer_kind` e `payer_cpf`), o dos boletos da venda quando o link é gerado;
  - um boleto novo só entra na lista se o pagador dele for igual;
  - o ensaio troca o responsável financeiro e confere que a lista antiga não mostra os boletos novos nem valores do acordo.

**Dúvida 1. Quantas vendas uma renegociação pode juntar?**
- **Qualquer quantidade.** `save_renegotiation` não tem limite.
  - Ela exige o mesmo cliente, a mesma unidade e parcelas em aberto ou parciais.
  - Ela mistura vendas de plano, vendas diretas e parcelas de renegociações anteriores.
- **Achado:** ela **não confere se a venda de origem está fechada.** Dá para renegociar parcela de uma proposta que ainda não virou venda.

**Dúvida 2. Clientes diferentes com o mesmo responsável financeiro?**
- **Não dá hoje** (`CLIENT_MISMATCH`).
- **O que seria preciso** (não construir):
  1. a renegociação passar a ser **do pagador**, não do cliente, com a lista dos clientes de cada parcela;
  2. cada parcela nova ganhar um cliente, porque a ficha, o razão e as Cobranças da venda são por cliente. Ou as parcelas novas ficam divididas por cliente, uma linha de cada para cada vencimento, ou vem um conceito novo de "conta do responsável";
  3. o termo assinado pelo responsável, citando cada cliente e cada venda;
  4. no Asaas, o cadastro do pagador já é o do responsável, então a cobrança não muda. Muda a referência: hoje uma cobrança é de uma parcela de um cliente;
  5. a lista por venda (19.28.5) continua valendo, e a condição do pagador já cobre esse caso.
- É uma entrega à parte, com plano próprio, se você quiser.

**Dúvida 3. Como o valor pago na parcela nova é atribuído às vendas de origem?**
- **Hoje, não é atribuído a nenhuma venda**, e a 4017 não muda isso. A parcela de renegociação, por regra do banco (0189), não pertence a uma venda, porque pode juntar várias.
- **Comissão de quem vendeu:** o riSZon **não tem comissão de vendedor**.
  - O repasse do dentista é por procedimento realizado, por competência, e não lê pagamento nenhum.
  - As metas creditam o vendedor no fechamento, pelo valor da venda.
  - A "receita recebida" das metas é coletiva e conta todo pagamento, inclusive os da renegociação.
- **Indica +Risos:**
  - os pontos nascem no fechamento da venda de plano, pelo valor fechado, e ficam em carência;
  - a carência termina pela data ou mais cedo, quando a 1ª parcela da venda é paga;
  - a renegociação não muda pontos, nem com desconto;
  - **o efeito de hoje, que a 4017 mantém:** se a 1ª parcela da venda foi renegociada, ela nunca fica "paga". A liberação antecipada deixa de acontecer, e os pontos saem só pela data da carência;
  - o pagamento das parcelas novas não mexe no Indica.
  - O ensaio confere isso, e o `npm run test:indica` roda junto.
- **Relatórios por venda:**
  - nas Cobranças da venda, as parcelas antigas aparecem como "renegociada", e as novas aparecem na ficha, separadas, com o código da renegociação (RN-…);
  - o Painel de recebíveis e a taxa de atraso da unidade contam as novas e ignoram as "renegociada", para não contar a dívida duas vezes;
  - as taxas da rede contam todo pagamento recebido, sem olhar a venda.

**Dúvida 4. A venda cancelada depois da renegociação.**
- **Hoje há uma falha, e ela já existe na produção:**
  - o cancelamento do plano (`apply_plan_cancellation`, 0360) só cancela as parcelas "em aberto" da própria venda. As parcelas novas da renegociação que vieram dela **continuam em aberto e continuam sendo cobradas**;
  - o acerto conta só o dinheiro pago nas parcelas da própria venda e **ignora o que foi pago nas parcelas da renegociação**. O cliente pode ficar com uma parcela de acerto e com as parcelas da renegociação ao mesmo tempo: **cobrança em dobro**;
  - a venda direta fechada não tem cancelamento, e nenhuma função desfaz uma renegociação aplicada.
- Com a 4017, as parcelas novas passam a ter cobrança automática no Asaas, e essa falha fica mais grave.

**O que muda no desenho da 4017 (espera a sua aprovação):**

| | Proposta | Alternativa |
|---|---|---|
| **A. Cancelar venda com parcelas renegociadas** | **(a) recomendado:** o cancelamento do plano é **recusado** enquanto a venda tiver parcelas numa renegociação aplicada com parcelas novas em aberto (`RENEGOTIATED_OPEN`). A tela diz: "Esta venda tem parcelas no acordo RN-…, ainda em aberto. O cancelamento dela fica para o distrato." A solução completa vai para a entrega do distrato (4020). | **(b)** a 4017 resolve: o cancelamento cancela a parte das parcelas novas que veio dessa venda, na proporção, e o acerto conta o que foi pago nelas. Com uma venda só, é direto; com várias vendas, o acordo teria de ser dividido, e a renegociação muda de tamanho. |
| **B. Renegociar parcela de venda não fechada** | **(a) recomendado:** recusado (`SALE_NOT_CLOSED`). Só entra parcela de venda fechada ou de renegociação aplicada. | **(b)** deixar como hoje. |
| **C. A condição do pagador** | a lista guarda o pagador e só mostra boleto novo do mesmo pagador (acima). Já é a sua regra; está aqui só para registro. | — |

- **Hoje, na produção:** a recusa de A também protege a renegociação manual que já existe, porque a falha não depende da 4017.
  - Ela entra na 4017 e sobe junto.
