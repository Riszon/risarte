# As duas portas de venda — comparativo

_Revisão feita em 06/08/2026, a pedido do dono, lendo o código dos dois fluxos._

O sistema tem **duas formas de vender** para o cliente. Elas nascem de
necessidades diferentes, seguem caminhos diferentes até o fechamento e depois
**desembocam exatamente no mesmo lugar**: as cobranças (`payment_installments`)
e o razão do Financeiro.

- **Venda direta (`VD-00001`)** — o balcão. Alguém chega, compra um
  procedimento avulso (uma restauração, uma limpeza) e paga. Não passa pelo
  Centro de Planejamento. Tela: `/comercial/venda-direta`.
- **Fechamento pelo Comercial (`PT-00001`)** — o plano de tratamento. O caso já
  passou por avaliação, planejamento e aprovação do Coordenador; o Consultor
  apresenta e negocia. Tela: `/apresentacao/[cliente]`.

---

## Comparativo

| | **Venda direta** | **Fechamento pelo Comercial** |
|---|---|---|
| **Quem pode fazer** | Recepção, Gerente, SDR, Admin Master | Consultor Comercial, Gerente, Admin Master |
| **O que vende** | Procedimentos lançados na clínica, do catálogo | Os itens da **opção aprovada** do plano |
| **Exige plano aprovado** | Não | **Sim** |
| **Jornada do cliente** | Não mexe na fase | Exige **Fase 4**; ao concluir vai à **Fase 5** e avisa a recepção |
| **Cliente pode recusar item** | Não — o que foi lançado é o que é | **Sim** — aprovação parcial, com motivo obrigatório |
| **Aceite do cliente** | Não existe como passo | **Sim** — o Consultor registra o aceite antes de fechar |
| **Devolver ao planejamento** | Não se aplica | **Sim**, com considerações obrigatórias ao Planner |
| **Código** | `VD-` no fechamento | `PT-` no fechamento |
| **Benefício do programa** (PPR+/Empresarial) | Calculado **no servidor**, por procedimento | Calculado **no servidor**, por procedimento |
| **Desconto de faixa do PPR+** | Servidor recalcula a cada salvamento | Servidor recalcula a cada salvamento |
| **Desconto automático à vista** (5% da regra) | **Servidor calcula e impõe** | **Servidor calcula e impõe** (corrigido em 06/08/2026) |
| **Desconto manual acima do teto** | **Bloqueia** o salvamento | Vai para **autorização do Gerente** |
| **Acréscimo** | Campo próprio, **só o Gerente** | Não há campo próprio de acréscimo |
| **À vista (1×) só PIX/depósito** | Sim, validado no servidor | Sim, validado no servidor |
| **Teto de parcelas / parcela mínima / meios permitidos** | Sim | Sim |
| **Passos do fechamento** | **3**: contrato assinado · cobrança emitida · pagamento confirmado | **3**, iguais (corrigido em 06/08/2026) |
| **Trava antes de fechar** | Exige condições de pagamento definidas | Exige a negociação **aceita** pelo cliente |
| **Cancelar depois de fechada** | **Sim** — devolve o benefício, cancela sessões e cobranças | **Não existe** ⚠️ |
| **Cobranças geradas** | `save_payment_schedule` | `save_payment_schedule` — **a mesma função** |
| **Meio de pagamento na cobrança** | Herda o da venda (0200) | Herda o da venda (0200) |
| **Benefício em risco por atraso** | Igual | Igual |
| **Adquirente, taxa e D+n** | Igual | Igual |
| **Renegociação de dívida** | Igual | Igual |

**O que é rigorosamente igual nas duas:** tudo o que acontece **depois** do
fechamento. As cobranças nascem da mesma função, com as mesmas travas (soma tem
de fechar com o valor da venda, uma entrada só, cronograma trava depois da
primeira baixa). Multa, juros, perda de benefício por atraso, taxa da
adquirente, data de liquidação, renegociação e razão contábil não distinguem a
origem — só olham a cobrança.

---

## Diferenças que são decisão de negócio (e estão certas)

1. **Quem faz.** Venda direta é ato de balcão (recepção); fechamento de plano é
   ato comercial (consultor). Por isso as listas de papéis não se cruzam.
2. **A jornada.** A venda direta não move o cliente de fase porque não é
   tratamento planejado — mover seria poluir o funil. O fechamento do plano
   move, porque é exatamente o gatilho para a recepção agendar o início.
3. **Aprovação parcial.** Só existe no Comercial porque só ali o cliente está
   escolhendo entre itens de um plano. No balcão, o que foi lançado já é a
   escolha dele.
4. **Desconto acima do teto.** No Comercial existe negociação de verdade, então
   faz sentido pedir autorização ao Gerente. No balcão não há negociação — por
   isso bloqueia direto.

## Diferenças que parecem falha (para o dono decidir)

**1. ✅ RESOLVIDO (v0.181.0) — o desconto automático à vista dependia da tela.**
Na venda direta o servidor calculava os 5% e os impunha; no Comercial, a tela
calculava e mandava pronto, e o servidor só conferia o teto. Se a tela errasse,
o cliente **perderia o desconto em silêncio**. Agora o servidor garante o piso
nos dois fluxos (`savePlanNegotiation`). O desconto manual maior continua
prevalecendo, e acréscimo lançado não é revertido pelo automático.

**2. ✅ RESOLVIDO (v0.184.0, migração 0205) — cancelar venda do Comercial.**
A venda direta tem `cancel_direct_sale`, que devolve o benefício do programa,
cancela as sessões no prontuário e as cobranças em aberto. No Comercial não há
equivalente.

**Decisão do dono (06/08/2026):** cancelar **desfaz tudo e devolve o cliente à
Fase 4 (Conversão Comercial)** — de onde ele pode ser renegociado ou marcado
como perdido, sem recomeçar do zero. O cancelamento cancela as sessões ainda
não realizadas e as cobranças em aberto. **Se já houve recebimento**, o sistema
recusa (`HAS_RECEIPTS`): dinheiro que entrou sai por estorno ou renegociação,
nunca por cancelamento. É ato de **Gerente/Admin**, com motivo obrigatório.

**Limite conhecido:** o benefício do programa **não** volta aqui (na venda
direta volta). O consumo em `ppr_benefit_usages` não guarda vínculo com a
negociação — ele nasce no atendimento, não no fechamento. Pendência para quando
o consumo apontar para a venda de origem.

**3. ✅ RESOLVIDO (v0.181.0, migração 0202) — os passos eram 3 contra 2.**
O Comercial não tinha "cobrança emitida", justamente o passo que o **ASAAS** vai
preencher sozinho. Agora os três caminhos que geram cobrança — venda direta,
fechamento pelo Comercial e renegociação — têm os mesmos três passos. A regra
de ouro não mudou: só **contrato assinado + pagamento confirmado** conclui a
venda; "cobrança emitida" é informativo.

**4. ✅ DECIDIDO — acréscimo só existe na venda direta, e é para continuar assim.**
**Decisão do dono (06/08/2026): plano de tratamento NÃO tem acréscimo.** O preço
vem do orçamento aprovado pelo Coordenador; somar valor por cima enfraquece a
aprovação clínica e é difícil de justificar ao paciente. A venda direta mantém o
acréscimo (item avulso é outra conversa) e ele continua restrito ao Gerente.
Falta impor a regra no código da negociação — vai junto com o cancelamento.

---

## Regra de trabalho

Toda mudança testada na venda direta precisa ser verificada no fechamento pelo
Comercial, e vice-versa. Os dois caminhos terminam nas mesmas cobranças: corrigir
só um lado deixa metade das vendas com o dado errado, e o erro só aparece
semanas depois, no relatório.
