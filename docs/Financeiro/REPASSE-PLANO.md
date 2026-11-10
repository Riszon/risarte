# Repasse dos dentistas — plano e decisões

Pedido do dono (10/11/2026): refazer o repasse "de forma segura, inteligente e
funcional" — "está confuso, difícil de achar, poucas informações e não
conseguimos gerar nenhum repasse até agora".

## O que o dono pediu

- **Relatório de repasse** por dentista, com: data de finalização, nome do
  procedimento, nome do cliente, link para a sessão em que o procedimento foi
  finalizado e o nível do dentista.
- **Telas:** todos os repasses da unidade e o histórico; a Franqueadora vê
  cada unidade e o consolidado da rede; gráfico de evolução dos dentistas
  (quanto produzem e quanto ganham).
- **Fluxo, tudo registrado (quem, quando, o quê):**
  1. o Financeiro gera o relatório (um ou todos da unidade) e envia;
  2. o Gerente da unidade aprova ou reprova, **um por vez, nunca em lote**, e
     só os da sua equipe;
  3. o Dentista aprova ou reprova **dentro do riSZon**; reprovar exige
     formulário com motivo e volta ao Gerente;
  4. só paga quando Gerente **e** Dentista aprovaram; a parte aprovada pode
     ser paga enquanto a divergência se resolve;
  5. o pagamento fica registrado no Financeiro.
- **Regras duras:** procedimento pago não entra de novo; refação ou revisão
  não paga de novo; excluir procedimento do relatório exige motivo; o dentista
  só vê o relatório dele; quem atende em mais de uma unidade recebe um
  relatório por unidade.

## Por que nenhum repasse saía (lido em 10/11/2026)

- **Produção:** nenhuma sessão de tratamento registrada, então nada a apurar
  (os testes de repasse são feitos no treino). 12 dentistas sem nível de
  carreira; nenhuma das duas unidades tem Gerente (1 Coordenador cada); 5
  dentistas atendem em mais de uma unidade; 38 de 312 procedimentos com
  repasse no cadastro.
- **Treino:** os 11 repasses apurados nasceram com R$ 0,00 — o valor é
  congelado na conclusão, e o nível do dentista / a tabela foram definidos
  depois. O "Fechar o mês" recusa mês de soma zero. Procedimentos de várias
  sessões incompletos e 8 itens antigos sem procedimento do catálogo não
  apareciam em lugar nenhum.

## As 14 decisões do dono (10/11/2026)

1. **Quem é o Financeiro:** o Financeiro da Franqueadora gera e paga; o
   Gerente só aprova. Ninguém gera e aprova o mesmo relatório.
2. **Aprovação parcial:** por procedimento. A linha contestada fica em
   análise; o resto segue para pagamento.
3. **Excluído do relatório, com motivo:** "adiar" (volta no próximo) ou "não
   pagar" (fora de vez; só volta por decisão registrada).
4. **Substituto do Gerente:** o Coordenador clínico só aprova quando a unidade
   **não tem** Gerente. O relatório do próprio Coordenador é aprovado pelo
   Financeiro da Franqueadora.
5. **Prazo do dentista:** 5 dias úteis, com lembrete; vencido, avisa o
   Gerente. **Nunca** aprovação por silêncio.
6. **Periodicidade:** mensal, por mês de finalização; o Financeiro pode gerar
   a qualquer momento; o que ficou de fora entra no seguinte.
7. (respondida na 10.)
8. **Contas:** repasse fixo em 2.1.01, bônus em 2.1.02. O bônus fica **fora**
   do relatório por enquanto.
9. **Pacote (grupo):** paga pelos procedimentos de dentro, cada um pela
   própria tabela. (É o que o sistema já faz: o grupo vira itens normais.)
10. **Várias sessões com mais de um dentista:** recebe quem concluiu a
    **última** sessão. (Fecha a pendência da AP61.)
11. **Dentista contesta e o Gerente mantém:** o Financeiro da Franqueadora
    desempata, com motivo registrado.
12. **Procedimento pago e depois cancelado ou estornado ao cliente:** o
    sistema avisa o Financeiro e o Gerente. **Só desconta do dentista** (linha
    negativa no próximo relatório, pelas mesmas aprovações) quando o motivo
    for **falha do próprio dentista**. Cancelamento ou estorno sem relação com
    o que ele fez não desconta.
13. **Procedimento que não paga de propósito:** marca "Sem repasse" no
    cadastro; não vira pendência nem entra no relatório.
14. **Pagamento dos dentistas:** dia **15** de cada mês.

## Etapas

| Etapa | O quê | Situação |
|---|---|---|
| 1 | **Destravar e proteger:** recalcular o que saiu zerado, pendências com o motivo, "em andamento", marca "Sem repasse", travas no banco (linha fechada imutável, sessão com repasse não se apaga, fim da escrita direta). | ✅ 0.417.0, migração 0387 |
| 2 | **Relatório de repasse:** um por dentista e por unidade, com o detalhe por procedimento; gerar um ou todos; excluir com motivo. Um procedimento só entra em um relatório. | a fazer |
| 3 | **Aprovações:** Gerente (um por vez, só a equipe dele; Coordenador quando não há Gerente), depois o Dentista na tela "Meus repasses"; reprovar com formulário; avisos a cada passo; prazo de 5 dias úteis. | a fazer |
| 4 | **Pagamento:** só o aprovado pelos dois vira conta a pagar, ligada aos procedimentos; parcial; vencimento no dia 15; estorno por falha do dentista como linha negativa. Sai o "Fechar o mês" antigo. | a fazer |
| 5 | **Visões:** histórico da unidade, consolidado da rede, gráfico de produção e ganho por dentista. | a fazer |

## O que a Etapa 4 precisa resolver do fechamento antigo

Achados lendo `close_payout_month` (0209), ainda no ar até a Etapa 4:

- procedimento com data num mês **já fechado** fica órfão (o mês não fecha de
  novo) e nunca é pago;
- a conta a pagar nasce direto como "aberta": não passa pela alçada e
  (suspeita, não provada) não entra no razão por competência;
- cancelar a conta a pagar não devolve as linhas do repasse;
- a conta não é ligada às linhas (só a referência `REP-AAAAMM`).
