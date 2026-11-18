# As cinco respostas antes do "pode" da 4021 e da 4021a (17/11/2026)

Tudo abaixo está no treino e no projeto de teste (**0.481.0**, Asaas 0.20.0). **Nada disso está na produção.**

## 1. O que entrou em cada versão

As versões do core da cobrança mensal (0.461.0, 0.462.0, 0.462.1 e 0.473.0) existiram só no projeto de teste. Ao juntar o `main`, que andou com as outras sessões, viraram **uma entrega só: 0.481.0**. A produção nunca viu essas versões.

| Peça | Versão do Asaas | Migração | O que faz |
|---|---|---|---|
| Cobrança mensal da rede (ASA6) | 0.18.0 | **4021** | A prévia por unidade (fixas e "a cobrar"), a conferência e a contestação da unidade, a decisão do Financeiro, o saldo anterior (incluir, parcelar ou dispensar), a emissão pela conta da franqueadora com a unidade pagadora, a baixa pelo aviso do Asaas e o mês fechado. A configuração nasce em branco. |
| Conferência das taxas (ASA6) | 0.19.0 | **4021a** | A conta do mês por unidade (diferença R$ 0,00) e as divergências da noite, com ignorar (motivo) e a lista das ignoradas. |
| Correções do seu teste (20.18) | dentro da 4021 | 4021 | Os pagamentos ligados ao lote, a taxa fixa prevista, a conta cancelada à mão que não volta, um vencimento só, o aviso da unidade certa, o texto do saldo mínimo, a situação da conta que acompanha o pago. |
| Estorno de parte (ASA4) | 0.20.0 | **4020a** | O estorno com valor, a confirmação reforçada do cartão, a repartição real, a parcela "Estornada" e a régua. |

**Já estão na produção (0.472.1):**
- a 4018a (a marca do split a mais);
- a 4018b, com a tela de Taxas da rede: o acordo na unidade certa e a conta cancelada à mão que não volta.

## 2. Os dois ajustes de tela (feitos e testados por você em Cambé)

1. **"Aprovar e emitir"** fica desabilitado enquanto a unidade não conferiu e a janela está aberta. O motivo fica fixo ao lado: "Aguardando a conferência da unidade até DD/MM". Com contestação aberta, o motivo é "Há contestação aberta: decida antes".
2. **A confirmação** usa a caixa do sistema, não a do navegador. Ela mostra a unidade, o mês, o valor, o vencimento e o e-mail do aviso do Asaas. Você aprovou Cambé nela: vencimento 25/11/2026, `financeiro.cambe@example.com`.

## 3. A ordem na produção, com a conferência

**Uma entrega de cada vez**, como você pediu:

1. **Primeiro, a 0427 da Jornada do Cliente.** Você roda e confere, e aquela sessão publica.
2. **Depois, a do Asaas.** Eu junto o `main` com a 0427, rodo de novo a suíte e os ensaios e te mando o resultado. Só então peço as três migrações, **uma por vez**, cada uma esperando a sua conferência:

| Ordem | Migração | Conferência esperada |
|---|---|---|
| 0 | `4018c_asa3_taxa_retida_no_razao.sql` | `gatilho_novo 1 · linhas_sem_razao 0` |
| 1 | `4020a_asa4_estorno_parcial_pelo_asaas.sql` | `tabela_nova 1 · funcoes_novas 9 · limite_em_branco true · aviso_ligado true` |
| 2 | `4021_asa6_cobranca_mensal_das_unidades.sql` | `tabelas_novas 8 · funcoes_novas 45 · configuracao_em_branco true · unidades_configuradas 0 · lotes 0 · ramos_ligados true` |
| 3 | `4021a_asa6_conferencia_das_taxas.sql` | `tabelas_novas 2 · funcoes_novas 9 · divergencias 0` |

**Depois das três:** publico o `main` (0.481.0) e confiro de fora a versão na tela de login e o anônimo barrado (401) nas portas novas.

**Sobre a ordem e o "funcoes_novas 45":**
- A 4020a e a 4021 rodam em qualquer ordem entre si: cada uma liga o ramo da outra só se ele existir. A 4021a precisa da 4021.
- O 45 conta as 41 funções da 4021 mais as 4 dos repasses que já estão na produção. Se der outro número, pare e me mande.

**Como desfazer:** cada migração só cria tabelas novas e redefine funções. Para cada uma eu preparo o `desfazer-….sql` antes de você rodar (com as versões anteriores das funções), e te mostro o passo, o risco e o desfazer (ajuste G).

## 4. O levantamento do acordo na franqueadora

**Ainda não recebi o resultado.** O arquivo `docs/asaas/levantamento-acordo-na-franqueadora.sql` vai junto de novo. Ele só lê.

- **Se voltar vazio:** nada a corrigir. A tela já grava na unidade certa desde a 0.472.1.
- **Se voltar linha:** proponho a correção caso a caso (mover o acordo para a unidade certa) e não altero nada antes da sua aprovação.

## 5. O que a 4021 faz no dia em que subir

**Não cobra ninguém.**
- **A configuração da rede e a de cada unidade nascem em branco.** Sem o 1º mês da unidade e os valores do contrato, a prévia não abre e nada é emitido. A tela diz o que falta.
- **Nenhuma unidade tem conta Asaas de produção**, então nenhuma cobrança sai mesmo com os campos preenchidos.

**O que ela mexe no que já existe:**
- **A apuração das contas de taxa** (`refresh_network_fee_payable`) ganha as regras novas: dispensa, proporcional (só com a regra preenchida), conta cancelada à mão que não volta e situação recalculada pelo pago.
  - **Ela não roda sozinha ao subir:** só na próxima vez que uma conta de taxa for apurada (um recebimento, a prévia ou o "Gerar taxas fixas do mês").
  - **O único efeito visível possível:** uma conta de taxa que estava "parcial" com o pago igual ao valor passa a "paga" quando for apurada de novo.
  - **O vencimento só muda** nas unidades com a cobrança mensal ligada, e nenhuma está.
- **A ligação dos pagamentos ao lote:** um único `update`, que só alcança lotes pagos. Na produção não há nenhum, então ele não mexe em nada.
- **O aviso do Asaas** ganha o ramo da cobrança mensal, que só reconhece cobranças de lote da franquia (nenhuma).
- **A rotina da noite** passa a chamar a cobrança mensal, que não faz nada sem configuração.
- **Uma pasta privada** para os demonstrativos, vazia.

**A 4021a no mesmo dia:** a conferência parte do 1º mês da cobrança mensal de cada unidade. Sem nenhum ligado, ela não abre divergência (`divergencias 0`).

**A 4020a no mesmo dia:**
- o limite nasce em branco, então todo estorno de cartão pede a confirmação do Gerente ou do franqueado;
- sem conta de produção, ninguém consegue pedir estorno pelo Asaas.
