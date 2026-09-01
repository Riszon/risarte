# Lacunas, riscos e pontos que precisam de validação

O que **não** foi possível confirmar analisando o código, o que ficou
incompleto neste material, e o que merece atenção antes de treinar gente de
verdade.

**Classificação:** 🔴 alta · 🟡 média · 🟢 baixa prioridade.

---

## 1. Não identificado no código analisado

### 1.1. 🔴 Não existe canal de suporte definido

**O que falta:** o manual manda "registrar o problema e acionar o suporte", mas
**não há telefone, e-mail, grupo ou fila configurados** em lugar nenhum do
sistema.

**Onde procurei:** `src/` inteiro (busca por *suporte*, *ajuda*, *contato*),
`CLAUDE.md`, `README.md`, variáveis de ambiente.

**Por que é alta prioridade:** um usuário travado sem saber a quem recorrer é o
que faz uma implantação fracassar na primeira semana. É decisão de operação, não
de código — mas precisa estar no material antes do treinamento.

**Sugestão:** definir um canal e escrever no manual (seção 9.6).

### 1.2. 🔴 Não existe recuperação de senha pelo próprio usuário

**O que confirmei:** `src/app/login/` tem só três arquivos — não há tela de
"esqueci minha senha". Usuário é criado pelo administrador com a senha já
definida (`createUser` com `email_confirm: true`).

**Consequência prática:** toda senha esquecida vira tarefa do Admin Master.
Com 15 pessoas isso é administrável; com 200 unidades, não.

**Sugestão:** decidir se entra no roadmap. Enquanto não entrar, o manual precisa
dizer isso com todas as letras — e diz.

### 1.3. 🟡 Posição visual dos elementos

**O que falta:** onde cada botão fica na tela.

**Por quê:** a análise é do código-fonte, não da aplicação rodando. Sei que o
botão existe, o que ele faz e quem pode usá-lo; **não sei se ele está no alto à
direita ou no rodapé**.

**Sugestão:** percorrer as telas principais com capturas e completar o
[mapeamento da interface](manual-treinamento-riSZon.md#7-mapeamento-da-interface).
O ambiente de treino serve exatamente para isso.

### 1.4. 🟢 Mensagens vindas do servidor

**O que falta:** as 179 mensagens catalogadas são as escritas como texto fixo na
tela. Mensagens montadas dinamicamente ou devolvidas pelo servidor
(`result.error`) **não** entraram na contagem.

---

## 2. Incompleto neste material

### 2.1. 🟡 Roteiros de treinamento de 6 funções

**Escritos:** Recepcionista, Coordenador Clínico, Dentista Planner, Dentista,
Consultor Comercial, Gerente de Unidade.

**Não escritos em detalhe:** SDR, Assistente Comercial, TSB, ASB, Franqueado,
Financeiro da Franqueadora, Comprador, Consultor RisLife, Franqueadora/Rede.

**Por quê:** escrever passo a passo dessas funções sem validar em tela produziria
exatamente o que o pedido proíbe — descrição plausível e não verificada.

**Sugestão:** completar depois de percorrer as telas no ambiente de treino.

### 2.2. 🟡 As 384 ações de servidor não foram descritas uma a uma

**O que existe:** nome e arquivo de cada uma, no inventário JSON.

**O que não existe:** o que cada uma faz, o que exige e o que devolve.

**Por quê:** seria referência técnica, não material de treinamento, e exigiria
ler 384 funções. **Sugestão:** descrever sob demanda, quando uma tela específica
entrar em treinamento.

### 2.3. 🟢 Módulos com pouca profundidade

PPR+, Empresarial, Chat, Documentos e Orientações aparecem no mapeamento, mas
**sem roteiro de uso**. São módulos inteiros — cada um mereceria a mesma
profundidade dada à jornada.

---

## 3. Riscos para usuários iniciantes

### 3.1. 🔴 O menu mostra mais do que a pessoa pode usar

**O achado:** os itens **Início, Jornada, Agenda, Atendimento, Prontuários,
Centro de Planejamento e Procedimentos** aparecem para **todas** as funções — não
há filtro por papel neles. A única exceção é o dentista, que perde "Jornada".

**Evidência:** `src/components/app-sidebar.tsx`, lista `NAV_ITEMS` sem condição.

**Por que é risco:** uma TSB abre "Centro de Planejamento", vê uma tela que não é
dela e conclui que o sistema está quebrado — ou pior, que ela deveria estar
usando aquilo. Também gera chamado desnecessário.

**Isso é defeito?** Não necessariamente: a proteção real está no banco, e o
sistema não fica inseguro. Mas é **confuso**, e confusão em usuário novo custa
adoção.

**Sugestão (média):** avaliar esconder do menu o que a função não usa. Enquanto
não mudar, o manual explica o comportamento — e explica bem, porque é a dúvida
número um previsível.

### 3.2. 🔴 Ações de dinheiro não se desfazem

**O achado:** no Financeiro, *"nada se apaga"* — lançamento liquidado gera
contra-lançamento com motivo, imposto por gatilho no banco.

**Risco:** um iniciante acostumado a "desfazer" vai errar e tentar apagar.

**Mitigação:** está no manual (seções 9.3, 11.2 e no checklist). **Sugestão:**
reforçar no treinamento presencial do Gerente e do Financeiro.

### 3.3. 🟡 Avisos modais insistentes com botão que afirma um fato

**O achado:** os avisos da recepção têm o botão **"Já agendei"**, que marca o
aviso como resolvido. Se a pessoa clicar sem ter agendado, **o sistema passa a
acreditar que foi feito**.

**Sugestão:** avisar no treinamento da recepção (já está no manual).

### 3.4. 🟡 A visibilidade de Relatórios e Planos depende da unidade ativa

**O achado:** `canViewReports` e `canViewPlans` olham a **clínica ativa**; os
outros módulos olham **todas** as clínicas da pessoa.

**Risco:** quem atende em duas unidades vê o menu **mudar** ao trocar de
unidade, e acha que perdeu acesso.

**Sugestão:** citar no treinamento de quem atua em mais de uma unidade.

---

## 4. Pontos que exigem validação com o dono

### 4.1. 🟡 Franqueadora/Rede não vê o Financeiro

**O achado:** `canViewFinance` inclui Admin, `finance_franchisor`,
`unit_manager` e `franchisee` — **não** inclui `franchisor_staff`.

**A dúvida:** o `CLAUDE.md` §5 descreve a Franqueadora/Rede como *"Leitura +
dashboard consolidado de TODAS as unidades"*. Se "dashboard consolidado" inclui
o consolidado financeiro (`/financeiro/consolidado`), há divergência entre a
documentação e o código.

**Não classifiquei como defeito** porque pode ser intencional (o consolidado
financeiro seria só do Financeiro da Franqueadora). **Precisa da decisão do
dono.**

### 4.2. 🟡 Consultor RisLife tem menu enxuto

**O achado:** com apenas esse papel, a pessoa vê os itens gerais + Empresarial +
PPR+. Não vê Comercial, Relatórios nem Planos.

**A dúvida:** ele é "Consultor Comercial Empresarial". Consegue trabalhar sem o
funil comercial? **Validar com o dono.**

### 4.3. 🟢 PPR+ aparece para praticamente todo mundo

**O achado:** `canViewPpr` devolve verdadeiro para **qualquer pessoa com ao
menos um papel** em alguma clínica.

**A dúvida:** é intencional ("toda a operação enxerga", como diz o comentário
do código) ou ficou largo demais?

---

## 5. Divergências entre documentação e código

### 5.1. 🟢 A matriz do `CLAUDE.md` é mais restritiva que o menu

O `CLAUDE.md` §5 traz uma matriz PODE/NÃO PODE por função. Ela descreve a
**intenção de negócio**. O menu do sistema é **mais permissivo** (item 3.1).

**Não é contradição:** a matriz do CLAUDE.md descreve o que cada um *deve*
fazer; o menu não impede abrir a tela; o banco é que limita o dado.

**Sugestão:** citar essa diferença sempre que a matriz do CLAUDE.md for usada em
treinamento, para ninguém prometer bloqueio que o menu não faz.

---

## 6. Sugestões de melhoria na experiência de treinamento

| # | Sugestão | Prioridade | Motivo |
|---|---|---|---|
| 1 | Definir e publicar o canal de suporte | 🔴 | Sem isso o manual tem um buraco no meio |
| 2 | Percorrer as telas no ambiente de treino e completar o mapeamento visual | 🔴 | É o que falta para o material virar guia de tela |
| 3 | Completar os roteiros das 9 funções restantes | 🟡 | Cada função precisa do roteiro dela |
| 4 | Avaliar esconder do menu o que a função não usa | 🟡 | Reduz confusão e chamado |
| 5 | Gravar vídeos curtos dos 6 fluxos principais | 🟡 | Fluxo de 9 passos e 5 pessoas se entende melhor vendo |
| 6 | Criar uma tela de "esqueci minha senha" | 🟡 | Tira carga do Admin |
| 7 | Cartão de bolso por função (1 página) | 🟢 | Consulta rápida no balcão |

---

## 7. Resumo

| Categoria | 🔴 | 🟡 | 🟢 |
|---|---|---|---|
| Não identificado no código | 2 | 1 | 1 |
| Incompleto neste material | 0 | 2 | 1 |
| Riscos para iniciantes | 2 | 2 | 0 |
| Precisa de decisão do dono | 0 | 2 | 1 |
| Divergência doc × código | 0 | 0 | 1 |
| **Total** | **4** | **7** | **4** |

**As quatro de alta prioridade:** canal de suporte inexistente; sem recuperação
de senha; o menu mostrando mais do que a função usa; e ações de dinheiro que não
se desfazem.

As duas primeiras são **decisões de operação**. As duas últimas já estão
explicadas no manual — o risco é de confusão, não de segurança.
