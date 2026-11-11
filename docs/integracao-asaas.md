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
| D13 | Devolução de repasse | Repasses já feitos à franqueadora **não são devolvidos** em distrato nem em estorno. |
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
| Contas de teste | No sandbox, a conta raiz representa a franqueadora. Um script cria três subcontas (Londrina, Cambé e RisLife) e as registra como vinculadas. Recusa rodar fora do sandbox e do banco de treino. |
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
  - Subcontas geridas pela franqueadora entre CNPJs distintos.
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
| ASA2 — Webhooks e baixa | Rota por conta, idempotência, baixa pela função existente, fechamento da venda (D21), sinalização "em dia" ou "em atraso", aba Cobrança e comunicação | Pagamento simulado dá baixa, fecha a venda e atualiza a sinalização sem ação humana |
| ASA3 — Split | Aba Taxas da franquia sobre `network_fees`; `split_recipients`, `charge_splits`; marca de retido na origem; teto de segurança; painel de repasses, mostrando por unidade quanto foi recebido com split e quanto por fora (dinheiro, maquininha, cobrança externa). Antes de implementar: os cálculos da compensação da tarifa nos três casos e a diferença máxima por meio de pagamento, para aprovação (seção 13.2, item 1) | No prazo, o repasse liquidado é exatamente o percentual sobre o valor pago, nos três meios; formato da entrada confirmado; nenhuma conta a pagar em dobro |
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
- [ ] **Uso da chave e subcontas entre CNPJs distintos (gerente de contas).**
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
- Subcontas entre CNPJs distintos.
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
- **Proposta, a aprovar antes da entrega 2** (preferência do Jeferson): quem emite escolhe o novo vencimento (hoje ou depois). O valor sai atualizado com a multa e os juros que o riSZon já calcula até o novo vencimento, e o desconto de pontualidade não se aplica (o benefício já foi perdido). Detalhes em aberto: o 14.6.

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

**Proposta para a quitação por valor menor** (a implementar na entrega 2, se aprovada):

- é um recebimento normal do valor pago, mais uma **dispensa** registrada com o motivo, que fecha o saldo;
- a dispensa abate primeiro os juros, depois a multa, depois o benefício perdido e por último o principal;
- só a parte de principal dispensada entra no razão como **Descontos concedidos (1.9.02)**. Multa, juros e benefício perdido nunca chegaram a ser lançados como receita, então dispensá-los não gera lançamento;
- a taxa da rede é calculada só sobre o que entrou de dinheiro.

### 14.6 Em aberto, para o Jeferson decidir antes da entrega 2

- A regra da parcela vencida (14.3), com dois detalhes:
  - a cobrança reemitida vai **sem multa nova** e com os **juros mensais** normais a partir do novo vencimento?
  - se o novo vencimento também passar, os juros do Asaas incidem sobre o valor novo (que já inclui multa e juros): a diferença de centavos é registrada como juros na baixa da ASA2?
- A quitação por valor menor (14.5): aprovar como proposta.

### 14.7 Permissões

- As três permissões novas da cobrança (ver, emitir, cancelar) nascem só com o Admin Master.
- Na liberação futura, conforme a matriz 9.3:
  - **Financeiro da Franqueadora:** ver, emitir e cancelar na rede toda;
  - **Gerente de Unidade:** ver, emitir e cancelar na própria unidade;
  - **Recepcionista:** ver e emitir na própria unidade;
  - **Assistente Comercial e Consultor Comercial:** ver e enviar o link dos clientes deles.
