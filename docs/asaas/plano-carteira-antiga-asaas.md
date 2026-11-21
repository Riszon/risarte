# Plano: trazer as cobranças antigas do Asaas para o riSZon (a "carteira antiga")

Versão de 20/11/2026, a pedido do dono, depois do levantamento de Cambé - Centro (a unidade piloto). Substitui, para o caso real, o desenho da 4019/4019b (spec 19.34), que foi aprovado em 16/11/2026 **antes** de se conhecer o tamanho real.

---

## 1. O que o levantamento mostrou

**No Asaas de Cambé** (levantamento da Central, 20/11/2026, 16h47), criados fora do riSZon:

| O quê | Quantidade |
|---|---|
| Cobranças em aberto (a vencer e vencidas) | **470**, somando **R$ 104.409,00** |
| Parcelamentos (carnês) | **32** |
| Assinaturas (mensalidades recorrentes) | **52** |

A amostra mostra boletos **vencidos desde 2019**. O levantamento guardou só 20 exemplos; a divisão por idade, por tipo e por paciente ainda não foi medida.

**No riSZon (produção, 20/11/2026):** Cambé tem **51 pacientes** cadastrados e a rede inteira tem **0 parcelas a receber**. Ou seja: **quase nada do que está no Asaas existe no riSZon.**

**O que isso muda:**
- A 4019 aprovada parte de uma parcela que **já existe** no riSZon, marcada como "cobrada fora", e a troca, uma a uma, pela cobrança nova. Em Cambé, essas parcelas **não existem**. O problema real é **migrar a carteira a receber** da unidade para dentro do riSZon.
- **O risco de boleto em dobro é menor do que eu disse antes.** Ele só existe quando alguém lança no riSZon uma dívida que já tem boleto no Asaas (por exemplo, o restante de um contrato antigo). **Venda nova feita no riSZon não tem cobrança antiga: pode ser cobrada pelo Asaas normalmente.** A regra para a equipe passa a ser: "não lance no riSZon parcelas de contrato antigo; essas entram pela migração".
- Os avisos de pagamento dessas cobranças antigas são ignorados pelo riSZon (`ignorado_fora_do_riszon`) e elas continuam funcionando no Asaas como hoje, com a régua de avisos do próprio Asaas.

---

## 2. As etapas

### Etapa 0 — O inventário completo (só leitura)

O riSZon lê, pela chave de Cambé, **todas** as cobranças em aberto, os carnês e as assinaturas, e monta uma planilha (sem nada gravar no Asaas):
- por cobrança: o pagador (nome e CPF/CNPJ), o valor, o vencimento, a situação, se é avulsa, de carnê ou de assinatura, a descrição;
- o cruzamento pelo CPF com os 51 pacientes de Cambé no riSZon;
- a divisão em grupos:
  - **A. Muito antigas:** vencidas há mais de um prazo a decidir (por exemplo, 12 meses);
  - **B. Vencidas recentes:** vencidas dentro desse prazo;
  - **C. A vencer:** parcelas futuras, quase sempre de carnês em andamento;
  - **D. Assinaturas ativas:** as mensalidades (PPR+, Ortodontia ou outras).

O inventário fica guardado só no servidor (tem CPF de pacientes) e o dono recebe o resumo por grupo. **Precisa do "pode" do dono**, porque usa a chave de produção de Cambé (só leitura).

### Etapa 1 — As decisões do dono, por grupo (com o inventário na mão)

As decisões estão na seção 3.

### Etapa 2 — A ferramenta de migração (construção; migração 4019, refeita)

Uma tela na Central (unidade › "Carteira antiga do Asaas"), só para o Admin Master e o Financeiro da Franqueadora:
1. Mostra o inventário por paciente: as cobranças antigas dele, agrupadas por carnê.
2. Para cada paciente escolhido:
   - acha o paciente no riSZon pelo CPF ou o cadastra com os dados do Asaas;
   - cria um **"saldo de contrato anterior"** (uma venda de migração, sem gerar receita de novo no razão, como a renegociação já faz), com uma parcela para cada cobrança antiga;
   - liga cada parcela à cobrança antiga, pelo caminho decidido (adotar ou reemitir, decisão 2).
3. Faz em lote, por grupo, com a prévia antes e o relatório depois.
4. O que falhar no meio para naquele paciente; nunca ficam duas cobranças vivas na mesma parcela (a regra da 4019 continua).

### Etapa 3 — As assinaturas (4019b)

As 52 assinaturas são mensalidades. Quando as mensalidades de Cambé forem ligadas no riSZon (4018), cada assinatura antiga do mesmo paciente é **cancelada no Asaas** no mesmo passo, com a confirmação (o desenho da 4019b continua valendo). Até lá, elas continuam como estão.

### Etapa 4 — Ensaio, piloto e as outras unidades

- Ensaio no treino e prova no sandbox, provados quebrando, como nas outras entregas.
- Cambé primeiro, por grupo, começando pelo menor.
- Depois, cada unidade nova repete: levantamento → inventário → decisões → migração.

---

## 3. As decisões do dono

**1. O que fazer com as muito antigas (grupo A).**
- **(a)** Deixar no Asaas como estão, fora do riSZon. Se o paciente pagar, a baixa é à mão.
- **(b)** Trazer para o riSZon como dívida em aberto, para a unidade cobrar ou renegociar.
- **(c)** Cancelar no Asaas (dívida considerada perdida), com a lista guardada.
- **Recomendação: (a) agora** e decidir caso a caso depois, com o inventário. Boleto de 2019 raramente é pago, e trazer tudo de uma vez enche o riSZon de dívida que ninguém vai cobrar.

**2. Como ligar a parcela à cobrança antiga (grupos B e C).**
- **(a) Adotar a cobrança antiga:** o riSZon coloca a referência dele na cobrança que já existe. O paciente **continua com o mesmo carnê**, e a baixa passa a vir sozinha. A multa, os juros e o desconto continuam os que foram digitados no Asaas.
- **(b) Cancelar e reemitir** (a decisão da 4019 em 16/11): o paciente recebe boletos novos e precisa descartar o carnê antigo.
- **Recomendação: (a) para as a vencer (grupo C) e (b) para as vencidas (grupo B), na hora em que o paciente vier pagar ou renegociar.** Na 4019 você escolheu (b) para casos isolados; em 470 cobranças, reemitir tudo mandaria centenas de boletos novos e confundiria os pacientes que já têm o carnê na mão.

**3. O split nas cobranças antigas.**
- **(a)** A adotada ganha o split da regra de hoje (royalties e taxas retidos na hora do pagamento).
- **(b)** A adotada fica sem split; a taxa da rede é calculada como "a cobrar" no Painel de repasses, como a cobrança externa paga.
- **Recomendação: (a)**, se o contrato de franquia já previa a taxa sobre essas vendas. Se não previa (vendas de antes da franquia, por exemplo), **(b)** ou nenhuma taxa. É uma decisão sua, e talvez do contador.

**4. A receita no razão.**
- As vendas antigas já foram faturadas fora do riSZon. A venda de migração **não gera receita de novo** na DRE; só o recebimento entra no caixa.
- **Recomendação: assim**, como a renegociação já faz. A competência da receita antiga fica fora do riSZon.

**5. Quem opera a migração.**
- **Recomendação:** só o Admin Master e o Financeiro da Franqueadora, unidade por unidade, com relatório. A equipe da unidade não opera a migração.

**6. A regra para a equipe até a migração.**
- **Recomendação:** a equipe de Cambé **pode** cobrar pelo Asaas as vendas novas feitas no riSZon, e **não lança** no riSZon parcelas de contratos antigos.

---

## 4. O que muda na spec

- A 4019 (19.34) e a 4019b (19.34.5) continuam aprovadas no que vale para casos isolados (a parcela marcada como externa). Este plano acrescenta a **migração em lote**, que é o caso real.
- A decisão 1 da 19.34.2 ("a adoção fica fora") é reaberta só para a migração em lote (decisão 2 acima).
