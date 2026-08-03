<!-- Documento-base do Módulo Financeiro do riSZon.
     Fonte: Risarte_Odontologia_-_riSZon_Financeiro.docx
     Este arquivo é a especificação funcional de referência. Não editar sem aprovação. -->

# Documento-base para construção do sistema financeiro da Risarte Odontologia

> Especificação funcional, gerencial e de dados para franqueadora, franqueados e rede consolidada

## 1. Sumário executivo

O sistema financeiro da **Risarte Odontologia** visa resolver a fragmentação de dados e a falta de padronização na gestão de clínicas odontológicas em expansão. Atualmente, a ausência de uma base única dificulta a visão clara da rentabilidade e a tomada de decisão estratégica.

O sistema é estruturado em três níveis de visão:

- **Franqueadora:** Foco na gestão da marca, suporte à rede, recebimento de taxas e expansão.

- **Franqueados:** Foco na operação local, controle de caixa, faturamento clínico e lucratividade da unidade.

- **Rede Consolidada:** Visão agregada para benchmarking, análise de performance global e saúde financeira do grupo.

A premissa central é a **captura de dados na origem** (agenda e atendimento), garantindo que a informação financeira seja um reflexo fiel da operação, devidamente padronizada e integrada para apoiar decisões baseadas em fatos.

## 2. Visão geral e escopo do sistema

O sistema abrange as dimensões financeira, operacional, gerencial e de expansão.

- **Centralização:** O sistema deve centralizar cadastros de pacientes, profissionais, serviços, fornecedores e o plano de contas único.

- **Automação:** Cálculos de impostos, repasses a profissionais, margens de contribuição e indicadores de desempenho devem ser automáticos.

- **Validação e Lançamento:** Despesas administrativas e conciliações bancárias dependerão de lançamentos manuais ou integrações via OFX/API.

- **Separação de Dados: **

- **Operacionais:** Agendamentos, procedimentos realizados e consumo de materiais.

- **Financeiros:** Fluxo de caixa, contas a pagar/receber e conciliação.

- **Gerenciais:** DRE, indicadores de performance e relatórios de expansão.

## 3. Objetivos do sistema

- **Financeiros:** Garantir a precisão do lucro líquido e controle rigoroso do fluxo de caixa.

- **Operacionais:** Otimizar a ocupação das cadeiras e o controle de estoque.

- **Governança e Controle:** Estabelecer trilhas de auditoria e níveis de aprovação.

- **Comparação (Benchmarking):** Identificar unidades de alta e baixa performance para replicar boas práticas.

- **Expansão:** Avaliar o tempo de retorno (payback) e viabilidade de novas praças.

**Prazos:**

- **Curto prazo:** Estabilização do contas a pagar/receber e conciliação bancária.

- **Médio prazo:** DRE gerencial confiável e indicadores de produtividade por profissional.

- **Estratégico:** Dashboards consolidados para suporte à expansão nacional.

## 4. Princípios de construção

- **Padronização:** Nomenclaturas e processos idênticos em todas as unidades.

- **Plano de contas único:** Estrutura hierárquica obrigatória para todas as entidades.

- **Centros de custos:** Segmentação por unidade e, internamente, **por área** — Clínico, Comercial, Administrativo, Marketing e Infraestrutura/Ocupação. *(Decidido.)* Especialidade clínica **não** é centro de custo: os mesmos recursos (cadeira, recepção, aluguel) servem várias especialidades no mesmo dia, e o rateio necessário para separá-los seria arbitrário. Rentabilidade por especialidade é obtida no módulo 6.13, por receita e custo direto do procedimento. A árvore de centros de custo é cadastrável pela franqueadora e extensível: a unidade pode criar centros próprios, sempre como filhos de um centro padrão da rede, preservando a comparabilidade no consolidado.

- **Competência versus Caixa:** Registro do fato gerador (DRE) e da movimentação financeira (DFC).

- **Receita faturada versus recebida:** Distinção clara entre o que foi vendido e o que efetivamente entrou no caixa.

- **Custos fixos versus variáveis:** Classificação rigorosa para cálculo de ponto de equilíbrio.

- **Separação Franqueadora/Franqueados:** Contabilidades distintas com fluxos de intercompany (royalties/taxas).

- **Consolidação e eliminação:** No nível rede, eliminar receitas da franqueadora que são despesas dos franqueados.

- **Rastreabilidade:** Todo número deve permitir o "drill-down" até o documento de origem.

- **Segurança e controle de acesso:** Perfis baseados em funções (recepção, gestor, auditor).

- **Qualidade dos dados:** Bloqueio de lançamentos sem centro de custo ou documento fiscal.

- **Histórico e auditoria:** Registro de quem criou, alterou ou excluiu qualquer dado.

## 5. Modelo organizacional e níveis de análise

| **Nível** | **Objetivo** | **Dados Principais** | **Indicadores Chave** | **Frequência** | **Responsável** |
| --- | --- | --- | --- | --- | --- |
| **Franqueadora** | Gestão da rede e marca | Royalties, taxas, despesas expansão | Receita da rede, ROI expansão | Mensal | Diretoria |
| **Franqueado** | Lucratividade da unidade | Vendas, custos, folha, estoque | Margem líquida, Ponto equilíbrio | Diário | Gestor Unidade |
| **Consolidado** | Visão estratégica global | Dados agregados de todas as unidades | EBITDA consolidado, Market share | Mensal | Controladoria |

**Dimensões de análise:**

- **Entidade/Unidade:** CNPJ e nome da clínica.

- **Período:** Dia, mês, trimestre, ano.

- **Centro de Custo:** Administrativo, Clínico, Comercial.

- **Serviço/Profissional:** Tipo de procedimento e dentista executor.

- **Paciente:** Identificador anonimizado para análise de recorrência.

- **Canal de Aquisição:** Origem do paciente (Instagram, Indicação, etc.).

- **Status da Unidade:** Em implantação, Operacional, Maturidade.

## 6. Arquitetura funcional do sistema

### 6.1 a 6.16 Detalhamento dos Módulos

| **Módulo** | **Finalidade** | **Dados Necessários** | **Origem** | **Saídas** |
| --- | --- | --- | --- | --- |
| **6.1 Cadastros** | Padronizar entidades | Dados cadastrais, CNPJ, CRO | Manual | Base mestre |
| **6.2 Plano de Contas** | Estruturar finanças | Categorias de receita/despesa | Controladoria | Hierarquia financeira |
| **6.3 Receitas/Vendas** | Registrar faturamento | Valor, serviço, forma pagamento | Agenda/Sistema | Relatório de vendas |
| **6.4 Produção Clínica** | Medir atendimentos | Procedimento, tempo, profissional | Agenda | Taxa de ocupação |
| **6.5 Contas a Receber** | Controlar entradas | Parcelas, vencimentos, taxas | Vendas | Fluxo de recebíveis |
| **6.6 Contas a Pagar** | Controlar saídas | Boletos, notas fiscais, impostos | Compras/RH | Cronograma pagto |
| **6.7 Conciliação** | Validar saldo real | Extrato bancário, comprovantes | Banco | Saldo auditado |
| **6.8 DRE Gerencial** | Medir lucro/prejuízo | Receitas e despesas (competência) | Módulos 6.3 a 6.6 | Lucro operacional |
| **6.9 DFC** | Gerir liquidez | Entradas e saídas (caixa) | Módulos 6.5 a 6.7 | Saldo projetado |
| **6.10 Orçamento** | Planejar futuro | Metas de receita e limites gastos | Planejamento | Orçado vs Realizado |
| **6.11 Estoque** | Controlar insumos | Entradas NF, baixas atendimento | Compras/Clínico | Custo material |
| **6.12 Folha/Repasses** | Gerir pessoas | Salários, encargos, comissões | RH/Produção | Custo pessoal |
| **6.13 Rentabilidade** | Analisar margens | Preço serviço vs Custo direto | Vendas/Estoque | Margem por serviço |
| **6.14 Franqueadora** | Gerir royalties | Faturamento unidades, contratos | Unidades | Receita royalties |
| **6.15 Expansão** | Viabilidade novas | Investimento inicial, obras | Projetos | Payback projetado |
| **6.16 Governança** | Segurança | Logs, permissões, fechamentos | Sistema | Relatório auditoria |

## 7. Dicionário inicial de dados (Campos essenciais)

| **Tabela** | **Campos Mínimos** | **Fonte** | **Risco** |
| --- | --- | --- | --- |
| **Unidades** | ID, Nome, CNPJ, Cidade, Data Abertura, Status | Cadastro | Dados desatualizados |
| **Plano de Contas** | Código, Descrição, Tipo (R/D), Grupo, Natureza | Controladoria | Classificação errada |
| **Atendimentos** | ID, Data, Paciente_ID, Profissional_ID, Valor, Status | Agenda | Atendimento sem valor |
| **Contas a Pagar** | ID, Fornecedor, Vencimento, Valor, Centro Custo, Status | Financeiro | Duplicidade |
| **Estoque** | Item_ID, Unidade, Qtd Mínima, Qtd Atual, Custo Médio | Compras | Falta de baixa no uso |

## 8. Demonstrações financeiras e relatórios estruturantes

### 8.1 DRE Gerencial

- **Estrutura:** Receita Bruta (-) Deduções/Impostos (=) Receita Líquida (-) Custos Diretos (Materiais/Repasses) (=) Lucro Bruto (-) Despesas Operacionais (Fixas) (=) EBITDA/Resultado Operacional (-) Depreciação (-) Resultado Financeiro (=) Lucro Líquido.

- **Fonte:** Lançamentos de competência.

- **Responsável:** Financeiro/Controladoria.

### 8.2 DFC e Fluxo de Caixa

- **Divisão:** Operacional, Investimentos e Financiamentos.

- **Projeção:** Visão de 30, 60 e 90 dias baseada no Contas a Receber e Pagar.

### 8.3 a 8.12 Relatórios Complementares

- **Orçado vs Realizado:** Comparação mensal de desvios.

- **Desempenho por Unidade:** Ranking de margem e faturamento.

- **Estoque:** Giro de materiais e perdas.

## 9. Indicadores financeiros e operacionais prioritários

### 9.1 Receita Bruta

- **O que é:** Total faturado antes de deduções.

- **Importância:** Mede o volume de vendas da rede.

- **Fórmula:** Soma de todos os procedimentos faturados no período.

### 9.10 Ticket médio por atendimento

- **O que é:** Valor médio gerado por cada consulta/procedimento.

- **Fórmula:** Ticket médio por atendimento = Receita dos atendimentos ÷ Número de atendimentos.

- **Nível:** Franqueado e Consolidado.

### 9.13 Taxa de ocupação da agenda/cadeiras

- **O que é:** Percentual de tempo produtivo das cadeiras.

- **Fórmula:** Taxa de ocupação = Horas ocupadas ÷ Horas disponíveis × 100.

- **Base de cálculo:** **horas de cadeira**, não slots. *(Decidido.)* Denominador = horas de funcionamento × número de cadeiras ativas no período. Numerador = horas efetivamente ocupadas por atendimento realizado. Slots de agenda foram descartados porque procedimentos odontológicos têm durações muito distintas e um slot ocupado por uma profilaxia de 30 minutos contaria igual a um de implante de duas horas, distorcendo a leitura de produtividade.

### 9.15 Custo da hora clínica

- **Visão A:** Custo fixo da hora disponível = Custos fixos operacionais mensais ÷ Horas clínicas disponíveis no mês.

- **Visão B:** Custo total da hora utilizada = Custos fixos mais custos variáveis ÷ Horas clínicas efetivamente utilizadas.

### 9.19 Margem de contribuição

- **Fórmula:** Margem de contribuição = Receita líquida - Custos e despesas variáveis.

### 9.20 Ponto de equilíbrio financeiro em receita

- **Fórmula:** Ponto de equilíbrio em receita = Custos e despesas fixas ÷ Margem de contribuição percentual.

### 9.21 Ponto de equilíbrio operacional em atendimentos

- **Fórmula:** Ponto de equilíbrio em atendimentos = Custos fixos ÷ (Ticket médio por atendimento - custo variável médio por atendimento).

### 9.28 Taxa de inadimplência

- **Fórmula:** Inadimplência percentual = Valor vencido ÷ Valor total a receber × 100.

### 9.42 Indicadores de qualidade dos dados

- **Métricas:** % de lançamentos sem centro de custo, dias de atraso na conciliação, atendimentos sem valor registrado.

## 10. Cards, gráficos, tabelas e dashboards

### 10.1 Dashboard Executivo da Rede

- **Objetivo:** Visão macro para a diretoria.

- **Cards:** Receita Total, EBITDA Médio, Unidades Ativas, Crescimento % MoM.

- **Gráficos:** Evolução da receita (Linha), Composição da receita por unidade (Barras empilhadas).

### 10.3 Dashboard do Franqueado

- **Objetivo:** Gestão do dia a dia da unidade.

- **Cards:** Saldo em conta, Contas a pagar hoje, Ocupação da agenda, Faltas.

- **Gráficos:** Ponto de equilíbrio vs Receita atual (Barra com meta), Ticket médio por profissional (Barras).

### 10.8 Central de Alertas

- **Alertas:** Caixa abaixo do mínimo (equivalente a 1 mês de custo fixo da unidade), Inadimplência acima de **5%** (atenção) e **8%** (crítico), Estoque crítico, Despesa acima do orçamento. *(Decidido — todos os limites são configuráveis em cascata: padrão da rede com override por unidade.)*

## 11. Matriz de origem e responsabilidade

| **Informação** | **Fonte Provável** | **Responsável** | **Frequência** |
| --- | --- | --- | --- |
| **Atendimentos** | Sistema Clínico | Recepção | Diário |
| **Pagamentos** | Internet Banking | Financeiro | Diário |
| **Folha** | Contabilidade/RH | Gestor Unidade | Mensal |
| **Royalties** | Contrato/Faturamento | Franqueadora | Mensal |

## 12. Dependências e fluxos de dados

- **Ciclo de Receita:** Agenda → Atendimento → Procedimento → Receita → Contas a Receber → Recebimento → Conciliação.

- **Ciclo de Custo:** Procedimento → Consumo de Material → Baixa Estoque → Margem de Contribuição.

- **Ciclo de Gestão:** DRE + Classificação Fixo/Variável → Cálculo Automático de Ponto de Equilíbrio.

## 13. Governança, segurança e fechamento

- **Perfis:** Master (Franqueadora), Gestor (Unidade), Operacional (Recepção).

- **Privacidade:** Dados de pacientes devem ser anonimizados em relatórios gerenciais.

- **Fechamento:** Bloqueio de edições em meses encerrados. Reabertura apenas com log de justificativa.

- **Conciliação:** Obrigatória para validação de qualquer relatório de fluxo de caixa.

## 14. Alertas automáticos e exceções

- **Financeiros:** Queda de receita > **15%** MoM. *(Decidido — configurável por unidade.)*

- **Operacionais:** Taxa de faltas > **15%**. *(Decidido — configurável por unidade.)*

- **Dados:** Lançamentos retroativos em períodos fechados.

## 15. Lacunas, suposições e pontos de validação

- **RESOLVIDO — Regras de repasse para dentistas:** **valor fixo por procedimento**, definido em tabela com vigência (`valid_from` / `valid_to`), chaveada por **nível do plano de carreira** — o dentista aponta para um nível, e override individual é exceção. Sobre o total dos repasses fixos do período pode incidir um **bônus percentual**, em caso de campanha, meta atingida ou evolução no plano de carreira; o bônus é apurado no fechamento mensal, nunca procedimento a procedimento. Apuração por competência na data do procedimento realizado; liberação para pagamento no fechamento mensal. Reajuste de tabela nunca recalcula repasse já apurado — a apuração usa a tabela vigente na data do procedimento. **Consequência de gestão:** como o repasse é fixo, desconto concedido na negociação não reduz o repasse e consome a margem integralmente — o sistema deve alertar, no momento da negociação, quando o preço deixar a margem abaixo do mínimo (repasse + material + laboratório + taxa de adquirente).

- **RESOLVIDO — Definição de paciente:** dois status distintos, para não misturar retenção com produção. **Paciente em tratamento** = possui plano de tratamento em andamento, independentemente da data do último atendimento. **Paciente ativo** = teve atendimento realizado nos **últimos 12 meses**. A janela de 12 meses acompanha o ciclo de retorno e recall da odontologia; janelas de 6 meses classificariam como inativo o paciente em manutenção semestral regular, que é justamente o mais fiel da base.

- **RESOLVIDO — Estrutura jurídica:** cada unidade é **CNPJ independente** da franqueadora. As duas unidades em operação são **franqueadas**; unidades próprias estão previstas para o futuro, e por isso a unidade carrega o campo `ownership` (`own` | `franchised`) desde a fundação do modelo. Consequência obrigatória na consolidação: **Resultado do Grupo** (franqueadora + unidades próprias, com eliminação intercompany do royalty, que é receita da franqueadora e despesa do franqueado) é diferente de **Faturamento da Rede** (todas as unidades, apenas para benchmarking e indicadores operacionais). Faturamento de unidade franqueada nunca entra no resultado da franqueadora — só o royalty e as taxas entram.

- **EM ABERTO — Inventário de sistemas atuais e APIs disponíveis:** ainda a levantar. Itens mínimos a mapear: sistema/planilha em uso hoje para agenda e prontuário e se expõe API ou exportação; adquirente(s) de cartão em uso, prazos de liquidação e taxas por bandeira e por número de parcelas; bancos das unidades e disponibilidade de extrato OFX ou Open Finance; emissor de NFS-e do município; e o escritório de contabilidade, para o de-para com o plano de contas fiscal.

- **EM ABERTO — Autorização contratual de acesso a dados:** o contrato de franquia precisa autorizar expressamente o acesso da franqueadora ao financeiro completo da unidade franqueada. Se o contrato vigente só prevê envio de faturamento para apuração de royalty, a coleta de dados de custo, folha e caixa da unidade precisa de aditivo antes de entrar em produção.

- **EM ABERTO — Plano de contas fiscal:** não há plano de contas formal da contabilidade mapeado. O plano gerencial será construído do zero, com campo de de-para (`fiscal_account_code`) preenchido quando o contador for consultado.

## 16. Priorização em fases

- **Fase 1 (Base):** Plano de contas único, Contas a Pagar/Receber, DRE e DFC básico.

- **Fase 2 (Integração):** Integração com agenda, cálculo de ocupação e repasses automáticos.

- **Fase 3 (Estratégico):** Dashboards de expansão, ROI por unidade e análise de estoque avançada.

## 17. Próximos passos práticos

- Validar este documento com a diretoria e TI.

- Definir o plano de contas e centros de custos oficiais.

- Mapear fontes de dados e disponibilidade de integração.

- Desenvolver protótipo (MVP) do Dashboard do Franqueado.

- Realizar piloto em uma unidade para ajuste de fórmulas.

## 18. Conclusão

O sistema financeiro da **Risarte Odontologia** deve atuar como a "única fonte da verdade". Ao integrar dados operacionais e financeiros sob uma governança rígida, a rede terá segurança para escalar, garantindo que cada nova unidade contribua positivamente para o resultado consolidado.