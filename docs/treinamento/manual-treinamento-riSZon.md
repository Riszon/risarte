# Manual de Treinamento — riSZon

> **Como este material foi produzido.** Tudo aqui saiu do código deste
> repositório, por extração automática (rotas, itens de menu, condições de
> acesso, mensagens de tela, ações de servidor) e leitura dos arquivos citados.
> Onde não foi possível confirmar, está escrito **"Não identificado no código
> analisado"** — e não substituído por descrição genérica.
>
> Números desta análise: **84 rotas**, **30 itens de menu**, **179 mensagens de
> tela**, **384 ações de servidor**, **16 papéis**. Ver
> [`evidencias-riSZon.md`](evidencias-riSZon.md).
>
> **Este manual muda junto com o sistema.** Desde 04/09/2026 vale a regra de que
> toda entrega que a equipe percebe na tela atualiza o manual no mesmo dia — e o
> texto que está em *Menu → Manual* é sempre o da versão no ar.
>
> **Limitação declarada:** a análise é do código, não da aplicação em execução.
> Posições visuais (onde cada botão fica na tela) **não foram confirmadas** e
> precisam de validação na interface. Ver [`lacunas-riSZon.md`](lacunas-riSZon.md).

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Início rápido](#2-início-rápido)
3. [Visão geral do riSZon](#3-visão-geral-do-riszon)
4. [Perfis, papéis e funções](#4-perfis-papéis-e-funções)
5. [Matriz de permissões](#5-matriz-de-permissões)
6. [Scripts de treinamento por função](#6-scripts-de-treinamento-por-função)
7. [Mapeamento da interface](#7-mapeamento-da-interface)
8. [Fluxos principais de uso](#8-fluxos-principais-de-uso) — inclui **o cliente que volta depois de perdido**
9. [Erros, falhas e mau funcionamento](#9-erros-falhas-e-mau-funcionamento)
10. [Mensagens do sistema](#10-mensagens-do-sistema)
11. [Segurança e boas práticas](#11-segurança-e-boas-práticas)
12. [Glossário](#12-glossário)
13. [Perguntas frequentes](#13-perguntas-frequentes)
13b. [Para o Admin Master: alterar permissões](#13b-para-o-admin-master-alterar-permissões)
13c. [Para o Admin Master: a Auditoria](#13c-para-o-admin-master-a-auditoria)
14. [Checklists](#14-checklists)
15. [Novidades, problemas e alertas](#15-novidades-problemas-e-alertas) — inclui o **relógio**

---

## 1. Resumo executivo

*Uma página, para gestores e responsáveis pelo treinamento.*

**O que é.** O riSZon é o sistema de gestão da rede Risarte Odontologia. Ele
acompanha cada paciente por uma sequência de **7 fases** — da primeira conversa
até o acompanhamento depois do tratamento — e, ao redor dessa sequência, reúne
agenda, prontuário, orçamento, negociação, financeiro, estoque e compras.

**O problema que resolve.** Hoje cada etapa vive numa planilha ou na cabeça de
alguém. No riSZon, cada paciente está sempre **em uma fase, com um responsável
e um prazo**, e a passagem de uma fase para outra **avisa automaticamente quem
faz o próximo passo**. Quando o prazo estoura, o caso fica marcado em vermelho
nas listas.

**Para quem.** Hoje: 1 franqueadora + unidades, com **16 funções** diferentes
(da recepção ao financeiro da rede). O sistema foi desenhado para crescer até
200 unidades.

**O que ele NÃO faz** (limites declarados no próprio código): não envia
mensagem de WhatsApp automaticamente; não assina contrato digitalmente ainda
(ZapSign previsto, não conectado); não cobra por meio de gateway ainda (ASAAS
previsto, não conectado); não funciona sem internet; não tem portal para o
paciente.

**O que muda na prática.** A recepção deixa de anotar em papel quem precisa ser
chamado; o coordenador vê a fila de avaliações com prazo; o planner recebe o
caso já com fotos e anamnese; o consultor sabe qual plano foi aprovado; o
gerente vê o resultado da unidade sem pedir relatório para ninguém.

**Riscos para quem está começando.** Dois, e ambos estão tratados neste manual:
(a) o menu mostra mais itens do que a pessoa realmente consegue usar — a
proteção de verdade está no banco de dados, não no menu; (b) muitas ações do
financeiro e do clínico **não podem ser desfeitas** — geram um lançamento de
correção em vez de apagar.

**Tempo estimado de treinamento por função:** 40 a 90 minutos, conforme a
função (ver [seção 6](#6-scripts-de-treinamento-por-função)).

---

## 2. Início rápido

*As cinco primeiras coisas que um usuário novo deve fazer.*

1. **Entrar.** Abra o endereço do sistema, informe o e-mail e a senha que o
   administrador cadastrou. **Não existe "criar conta"** — todo acesso é criado
   por um administrador, na ficha do Risartano (evidência:
   `src/app/login/login-form.tsx`,
   `src/app/(app)/risartanos/acesso-actions.ts` → `createUser`).
2. **Confira em que unidade você está.** No alto da barra lateral esquerda
   aparece a **assinatura da Risarte** e, logo abaixo, o nome da clínica ativa e
   *"Sua função aqui: …"*. Se você atende em mais de uma unidade, é por ali que
   se troca.
   > **A cor da tela diz onde você está.** Ver [seção 2.1](#21-a-cor-da-tela-diz-onde-voce-esta).
3. **Olhe o menu da esquerda.** Ele é a lista do que você pode abrir.
4. **Comece pelo "Início".** É a primeira tela, e ela responde a uma pergunta
   só: **o que espera por você agora**. Ver [seção 2.2](#22-a-tela-de-inicio).
5. **Ache a versão do sistema** no rodapé da barra lateral (ex.: *"Versão
   0.238.0 · migração 0252"*). É essa informação que o suporte pede quando algo
   dá errado.

### 2.1. A cor da tela diz onde você está

O sistema tem **três ambientes**, e cada um tem a sua cor. Não é enfeite: é para
você saber, sem ler nada, em que parte da Risarte está trabalhando.

| Onde você está | Assinatura | Cor |
|---|---|---|
| Numa **unidade** (Cambé, Londrina…) | Risarte **Odontologia** | azul-marinho |
| Na **Franqueadora** | Risarte **Franchising** | turquesa |
| No **Risarte Empresarial** | Risarte **Empresarial** | bordô |

A cor segue a **unidade ativa**, e as telas do **Empresarial** usam a cor delas
mesmo quando você está com uma unidade escolhida — o Empresarial é um lugar, não
um chapéu.

> **O aviso de TREINO continua mandando mais que a cor.** Se você estiver no
> ambiente de treino, a faixa amarela e o nome da aba avisam, e isso vale acima
> de qualquer cor. Errar entre treino e produção custa mais caro que errar entre
> Franqueadora e unidade.

**As cores das fases da Jornada não mudaram.** As sete continuam exatamente como
eram — vermelho na Aquisição, laranja na Conversão Clínica, e assim por diante.

**Claro ou escuro.** O botão de lua/sol na barra de cima troca a aparência. A
escolha fica guardada **no seu computador**: se você entrar de outra máquina,
escolhe de novo.

> **Se alguma letra sumir no modo escuro, é defeito — relate.** Isso aconteceu
> em dois lugares: os **cartões da agenda** (corrigido em setembro de 2026) e
> as **opções das caixas de seleção**.
>
> A caixa de seleção precisou de **duas** correções, e vale saber por quê: na
> primeira, o sistema passou a avisar o navegador de que estava no tema escuro
> — necessário, mas insuficiente. Quem desenha aquela listinha que abre é o
> navegador, e ele só respeita o aviso quando a lista **não tem cor própria**.
> Como as nossas caixas eram transparentes, ele continuava pintando de branco,
> e a letra clara sumia. Na segunda correção, as opções ganharam fundo e letra
> declarados, nos dois temas. Agora existe uma verificação que **abre a tela
> num navegador de verdade** e mede se dá para ler — a primeira verificação só
> lia o código, e por isso não pegou nada.
>
> **Reabrir um relato quando o problema continua é o certo a fazer.** Foi uma
> reabertura que mostrou que a primeira correção estava pela metade. Se você
> encontrar outro canto assim, use a **boia** — é exatamente o tipo de coisa
> que só quem usa o sistema todo dia percebe.

### 2.2. A tela de Início

A tela de Início responde a **uma pergunta**: *o que espera por você agora?*
Ela tem três partes, sempre nesta ordem.

**No alto:** a saudação, a data, a unidade em que você está e a sua função ali
— tudo numa linha só. Ao lado, **dois ou três atalhos** do que você mais faz
para começar o dia (a recepção vê *Cadastrar cliente* e *Abrir a agenda*; o
dentista vê *Meu Dia*). Para ver a lista completa das suas clínicas e funções,
clique em **"ver minhas funções"** — ela mora no seu Perfil.

**No meio: "O que espera por você".** Cartões com um número, o que aquele número
significa e o caminho para resolver. Eles mudam conforme a sua função:

| Se você é… | Pode ver, por exemplo |
|---|---|
| Recepção | Agendamentos de hoje, quem já fez check-in e ainda está esperando |
| Dentista | Os seus atendimentos de hoje |
| Coordenador Clínico | Planos aguardando a sua aprovação, casos com prazo estourado |
| Dentista Planner | A fila do Centro de Planejamento |
| Consultor Comercial | Follow-ups com a data de retorno vencida |
| Gerente / Franqueado | Prazo estourado, compras a aprovar, entregas a receber, itens abaixo do mínimo |
| Comprador da Franqueadora | Listas das unidades esperando, rodadas de negociação abertas |

> **Cartão zerado não aparece.** Se não há nada esperando naquele assunto, o
> cartão some — em vez de mostrar um "0". Um zero pendurado em todo cartão vira
> paisagem, e aí ninguém repara mais nos que **não** são zero. Quando não há
> nada pendente em nada, a tela diz isso com todas as letras.

> **O número do cartão é o mesmo da tela para onde ele leva.** Se o cartão diz
> "3 esperando", ao abrir você encontra três. Cada contagem usa a mesma régua da
> tela de destino, nunca uma conta separada.

**Minhas metas.** Quem participa de alguma meta ativa vê, no alto, um cartão
para cada uma (até quatro), com a barra da equipe e — na meta individual — a
**sua** barra ("Você"). Ver [seção 2.7](#27-metas-smart).

**Embaixo: "O que mudou no sistema"** — as **três últimas** entregas que
alcançam a sua função. A lista completa, com busca e filtros, está em **Ver
todas as novidades** (ou no ícone ✨ da barra de cima). Ver
[seção 15](#15-novidades-problemas-e-alertas).

**O que NÃO está mais aqui:** a lista das suas clínicas, das suas funções e das
unidades sob sua responsabilidade. Isso é cadastro, não muda de um dia para o
outro, e agora fica no **Perfil** (clique no seu nome, no rodapé do menu
lateral). A primeira tela do dia é para o trabalho que espera por você.

### 2.3. A porta do Financeiro

**O Financeiro abre num Painel**, não na Configuração. Ele responde às duas
perguntas que o módulo separa de propósito — e que são diferentes:

- **"O mês deu lucro?"** é competência: a venda de março conta em março, mesmo
  que o cliente pague em junho.
- **"Tenho dinheiro?"** é caixa: o que entrou e o que ainda vai entrar, por dia.

É por serem diferentes que existe clínica lucrativa que quebra.

**No alto, três números** da sua unidade no mês: resultado (com a comparação
contra o mês anterior de mesmo tamanho), receita líquida com a margem, e o
saldo em caixa de hoje.

**No meio, "O que precisa de você"** — só o que existe:

| Cartão | O que ele diz |
|---|---|
| O caixa fica negativo | O primeiro dia em que a projeção fica no vermelho |
| A receber vencido | O que passou do vencimento (não entra na projeção) |
| A pagar vencido | Contas da unidade em atraso |
| Contas aguardando autorização | Não são pagas antes da decisão de quem tem alçada |
| Alertas em aberto | Avisos do acompanhamento diário ainda não resolvidos |

**Embaixo, os caminhos agrupados** pela pergunta que respondem: *O mês deu
lucro?*, *Tenho dinheiro?*, *A rede* e *Cadastros*.

**Quem lança e quem consulta.** Ver o Financeiro não é o mesmo que lançar
nele. Quem **grava** é decidido pelo banco, e a tela segue o banco:

| O quê | Quem grava |
|---|---|
| Contas a pagar, fornecedores, conta bancária e conciliação da unidade | Gerente da unidade, Financeiro da Franqueadora, Admin Master |
| Multa, juros, carência e centros de custo (regras da rede) | Financeiro da Franqueadora, Admin Master |

Quem abre a tela sem poder gravar vê **"Só consulta"** e o nome de quem faz.
**A conta bancária se cadastra em Financeiro → Conciliação → "Cadastrar conta
bancária"** — é ela que dá o saldo de abertura ao Fluxo de caixa, que avisa e
leva até lá quando não há conta.

**Importar o extrato do banco** (Conciliação → escolha a conta → **Importar
extrato**). Aceita **OFX** (o preferido: cada lançamento traz um identificador
do banco, e importar o mesmo arquivo de novo não duplica nada) e **CSV** (o
sistema acha as colunas de data, descrição e valor pelo cabeçalho). Desde a
versão 0.322.0:

- **Os acentos saem certos qualquer que seja o banco.** O sistema descobre
  sozinho se o arquivo veio em UTF-8 (o Inter) ou em Latin-1 (a maioria dos
  outros) — antes lia tudo como Latin-1, e "Transferência" virava
  "TransferÃªncia".
- **Linha com data que não existe** (por exemplo, dia e mês trocados) fica de
  fora e é contada no aviso de linhas ignoradas — antes ela fazia a importação
  inteira falhar.
- Se o extrato for de **outra conta** (o próprio OFX diz qual é), o sistema
  avisa e só importa se você confirmar em **Importar mesmo assim**. Importou na
  conta errada? **Desfazer**, na lista de importações.

> **"Não foi possível importar o extrato" (relato OC-00103).** Até a
> atualização 0298, a importação falhava assim para todo arquivo, por um
> defeito do sistema — não do arquivo nem da sua função. Se a mensagem voltar
> a aparecer depois da 0298, relate o problema com o arquivo à mão.

**Conciliar: cada linha do extrato com o que o sistema já sabe** (relato
OC-00108; desde a versão 0.325.0; **Pagar conta** desde a 0.326.0, relato
OC-00110). Cada linha pendente tem botões, e escolher o
certo é o que impede o mesmo dinheiro de entrar duas vezes:

| A linha do banco é… | Botão | O que acontece |
|---|---|---|
| Um recebimento ou pagamento que **já está no sistema** com o mesmo valor (a baixa da parcela do paciente, a conta paga) | **Casar (N)** — aparece quando há lançamento do mesmo valor perto da data | só liga os dois; não cria nada |
| Um pagamento de uma **conta a pagar que ainda está em aberto**, com o mesmo valor | **Pagar conta (N)** — aparece quando há conta em aberto com o saldo exato da linha | a conta recebe a baixa com a **data do extrato** e a linha fica conciliada com o pagamento, de uma vez. A despesa já estava na DRE desde que a conta foi lançada: pagar não lança de novo |
| **Vários lançamentos juntos** — o depósito da maquininha é a soma das vendas menos as taxas | **Vários** | você marca os lançamentos (até 7 dias da data da linha) e só concilia quando a soma bate no centavo |
| Dinheiro **entre contas da própria clínica** — resgate ou aplicação de investimento, transferência de uma conta para outra | **Transferência** | lança na conta **6.3.01** (aplicações e transferências), já conciliada. **Não é receita nem despesa:** fica fora da DRE e, no Fluxo de caixa, aparece como investimento |
| O **depósito do dinheiro do caixa** no banco (ou um **saque** para o caixa) | **Transferência** → marque **É com o Caixa** | lança as **duas pontas** de uma vez: entra no banco e sai do Caixa (ou o contrário), na conta 6.3.01 — fora da DRE |
| Algo que o sistema **não sabia** — rendimento da aplicação, tarifa do banco, uma receita que não passou pelos Recebíveis | **Lançar** | cria o lançamento, na conta que você escolher, já conciliado. **Na DRE ele entra no mês da linha do extrato** — a janela diz qual |
| Uma linha que **não pertence** a esta conciliação (linha repetida no extrato, lançamento que o próprio banco desfez) | **×** (Ignorar) | a linha sai desta conta, com o motivo registrado |

- **O recebimento do paciente nasce na baixa da parcela**, em Recebíveis. Na
  Conciliação ele só é **casado** — nunca lançado de novo. Se você abrir o
  **Lançar** numa linha que parece já estar no sistema, a janela avisa
  ("Isto parece já estar no sistema") e oferece **Conciliar com este**.
- **"Conciliei e não apareceu na DRE"** (relato OC-00110). O lançamento criado
  pela linha entra na DRE na **data do extrato**: uma linha de 02/09 lançada em
  outubro está na DRE de **setembro**. Na DRE, escolha o período do extrato. A
  janela do Lançar e a confirmação dizem o mês.
- **Conta de fornecedor que já está em Contas a pagar não se lança aqui** — a
  despesa dela já está na DRE desde que ela foi lançada, e lançar de novo
  contaria duas vezes (e a conta continuaria em aberto). Com o mesmo valor, use
  **Pagar conta**; a janela do Lançar avisa quando existe conta em aberto do
  mesmo valor. Pagou com multa, juros ou só uma parte? Pague em **Contas a
  pagar** (lá se informam multa e juros) e depois case a linha com **Vários**.
  O **Desfazer** da Conciliação solta só a conciliação: a conta continua paga
  (para desfazer o pagamento, use o estorno em Contas a pagar).
- **Ignorar não é para transferência.** A linha ignorada não entra no saldo
  pelo banco, e o saldo deixa de bater com o extrato. Para resgate, aplicação
  ou transferência, use **Transferência**, que mantém o saldo certo.
- **As contas que aparecem no Lançar são as da unidade escolhida no alto da
  tela.** A conta bancária da clínica precisa estar cadastrada **na unidade**
  (não na Franqueadora); senão as contas de receita de paciente não aparecem.
- **Errou?** **Desfazer** devolve a linha para pendente e solta todos os
  lançamentos que estavam casados com ela, inclusive os do **Vários**.
- A tela lê o extrato e os lançamentos **inteiros**, por maior que seja a
  conta (antes parava nas primeiras 1.000 linhas). Se a leitura falhar, um
  aviso vermelho diz que os saldos podem estar incompletos.

#### Em qual conta o dinheiro está *(desde a 0.342.0, AP51)*

Cada recebimento e cada pagamento passa a dizer **em qual conta** o dinheiro
entrou ou saiu — e por isso cada conta da Conciliação soma **só o que é dela**.
Antes, com duas contas na unidade (corrente e aplicação, por exemplo), o
"Saldo pelo sistema" de cada uma somava o dinheiro das duas, e o dinheiro
recebido **em espécie** no balcão aparecia como diferença contra o banco.

- **Ao receber** (aba Financeiro da ficha do cliente) e **ao pagar** (Contas a
  pagar → **Pagar** e **Pagar a nota**) aparece o campo **Entrou em** /
  **Saiu de**, já preenchido: **Dinheiro** vem com o **Caixa (dinheiro)**;
  cartão, Pix e boleto vêm com a **conta principal** da unidade. Dá para
  trocar antes de confirmar. Trocar a forma de pagamento troca a sugestão.
- **A conta principal** se marca em Conciliação → **Editar conta** → **Conta
  principal**. É uma por unidade; marcar uma desmarca a outra. Com uma conta
  bancária só, ela já é a principal.
- **O Caixa** é uma conta da unidade que **o sistema cria sozinho** na primeira
  baixa em dinheiro. Na Conciliação ele não tem extrato: o número **No Caixa,
  pelo sistema** é o dinheiro que deve estar na gaveta — o que entrou em
  dinheiro, menos o que foi pago em dinheiro e o que foi depositado. Conte e
  compare.
- **Depositou o dinheiro no banco?** Na linha do depósito no extrato:
  **Transferência** → **É com o Caixa**. O dinheiro sai do Caixa e entra no
  banco, sem mexer no resultado.
- **O extrato manda.** Casar um lançamento com a linha de uma conta (Casar,
  Vários, Pagar conta) leva o lançamento para aquela conta — o extrato é a
  prova de onde o dinheiro está. Estorno volta pela mesma conta do original, e
  a taxa da maquininha sai da conta em que o recebimento entrou.
- **O que já estava lançado** antes desta versão conta como da conta principal;
  os recebimentos e pagamentos antigos **em dinheiro** passaram para o Caixa.
  Se a unidade tiver várias contas e nenhuma principal, a tela avisa quantos
  lançamentos ficaram sem conta: marque a principal e eles passam a contar
  nela.
- **Nada muda na DRE, no Fluxo de caixa nem no Painel da rede** — eles somam
  todas as contas da unidade, como antes.

**As contas pagas** (Contas a pagar; relato OC-00110, desde a versão 0.326.0).
Na lista, o filtro **Pagas** mostra as contas já quitadas — mas o período da
lista é pelo **vencimento**. Para saber **o que foi pago e quando**, use o
quadro **Relatório de contas pagas**, no alto da tela: escolha *Pago de … até*
e clique em **Relatório (PDF)** ou **Planilha**. Uma linha por pagamento, pela
**data do pagamento**: fornecedor, descrição, conta, vencimento, forma, valor,
multa e juros, desconto, total pago e se o pagamento **já foi conferido com o
banco** (conciliado). Pagamento estornado não entra. Na DRE, a despesa continua
entrando pela competência da conta, não pela data do pagamento.

**A nota fiscal (XML) e as contas a pagar dela** (Estoque → **Importar nota
fiscal (XML)**; desde a versão 0.324.0, relato OC-00109). Ao importar, os
**produtos** entram no estoque, cada um com o **valor real** da nota; e as
**parcelas** viram contas a pagar — **uma conta por parcela**, não por
produto.

- **De onde vêm as parcelas.** O XML traz as **duplicatas** que o fornecedor
  emitiu (vencimento e valor de cada uma) e diz a **forma de pagamento**. A
  tela de importação mostra isso no quadro **Como vai ser pago**, e você pode
  trocar antes de confirmar: **Como veio na nota**, **À vista** (uma conta, na
  data do pagamento) ou **Em várias vezes** (quantas e o 1º vencimento — uma
  por mês). A forma escolhida fica anotada em cada conta. A soma sempre fecha
  com o total da nota: a última parcela absorve os centavos.
- **Como a conta aparece.** *"Compra de material — NF 2852836 · parcela 1/12 ·
  boleto (17 itens)"*: o número da nota, **qual parcela é**, a forma (quando
  informada) e quantos produtos a nota tem. Os R$ 137,33 de cada linha são o
  valor **da parcela**, não de um produto. (Antes a descrição não dizia
  "parcela" e trazia "itemns" — as contas antigas foram corrigidas.)
- **Pagar a nota inteira de uma vez.** Na parcela de uma nota com mais de uma
  em aberto, **Pagar a nota (N)**: escolha a data, a forma e o comprovante, e
  todas as parcelas em aberto recebem a baixa do que falta delas. Cada uma
  continua na lista, como paga. Multa, juros ou valor diferente numa parcela
  pedem o **Pagar** daquela parcela; parcela aguardando autorização fica de
  fora.

> **O número do painel é o mesmo da tela para onde ele leva.** O resultado do
> mês no painel é o mesmo lucro líquido da DRE, do mesmo período — as duas usam
> a mesma conta, não duas parecidas.

**Na Franqueadora a tela é outra:** em vez do resultado de uma unidade, o
**resumo da rede** — quantas unidades estão no vermelho e no amarelo, quais
pedem atenção primeiro e por quê, e quanto das taxas está em aberto. Esse
resumo mostra o **retrato da última apuração dos alertas**, e diz na tela
quando ela foi; apurar na hora é botão do Painel da rede.

#### O Painel da rede por área *(desde a 0.341.0, relato OC-00121)*

Em **Rede → Painel da rede** (Admin Master e Financeiro da Franqueadora), no
alto, o **mês e o ano** — valem para todas as abas — e seis abas:

| Aba | O que mostra de cada unidade | Vermelho | Amarelo |
|---|---|---|---|
| **Visão geral** | os alertas e as taxas da rede (o painel de sempre) | caixa negativo previsto ou taxa vencida | o que ainda dá para resolver |
| **Contas a pagar** | o que deve **hoje**, o que vence no mês e o que pagou no mês | conta vencida | conta esperando autorização |
| **Recebíveis** | o que tem a receber **hoje** e o que recebeu no mês | inadimplência acima do limite da unidade | vencido dentro do limite |
| **Fluxo de caixa** | saldo no início, entradas, saídas e saldo no fim do mês | o saldo fica negativo em algum dia do mês | sai mais do que entra, com o saldo aguentando |
| **DRE** | receita líquida, resultado e **margem** do mês | prejuízo | margem mais de 2 pontos abaixo da margem da rede |
| **Hora clínica** *(desde a 0.362.0)* | a **hora clínica** (custo fixo por mês, horas de cadeira, ocupação esperada e real, hora real) nos **3 meses fechados** até o mês escolhido | — | hora mais de 10% acima da hora da rede |

Cada aba é uma **tabela em colunas** (desde a 0.341.1, relato OC-00122). A
primeira linha, **Rede**, traz o total nas **mesmas colunas** das unidades —
o número de cada unidade fica logo abaixo do número da rede. Na coluna
principal (a pagar, a receber, entradas, receita líquida) aparece também
**quanto a unidade representa da rede** (*"60% da rede"*). No celular a tabela
rola para o lado com o dedo, e o nome da unidade fica fixo à esquerda. Abaixo
da linha Rede vêm as unidades **na ordem de atenção**
(a pior primeiro), cada uma com uma bolinha e a **frase que explica a cor** —
por exemplo *"Saldo fica negativo em 08/10 (-R$ 2.000,00)"* ou *"Puxa a rede
para baixo: margem de 12%, −8 p.p. da média"*. Bolinha cinza é **sem dado**
(nenhuma conta, nada a receber, sem receita): unidade calada não é unidade em
dia.

> **Os números são os da tela da unidade.** A rede soma as mesmas contas que o
> Contas a pagar, os Recebíveis, o Fluxo de caixa e a DRE de cada unidade
> fazem — por isso, ao abrir a unidade, o número é o mesmo.

> **No DRE a cor é a margem, não o valor.** Em reais a unidade grande sempre
> pareceria melhor e a pequena sempre pior. A margem da rede é o resultado de
> todas dividido pela receita de todas — não a média das margens. A soma da
> aba é **comparação**: ela não é o resultado da Franqueadora (esse está no
> **Consolidado**).

> **Na Hora clínica, a conta é a da Precificação** (veja *A hora clínica
> calculada*, na parte do Admin Master): custo fixo ÷ (horas de cadeira × ocupação esperada). A
> hora da rede é o custo de todas dividido pelas horas de todas. Unidade sem
> custo fixo lançado ou sem agenda nos 3 meses fica cinza, mostra o valor
> provisório digitado e **não entra na média**. Ali, **Abrir na unidade** leva
> ao **Ponto de equilíbrio** dela, nos mesmos 3 meses, com o custo conta a
> conta.

> **No Fluxo de caixa não existe "saldo da rede".** O dinheiro de uma unidade
> não paga a conta da outra; por isso a linha Rede mostra um traço nos saldos
> e diz **quantas unidades ficam negativas** no mês. Nos Recebíveis, a coluna
> **Limite** também fica com traço na linha Rede: cada unidade tem o seu.

**Abrir na unidade.** Cada linha tem o botão **Abrir na unidade** (na Visão
geral, ele aparece ao clicar na unidade). Ele troca a unidade de trabalho —
como o **Trabalhar na clínica** — e abre o relatório do **mesmo assunto e do
mesmo mês** naquela unidade. No alto do Financeiro aparece a faixa *"Você abriu
… pelo Painel da rede"* com o botão **Voltar para a rede**, que devolve à
franqueadora de onde você saiu, na mesma aba e no mesmo mês. Trocar de unidade
pelo seletor apaga a faixa. Os **Recebíveis** abrem sem filtro de data (lá a
data filtra pelo vencimento, e esconderia o atrasado). O mesmo botão está nas
telas **Recebíveis da rede** e **Consolidado**.

O Financeiro da Franqueadora com escopo **Específicas** vê todas as unidades
nas abas (o número vem do banco), mas só tem o **Abrir na unidade** nas do
escopo dele.

**A barra de abas encolheu.** As telas de todo dia ficaram à mostra (Painel,
DRE, Fluxo de caixa, Recebíveis, Contas a pagar, Conciliação) e o resto entrou
em três menus: **Análise**, **Rede** (só na Franqueadora) e **Cadastros**. O
menu fica aceso quando você está numa tela dele.

### 2.4. Recebíveis e inadimplência

A aba **Recebíveis** é o outro lado do Contas a pagar: o que a unidade tem **a
receber**.

Ela tem uma **barra de abas**, e cada aba responde uma pergunta diferente:

| Aba | Uma linha por | Serve para |
|---|---|---|
| **Visão geral** | cobrança | conferir o financeiro |
| **Inadimplentes** | pessoa | **ligar e cobrar** |
| **Rede inteira** | unidade | comparar as unidades (só na Franqueadora) |

A terceira aba é a mesma tela que fica em **Rede → Recebíveis da rede**; ela
ganhou um atalho aqui porque é aqui que a pergunta aparece.

**No alto da visão geral:** quanto há a receber, quanto já venceu, a **taxa de
inadimplência** e quanto foi recebido no mês.

> ⚠️ **O quadro "Vencido" mostra só o principal**, sem multa e juros. É de
> propósito: a taxa de inadimplência divide o vencido pelo que há a receber, e
> os dois lados precisam ser a mesma coisa — somar encargos só em cima faria a
> unidade parecer pior a cada dia que a dívida ficasse parada, mesmo sem
> nenhuma cobrança nova atrasando. **O valor que se cobra da pessoa**, esse sim
> com multa e juros, está na aba **Inadimplentes** e na coluna *Com multa e
> juros* da tabela.

**Duas escadas de prazo**, e elas não se misturam de propósito:

| Escada | Responde | Para que serve |
|---|---|---|
| **A vencer, por prazo** | o que vence em 30, 60, 90 dias | é o que existe para **antecipar** |
| **Vencido, por tempo de atraso** | há quanto tempo cada parte venceu | é o que existe para **cobrar** |

> **Por que separadas.** O que vence semana que vem e o que está parado há seis
> meses pedem decisões opostas: uma é sentar com o banco, a outra é ligar para
> o cliente. Numa escada só, as duas apareceriam lado a lado.

**Sobre antecipar:** a tela mostra **quanto existe**, não quanto entraria na
conta. O desconto que o banco cobra para antecipar depende de negociação e não
está cadastrado no sistema — mostrar um valor líquido seria prometer dinheiro
que não chega.

**A taxa de inadimplência** é o **vencido dividido pelo que há a receber** —
não sobre o faturamento, senão ela cairia em todo mês de venda forte mesmo com
a cobrança piorando. Ela é comparada com um limite definido pela **rede**, no campo **Teto da
inadimplência (%)** em **Financeiro → Cadastros → Configuração** — no mesmo
bloco de multa, juros e carência. Na unidade, deixar o campo **vazio** quer
dizer *"sigo o padrão da rede"*; preencher cria uma exceção só para ela.

> ⚠️ **O limite não é um índice de mercado.** Nenhum sistema sabe qual taxa é
> "saudável" para a sua clínica: depende do ticket, do meio de pagamento e da
> praça. O número é uma decisão da rede, e serve para comparar unidades na
> mesma régua — não para dizer que a Risarte está certa ou errada diante do
> mercado.

**Cartão a cartão, o que entra na conta:** só cobranças que ainda devem alguma
coisa. Paga, cancelada ou substituída por renegociação fica na ficha do
cliente — aqui ela inflaria o total sem ser dívida. E **cartão não conta como
atrasado enquanto não liquidou**: a adquirente paga em D+30, e cobrar antes
disso acusaria de inadimplência o que é só prazo combinado.

#### A aba Inadimplentes — a fila de ligação

É a lista de quem cobrar hoje. **Uma linha por pessoa**: quem deve cinco
parcelas aparece **uma vez**, com a soma — ninguém liga cinco vezes para a mesma
pessoa.

Cada linha traz o **nome**, o **telefone** (clicar disca; o ícone ao lado abre o
WhatsApp), o **valor devedor com multa e juros**, há quantos dias está o
**atraso mais antigo** e o **último contato**. Quem tem parcela ainda a vencer
mostra isso ao lado, para dar a dívida inteira na mesma conversa.

**Quatro quadros no alto:** pessoas a cobrar, quantas ainda **não foram
contatadas**, quantas **prometeram e não pagaram**, e quantas estão **sem
telefone no cadastro**.

**Registrar contato** abre a janela do retorno. Escolha o que aconteceu:

| Resposta | O que acontece |
|---|---|
| Não atendeu · Falei com a pessoa · Sem condições agora · Número errado | fica registrado |
| **Prometeu pagar** | pede a **data**; passado o dia sem pagamento, a pessoa volta **destacada em vermelho** |
| Diz que já pagou | a tela lembra de conferir na **Conciliação** antes de cobrar de novo |
| Contesta a dívida · Pediu para renegociar | acordo não se fecha no telefone: quem decide é o **Gerente**, em Renegociações |

> ⚠️ **O registro não se edita nem se apaga.** É a sequência de tentativas que
> prova que a unidade cobrou. Errou ao digitar? **Registre de novo** — a
> correção também entra no histórico, e a tela sempre mostra o último.

**Quem não aparece na lista:** quem só tem parcela **a vencer** (a vencer não é
atraso) e as cobranças **sem paciente vinculado** — sem pessoa não há para quem
ligar. Essas últimas aparecem contadas num aviso, para não sumirem em silêncio.

#### Relatórios: PDF e planilha

As abas têm os botões **Relatório (PDF)** e **Planilha**, no alto à direita.
Os dois levam junto o filtro que estiver na tela: o relatório é sempre o que
você está vendo.

- **Relatório (PDF)** abre uma **página de relatório** — um documento, não a
  tela. No alto vêm a marca, a unidade, o período, quem gerou e quando; depois
  a linha da margem, os números de destaque, a tabela com a linha de **TOTAL**
  e as notas de rodapé. Nessa página há o botão **Salvar em PDF**, que chama a
  janela de impressão do navegador.
- **Planilha** baixa um `.xlsx` formatado: cabeçalho fixo ao rolar, filtro nas
  colunas, larguras certas e a linha de total. O dinheiro e as datas vão como
  **número e data de verdade**, não como texto — dá para somar, ordenar e
  filtrar no Excel sem redigitar nada.

> **Na janela de impressão, marque *Gráficos de fundo***. Sem isso o navegador
> imprime só o texto e o cabeçalho da tabela sai sem a faixa azul. A barra do
> Financeiro e o menu lateral **nunca** saem no papel.

**Filtro por período**, nas duas abas: escolha *vencimento de* e *até*. Quando
há filtro, aparece um aviso de que aquilo é **um recorte**.

> ⚠️ **O recorte não é o total da unidade.** Os quadros do alto e a **taxa de
> inadimplência** continuam sendo da unidade inteira, sempre. Taxa de um pedaço
> de calendário não é taxa de ninguém — e um relatório de março lido como se
> fosse a inadimplência toda leva a decisão errada.

**Todo relatório traz a linha da margem:** *"Dentro do limite de 7% definido
pela rede"* ou *"ACIMA do limite…"*.

> ⚠️ Ele diz **"dentro do limite"**, nunca **"saudável"**. O número é a decisão
> que a rede tomou, não uma referência de mercado — um relatório que se dá nota
> não ajuda a decidir nada.

**Na Franqueadora há um seletor de unidade** na aba Inadimplentes: dá para abrir
a fila de cobrança de qualquer unidade **sem trocar a unidade ativa**. E na aba
**Rede inteira** os mesmos dois botões exportam o quadro de todas as unidades,
com quem passou do próprio limite.

**Na Franqueadora há a visão da rede:** menu **Rede → Recebíveis da rede**. Ela
mostra todas as unidades lado a lado — a receber, vencido, a taxa de cada uma e
o limite dela — mais os totais da rede e as duas escadas de prazo somadas.
Cada linha tem **Abrir na unidade** (desde a 0.341.0): entra na unidade e abre
os Recebíveis dela, com a faixa **Voltar para a rede**.

> **A ordem da lista é "quem pede atenção primeiro".** Quem estourou o limite
> vem na frente e, entre essas, **quem tem mais dinheiro vencido** — não quem
> tem a maior taxa. Uma unidade com R$ 300 vencidos e 100% de inadimplência
> aparece pior que uma com R$ 80 mil e 12%, e é atrás dos R$ 80 mil que se vai
> primeiro. A taxa diz se a unidade está doente; o valor diz o tamanho do
> problema.

> **A inadimplência da REDE não é a média das taxas das unidades.** É o vencido
> de todas dividido pelo que todas têm a receber. Na média, uma unidade pequena
> com tudo vencido pesaria igual a uma grande em dia, e a rede pareceria muito
> pior do que é. Se você conferir somando com o dedo, some os dois totais — não
> tire a média das colunas.

### 2.5. Risartanos: a equipe e o acesso na mesma ficha

Antes havia **duas** telas para a mesma pessoa: *Risartanos* (o cadastro de RH)
e *Usuários (acesso)* (o login). Quem quisesse saber **se alguém que saiu ainda
entra no sistema** precisava abrir as duas e comparar de cabeça. Agora é uma só:
**Risartanos**.

**A lista.** Cada linha é uma pessoa: foto, código (`RIS-000001`), unidades com
a função em cada uma, regime e, à direita, o **selo do acesso**:

| Selo | O que quer dizer |
|---|---|
| **Com acesso** | entra no sistema normalmente |
| **Sem acesso** | está no cadastro, mas não tem login (a linha mostra a unidade e a **função prevista** no cadastro) |
| **Acesso desativado** | tem login, e ele está bloqueado |
| **Login ainda ativo** | 🔴 **saiu da equipe e continua entrando** — resolva |
| **Cadastro incompleto** | entra no sistema, mas não tem ficha de Risartano |

Os quatro atalhos no alto (*Toda a equipe*, *Com acesso*, *Sem acesso*,
*Precisa de atenção*) são filtros de um clique. A lista vem ordenada por risco:
quem saiu e continua com login aparece **em cima**; os cadastros incompletos
ficam no fim, como lista de pendências.

**As medalhas de certificação** (desde a versão 0.349.0). Embaixo do e-mail,
cada pessoa mostra **uma medalha por função em que cumpriu a missão de
certificação** — *Recepcionista*, *Coordenador Clínico*… Passe o mouse para ver
a data. **Dourada** = ela tem aquela função hoje; **mais clara, com borda
tracejada** = já foi certificada nela e mudou de função (continua à vista de
propósito: é o que serve para remanejar alguém ou **cobrir um colega que
faltou**). **×2** quer dizer que ela passou duas vezes (a segunda foi
reciclagem). O filtro **Certificado em…** mostra só quem tem aquela medalha —
inclusive quem mudou de função. Quem vê as medalhas é quem já vê a lista
(Admin, Franqueadora, Gerente e Franqueado da unidade); a própria pessoa vê as
dela no **Início**.

**A ficha** (clique em qualquer linha) mostra, no alto, a seção
**Certificações**: cada medalha com o histórico — a data, se foi a certificação
ou uma reciclagem, e se foi automática ou aprovada pelo Admin. Abaixo dela, a
ficha tem **duas abas**:

**Aba Cadastro** — dados pessoais, contato, endereço, contrato e a **função na
unidade**. Três coisas ajudam a errar menos:

- **CPF, CEP e WhatsApp mostram a máscara enquanto você digita.** Os pontos e
  traços aparecem sozinhos; dígito a mais ou a menos fica visível na hora.
- **A função é obrigatória** e é ela que vai preencher o acesso depois.
- **As especialidades só aparecem para Dentista.** Para recepção, TSB ou
  gerente a lista nem é mostrada — e quem deixa de ser dentista perde as
  marcações (senão continuaria sendo sugerido para uma sessão de Endodontia).

**Aba Acesso** — o e-mail de entrada, as funções por unidade, a senha
provisória, os botões de ativar/desativar e as **unidades e situação** (ativar
ou inativar a pessoa **em cada unidade** — ela pode ter parado em Londrina e
continuar em Cambé — e **desligar da equipe**, que é o cadastro inteiro).
**Só o Admin Master mexe no acesso**; Gerente, Franqueado e Franqueadora/RH veem
para saber o que está valendo.

**Admin Principal e outros Admins.** O dono do sistema é o **Admin Principal**.
Ele pode tornar outras pessoas **Admin** — na aba **Acesso** da ficha, botão
**Tornar Admin** (e **Retirar Admin**). Um Admin faz tudo no sistema, em todas as
unidades, mas fica **sempre abaixo do Admin Principal**:

- só o **Admin Principal** dá ou tira o Admin de alguém;
- o **acesso de qualquer Admin** — login, senha, funções, ambientes, desativar —
  só o Admin Principal altera. Um Admin não mexe no acesso de outro Admin, nem
  no próprio, e nunca no do Admin Principal. Na ficha de um Admin, os botões de
  acesso só aparecem para o Admin Principal;
- a **matriz de permissões** qualquer Admin pode alterar.

A trava não é só da tela: o sistema recusa a alteração mesmo que alguém tente
por outro caminho.

**Primeiro o cadastro, depois o acesso.** Enquanto faltar dado no cadastro, a
aba Acesso diz **o que falta** em vez de oferecer um login — e não existe outro
caminho para criar acesso sem a ficha completa.

> **Antes de cadastrar, peça os dados à pessoa.** O texto pronto (WhatsApp e
> e-mail) está em `docs/treinamento/mensagem-cadastro-risartano.md`, com a
> lista exata do que o formulário exige.

**Cadastrar alguém novo:** botão **Novo Risartano**. Ao salvar, a ficha já abre
na aba **Acesso**, com tudo preenchido a partir do cadastro: e-mail, a unidade,
a função escolhida e uma **senha provisória sugerida** pelo sistema (sem letras
e números que se confundem ao ditar por telefone). Ao Admin sobra conferir e
clicar em **Criar acesso**.

**Cada pessoa vê o próprio cadastro.** No **Perfil** (clique no seu nome, no
rodapé do menu), o bloco **Meu cadastro** mostra o que a Risarte tem sobre
você: foto, código, unidade, função, regime de contrato, contato, endereço e
dados pessoais. É **só leitura** — ficha de RH não se corrige sozinha; se algo
estiver errado, fale com a gestão da sua unidade. O que você mesmo altera
(nome de tratamento, telefone e senha) continua logo acima, na mesma tela.

**Enviar os dados de acesso.** Depois de criar o acesso (ou redefinir a senha),
a aba **Acesso** mostra uma **mensagem pronta** com:

- o **endereço** do sistema (ou do treino, para quem ainda não foi liberado no
  real);
- o **login** (o e-mail) e a **senha provisória**;
- **todas as unidades** da pessoa, com a **função em cada uma**;
- o que ela deve fazer no primeiro acesso (trocar a senha no Perfil).

Três botões: **Copiar**, **WhatsApp** (abre a conversa com o número do cadastro)
e **E-mail** (abre o programa de e-mail já preenchido).

> ⚠️ **A senha provisória só existe naquele instante** — o sistema guarda apenas
> uma versão embaralhada dela. Se a mensagem aparecer sem senha, é porque ela
> não foi criada agora: use **Redefinir senha** para gerar outra. E mande a
> senha por um canal separado do resto da mensagem, nunca num grupo.

> ⚠️ **Acesso em outra unidade pede autorização.** Dar função numa unidade
> diferente da unidade do cadastro exige que o Admin autorize no ato — a pessoa
> passa a ver os dados daquela unidade, e o registro vai para a Auditoria.

> **O e-mail é o que amarra os dois lados.** Ao cadastrar um Risartano com o
> mesmo e-mail de um login que já existe, o sistema liga os dois sozinho.

**Quem já tinha login e não tinha cadastro** aparece com o selo *Cadastro
incompleto* e o botão **Completar cadastro**, que abre o formulário já com nome
e e-mail preenchidos.

> **Cadastrar e alterar Risartanos é SÓ no sistema real.** No treino a tela
> Risartanos mostra a mesma equipe, com as mesmas fichas e os mesmos acessos,
> mas **só para consulta** — veja "No treino, a equipe é cópia do sistema real",
> na seção 2.6.

### 2.6. Os três ambientes

O Risartano usa **um login só** em três lugares:

| Ambiente | O que é |
|---|---|
| **riSZon** | o sistema do dia a dia — agenda, prontuário, jornada, financeiro |
| **riSZon Treino** | o mesmo sistema com **dados de mentira**, para aprender sem medo. A **faixa amarela fica no topo o tempo todo**, mesmo rolando a tela — se ela estiver lá, você não está no sistema de verdade |
| **Risarte Academy** | cursos, vídeos, provas e certificados |

**O ponto de partida é sempre a tela de Início do riSZon.** Lá aparecem os
atalhos para o treino e para o Academy — cada um abre em **uma aba própria**.
Clicar de novo volta para a aba que já está aberta, em vez de abrir outra: dá
para ir e voltar o dia inteiro sem encher o navegador.

**Quem chega novo entra antes de ser liberado no sistema de verdade.** Nesse
período ele vê **só a tela de Início**, com os atalhos: o menu dos módulos nem
aparece, e digitar o endereço de outra tela devolve para o Início. No alto, à
direita, ficam o **Perfil** (para trocar a senha) e o botão **Sair**. É assim
que o treinamento começa: primeiro o treino, depois o sistema real.

**Boas-vindas.** Nos **3 primeiros acessos** ao riSZon (uma vez por dia)
aparece uma janela de boas-vindas: o que é o sistema, o próximo passo (para
quem ainda está só no Início, é o **riSZon Treino**), onde trocar a senha e
onde está o Manual. Depois do terceiro, ela não volta.

> **Para o Admin Master:** o texto exato dessas mensagens fica em
> **Administração → Orientações**, no bloco *O que o sistema já diz sozinho* —
> junto com o guia do treino. É só consulta, para você saber o que a equipe
> está recebendo sem precisar lembrar de cabeça.

**O caminho de quem chega:**

1. O Admin **cadastra** a pessoa no sistema real e **cria o acesso** com o
   **riSZon Treino marcado** (já vem marcado) e o **riSZon desmarcado**. O login
   do treino nasce com a **mesma senha**.
2. No treino, a pessoa entra com **tudo o que a função dela permite** — agenda,
   jornada, atendimento, o que for da função. No sistema real ela vê só o
   Início.
3. Quando ela **cumpre a missão de certificação**, o sistema real abre sozinho
   (ou depois da aprovação do Admin, conforme a configuração) — veja *Quando
   você cumpre a missão*. Sem missão definida para a função, o Admin libera à
   mão: **Liberar** no **riSZon** (ficha → aba Acesso). Em todos os casos ela
   usa o sistema real **nas unidades em que a função dela estiver liberada**
   (veja abaixo).

> Desmarcar o treino ou o Academy na hora de criar o acesso agora vale: a
> pessoa fica **sem** aquele ambiente até alguém liberar.

**Para quem libera (Admin Master):** na ficha do Risartano, aba **Acesso**, há
os três ambientes com **Liberar** / **Retirar**.

- **riSZon** — sem ele, a pessoa fica só no Início.
- **riSZon Treino** — liberar **abre o login dela no treino**, com o mesmo
  e-mail, e o sistema mostra uma **senha provisória do treino** para você anotar
  e passar por um canal seguro. Retirar **bloqueia** o login de lá (não apaga
  nada do que ela fez treinando).
- **Risarte Academy** — libera os cursos.

> **O treino e o Academy já vêm liberados** para quem ganha acesso: são os
> lugares de aprender. O que se libera caso a caso é o sistema de verdade.

#### O sistema real abre em cada unidade pela função que você tem nela

O **riSZon** liberado na ficha é a **porta**. Com a porta aberta, cada unidade
ainda abre ou fica fechada **pela função que a pessoa tem naquela unidade**:

- **Uma missão por função.** Quem é recepcionista em Cambé e em Londrina
  cumpre a missão de recepção **uma vez** e fica liberado nas duas.
- **Funções diferentes, missões diferentes — e cada uma libera sozinha.** Quem
  é recepcionista em Cambé e gerente em Londrina: cumpriu a de recepção, Cambé
  abre; Londrina continua fechada até cumprir a de gerência. Uma não espera a
  outra.
- **Liberação coletiva:** se a unidade tem uma turma coletiva de novatos em
  andamento, ela só abre quando **o grupo inteiro** cumprir — mesmo para quem
  já é certificado em outra unidade.
- **Função sem metas definidas não barra ninguém.** Enquanto as metas de uma
  função estiverem em branco em Administração → Certificação, a unidade abre
  normalmente para quem tem aquela função.
- **Quem já trabalhava quando esta regra entrou (versão 0.293.0) continua
  trabalhando**: cada unidade + função que já existia ficou registrada como
  *liberada antes do portão*. A regra vale para o que mudar dali em diante —
  por exemplo, uma recepcionista que passa a ser **gerente** na mesma unidade
  precisa da missão de gerência (se ela tiver metas).

**Unidade fechada some da sua lista de unidades.** Para você não achar que foi
defeito, o **Início** mostra o quadro **"Unidades ainda fechadas no sistema
real"**, com a unidade, a função e o motivo (*aguardando a missão desta
função*, *aguardando o grupo da unidade cumprir*). Se **nenhuma** unidade
estiver aberta, você fica só no Início, como quem acabou de chegar.

> **"Não foi possível conferir…"** — se o sistema não conseguir consultar a
> liberação naquele instante, ele **fecha** em vez de abrir, e avisa no Início.
> Recarregue a página em instantes.

**Para o Admin Master:** na ficha do Risartano, aba **Acesso**, o bloco
**"Sistema real em cada unidade"** mostra cada unidade com a função, **Aberto**
ou **Fechado** e o motivo.

- **Liberar sem missão** — aparece nas unidades que aguardam missão. Serve
  para o caso que a régua não prevê (por exemplo, alguém experiente vindo de
  outra rede). **O motivo é obrigatório** e fica registrado.
- **Retirar liberação** — aparece nas liberadas *antes do portão* ou *sem
  missão*. A unidade volta a exigir a missão. Nada é apagado: a retirada fica
  registrada. **Missão cumprida não se retira** — é fato histórico.
- **O interruptor riSZon, acima, vence tudo:** retirado, a pessoa fica fechada
  em **todas** as unidades, com certificado ou sem.

**Trocar a senha:** em **Perfil → Minha senha**, **no riSZon**, informando a
senha atual. A nova vale no riSZon **e no treino**. Dentro do treino a troca de
senha, nome e telefone não é feita: lá eles vêm do sistema real. (Recuperação
por link de e-mail, se um dia existir, não se espelha.)

#### Como usar o riSZon Treino

Na tela de Início do treino há sempre o quadro **"Este é o riSZon Treino —
aqui é para testar"** (dá para recolher com um clique). O recado dele:

- **É o mesmo sistema**, com as mesmas telas e regras, só que com **dados de
  mentira**. Nada do que se faz no treino chega ao sistema real, a um paciente
  ou ao caixa de uma unidade.
- **Fique à vontade e teste os limites:** cadastre pacientes inventados,
  agende, remarque, avalie, planeje, venda, dê baixa, cancele — e tente o
  caminho errado de propósito para ver o que o sistema responde.
- **O treino fica sempre disponível**, não só no treinamento inicial. Na dúvida,
  ou antes de fazer algo novo no real, faça primeiro no treino.
- ⚠️ **Nunca use dados de pacientes reais no treino** (nome, CPF, telefone,
  fotos, exames): são dados de saúde protegidos pela LGPD. Invente tudo.

#### No treino, a equipe é cópia do sistema real

**Quem cadastra e altera Risartanos, logins, funções, ambientes e permissões é
só o sistema real.** O treino recebe uma **cópia** de tudo, sozinho, a cada
alteração — e lá dentro essas telas são **só para consulta**, para todo mundo,
inclusive o Admin Master:

- **Risartanos** mostra a mesma equipe, com as mesmas fichas, fotos, unidades e
  acessos. Não há botão de novo cadastro, de editar nem de mexer no acesso. No
  alto aparece o aviso **Só consulta no treino**, com a hora da última cópia.
- **Matriz de permissões** mostra as mesmas permissões do sistema real, sem
  poder salvar. Cada função vê no treino exatamente o que veria no real.
- Na aba **Acesso** da ficha, os três ambientes aparecem **como estão no
  sistema real**.
- **Exceção: o nível de carreira do dentista** (Financeiro → Repasses) é do
  treino, como as tabelas de repasse: define-se lá mesmo, e a cópia não apaga o
  que foi definido.
- Os **usuários de treino por função** (a senha da recepção, a do gerente…)
  continuam entrando normalmente, mas **não aparecem** na lista de Risartanos:
  eles não são pessoas da equipe.
- **Fichas criadas no treino antes desta mudança** (cadastros de teste) também
  saem da lista. Se o número delas coincidia com uma ficha do sistema real, elas
  ganharam o final **-TREINO** (ex.: `RIS-000001-TREINO`); nada foi apagado.

**O seu login no treino** é criado junto com a cópia, com o **mesmo e-mail**.
Enquanto a senha não for definida no sistema real, você não consegue entrar lá:
troque a sua em **Perfil → Minha senha** (no riSZon) ou peça ao Admin Master
para redefinir — a senha nova passa a valer nos dois. Quem está **desativado**
no sistema real, ou teve o **treino retirado**, fica com o login do treino
bloqueado.

**Para o Admin Master:** em **Administração → Ambientes** fica o quadro **O
treino é cópia deste sistema**, com a hora da última cópia e o botão
**Sincronizar treino agora**, que copia tudo de uma vez. Use-o na primeira vez e
sempre que aparecer o aviso amarelo **"Alguma alteração de Risartanos ou
acessos não chegou ao treino"** na tela Risartanos. A cópia nunca atrapalha o
que você salvou no sistema real: se o treino estiver fora do ar, o seu cadastro
fica salvo e só a cópia fica pendente.

**Endereços:** ficam em **Administração → Ambientes** (só o Admin Master). O
Risarte Academy só mostra o atalho depois que o endereço dele for preenchido —
enquanto estiver em branco, o cartão não aparece.

### O portão: por que o sistema real começa fechado

**Todo Risartano novo entra primeiro no treino.** O riSZon real nasce
**fechado** para quem acaba de chegar — não é falha de cadastro, é a regra:
ninguém opera na base de verdade antes de aprender numa base onde errar não
custa nada. É isso que evita as duas coisas que mais atrapalham: gente
despreparada mexendo no sistema real, e o sistema real enchendo de cliente
inventado e pagamento de mentira.

**O que libera é cumprir a sua missão no treino.** Cada função tem metas
próprias, escolhidas entre **as ações que o sistema realmente consegue
contar** — a recepção cadastra pessoas, faz primeiros agendamentos, registra
check-ins e consentimentos; o coordenador conclui avaliações, avalia opções de
plano e preenche as fichas de anamnese (em **Ficha do cliente → Anamnese →
Preencher**, ou **Atualizar**); o dentista conclui sessões e escreve evoluções; o comercial faz
apresentações e fecha contratos; a **ASB** cuida do material — envia a lista
de compras (para a franqueadora ou local), dá entrada, manda material para
uso, faz o inventário e acerta o saldo — e pede indicação. Três delas valem para **todas** as funções:
relatar um problema, enviar uma sugestão e usar o chat — e a tela recomenda
meta **1** para as três (relato inventado para bater número dá trabalho a quem
responde; mensagem de chat em quantidade mede conversa, não competência). São
**88 ações ao todo, em 13 funções**, e
cada função só enxerga as suas. As metas valem para a **rede inteira**: não
existe unidade com régua mais fácil.

**Cada ação vem explicada**, para quem configura não precisar adivinhar: o que
exatamente é contado, **em qual tela** a pessoa faz aquilo, e se aquilo
**depende de outra pessoa** ter feito algo antes (não dá para receber
mercadoria sem alguém ter feito o pedido). As ações aparecem separadas em
**trabalho do dia a dia** e **acontece de vez em quando** — comece pelas
primeiras.

> **Até a versão 0.348.1, dois itens nunca contavam** (OC-00134): as
> *Anamneses clínicas preenchidas* do Coordenador contavam uma tela antiga de
> anamnese, que saiu quando vieram as fichas, e os *Lançamentos no razão* do
> Financeiro da Franqueadora contavam uma tela que não existe. Agora contam as
> fichas de anamnese e os lançamentos feitos na **Conciliação** (Lançar ou
> Transferência). Quem já tinha feito não precisa refazer: entra na conta o que
> foi feito **depois do aceite da missão**. O item de anamnese saiu da lista do
> Dentista — só o Coordenador consegue preencher a ficha.

> **Se a missão de uma função tiver só ações que dependem de terceiros**, a
> tela avisa. Quem tiver aquela função ficaria travado sem ter como resolver
> sozinho, e o portão viraria castigo por algo que não é dela.

**Para o Admin Master:** as metas ficam em **Administração → Certificação**,
uma função por vez (as já configuradas aparecem abertas; as demais abrem no
clique). Lá também se escolhe:

- **De quem depende a liberação** — só da própria pessoa (*individual*), ou de
  todos os participantes da unidade terem cumprido (*coletiva*);
- **O que acontece ao cumprir** — o sistema real abre sozinho (*automática*),
  ou o Admin Master recebe um aviso e confirma (*aprovação*).

**Na liberação coletiva, é preciso dizer QUEM participa** — por **cargo**
(toda recepcionista e todo coordenador da unidade, e quem for contratado
depois entra sozinho) ou por **pessoa** (estas cinco, pelo nome, e quem chegar
depois não entra sozinho). Isso existe por um motivo prático: sem a lista, a
liberação esperaria *todo mundo* da unidade, e bastaria uma pessoa de férias
ou recém-contratada para travar a equipe inteira sem ninguém entender por quê.

> **Grupo vazio não quer dizer "todo mundo".** Quer dizer que ainda falta
> escolher — e, enquanto faltar, a liberação coletiva não acontece. A tela
> avisa.

> **"As regras foram salvas, mas o grupo não"** (AP48). Até a atualização
> 0299, salvar o grupo falhava sempre assim, por um defeito do sistema: as
> regras eram gravadas e o grupo não. Depois da 0299 o grupo salva. Se a
> mensagem voltar, relate o problema.

### ⚠️ A missão só começa quando você aceita

**Esta é a parte mais importante desta seção.** A certificação **não fica
valendo o tempo todo**.

Primeiro você usa o ambiente de treino **à vontade**, para aprender: cadastre
paciente de mentira, erre, apague, refaça, teste todos os botões. **Nada disso
é contado.** É para isso que o treino existe.

Depois, quando a liderança abrir uma **turma**, você recebe um **aviso no
sino** (*"Você foi convocado para a certificação"*) e aparece um quadro na sua
tela de **Início do sistema REAL** dizendo **o que exatamente você vai precisar
cumprir**. Você lê com calma. Sem pressa — enquanto não clicar, continua nada
sendo contado.

> ⚠️ **O quadro da convocação aparece no sistema REAL, não no treino** (relato
> OC-00003). A certificação é guardada no real, e é lá que você aceita e
> acompanha. **A missão você cumpre trabalhando no treino** — e o que faz lá
> aparece no quadro do real. Quem entrar só no treino não vê o quadro: isso não
> é defeito. Quem ainda está com o sistema real fechado também entra no real e
> cai direto no Início, onde o quadro está — e o **sino** aparece também para
> ele, com os avisos da certificação.

**Tem mais de uma função, em turmas diferentes?** Aparece **um quadro para cada
missão**, um embaixo do outro, cada um com a **função e a unidade** no título
(*"Função: TSB · Unidade: Risarte Cambé - Centro"*) e o seu próprio botão
**"Aceitar e começar a missão"**. Aceite cada uma quando estiver pronto — elas
são contadas separadamente. (Até a versão 0.328.0 só a convocação mais recente
aparecia, e a outra ficava sem ter como ser aceita — relato OC-00111.)

**A mesma função em duas unidades é UMA missão.** Se você é, por exemplo,
dentista em Cambé e em Londrina e foi convocado nas duas, aparece **um quadro
só** — *"Função: Dentista · Unidades: Cambé e Londrina"*. Aceitar começa a
missão nas duas, e cumprir vale para as duas, com **um certificado**. Na
liberação coletiva você conta no grupo de **cada** unidade, e libera as duas de
uma vez. (Se você já tinha aceitado numa delas, a outra passa a contar a partir
do mesmo momento — nada do que você fez se perde.)

**Quando estiver pronto, clique em "Aceitar e começar a missão".** A partir
desse instante — e só dele — o que você fizer no treino conta para a sua
certificação. O que você fez antes, aprendendo, não entra.

> **Por que assim?** Porque a prova precisa medir o que você faz *sabendo* que
> está sendo medido. Contar o período de aprendizado faria a certificação ser
> conquistada por quem brincou bastante, não por quem aprendeu.

**Depois de começar, o cartão mostra o seu progresso** — cada critério com uma
barra e quanto falta: *"3 de 5"*, *"1 de 3"*. A contagem é feita no ambiente de
treino e **só considera o que você fez depois do clique**.

Duas regras que valem a pena saber:

- **Fazer mais num critério não compensa outro.** Vinte cadastros não ensinam
  a fazer check-in. Cada critério precisa ser atingido.
- **Se aparecer "não deu para medir", o seu trabalho não sumiu.** Quer dizer
  que o sistema não conseguiu falar com o ambiente de treino naquele momento.
  Tudo o que você fez continua lá, e aparece quando a medição voltar. Enquanto
  algum critério não puder ser conferido, a missão **não** é dada por
  cumprida — nada é liberado no escuro.

**Na liberação coletiva, você vê a sua equipe.** Logo abaixo do quadro da
missão, no Início, aparece **"Sua equipe na certificação"**: cada colega da
unidade com nome, função e situação — *ainda não aceitou*, *em andamento* (com
o percentual e a hora da última medição), *cumpriu*, *aguardando aprovação* ou
*certificado* — e quantos já cumpriram (*"2 de 5"*). A unidade só abre quando
todos cumprirem; o quadro mostra por quem o grupo está esperando. O percentual
dos colegas é a **última medição** feita (quando cada um abriu o Início ou
conferiu a missão), não uma medição deste instante — por isso a hora aparece.

**Para o Admin Master:** a lista de cada turma mostra, pessoa por pessoa, o
progresso de quem já começou. E o quadro **Acompanhamento da certificação**, no
alto de Administração → Certificação, junta **todas as turmas abertas**: cada
equipe (unidade) com *"N de M cumpriram"* e uma barra, e cada pessoa com a
situação e o percentual da última medição. Filtre por turma, unidade, função e
situação. **Medir agora** mede a unidade no treino naquele momento e atualiza
os números.

**Para o Admin Master:** as turmas ficam na mesma tela de Certificação. Escolha
**uma unidade, várias, ou marque "Rede toda"** — com muitas unidades, há uma
busca pelo nome. Escolha o tipo, confira a lista que o sistema monta, **agrupada
por unidade** (ele já pula quem tem certificação), e desmarque quem não deve
entrar agora — férias, afastamento, quem acabou de chegar.

Três coisas para saber sobre turmas de várias unidades:

- **É uma turma só**, com um código só — não uma por unidade.
- **Cada unidade é liberada quando o SEU grupo cumprir.** Numa turma da rede
  toda, Cambé não fica esperando Londrina.
- **Unidade que já está numa turma aberta aparece desabilitada**, com o código
  da turma. Ela só entra em outra quando aquela for encerrada — senão a mesma
  pessoa teria duas missões ao mesmo tempo.

Na lista de turmas, **abra uma unidade para ver o progresso de cada pessoa**:
ele é medido no treino na hora em que você abre, para a tela continuar rápida
mesmo com a rede inteira numa turma.

**Enquanto não houver turma aberta, ninguém tem missão** — e está certo assim.

### A reciclagem e o seu acesso ao sistema real

Quando a turma é de **reciclagem**, o Admin escolhe uma de três coisas — e o
que ele escolher **aparece na sua tela de Início desde o primeiro dia**:

| Escolha | O que acontece com você |
|---|---|
| **Continua trabalhando** | Nada muda. A reciclagem fica como pendência. |
| **Prazo até uma data** | Você trabalha normalmente até lá. Passou a data sem concluir, o acesso ao sistema real é suspenso automaticamente. |
| **Suspende agora** | Você fica sem acesso ao sistema real já na convocação, e volta ao concluir. |

**O prazo nunca chega de surpresa:** a data aparece no cartão da convocação
desde o dia em que você é chamado, com a frase dizendo o que acontece depois
dela.

**Se o seu acesso for suspenso**, o caminho de volta é um só: concluir a
reciclagem no treino. O Admin também pode **encerrar a turma**, e isso devolve
o acesso de todo mundo que ela havia suspendido.

> **O sistema nunca dá acesso a quem não tinha.** Se você já estava bloqueado
> por outro motivo — desligamento, afastamento —, a reciclagem não mexe nisso,
> nem para tirar nem para devolver.

### Quando você cumpre a missão

**A conferência acontece sozinha** em três momentos: quando você abre o
**Início**, quando clica em **"Conferir minha missão"** no cartão (use depois de
fazer o último item no treino, para saber na hora) e quando o Admin abre a sua
unidade na lista da turma.

Cumprida a missão, o cartão do Início muda, e o que acontece depende de como o
Admin configurou a liberação:

| Liberação | O que acontece |
|---|---|
| **Automática** | O certificado é gravado na hora e o sistema real abre nas unidades onde você tem aquela função. |
| **Aprovação do Admin** | O cartão diz *"Missão cumprida — aguardando aprovação"*. O Admin confere os seus números e aprova; aí o sistema real abre. Você não precisa fazer mais nada no treino. |
| **Reciclagem** (qualquer configuração) | O certificado novo é gravado na hora e, se o seu acesso estava suspenso por causa dela, **ele volta sozinho**. |

**A sua medalha.** Com o certificado gravado, o Início do sistema real passa a
mostrar o quadro **Sua certificação**, com uma medalha por função em que você
cumpriu a missão. Os seus gestores veem as mesmas medalhas na lista de
Risartanos (ver 2.5).

Duas coisas que valem nos dois casos:

- **Na liberação coletiva, a unidade abre quando o grupo todo cumprir.** Você
  já está certificado, mas aquela unidade espera os colegas — o Início mostra
  isso no quadro das unidades fechadas.
- **Se o Admin tiver fechado o seu acesso ao sistema real à mão** (na ficha), a
  certificação é registrada, mas o acesso não abre sozinho: o Admin é avisado e
  decide.

> **"Não deu para medir" nunca libera.** Se o ambiente de treino não responder
> na hora da conferência, nada é registrado — nem para liberar, nem para
> negar. O seu trabalho continua lá, e a próxima conferência encontra.

**Para o Admin Master:** com a liberação por aprovação, quem cumpriu aparece no
alto de **Administração → Certificação**, em **"Aguardando a sua aprovação"**,
agrupado por unidade e com os **números que a pessoa atingiu** em cada critério.
Aprove uma pessoa ou **todos de uma unidade de uma vez** — útil na coletiva,
onde a unidade só abre quando o grupo inteiro for aprovado. Dois cliques não
geram dois certificados. Você recebe um aviso no sino sempre que alguém entra
nessa fila, e também quando alguém cumpre a missão mas está com o acesso
fechado na ficha.

### 2.7. Metas (SMART)

O menu **Metas** (logo abaixo do Início) reúne as metas da rede e da sua
unidade, com uma **barra que mostra quanto já foi feito** — medida direto do
sistema, sem ninguém digitar número.

**Quem vê o quê.** Todo Risartano vê as metas em que **participa**. Gerente,
Franqueado e Coordenador veem todas as metas da(s) sua(s) unidade(s). A
Franqueadora e o Admin Master veem todas as da rede. Rascunho só aparece para
quem pode editar.

**Quem cria.** A **Franqueadora/Rede** e o Admin Master criam metas da rede
toda ou de várias unidades. O **Gerente** e o **Franqueado** criam metas da
**própria unidade**. As outras funções acompanham.

#### O painel

Cinco abas: **Ativas · A iniciar · Pausadas · Finalizadas · Canceladas** (e
**Rascunhos**, para quem tem algum). Os filtros acima dos cartões escolhem a
unidade, o indicador e **"Só as metas em que participo"**. Cada cartão mostra:

- o percentual e a **barra**. A cor é o **ritmo**: verde, no ritmo; âmbar,
  um pouco atrás; vermelho, atrás. O traço fino marca **onde a equipe deveria
  estar hoje**; o traço dourado marca a meta quando existe **Super Meta**;
- o realizado e o alvo ("R$ 11.250,00 de R$ 15.000,00");
- "no ritmo atual, termina em X%" e os dias que faltam;
- no Início, a sua posição: **"Sua unidade: 3º de 12"** (meta de várias
  unidades, pela unidade em que você está trabalhando) e **"Você: 2º de 8"**
  (meta individual) — quando a meta mostra o ranking;
- o **reconhecimento** combinado, quando há ("Reconhecimento: jantar da
  equipe"). Meta atingida ganha o **selo de troféu** e continua no seu Início
  por **7 dias** depois do fim.

**Como a barra é calculada.**

| A meta é… | O percentual é… |
|---|---|
| **Aumentar** até um valor | o realizado ÷ o alvo (passa de 100% quando supera) |
| **Reduzir** até um valor (ex.: faltas de 8% para 5%) | quanto já caiu ÷ quanto precisava cair. Em 6,5%, a barra mostra 50% |
| **Individual** | a média dos participantes, cada um contando até 100% |
| **Mensal**, depois de encerrada | meses atingidos ÷ meses |
| **No máximo** (limite — ex.: cancelamentos do Riso+) | quanto do limite já foi usado ("3 de 5" = 60%). Aqui **menos é melhor**: verde enquanto o uso acompanha o prazo, âmbar quando passa dele, vermelho quando estoura o limite |

> **O ritmo conta os dias já encerrados — até ontem.** No primeiro dia a meta
> aparece "Começando", não "atrás": o dia ainda está acontecendo.

> **Números do financeiro só para a gestão.** Numa meta financeira (vendas,
> ticket médio, receita, produção do dentista, inadimplência — inclusive a taxa
> em %), quem não enxerga o financeiro da unidade vê **o percentual da meta**,
> com o aviso "Números do financeiro só para a gestão". O seu próprio número
> você sempre vê.

> **Fotografia: inadimplência e vidas.** Alguns indicadores não somam: valem
> **o número de cada dia** (a taxa de inadimplência de hoje, as vidas ativas no
> Riso+ hoje). Neles o cartão diz **"Hoje (fotografia do dia)"**; o sistema
> guarda uma foto por dia, o gráfico mostra a evolução, e o **resultado da
> meta é o valor do último dia do prazo**. Como não existe histórico guardado
> de antes, a linha de base é o valor do dia em que a meta foi criada. Essas
> metas valem para o período inteiro (não mês a mês).

#### Criar uma meta — os cinco passos do SMART

Em **Metas → Nova meta**. No alto do passo S dá para **começar de um
modelo** (no início: Mês do Riso+, Avaliações do mês, Reduzir faltas,
Ortodontia no trimestre, Inadimplência abaixo do limite, Ocupação da cadeira,
Novos clientes e Ticket médio). O modelo preenche o indicador, o recorte, o
período e os textos; **revise cada passo** — nada é publicado sozinho. Ou fique
em "Começar do zero".

> **Os modelos são editáveis.** O Admin e a Franqueadora/Rede cuidam deles em
> **Metas → Modelos**: criar, editar e desativar (o desativado some da Nova
> meta e pode ser reativado). Mudar um modelo **não muda** as metas que já
> nasceram dele — a meta copia os campos ao ser criada.

Cada passo é uma letra; o círculo fica marcado
quando ela está completa, e você pode ir e voltar entre os passos. Ao lado, a
**meta por extenso** é escrita enquanto você preenche, por exemplo: *"Fechar
R$ 15.000,00 em vendas por mês na Risarte Centro, de 01/01/2027 a
31/03/2027."*

1. **S — Específica.** O nome; **o que vai ser medido** (o indicador — veja a
   lista abaixo); o **recorte** opcional (tipo de agendamento, especialidade,
   plano do Riso+, origem do cliente, origem da venda, especialidade nas
   vendas e na produção); **de onde os números
   vêm** (rede toda, unidades escolhidas ou a sua unidade); **quem participa**
   (toda a equipe, por função, pessoas escolhidas — dá para combinar); e
   **como** a meta vai ser alcançada.
2. **M — Mensurável.** A direção (aumentar ou reduzir), o **tipo de meta** —
   coletiva (um número de todos), individual (cada um com o seu alvo) ou as
   duas — e o **valor-alvo**. Na individual: o mesmo alvo para cada um, ou um
   total dividido entre todos. Opcional: **Super Meta** e o ajuste do alvo de
   **cada unidade** (meta de várias unidades) ou de **cada pessoa**. Quando o
   sistema tem o histórico, ele mostra uma **sugestão de alvo**: o histórico
   **+10%** (numa meta de reduzir, **−10%**) — o limite do "Realista". O botão
   **Usar a sugestão** aparece enquanto o alvo está em branco; o número é seu.
3. **A — Atingível.** O sistema mostra o **histórico** do mesmo indicador e
   dá um selo: **Realista** (até 10% acima do histórico), **Desafiador** (até
   30%) ou **Muito acima do histórico** — nesse caso é obrigatório explicar
   por que é possível. Diga também os **recursos** que a equipe terá.
4. **R — Relevante.** O **objetivo estratégico** e **por que esta meta importa
   agora**. Opcional: o **reconhecimento** ao atingir a meta e ao atingir a
   Super Meta ("jantar da equipe", "folga no aniversário"). **É só texto**: nada
   vai ao Financeiro nem à folha — o prêmio, se houver, é pago fora do sistema.
   Em meta de várias unidades (ou individual), a caixa **Mostrar o ranking**
   vem marcada; desmarque para a ficha não mostrar posições.
5. **T — Temporal.** Início, fim e se o alvo vale **para o período inteiro** ou
   **para cada mês**. Opcional: **marcos intermediários** ("1º mês com pelo
   menos 20 novos clientes").

**Repetir uma meta: Duplicar.** Na ficha de uma meta publicada, **Duplicar**
abre um rascunho igual, com o **período seguinte** já preenchido: uma meta de
outubro (dia 1 ao último dia) vira novembro; um trimestre vira o trimestre
seguinte; fora disso, o mesmo número de dias logo depois do fim. Se o período
seguinte já passou, ele começa no período de hoje. O **alvo vem copiado**, e ao
lado dele aparece a **sugestão pelo histórico** mais recente, quando há
histórico — revise antes de publicar. O nome ganha "(cópia)" para você trocar.
Só aparece para quem pode criar aquela meta.

Na **Revisão**, **Publicar meta** (ou **Salvar rascunho**). Faltando uma letra,
o sistema diz qual e leva até ela.

> **Quem participa por função ou "toda a equipe" muda sozinho.** Quem entra na
> equipe durante a meta entra na meta. Escolher pessoas fixa a lista.
>
> **Com participantes escolhidos, conta só o que eles fizeram.** Uma meta de
> agendamentos para as recepcionistas não conta o que o gerente agendou.

#### Depois de publicada

- **A iniciar → Ativa → Finalizada** acontecem **sozinhas pela data**.
- **Pausar** e **Cancelar** (no alto da meta) pedem o **motivo**. Enquanto
  pausada, os dias **não contam para o ritmo**, e o prazo final **não se
  estende sozinho** — se precisar de mais tempo, edite o fim. Cancelar é
  definitivo.
- **Editar** continua possível, mas **toda alteração pede motivo** e aparece
  no **Histórico** da meta. Indicador, recorte, abrangência, tipo de meta,
  direção e periodicidade **não mudam** — isso seria outra meta: cancele e
  crie uma nova.
- **Ao terminar o prazo, o resultado é congelado** na madrugada seguinte e não
  muda mais. Até lá, a meta aparece como **"Finalizada — apurando"**.
- Rascunho pode ser **descartado** (apagado): ninguém da equipe chegou a vê-lo.

**A ficha da meta** mostra o **reconhecimento** combinado, a barra grande, o
gráfico **realizado × esperado** dia a dia (com "Ver os números"), o **mês a
mês** (meta mensal), os **participantes** com o número de cada um (meta
individual ou com participantes escolhidos), o quadro **por unidade**, os
**marcos**, as cinco letras do SMART e o **histórico**.

**Campeonato entre unidades.** Numa meta de várias unidades com o ranking
ligado, o quadro vira **Campeonato entre unidades**: o **pódio** (1º, 2º e 3º)
e a posição de cada uma. A posição é pelo **percentual do alvo de cada
unidade**, não pelo número bruto — assim a unidade pequena compete com a
grande. Empate divide o lugar (duas em 1º, a seguinte é 3º). Numa meta de
**limite**, quem usou **menos** fica na frente. Os participantes da meta
individual aparecem na mesma ordem, com a posição.

#### Avisos no sino

A meta avisa sozinha — **uma vez só** cada aviso, e **nunca com valor em R$**
(só o percentual). Clicar no aviso abre a meta. Na central de notificações, os
avisos de meta têm a aba própria **Metas**.

| Aviso | Quem recebe | Quando |
|---|---|---|
| **Nova meta** | os participantes | na hora da publicação |
| **A meta começou** | os participantes | na madrugada do início (meta publicada "A iniciar") |
| **Faltam 3 dias** | os participantes | na madrugada, 3 dias antes do fim |
| **Marco atingido** | os participantes | na madrugada seguinte |
| **Meta atingida** / **Super Meta atingida** (antes do prazo) | os participantes e quem criou | na madrugada seguinte |
| **Meta encerrada**, com o resultado e o reconhecimento | os participantes e quem criou | quando o resultado é congelado |
| **Meta atrás do ritmo** | **só quem criou e os gestores** | na madrugada, no máximo 1 vez por semana |

> O "atrás do ritmo" não vai para a equipe de propósito: avisar todo mundo que
> está atrás desanima mais do que ajuda. Quem cria e quem gere decide o que
> fazer.
>
> As metas de **ocupação e horas ociosas da cadeira** (medidas pela conta do
> Planejamento Anual) não recebem "atrás do ritmo" nem "atingida antes do
> prazo": o banco não mede a cadeira durante a meta. Os outros avisos valem.

#### Resultados das metas

Em **Metas → Resultados**: as metas **encerradas** num período (padrão: os
últimos três meses), com filtro **De / Até** e por **unidade**.

- **No alto:** metas encerradas, atingidas, Super Meta, não atingidas e a
  **taxa de atingimento**. A taxa conta só as metas **com dados para apurar** —
  meta sem dados não conta como fracasso.
- **Por unidade:** cada meta em que a unidade teve registro, pelo **alvo
  dela**; unidade sem nenhum registro na meta não entra.
- **Por indicador** e **por objetivo estratégico**.
- **Quem mais atinge** (metas individuais): só para quem cria metas, e só com
  as metas que a pessoa pode editar. Os outros veem **"Você: atingiu X de Y"**.
- **A lista das metas**, com o resultado e o percentual de cada uma.
- **Planilha:** baixa o mesmo relatório em Excel (fica registrado na
  Auditoria).

> O relatório mostra **só percentuais**: os valores em R$ ficam na ficha de
> cada meta, para quem pode vê-los. Meta mensal: o percentual é a média dos
> meses, e ela só conta como atingida se atingiu em todos. O resultado é o
> **congelado** no fim da meta — não muda mais.

#### O que dá para medir (indicadores)

| Indicador | O que conta | Número de quem |
|---|---|---|
| Vendas fechadas (R$) e (quantidade) | Vendas de plano e vendas diretas fechadas (contrato + pagamento). Cancelada não conta | O consultor da negociação (venda direta: quem lançou) |
| Ticket médio das vendas | Soma das vendas ÷ quantidade | Idem |
| Agendamentos marcados | Pela data em que foram **marcados**. Cancelado não conta; falta conta | Quem marcou |
| Atendimentos concluídos | Atendimento terminado | O profissional do horário |
| Avaliações realizadas | Atendimento concluído do tipo Avaliação | O profissional do horário |
| Taxa de comparecimento / de faltas | Dos horários que já passaram **e tiveram desfecho**, quantos % vieram / faltaram | Quem marcou |
| Check-ins na recepção | Chegadas registradas | Quem registrou |
| Retornos e reavaliações marcados | Agendamentos de Retorno e Reavaliação marcados | Quem marcou |
| Procedimentos executados | Sessões de tratamento concluídas (recorte por especialidade) | O dentista que executou |
| Novos clientes | Cadastros, pela unidade onde nasceram (recorte por origem) | Quem cadastrou |
| Adesões ao Riso+ | Adesões **ativadas** (contrato + 1º pagamento); transferência não conta | Quem vendeu |
| Vendas por especialidade | Recorte em Vendas (R$ e quantidade): em R$, a **parte** da venda que é da especialidade (o desconto se reparte na mesma proporção); em quantidade, a venda com ao menos um procedimento dela | O consultor |
| Taxa de conversão | Das negociações abertas no período, quantas % já foram aceitas (a mesma conta do painel do Comercial) | O consultor |
| Receita recebida (caixa) | Recebimentos do período, sem os estornados | A unidade (só coletiva) |
| Receita faturada (DRE) | Receita bruta − deduções, pela conta da DRE. Sem gráfico dia a dia (a DRE é por período) | A unidade (só coletiva) |
| Taxa de inadimplência / Valor inadimplente | **Fotografia** — a mesma conta da tela do Financeiro | A unidade (só coletiva) |
| Recuperação de inadimplência | Recebido **depois do vencimento**, de parcelas que ficaram vencidas | A unidade (só coletiva) |
| Produção do dentista (R$) | O repasse das sessões concluídas (o mesmo da tela de Repasses) | O dentista |
| Opções de plano aprovadas | Aprovadas pelo Coordenador | O Planner que montou o plano |
| Novos clientes que avaliaram | Cadastrados no período que já fizeram a avaliação | Quem cadastrou |
| Cancelamentos do Riso+ | Adesões canceladas — meta de **no máximo**. Transferência não conta | A unidade (só coletiva) |
| Vidas no Riso+ | **Fotografia** — titulares e dependentes das adesões ativas | A unidade (só coletiva) |
| Indica +Risos — indicações recebidas / convertidas / novos Embaixadores | Registradas; convertidas pela data do fechamento (a régua do Indica); Embaixadores cadastrados | Quem registrou / converteu / cadastrou |
| Empresarial — empresas que aderiram | Empresas que entraram em **Fechado (ganho)** no funil, pela unidade principal da empresa | O consultor RisLife |
| Empresarial — vidas incluídas | Titulares e dependentes incluídos no convênio | A unidade (só coletiva) |
| Desconto médio concedido (%) | Desconto ÷ valor de tabela das vendas de plano fechadas, ponderado pelo valor. Meta típica: reduzir | O consultor |
| Vendas canceladas | Vendas de plano e diretas canceladas — meta de **no máximo** | A unidade (só coletiva) |
| Margem líquida / Margem de contribuição (%) | A mesma conta da DRE / do Ponto de equilíbrio. Várias unidades: ponderado (o lucro de todas ÷ a receita de todas) | A unidade (só coletiva) |
| Ponto de equilíbrio atingido (%) | Receita líquida ÷ ponto de equilíbrio (100% = empatou); visão contábil ou de caixa. A ficha mostra quanto falta **em R$ e em atendimentos** | A unidade (só coletiva) |
| Recebimento em dia (%) | Das parcelas que venceram no período, quantas foram pagas até o vencimento | A unidade (só coletiva) |
| Ocupação da cadeira (%) / Horas ociosas | A **mesma conta do Planejamento Anual**. Horas ociosas é meta de **no máximo** | A unidade (só coletiva) |
| Tratamentos concluídos | Clientes que entraram na Fase 6 (reavaliação) | A unidade (só coletiva) |
| Conversão da Jornada | Dos clientes avaliados no período, quantos % já fecharam venda | A unidade (só coletiva) |
| Clientes reativados | Atendidos no período depois de mais tempo sem atendimento que os "dias sem atendimento" da Administração | A unidade (só coletiva) |
| Certificações concluídas | Certificados emitidos pelo portão de certificação | A pessoa certificada |
| Relatos e sugestões enviados | Relatos e sugestões registrados — use para incentivar quem nunca relatou, não para competir | Quem relatou |

> **Ocupação e horas ociosas usam a conta do Planejamento Anual.** O número
> da meta é o mesmo da tela **Agenda → Planejamento anual** no mesmo período.
> Por isso o resultado final dessas duas é gravado na **primeira vez que a
> meta é aberta depois do fim do prazo** (até lá ela aparece "apurando"), e
> elas valem para o período inteiro, não mês a mês. Uma meta da rede inteira
> com muitas unidades demora um pouco mais para abrir.

> **Ponto de equilíbrio em R$ e em atendimentos.** Em percentual, o ponto de
> equilíbrio financeiro e o operacional são o mesmo número. A ficha da meta
> mostra as duas leituras: "faltam R$ 8.400 para empatar" e "faltam 23
> atendimentos", pela margem média por atendimento do período.

**Evidência:** EV-209 e EV-210 (etapa 1); EV-211 e EV-212 (etapa 2); EV-213 e EV-214 (etapa 3).

### 2.8. Ortodontia

**Desde a versão 0.361.0 (migração 0329).** O item **Ortodontia** do menu
acompanha todos os pacientes em tratamento ortodôntico da unidade. A ideia é
uma só: **cada paciente de ortodontia vira um caso**, com ortodontista, tipo de
aparelho, cronograma de manutenções, mensalidade e situação — e o sistema mostra
quem está no prazo, quem atrasou, quem faltou, quem precisa de agendamento e
quanto a ortodontia rende.

**O que é diferente de um tratamento comum.** A ortodontia **não é um
procedimento com preço fechado**: o paciente paga uma **mensalidade de
tratamento**, devida todo mês **com ou sem comparecimento à manutenção** (regra
da rede, escrita na proposta e no termo), **do início até a entrega das
contenções** (desde a versão 0.363.0). E o **ortodontista recebe por
manutenção realizada**: cada manutenção concluída gera uma linha no Repasse,
pela tabela de repasse do procedimento de manutenção configurado.

#### As telas

| Tela | Quem usa | O que faz |
|---|---|---|
| **Painel** (`/ortodontia`) | Gerente, Coordenador, Franqueado, Franqueadora, Admin | Os números: em tratamento, aguardando início, em acompanhamento; **no prazo × atrasados** (cada lista mostra as faltas e a **assiduidade** do paciente); sem agendamento; novos, finalizados (= contenções entregues), faltas e manutenções realizadas no período; **previsão de término** (3, 6 e 12 meses); receita recebida, prevista e inadimplência (para quem vê dinheiro); **de onde vêm os pacientes** (Indica +Risos, Riso+, Empresarial, indicação de cliente, direto); a evolução mês a mês; e, para a rede, a tabela **por unidade**. Todo número abre a lista por trás. |
| **Atenção** (`/ortodontia/atencao`) | **Recepção** (é a tela dela), e todos | Quem precisa de ação agora: **sem próximo agendamento**, **manutenção vencida** (prevista há mais de 7 dias sem agendar), **faltou na última**, **aguardando início**, **reavaliação vencida**, **pedido clínico em aberto**, **término atrasado** e, para quem vê dinheiro, **mensalidade atrasada**. Cada linha tem o WhatsApp, o botão **Agendar** (abre a agenda com o paciente) e o atalho para o caso. Em dia, o paciente não aparece. |
| **Casos** (`/ortodontia/casos`) | Todos do módulo | A lista com busca (paciente, código, ortodontista) e filtros por situação. O Dentista vê só os casos em que é o ortodontista. |
| **Novo caso** (`/ortodontia/casos/novo`) | Gerente, Coordenador, Admin | Passo 1: procurar o paciente da unidade. Passo 2: ortodontista, tipo, início, meses previstos, intervalo das manutenções, procedimento da manutenção (repasse), mensalidade, dia de vencimento, instalação (informativo). Os valores vêm da **Configuração** e podem ser ajustados. Marcando **"O aparelho já foi instalado"**, o caso nasce **em tratamento** e o cronograma é gerado na hora. |
| **A ficha do caso** (`/ortodontia/casos/[id]`) | Todos do módulo | Logo no alto, os **alertas da anamnese** do paciente (desde a 0.364.0, para o Dentista, o Coordenador e o Gerente). Situação e prazo (com a barra do tempo), os motivos de atenção, o **cronograma** manutenção a manutenção (prevista, agendamento ligado, situação, quem fez e a **evolução**: fio/arco, observações, próximo passo), as **mensalidades** com baixa (só para quem vê dinheiro), as **indicações** que o paciente trouxe, a origem dele e o **histórico**. Botões: **Prontuário**, **Planos de tratamento** e **Desenvolvimento clínico** (abrem a aba certa do prontuário — desde a 0.364.0), **Agendar**, **Termo** (imprimir/PDF), **Editar**; e as mudanças de situação (abaixo). |
| **Mensalidades** (`/ortodontia/mensalidades`) | **Gerente** e **Financeiro da Franqueadora** (dão baixa), Franqueadora, Admin; **Coordenador, Recepção e Franqueado só veem** | **Gerar mensalidades do mês** (uma por caso em tratamento, não duplica), **Dar baixa** (com a forma de pagamento), desfazer a baixa, **Marcar atrasadas** e, para o Gerente/Coordenador, cancelar com motivo. A cobrança da **contenção** (quando cobrada) aparece aqui com a etiqueta "Contenção". Desde a 0.363.0 a Recepção abre a tela **sem botões**: vê a situação de cada paciente para ajudar o Gerente e o Financeiro. |
| **Configuração** (`/ortodontia/configuracao`) | Admin (rede) e Gerente (a própria unidade) | O padrão da rede e o ajuste por unidade: mensalidade padrão, meses previstos, intervalo das manutenções, reavaliação a cada N meses, tolerância do prazo, dia de vencimento, o **procedimento da manutenção** (de onde sai o valor do repasse) e **a contenção no fim do tratamento**: cobrar ou não, o valor e uma condição especial (ex.: "em até 3x sem juros") — o que estiver aqui sai no termo do paciente. |

#### A situação do caso

**Aguardando início** (caso aberto, aparelho ainda não instalado) → **Em
tratamento** (o botão **Iniciar tratamento** gera o cronograma a partir da
data; a mensalidade é cobrada) → **Entregar contenções** → **Em
acompanhamento** → **Dar alta** → **Alta**. A qualquer momento,
**Interromper** (com motivo obrigatório: desistência, transferência…). Alta
ou interrompido pode ser **reaberto** por quem gere. Só existe **um caso aberto
por paciente**.

**A entrega das contenções finaliza o tratamento** (desde a 0.363.0, decisão
da rede). Na ficha do caso, o Gerente/Coordenador clica **Entregar
contenções**, confirma a data e, se a contenção for cobrada, o valor: o sistema
registra o tratamento como **finalizado naquela data**, cancela a mensalidade
dos meses seguintes e as manutenções previstas, gera a **cobrança da
contenção** (quando cobrada) e marca o **controle da contenção** para daqui a
um intervalo de reavaliação. O paciente passa a **Em acompanhamento**: continua
"em ortodontia" (aparece no cartão do prontuário, pode ter manutenção extra e
agendamento), mas **sem mensalidade**. **Dar alta** encerra o acompanhamento.
**Encerrar sem contenção** existe para o caso raro (mudança de cidade, por
exemplo) e também finaliza. O Painel conta como **finalizado** quem entregou
as contenções, na data da entrega.

**No prazo × atrasado:** o caso é "atrasado" quando passou da **data prevista de
término + a tolerância** configurada (30 dias por padrão) e ainda está em
tratamento. Finalizado (contenções entregues) compara a data da entrega com a
prevista.

**Cada falta prorroga o término previsto** (desde a 0.363.0): uma falta a uma
manutenção empurra a data prevista de término em **um intervalo de manutenção**
(30 dias por padrão), porque a etapa não realizada precisa ser refeita, e o
cronograma ganha a vaga correspondente no fim. A ficha do caso, a lista de casos
e o Painel mostram a **assiduidade** do paciente (manutenções realizadas ÷
realizadas + faltas) e quantos dias as faltas prorrogaram — assim, ao ver um
caso "atrasado" ou "em tratamento", você vê junto quantas vezes o paciente
faltou. A falta **fica registrada**: para reagendar, basta **Agendar** — o novo
horário liga-se à próxima prevista. **Desfazer falta** é só para a falta
marcada por engano (desfaz a prorrogação).

#### Como a agenda e o cronograma se falam

- Ao iniciar o caso, o sistema gera as **manutenções previstas**: uma a cada
  intervalo (30 dias por padrão), do início até o término previsto.
- A recepção **agenda como sempre**, em Agenda, com o **ortodontista do caso**
  (sessão de tratamento, início de tratamento ou retorno). O sistema **liga
  sozinho** o agendamento à manutenção prevista mais próxima (até 45 dias de
  diferença) — ou cria uma manutenção extra. Ela passa a **Agendada**.
- **Concluir o atendimento** marca a manutenção como **Realizada** e gera o
  **repasse** do ortodontista. **Não compareceu** marca **Faltou** (e prorroga
  o término previsto). Cancelar o agendamento devolve a manutenção a
  **Prevista** — mas uma falta já registrada fica como falta (só solta o
  agendamento).
- Quando o profissional do agendamento não é o ortodontista do caso, ou o
  agendamento veio antes do caso, use **Vincular** (ícone de elo) na linha da
  manutenção, na ficha do caso.
- O ortodontista (ou o Coordenador) registra a **evolução** no botão
  **Registrar** / **Evolução** da manutenção — e pode marcar como realizada por
  ali uma manutenção feita sem agendamento. Desfazer uma realizada é do
  Gerente/Coordenador e só antes do fechamento do repasse do mês.
- **A evolução vai também para o Desenvolvimento Clínico** (desde a 0.364.0):
  cada evolução registrada vira uma anotação no prontuário, assinada por quem
  registrou ("Ortodontia — manutenção N: fio/arco…, observações…, próximo
  passo…"). Corrigir no mesmo dia atualiza a anotação; se ela já estiver
  **trancada** (atendimento concluído ou dia encerrado), a correção entra como
  **adendo**, e se o atendimento já tem a anotação de quem atendeu, a evolução
  entra como adendo dela — uma anotação por atendimento, nada se apaga.
- **Manutenção extra** (bráquete solto, urgência): botão na ficha do caso.
- Se o caso ainda não tem **procedimento de manutenção** (nem na
  Configuração), a manutenção é concluída do mesmo jeito e o repasse nasce com
  **valor zero** — para alguém perceber e configurar (corrigido na 0.364.0:
  antes dava erro e travava a conclusão do atendimento).

#### Do clínico ao plano: quem indica, quem define, quem aprova (desde a 0.365.0)

A ortodontia entra pelo caminho normal do paciente — e cada papel faz a sua
parte:

1. **O Coordenador Clínico indica.** Na avaliação ou na reavaliação, no passo
   do exame clínico (logo abaixo do odontograma), marca **"Indicar tratamento
   ortodôntico"** e escreve o que observou. É uma **sugestão**, não uma
   decisão: dá para desfazer enquanto a rodada não tem o diagnóstico
   finalizado. A Recepção e o Dentista não marcam.
2. **O Dentista Planner define.** No cockpit dele aparece o cartão
   **"Ortodontia indicada"** (com a observação do Coordenador). Ao montar a
   opção do plano com um procedimento de Ortodontia, o bloco **"Proposta
   ortodôntica"** pede o **tipo de aparelho**, os **meses previstos**
   (referência), o **intervalo das manutenções** e a **contenção final**
   (placa removível, fixa colada, ambas ou a definir). Só o Planner (ou o
   titular) preenche, e só com o plano em rascunho/devolvido — enviado,
   tranca com o plano.
3. **O Coordenador aprova** a opção como sempre: a proposta vai junto. Não há
   passo novo.
4. **O Consultor Comercial vê** a proposta nas Condições do tratamento
   ortodôntico do orçamento impresso (tipo, meses, contenção prevista) e
   fecha o acordo — mensalidade, contenção cobrada ou não, descontos e forma
   entram na próxima etapa (ORTO8).
5. **O caso** aberto a partir da venda **já nasce** com o tipo, os meses e o
   intervalo da proposta; o ortodontista pode ficar em branco até a
   instalação.

**Quem inicia o tratamento.** O termo diz o nome do(a) ortodontista que
**inicia** (ou "a ser designado(a) pela clínica") e que, por necessidade da
clínica ou do paciente, **outro(a) ortodontista da equipe pode continuar**,
sem mudar as condições. Caso sem ortodontista escolhido: quando a Recepção
agenda a **instalação** (início de tratamento ou sessão) com um **dentista da
unidade**, ele passa a ser o responsável — fica no histórico do caso. Um
retorno não define, e quem não é dentista não assume. Trocar o responsável em
**Editar** também fica registrado (de quem → para quem).

**O prazo é uma referência.** O termo passou a dizer que os meses previstos
são uma estimativa, e não um compromisso de conclusão em data certa: a
duração real depende da resposta de cada paciente, da colaboração e da
assiduidade.

#### O que o ortodontista vê — e o que não vê

Desde a 0.364.0, **o Dentista não vê nenhum valor da ortodontia**: nem a
mensalidade, nem as cobranças, nem o que o paciente pagou — na ficha do caso,
na lista de casos, no cartão do prontuário e no termo. Não é só a tela que
esconde: o banco deixou de entregar esses números a ele (as condições
financeiras do caso vivem numa tabela própria, lida só por quem vê dinheiro).
Quem **vê** a situação financeira: o Gerente, o **Coordenador** (desde a
0.364.0), a Recepção, o Franqueado, o Financeiro da Franqueadora e a
Franqueadora/Rede. Quem **dá baixa**: o Gerente e o Financeiro (O2).

Para o ortodontista entender o que os outros profissionais propõem e fazem, a
ficha do caso tem os botões **Planos de tratamento** e **Desenvolvimento
clínico** (abrem a aba certa do prontuário) e mostra, no alto, os **alertas da
anamnese** (alergia, gestante, medicamentos, sangramento…), os mesmos do
prontuário.

#### A mensalidade e a DRE

- A mensalidade é **devida independentemente do comparecimento**, **do início
  até a entrega das contenções**. Essas regras — e se a contenção é cobrada ou
  incluída, e que cada falta prorroga o término — estão escritas nas
  **Condições do tratamento ortodôntico** que saem no **orçamento impresso**
  (quando o plano tem procedimento de Ortodontia) e no **Termo do tratamento
  ortodôntico** da ficha do caso.
- **Gerar mensalidades do mês** cria uma cobrança por caso **em tratamento**
  (em acompanhamento e aguardando início não cobram) com vencimento no dia
  configurado. Entregar as contenções, dar alta ou interromper cancela as
  mensalidades dos meses **seguintes**.
- **A contenção** (desde a 0.363.0): se a Configuração (ou o caso) diz que ela
  é cobrada, **Entregar contenções** gera uma cobrança própria, com o valor
  combinado, vencendo na entrega — ela aparece em Mensalidades com a etiqueta
  "Contenção" e recebe baixa como qualquer outra.
- Cada cobrança (mensalidade ou contenção) entra na **DRE da unidade** na linha
  **"Ortodontia — mensalidades e contenções" (1.1.04)**, no mês de
  competência, assim que é gerada; a **baixa** leva o valor para o **fluxo de
  caixa** do dia; desfazer a baixa volta; cancelar tira da DRE.
- **Quem dá baixa** (desde a 0.363.0): o **Gerente da unidade** e o
  **Financeiro da Franqueadora** (e o Admin). A Recepção e, desde a 0.364.0,
  o **Coordenador** **veem** a situação de cada paciente — na ficha do caso,
  em Atenção ("mensalidade atrasada") e na tela Mensalidades, sem botões —
  para ajudar quem cobra. O **Dentista não vê valor nenhum**.
- A **instalação do aparelho** continua sendo cobrada pelo plano/venda normal
  (linha "Procedimentos — plano de tratamento"); no caso ela é só informativa.

#### Ortodontia, Metas, Indica +Risos, Riso+ e Empresarial

O Painel mostra **de onde vêm** os pacientes de ortodontia: se chegaram por uma
indicação do **Indica +Risos**, se são beneficiários do **Riso+ (PPR+)**, se são
colaboradores do **Empresarial**, se vieram por **indicação de cliente** (o
"indicado por" da ficha) ou **direto**. Na ficha do caso, o bloco **Indicações**
lista quem o paciente trouxe. As **Metas** continuam medindo os procedimentos
de Ortodontia (modelo "Ortodontia no trimestre"); indicadores pelo caso vêm na
próxima etapa do módulo.

#### No prontuário

A ficha do paciente ganhou o cartão **Ortodontia** (situação, ortodontista,
próxima manutenção e, só para quem vê dinheiro, a mensalidade e as
mensalidades em atraso) com o botão **Abrir o caso ortodôntico**. Sem caso, o
cartão não aparece. Na aba **Desenvolvimento Clínico** aparecem as evoluções
da ortodontia (desde a 0.364.0).

**Evidência:** EV-235 a EV-242; contenção, baixa e faltas (0.363.0): EV-243 a
EV-245; a tela do ortodontista (0.364.0): EV-246 a EV-248; do clínico ao plano
(0.365.0): EV-249 a EV-251.

## A barra de cima

**O que você usa de dentro de qualquer tela mora no alto**, e não no menu
lateral. O menu da esquerda é só o caminho entre os módulos.

**Na ponta esquerda: a seta ← (Voltar).** Volta para a **tela anterior** em
que você estava, do jeito que ela estava — a mesma aba, os mesmos filtros.
Exemplo: na Auditoria, aba **Ações**, você abre a ficha de um cliente; a seta
traz você de volta à aba Ações, sem passar pelo Início (desde a versão
0.317.0).

- Ela faz o mesmo que a seta do navegador (ou **Alt + ←**): use a que preferir.
- Ela volta à tela **anterior**, não à "tela de cima": quem veio da Auditoria
  para a ficha volta para a Auditoria, não para a lista de clientes.
- **Apagada** quer dizer que não há tela anterior do sistema nesta aba — por
  exemplo, logo depois de entrar, ou numa aba que você acabou de abrir.
- **O que estava digitado e não foi salvo se perde ao voltar**, como ao clicar
  em qualquer item do menu. Salve antes.

**Logo depois: "Procurar paciente".** O caminho mais curto para uma ficha:
clique (ou **Ctrl + K**), digite, escolha com as setas e abra com **Enter**.
Procura por **nome**, pelo **código** (ex.: `CAM-00001`) e pelo **CPF** —
inclusive digitando só os números, sem pontos nem traço.

> **Dois pacientes com o mesmo nome?** A lista mostra o código e a unidade de
> cada um, para você escolher sem precisar abrir as duas fichas.

**À direita, a data e a hora** — sempre no **horário de Brasília**, que é o que
o sistema usa para decidir se um horário já passou, quando uma parcela vence e a
que mês um lançamento pertence. Se o relógio do seu computador mostrar outra
coisa, quem manda é este.

**E os desenhos:**

| | O que é |
|---|---|
| Lua / Sol | **Claro ou escuro** — troca a aparência do sistema. A escolha fica no seu computador |
| Antena, com número verde | **Quem está online** — **só o Admin Master vê este desenho.** O número é quantas pessoas estão online agora; um clique abre a lista (veja a [seção 13c](#13c-para-o-admin-master-a-auditoria)) |
| Balão de conversa | **Chat** da equipe, com o número de mensagens não lidas |
| Sino | **Notificações**, com o número de avisos não lidos |
| Triângulo | **Alertas do sistema** — o que o financeiro e o estoque estão avisando |
| Boia | **Relatar um problema** — abre um painel ao lado da tela em que você está. Dali também se chega aos relatos e respostas. **Tem número** (veja abaixo) |
| Ponto de interrogação **?** | **Ajuda desta tela** — abre ao lado o passo a passo da tela em que você está: para que serve, quem faz, os passos com o nome dos botões e o que costuma confundir, com o link para a parte do manual que explica. Desde a versão 0.318.0; já escrito para **Compras**, **Agenda**, **Atendimento**, **Jornada** e a **ficha do cliente** (desde a 0.321.0), e vai sendo escrito tela a tela — onde ainda não há, ele diz isso e oferece o manual |
| Livro | **Manual** — este texto, sempre na versão que está no ar |

> **O número da boia não quer dizer a mesma coisa para todo mundo.** Para o
> **Admin Master** ele é a fila dele: os relatos abertos e em análise, de todas
> as unidades. Ele some quando ele responde.
>
> Para **todo o resto**, ele conta as **respostas que você ainda não leu** nos
> relatos que **você** abriu. Cada uma deixa de contar quando você abre
> **aquele relato** — não basta entrar na lista.
> Contar a fila inteira para quem não responde seria pendurar no seu ícone um
> número sobre o qual você não pode fazer nada.

> **O "Abrir" do aviso leva direto ao assunto.** Na tela de Notificações, o
> **Abrir** de um aviso sobre um cliente abre o prontuário **na aba do
> assunto** — "Pedido respondido" cai em **Pedidos**, "Plano aprovado" em
> **Plano**, "Sessão atrasada" em **Sessões & Procedimentos**, renegociação em
> **Financeiro**, compartilhamento e transferência em **Histórico**, mudança de
> fase em **Jornada**. Se a sua função não tem aquela aba, o prontuário abre
> na primeira. Abrir um aviso não lido também o marca como lido (o botão mostra
> "Abrindo…" enquanto isso). As decisões pendentes ("necessita reavaliação?")
> não têm aba: a caixa delas fica no topo do prontuário, acima das abas.

> **Por que o triângulo não tem número.** O que é urgente já chega pelo sino: os
> alertas do financeiro disparam notificação. O triângulo é para consultar a
> lista completa quando você quiser. (Contar tudo o que ele mostra sairia caro e
> daria um número diferente do que a tela apresenta — número que não bate com a
> tela é pior que número nenhum.)

**No celular**, para a barra caber na tela, o relógio não aparece e **tema,
alertas, novidades e manual** ficam no botão **⋯** (no canto direito). A seta,
a busca, o **?**, o chat, os avisos e a boia continuam à vista.

**As novidades do sistema ficam na tela de Início** — a primeira que você vê ao
entrar. Ver [seção 15](#15-novidades-problemas-e-alertas).


**Se algo não aparecer para você**, não é defeito: é permissão. Ver
[seção 13](#13-perguntas-frequentes).

---

## 3. Visão geral do riSZon

### 3.1. O que o sistema faz

O riSZon organiza o caminho do paciente em **7 fases**. Cada paciente está
sempre em **uma fase** e com um **sub-status** dentro dela, e o tempo em cada
fase fica registrado.

| # | Fase | O que acontece | Quem costuma agir |
|---|---|---|---|
| 1 | **Aquisição** | Entrada do cadastro | Recepção, SDR |
| 2 | **Conversão Clínica** | Avaliação, fotos, exames, anamnese | Coordenador Clínico |
| 3 | **Centro de Planejamento** | Diagnóstico, plano, orçamento, aprovação | Dentista Planner + Coordenador |
| 4 | **Conversão Comercial** | Apresentação, negociação, fechamento | Consultor Comercial |
| 5 | **Início de Tratamento** | Agendamento do início | Recepção |
| 6 | **Reavaliação** | Controle de qualidade | Coordenador |
| 7 | **Acompanhamento** | Prevenção, retorno, resgate | Recepção, SDR |

**Evidência:** `CLAUDE.md` seção 3; a fase fica em `clients.journey_phase` e o
histórico em `journey_phase_history`; a movimentação é validada pela função
`move_client_phase` no banco.

**Regra que atravessa tudo:** *só é venda com documento assinado **e** pagamento
confirmado*. Essa regra não está apenas na tela — está imposta pelo banco de
dados, que recusa registrar recebimento de uma venda não fechada com o erro
`SALE_NOT_CLOSED` (evidência: `CLAUDE.md` §8b; migração 0203).

### 3.2. Os módulos

Além da jornada, o sistema tem módulos que aparecem no menu conforme a função:

| Módulo | Rota | O que resolve |
|---|---|---|
| Agenda | `/agenda` | Marcar e acompanhar horários, por dia/semana/mês |
| Atendimento | `/atendimento` | Chegada, chamada e conclusão do atendimento do dia |
| Prontuários | `/prontuarios` | A ficha completa do paciente |
| Centro de Planejamento | `/planejamento` | Fila de casos a planejar, com prazo |
| Procedimentos | `/procedimentos` | Catálogo: preço, protocolo de sessões, comissionamento. Cadastro e preço só do Admin Master; o Planner consulta, edita as sessões e sugere procedimento novo. **Grupos** (o Admin e o Planner montam) lançam vários procedimentos de uma vez no plano |
| Planos de Tratamento | `/planos` | Visão gerencial dos planos |
| Metas | `/metas` | Metas SMART da rede e da unidade, com a barra do realizado (ver [seção 2.7](#27-metas-smart)) |
| Comercial | `/comercial` | Funil de negociação e fechamento |
| Financeiro | `/financeiro` | Abre no **Painel** (ver [seção 2.3](#23-a-porta-do-financeiro)); dentro dele, DRE, fluxo de caixa, contas, taxas, repasses |
| Estoque | `/estoque` | Itens, kits, saldo, inventário |
| Compras | `/compras` | Requisição, cotação, pedido, recebimento |
| PPR+ | `/ppr` | Programa de prevenção |
| Ortodontia | `/ortodontia` | Os pacientes em tratamento ortodôntico: casos, cronograma de manutenções, mensalidade e a lista de quem precisa de atenção (ver [seção 2.8](#28-ortodontia)) |
| Empresarial | `/empresarial` | Convênio com empresas parceiras. **Funil**: o quadro comercial de 8 fases, da captação à implantação — clicar no nome da empresa abre o levantamento, a simulação da proposta, a apresentação em PDF, o registro do envio e, no fechamento, a conferência do consultor e os passos da implantação. **Painel**: conversão fase a fase, tempo em cada fase, quem está parado e o desempenho por consultor e por canal. **Agenda**: as reuniões do programa. **Cobranças**: as de todas as empresas. **Boas-vindas**: a fila de ligação da recepção/SDR em cada empresa. ⚠️ **Este módulo tem MANUAL PRÓPRIO**, no botão **Manual** dentro dele (ou `/empresarial/manual`): titular, faixa, carência, proposta, termo de inclusão e cobrança estão explicados lá, não aqui |
| Risartanos | `/risartanos` | A equipe: cadastro, unidades e **acesso ao sistema** na mesma ficha (ver [seção 2.5](#25-risartanos-a-equipe-e-o-acesso-na-mesma-ficha)) |
| Relatórios | `/relatorios` | Indicadores de agenda, rede e produtividade |
| Manual | `/manual` | Este manual, sempre na versão do sistema no ar |
| Alertas | `/alertas` | O que o sistema está avisando, e o relógio |
| Problemas | `/problemas` | Relatar e acompanhar problemas, dúvidas e sugestões |
| Administração | `/admin/*` | Clínicas, permissões, prazos, regras, modelos (o **acesso** de cada pessoa saiu daqui: mora na ficha do Risartano) |

### 3.3. O que **não** faz parte do escopo

Confirmado no código como **previsto mas não conectado**:

- **Assinatura digital (ZapSign)** — variáveis `ZAPSIGN_API_TOKEN` e
  `ZAPSIGN_BASE_URL` existem, sem integração ativa.
- **Pagamento online (ASAAS)** — variáveis `ASAAS_API_KEY` e `ASAAS_BASE_URL`
  existem, sem integração ativa.
- **WhatsApp automático** — o envio é manual, com mensagem pronta para copiar
  (`src/lib/whatsapp.ts`).
- **Funcionamento sem internet** — o sistema é online.
- **Portal do paciente** — não existe.

### Evidências analisadas

| Arquivo | Elemento | Conclusão |
|---|---|---|
| `CLAUDE.md` | §3 Jornada | As 7 fases e quem move cada uma [EV-001] |
| `src/app/(app)/**/page.tsx` | 87 rotas | Lista completa de telas [EV-002] |
| `src/components/app-sidebar.tsx` | 28 itens | Menu e condições [EV-003] |
| `.env.example`, código | `ZAPSIGN_*`, `ASAAS_*` | Variáveis existem, integração não [EV-011] |

---

## 4. Perfis, papéis e funções

O sistema tem **15 papéis** guardados por clínica (`user_clinic_roles`), mais
o **Admin Master**, que não é um papel e sim uma marca no perfil da pessoa
(`profiles.is_admin_master`). Evidência: `src/lib/roles.ts`.

**Uma pessoa pode ter funções diferentes em unidades diferentes.** O que ela vê
depende da **unidade ativa** no momento.

### 4.1. Regra estrutural: função pertence a um ambiente

Cada papel só pode ser atribuído a uma clínica do tipo certo — e isso é
**imposto pelo banco**, não só escondido na tela (evidência: `src/lib/roles.ts`,
`FRANCHISOR_ROLES` / `UNIT_ROLES`, e a função `isRoleAllowedForClinicType`).

| Ambiente | Papéis |
|---|---|
| **Franqueadora** | SDR, Dentista Planner, Consultor Comercial, Assistente Comercial, Franqueadora/Rede, Consultor RisLife, Financeiro da Franqueadora, Comprador da Franqueadora |
| **Unidade** | Recepcionista, Coordenador Clínico, Dentista, Gerente de Unidade, TSB, ASB, Franqueado |

Se alguém tentar dar a função "Recepcionista" a uma pessoa na Franqueadora, o
sistema recusa com o erro `ROLE_NOT_ALLOWED_FOR_CLINIC_TYPE`.

### 4.2. As duas camadas de proteção — e por que isso importa para você

Este é o conceito mais importante deste manual, e o que mais gera confusão:

> **O menu esconde. O banco de dados barra.**

O menu da esquerda mostra ou esconde itens conforme a sua função — isso é
conforto, para você não se perder. **A proteção de verdade está no banco**, com
uma regra por linha (chamada RLS) que decide o que cada pessoa consegue ler e
escrever, mesmo que tente por fora da tela.

**Consequência prática, confirmada na análise:** os itens **Início, Jornada,
Agenda, Atendimento e Prontuários** aparecem no menu para todas as funções — não
há filtro por papel neles. O que muda é **o que você encontra lá dentro**. Um
TSB abre `/prontuarios` e vê a tela, mas os dados seguem as regras do banco.

> **Correção (01/09/2026).** A primeira versão deste manual dizia que *Centro de
> Planejamento* e *Procedimentos* também apareciam para todos. **Estava errado:**
> eles sempre foram só do Dentista Planner e do Admin Master. O erro veio de
> leitura incompleta do menu, e foi encontrado ao construir a tela da matriz de
> permissões. A matriz em CSV também foi corrigida.

Evidência: `src/components/app-sidebar.tsx` (`NAV_ITEMS` sem condição por papel;
`PLANNER_ITEMS` sob a condição do Planner); `docs/ARQUITETURA-TECNICA.md`
§"Autenticação e RBAC".

> **A partir da migração 0246, isto é editável.** Quem vê cada item passou a vir
> da **Matriz de permissões** (`/admin/permissoes`), e o Admin Master muda pela
> tela — sem precisar de alteração no código. Ver
> [seção 5](#5-matriz-de-permissões).

**Única exceção encontrada no menu:** quem tem **apenas** o papel *Dentista* na
unidade ativa **não vê "Jornada"**, e ganha dois itens próprios, *Meu Dia* e
*Minha Agenda* (evidência: `app-sidebar.tsx`, variável `dentistOnly`).

### 4.3. Ficha de cada papel

> **Legenda de confiança:** ✅ confirmado no código · ⚠️ parcialmente confirmado
> (a regra existe, mas o comportamento de tela precisa de validação) ·
> ❔ não identificado.

#### Admin Master

- **O que é:** marca global no perfil, não um papel de clínica.
- **Usa quem:** o responsável pelo sistema (hoje, o proprietário).
- **Vê:** todos os itens do menu, incluindo o bloco **Administração** — que é
  exclusivo dele (✅ `app-sidebar.tsx`: `{isAdminMaster && (…)}`).
- **Pode:** criar clínicas, criar usuários, redefinir senha, configurar prazos,
  regras comerciais, agenda, fichas de anamnese, modelos de documento e ver a
  auditoria. É o **único** que cadastra, altera e precifica procedimentos, e é
  quem decide as **sugestões de procedimento novo** dos Planners (em
  **Procedimentos → Sugestões de novos procedimentos**: aprovar e cadastrar,
  pedir mais informações ou recusar). Também é quem configura a **base do
  odontograma** em **Administração → Odontograma** (veja abaixo).
- **Atos clínicos do odontograma — só o titular** (decisão do dono, D6): o
  Admin Master que **não** é o Admin Principal **vê** o diagnóstico e o
  plano (com preços), mas **não** sugere, não define, **não monta nem envia
  plano** (desde a 0.337.0 também o plano; o banco recusa) e, desde a
  0.339.0, **não escreve evolução clínica nem conclui atendimento** (lê
  tudo). O titular faz tudo, como o Planner.
- **Riscos:** é o único que pode apagar configuração da rede inteira. Um engano
  aqui atinge todas as unidades.
- **Depende de:** ninguém.

**Administração → Regras Comerciais — validade do orçamento** (desde a
0.338.0). O campo **Validade do orçamento impresso (dias)** diz até quando vale
o orçamento que o cliente assina, contado do dia da impressão. Fica no
**Padrão da rede** e, se preciso, no ajuste de cada unidade (a unidade vence a
rede). **Em branco, vale 15 dias** (decisão do dono, G2). Aceita de 1 a 365.

**Administração → Odontograma** (versão 0.332.0, só o Admin Master). É a
base do odontograma que está chegando ao riSZon, em quatro abas:

- **Situações do dente** — as 5 oficiais da TUSS (Hígido, Cariado,
  Restaurado, Ausente, Extração indicada) e as da Risarte (código **RZ-…**:
  canal tratado, coroa, implante, prótese, selante…). Em cada uma: onde se
  marca (face, coroa, raiz, dente inteiro, entre dentes), se é achado do
  exame ou efeito de um procedimento, e o **símbolo** que aparece no desenho.
  **Nova situação** cria uma da Risarte. Desde a 0.337.0, a marca **"Achado a
  tratar"** decide o que aparece em **vermelho** já no diagnóstico (decisão
  do dono). Veio marcada em: Cariado, Extração indicada, Restauração
  insatisfatória, Cárie incipiente, Lesão cervical não cariosa, Fratura,
  Endodontia insatisfatória/lesão periapical, Raiz residual, Mobilidade,
  Recessão gengival, Bolsa periodontal e Lesão de furca — ajuste aqui o que a
  rede considerar diferente. A tabela mostra o selo **"a tratar"**.
- **Faces dos dentes** — que faces podem ser marcadas em cada dente
  (marque/desmarque e **Salvar** na linha).
- **Regiões** — que dentes cada região seleciona de uma vez (sextante, arco,
  grupo de dentes). Região sem dentes é tecido ou osso (língua, palato…).
- **Procedimentos** — a **regra** de cada procedimento: onde se marca (face,
  dente, região, arcada ou sem marcação), quantas faces, dentição, dentes
  compatíveis, situações que **impedem** (ex.: restauração em dente ausente)
  e que são **exigidas** (ex.: coroa sobre implante exige implante), e o
  **efeito** depois de realizado (ex.: exodontia deixa o dente ausente).
  Filtros: **Só os sem regra** e **Só confiança baixa**.

O que é **oficial da TUSS** (código e nome) não muda, e **nada se apaga**:
situação se desativa; procedimento que não aparece no dente fica como "sem
marcação". Toda alteração fica na Auditoria.

**Preço com data — o reajuste agendado** (versão 0.333.0, só o Admin Master).
Ao mudar um preço, dá para escolher **a partir de quando** ele vale:

- **Hoje** (o padrão): o preço muda na hora, como sempre.
- **Uma data futura**: o reajuste fica **agendado**. Até a data, continua valendo
  o preço atual; na madrugada do dia, o sistema troca o preço sozinho. O cartão
  do procedimento mostra o selo azul *"R$ X a partir de dd/mm"*.
- **Data no passado não é aceita**: o passado fica como foi.

Funciona em três lugares: **Editar** o procedimento (campo *O preço vale a
partir de*), o **preço da unidade** (campo *a partir de*, ao lado do valor) e o
**Reajuste de preços em massa**, na Precificação (campo *Vale a partir de*;
agendado, o percentual é calculado sobre o preço de hoje).

No cartão aberto, o quadro **Preço no tempo** mostra os reajustes agendados
(com **Cancelar**) e, em **Ver histórico de preço**, todo preço que o
procedimento já teve, com a data, a origem e quem mudou. O histórico nasce em
20/10/2026 (o que veio antes não estava registrado) e **não pode ser alterado**.

Se a troca da madrugada falhar, a tela de Procedimentos avisa *"reajuste
atrasado"* e o Admin tem o botão **Aplicar agora**. Um reajuste atrasado **não
passa por cima** de um preço mudado à mão depois da data marcada: ele é
cancelado, com o motivo.

**Precificação no preço normal e no preço mínimo** (versão 0.357.0). Em
**Procedimentos → Precificação**, cada procedimento com **Preço mínimo** mostra
na linha a margem nos dois preços (*preço R$ 150,00 · 95% · mín R$ 110,00 ·
93,18%*). Ao abrir, a tabela **Preço normal × Preço mínimo** mostra a conta
inteira — preço, custo direto, imposto + taxa e a margem em R$ e em % — e a
comparação por nível mostra os dois (*Júnior: 95% · no mínimo 93,18%*). As
cores são as de sempre: verde na meta, âmbar abaixo dela, vermelho no
prejuízo.

**Margem desejada e margem mínima** (versão 0.358.0). Em *Custos e metas*,
ao lado da **Margem desejada** fica a **Margem mínima**. O **preço normal** se
mede pela margem **desejada**; o **preço mínimo**, pela margem **mínima** — a
tabela mostra a linha **Meta** com as duas. Em branco, o preço mínimo se mede
pela desejada. A mínima não pode passar da desejada (a tela não deixa salvar).

> **A margem mínima é a mesma do alerta de margem** da negociação e da venda
> direta: salvar aqui **liga aquele aviso** para o Comercial (ele avisa, não
> bloqueia). Ela vale para a unidade em que você está; em **Regras
> comerciais**, *Remover ajuste* da unidade apaga também a margem mínima dela,
> e volta a valer a da rede. Desde a versão 0.359.0 a conta do alerta é **a
> mesma desta tela** (cadeira, material, laboratório, repasse e imposto + taxa
> média): o mesmo percentual vale a mesma coisa nos dois lugares.

**A hora clínica calculada** (versão 0.362.0). Em *Custos e metas*, a **hora
de cadeira** não é mais digitada: o quadro **Hora clínica** mostra o valor
calculado para a unidade e a conta inteira:

> **hora clínica = custo fixo ÷ (horas de cadeira × ocupação esperada)**

- **Custo fixo:** a média dos **últimos 3 meses fechados** (em outubro:
  julho, agosto e setembro), das contas marcadas como **fixo** no Plano de
  contas — pessoal, aluguel, contas, administrativo, marketing — **mais a
  depreciação dos bens**. É o mesmo custo fixo do **Ponto de equilíbrio**.
  Material, laboratório, repasse, taxa e imposto **não entram**: eles já são
  somados em cada procedimento.
- **Horas de cadeira:** as do **Planejamento Anual** (horário da unidade ×
  cadeiras, descontados feriados, recessos e fechamentos de agenda).
- **Ocupação esperada:** quanto das horas de cadeira a unidade deve ocupar
  (**80%** se ninguém mudar). O campo fica no quadro; mudar o número refaz a
  conta na hora, e **Salvar configuração** guarda para a unidade.
- **Hora real:** a mesma conta pelas horas **trabalhadas de verdade**
  (atendimentos concluídos). É só comparação — o preço usa a ocupação
  esperada, para um mês fraco não encarecer todos os preços.

Mês sem custo fixo lançado ou sem agenda fica fora da conta (a tela diz *"1 de
3 meses tinham custo e agenda"*). **Sem nenhum dado**, vale o **Valor
provisório (R$/h)** digitado, e o quadro diz em amarelo o que falta. A
**negociação** e a **venda direta** usam a mesma hora desta tela. Na
**Franqueadora** não há cadeira: lá o campo continua digitado.

O filtro **Mostrar**, no alto da lista, separa: **Na margem desejada ou
acima**, **Abaixo da margem desejada** (pelo preço normal), **Abaixo da margem
no preço mínimo** — desde a 0.358.0, **Abaixo da margem mínima no preço
mínimo** (o pior caso da negociação) — e **Sem preço** (não há margem para
comparar). Cada opção mostra quantos são. O filtro usa as **margens** e os
custos que estão na tela, e o nível
escolhido em *Simular com* — mudou um deles, a lista muda junto, mesmo antes
de salvar.

#### Recepcionista *(unidade)*

- **Objetivo:** porta de entrada e organização do dia.
- **Pode:** cadastrar paciente, agendar, registrar chegada, chamar, solicitar
  anamnese, receber o aviso de fechamento para agendar o início do tratamento.
- **Não vê:** Financeiro, Compras (✅ `canViewFinance` não inclui
  `receptionist`; `canViewPurchases` também não).
- **Não vê no menu, mas o item aparece:** Centro de Planejamento e Procedimentos
  (⚠️ ver [4.2](#42-as-duas-camadas-de-proteção--e-por-que-isso-importa-para-você)).
- **Riscos:** cadastrar paciente duplicado — mitigado pelo sistema, que
  reconhece o CPF já existente e autopreenche.
- **Depende de:** Coordenador (avaliação) e Consultor (fechamento).

#### Coordenador Clínico *(unidade)*

- **Objetivo:** avaliar o paciente e preparar o caso para o planejamento.
- **Pode:** registrar consentimento (obrigatório antes de qualquer coleta),
  subir fotos/exames, gravar áudio, enviar ao Centro de Planejamento, e
  **aprovar ou reprovar** cada opção do plano.
- **Vê também:** Planos de Tratamento (✅ `planRoles` inclui
  `clinical_coordinator` na unidade), Estoque (✅ é papel clínico).
- **Não vê:** Financeiro, Compras, Comercial — **por padrão**. Com "Criar
  requisição de compra" ligada na matriz de permissões, ele vê Compras e
  **monta e envia a lista de compras da unidade** (desde a versão 0.320.0;
  antes a tela mostrava só consulta). Receber o pedido não: cria conta a pagar.
- **Riscos:** aprovar plano sem ler o orçamento. Ele vê **o total** de cada
  opção, não o preço item a item (✅ regra do LOTE F4).
- **Evolução clínica (desde a 0.339.0, decisão do dono D8b/H4):** no
  atendimento em que **ele é o profissional**, o Coordenador escreve o
  Desenvolvimento Clínico, dá baixa nas sessões e sugere achado no dente —
  igual ao dentista. No atendimento de outro profissional, só lê.
- **Depende de:** Dentista Planner (que monta o plano).

#### Dentista Planner *(franqueadora)*

- **Objetivo:** transformar o caso em diagnóstico, plano e orçamento.
- **Pode:** criar plano com opções, lançar procedimentos, classificar o pilar,
  pedir aprovação, enviar ao Comercial.
- **Vê também:** Procedimentos (catálogo), Relatórios, Planos de Tratamento.
  No catálogo ele **consulta** tudo e **edita direto só as sessões** de cada
  procedimento (o protocolo da rede); procedimento que falta, ele **sugere**.
- **Não vê:** Estoque (de propósito: material é com o Coordenador, a TSB e a
  ASB).
- **Não pode:** avaliar paciente, agendar, negociar; cadastrar, alterar ou
  precificar procedimento (só o Admin Master — desde a versão 0.330.0); lançar
  item fora do catálogo ou mudar o preço de um item no orçamento.
- **Riscos:** enviar ao Comercial sem aprovação — o sistema barra.
- **Depende de:** Coordenador (aprovação) e Admin Master (procedimento novo).

#### Dentista (executor) *(unidade)*

- **Objetivo:** executar o plano aprovado.
- **Menu diferente dos outros:** ✅ **não tem "Jornada"**, e ganha **Meu Dia** e
  **Minha Agenda**.
- **Pode:** ver a agenda dele, chamar o paciente, escrever o Desenvolvimento
  Clínico e concluir o atendimento. Desde a 0.339.0 vê o **dente** de cada
  sessão e o **odontograma do atendimento**, e **sugere** achado novo durante o
  tratamento (o Planner decide).
- **Não vê:** Financeiro, Comercial, Compras, Relatórios, **Estoque** (de
  propósito: o material do procedimento é baixado sozinho ao concluir a
  sessão; o que sair fora do previsto é lançado pela TSB, pela ASB ou pelo
  Coordenador).
- **Riscos:** concluir atendimento sem escrever o Desenvolvimento Clínico — o
  sistema **não deixa** (✅ regra I7b).
- **Depende de:** Recepção (que registra a chegada).

#### Consultor Comercial *(franqueadora)*

- **Objetivo:** apresentar o plano e fechar a venda.
- **Pode:** negociar, aplicar desconto dentro do teto, definir forma de
  pagamento, marcar contrato assinado e pagamento confirmado.
- **Vê também:** Comercial, Relatórios, Planos de Tratamento.
- **Não vê:** Financeiro, Estoque, Compras.
- **Riscos:** desconto acima do teto — o sistema avisa e, acima do limite,
  exige autorização.
- **Depende de:** Planner (plano aprovado).

#### Gerente de Unidade *(unidade)*

- **Objetivo:** enxergar e responder pela unidade.
- **Vê praticamente tudo da unidade:** Financeiro ✅, Estoque ✅, Compras ✅,
  Comercial ✅, Relatórios ✅, Planos ✅, Risartanos ✅, Empresarial ✅.
- **Pode:** lançar dinheiro (`canPostFinance`), dar entrada e fazer inventário
  de estoque (`canManageStock`), criar requisição de compra
  (`canManagePurchaseRequests`), autorizar contas dentro da alçada. No plano
  de tratamento, **vê o preço item a item** (decisão do dono, D7; desde a
  0.336.0 — antes via só os totais), sem editar.
- **Não pode:** configurar o que vale para a rede inteira
  (`canConfigureFinanceNetwork` exclui o gerente) nem cadastrar item no catálogo
  de estoque (`canManageStockCatalog`).
- **Riscos:** é quem mais executa ação irreversível no financeiro.

#### Franqueado *(unidade)*

- **Objetivo:** acompanhar a unidade que possui.
- **Vê:** Financeiro ✅, Estoque ✅, Compras ✅, Comercial ✅, Relatórios ✅.
- **Não pode lançar dinheiro:** ⚠️ `canPostFinance` **não** inclui `franchisee`
  — o comentário no código diz *"franqueado é somente leitura"*.

#### Financeiro da Franqueadora *(franqueadora)*

- **Pode:** tudo do financeiro, inclusive **configurar a rede**
  (`canConfigureFinanceNetwork` ✅), o catálogo de estoque
  (`canManageStockCatalog` ✅) e ver Compras.
- **Trabalhar no financeiro de uma unidade (desde a 0.340.1, relato
  OC-00120):** no **Trabalhar na clínica**, além da Franqueadora, aparecem as
  **unidades do escopo** dele (Todas, ou as específicas marcadas na função).
  Escolha a unidade e o Financeiro inteiro — contas a pagar, baixas,
  conciliação, DRE — passa a ser o dela, como para o Gerente. Fora do
  Financeiro, as telas da unidade continuam seguindo o que a função dele
  permite (ele não vira gerente nem recepção ali).
- **Pela rede (desde a 0.341.0, OC-00121):** no **Painel da rede**, as abas
  Contas a pagar, Recebíveis, Fluxo de caixa e DRE comparam as unidades, e
  **Abrir na unidade** faz a troca e abre o relatório dela (seção 2.3).
- **Não pode:** aprovar a própria conta lançada (regra de alçada, FIN3).
- **Compras:** entra na mesa de negociação; **aprova a compra da própria
  Franqueadora** (desde a versão 0.318.0) e recebe a entrega. **Não aprova a
  compra de uma unidade** — quem paga é ela, e quem aprova é o gerente dela.
  Passo a passo no Fluxo 5 (seção 8).

#### Comprador da Franqueadora *(franqueadora)*

- **Objetivo:** negociar compras pela rede.
- **Vê:** Compras ✅ (é o único, além do Admin, que entra na mesa de
  negociação — `isPurchaser`).
- **Regra estrutural:** *quem compra não é quem paga*. Ele **não** tem acesso
  ao Financeiro (✅ `canViewFinance` não o inclui).

#### SDR (Encantador) *(franqueadora)*

- **Pode:** cadastrar clientes e agendar, inclusive em outra unidade; vê os
  clientes que cadastrou.
- **Não pode:** mover fases (botões removidos), atos clínicos ou comerciais.
- **Vê:** Empresarial ✅ (`canViewEmpresarial` inclui `sdr`).

#### Assistente Comercial *(franqueadora)*

- **Pode:** enviar documentos e link de pagamento, acompanhar status.
- **Vê:** Comercial ✅. **Não vê** Relatórios nem Planos (⚠️ não está em
  `reportRoles` nem em `planRoles`).

#### Franqueadora/Rede *(franqueadora)*

- **Vê:** Relatórios ✅, Planos ✅, Risartanos ✅, Empresarial ✅ — e
  Financeiro, Estoque e Compras quando o Admin liga na matriz de permissões
  (na produção estão ligados desde antes de 14/10/2026).
- **Não grava** no Financeiro, no Estoque nem nas Compras: é função de
  **consulta**, e o banco recusa. As telas abrem com **"Só consulta"** e dizem
  quem faz. Quem lança pela Franqueadora é o **Financeiro da Franqueadora**
  (relatos OC-00094 a OC-00099).

#### Consultor RisLife *(franqueadora)*

- **Objetivo:** gerir o programa Empresarial (B2B).
- **Vê:** Empresarial ✅ (é gestor do programa).

#### TSB e ASB *(unidade)*

- **Pode:** consumo avulso de estoque ✅ (são papéis clínicos) e **pedir
  indicação** na ficha do cliente.
- **ASB não faz:** registrar chegada, chamar paciente, preencher anamnese,
  enviar foto ou exame, nem ser o profissional responsável ou registrar o
  desfecho do atendimento — o sistema não deixa, e por isso essas ações
  também não estão na missão dela (desde a versão 0.331.1).
- **ASB, quando a matriz liga** (desde a versão 0.320.0): **entrada e
  inventário de estoque** da unidade, e **montar e enviar a lista de
  compras**. Não registra nota de compra, não mexe em mínimo nem em kit, e não
  recebe pedido — esses criam conta a pagar ou mudam a configuração.
- **Não vê:** Financeiro, Comercial, Relatórios, Planos (e Compras, por padrão).

### Evidências analisadas

| Arquivo | Elemento | Conclusão |
|---|---|---|
| `src/lib/roles.ts` | `USER_ROLES`, `ROLE_LABELS` | 15 papéis + rótulos [EV-004] |
| `src/lib/roles.ts` | `FRANCHISOR_ROLES`/`UNIT_ROLES` | Papel pertence a um ambiente [EV-005] |
| `src/app/(app)/layout.tsx` | `canViewReports`, `canViewPlans`, `canViewComercial`, `canViewStaff` | Condições de menu [EV-006] |
| `src/lib/finance/access.ts` | `canViewFinance`, `canPostFinance`, `canConfigureFinanceNetwork` | Três níveis distintos [EV-007] |
| `src/lib/stock-access.ts` | `CLINICAL_ROLES`, `canManageStock`, `canConsumeStock` | Gestão × atendimento [EV-008] |
| `src/lib/purchases-access.ts` | `isPurchaser`, `canManagePurchaseRequests` | Comprar ≠ pagar [EV-009] |
| `src/components/app-sidebar.tsx` | `dentistOnly` | Única exceção de menu por papel [EV-010] |

---

## 5. Matriz de permissões

> **Desde 01/09/2026 a matriz é EDITÁVEL no sistema.** Admin Master →
> **Administração → Permissões** (`/admin/permissoes`). Marque ou desmarque por
> função e salve; vale para toda a rede.
>
> **Duas coisas que a tela avisa, e que valem repetir aqui:**
> **desligar** uma permissão sempre funciona; **ligar** uma marcada com o selo
> *"o banco também decide"* abre a tela, mas os dados podem vir vazios — nessas,
> a regra do banco continua a mesma até ser ajustada. E o **Admin Master não
> aparece na matriz**: ele passa por cima sempre, para não existir a porta
> trancada com a chave dentro.

A matriz completa (16 papéis × 27 colunas) está em
[`matriz-permissoes-riSZon.csv`](matriz-permissoes-riSZon.csv), e foi **calculada
aplicando as mesmas condições booleanas do código**, não deduzida pelo nome do
papel.

**Como ela foi montada:** para cada papel, simulou-se uma pessoa que tem
**apenas aquele papel**, na clínica compatível com ele, e rodaram-se as funções
reais (`canViewFinance`, `canViewStock`, etc.). Quem acumula funções vê a soma.

### Resumo — visibilidade dos módulos principais

| Papel | Financeiro | Estoque | Compras | Comercial | Relatórios | Planos | Admin |
|---|---|---|---|---|---|---|---|
| Admin Master | SIM | SIM | SIM | SIM | SIM | SIM | **SIM** |
| Gerente de Unidade | SIM | SIM | SIM | SIM | SIM | SIM | não |
| Franqueado | SIM | SIM | SIM | SIM | SIM | SIM | não |
| Financeiro da Franqueadora | SIM | SIM | SIM | não | não | não | não |
| Comprador da Franqueadora | não | não | SIM | não | não | não | não |
| Consultor Comercial | não | não | não | SIM | SIM | SIM | não |
| Assistente Comercial | não | não | não | SIM | não | não | não |
| Dentista Planner | não | não | não | não | SIM | SIM | não |
| Coordenador Clínico | não | SIM | não | não | não | SIM | não |
| Dentista | não | não | não | não | não | não | não |
| TSB / ASB | não | SIM | não | não | não | não | não |
| Recepcionista | não | não | não | não | não | não | não |
| SDR | não | não | não | não | não | não | não |
| Franqueadora/Rede | não | não | não | não | SIM | SIM | não |
| Consultor RisLife | não | não | não | não | não | não | não |

**Ler assim:** "SIM" quer dizer *o item aparece no menu para essa função*. Não
quer dizer que a pessoa possa fazer tudo lá dentro — as colunas de **ação** da
planilha (lançar dinheiro, dar entrada no estoque, criar requisição) mostram a
diferença.

### Ações — quem pode de fato executar

| Ação | Quem pode |
|---|---|
| Ortodontia — ver o módulo | Admin, **Gerente**, **Coordenador**, **Recepção**, Franqueado, Franqueadora/Rede, Financeiro da Franqueadora, **Dentista** (só os casos em que é o ortodontista) |
| Ortodontia — ver o Painel (os números) | Admin, **Gerente**, **Coordenador**, Franqueado, Franqueadora/Rede, Financeiro da Franqueadora (a Recepção cai na tela Atenção) |
| Ortodontia — abrir, editar, iniciar, entregar contenções, dar alta, interromper o caso | Admin, **Gerente**, **Coordenador** |
| Ortodontia — indicar na avaliação/reavaliação (0.365.0) | Admin, **Coordenador** (sugestão; o Planner decide no plano) |
| Ortodontia — a proposta ortodôntica da opção do plano (0.365.0) | **Dentista Planner** e o titular, com o plano em rascunho/devolvido; o Coordenador aprova junto com a opção |
| Ortodontia — registrar a manutenção e a evolução | Admin, **Coordenador**, o **Dentista** que é o ortodontista do caso |
| Ortodontia — mensalidades (gerar, dar baixa) | Admin, **Gerente**, Franqueadora/Rede, **Financeiro da Franqueadora** (desde a 0.363.0: a Recepção e o Franqueado só **veem** a situação; desde a 0.364.0 o **Coordenador** também vê, e o **Dentista não vê valor nenhum** — nem o banco lhe entrega) |
| Lançar/editar dinheiro | Admin, Financeiro da Franqueadora, **Gerente** |
| Configurar financeiro da REDE | Admin, Financeiro da Franqueadora |
| Entrada e inventário de estoque | Admin, Financeiro da Franqueadora, **Gerente**, **ASB** (na unidade dele, desde a 0.320.0) |
| Consumo avulso de estoque | Os acima **+ Coordenador, TSB, ASB** |
| Cadastrar item no catálogo | Admin, Financeiro da Franqueadora |
| Criar requisição de compra | Admin, **Gerente**, **Coordenador Clínico** e **ASB** (na unidade deles, desde a 0.320.0) |
| Mesa de negociação de compras | Admin, **Comprador**, Financeiro da Franqueadora |
| Aprovar compra e gerar o pedido | Admin, **Gerente** da unidade; na compra da **própria Franqueadora**, o **Financeiro da Franqueadora** |
| Receber a entrega | Admin, Financeiro da Franqueadora, **Gerente** |
| Configurar PPR+ | **Só Admin** |
| **Mover o cliente de fase à mão** | **Só Admin** (as demais funções movem pelos atos do fluxo — seção 8, Fluxo 2b) |

**Repare na diferença que mais confunde:** o Franqueado **vê** o Financeiro mas
**não lança** nada; o Gerente vê e lança. É proposital.

---

## 6. Scripts de treinamento por função

Cada roteiro segue a mesma estrutura. Comece pelo da sua função.

> **Antes de qualquer roteiro — 5 minutos de conceitos**
>
> - **Fase:** em que ponto do caminho o paciente está. Sempre uma só.
> - **Sub-status:** o detalhe dentro da fase (ex.: "aguardando aprovação").
> - **SLA:** o prazo daquela fase. Estourou, o caso fica **vermelho** nas listas.
> - **Unidade ativa:** a clínica em que você está trabalhando agora. Aparece no
>   alto da barra lateral.
> - **Prontuário:** a ficha do paciente, com abas.

### 6.1. Recepcionista

**Objetivo:** cadastrar pacientes, organizar a agenda e conduzir a chegada.
**Pré-requisitos:** acesso criado pelo administrador; saber em que unidade
trabalha. **Duração estimada:** 60 minutos.

> **Antes de cadastrar, procure.** Use **Procurar paciente** no alto do menu
> (ou **Ctrl + K**) e digite o CPF, o nome ou o código. Se a pessoa já existe na
> rede, você a abre em dois segundos — e evita o cadastro repetido, que é o erro
> mais comum do balcão. A mesma busca funciona na lista de Prontuários.

**Tarefa 1 — Cadastrar um paciente**

1. Menu **Prontuários** → botão de novo cadastro (rota `/prontuarios/novo`).
2. **Comece pelo CPF.** O sistema procura antes de deixar você digitar o resto:
   se o paciente já existir na rede, ele **autopreenche** (evidência: LOTE F1).
3. Preencha nome, nascimento, telefone, e-mail e endereço.
4. Clique em **Cadastrar cliente**.
5. **Resultado esperado:** o sistema abre a ficha do paciente e ele nasce na
   fase **Aquisição**, com um código próprio (ex.: `CAM-00001`).

> **Cuidado:** o CPF é a trava contra paciente repetido. Digitar com pontuação
> ou sem dá no mesmo — o sistema compara só os números (migração 0244).

**Tarefa 2 — Agendar**

1. Na ficha do paciente, botão **Novo agendamento**; ou pelo menu **Agenda**.
2. **Procure o cliente digitando** — nome, código do prontuário (`CBE-00006`)
   ou CPF. A busca alcança **todos** os cadastros da unidade, não só os que
   aparecem na lista inicial. Escolheu errado? O **X** ao lado do nome troca.
3. Preencha o resto: tipo, profissional, sala, duração, data e horário.
4. **O sistema recusa** horário fora do funcionamento da unidade, dia fechado ou
   sala lotada — exceto urgência/emergência.

> **Recesso com horário avulso: vale só o avulso** (desde a versão 0.321.0).
> Num dia fechado pelo **Planejamento anual** — recesso, férias coletivas,
> evento, treinamento ou manutenção —, liberar um horário avulso abre **só a
> janela dele**: liberar das 08h às 12h numa segunda de recesso abre das 08h
> às 12h, e não a segunda inteira. A lista de **Próximos horários disponíveis**
> segue a mesma regra. Período lançado pela **rede com trava** não abre nem com
> horário avulso; e as férias de um profissional fecham só a agenda dele.
> (Antes, a agenda tratava o dia de recesso como dia normal e aceitava o
> horário inteiro — contrariando a regra combinada para o horário avulso.)
5. **Resultado esperado:** a janela fecha e o horário aparece na agenda.

> **Quem atende depende do tipo.** Numa Avaliação o sistema oferece só o
> Coordenador. Isso não é erro: é a regra da fase.

**Os avisos que cobram um agendamento.** Dois avisos abrem por cima da tela
quando há alguém esperando a recepção agendar: **"Fechamento! Iniciar
tratamento"** (a venda fechou) e **"Agendar apresentação comercial"**.

1. Cada cliente do aviso tem um botão só: **Abrir agenda** — ele leva à agenda
   com o cliente já escolhido.
2. Agende normalmente (tipo **Início de Tratamento** ou **Apresentação
   Comercial**).
3. **Resultado esperado:** o aviso **some sozinho**, em até um minuto — por
   qualquer caminho que você tenha agendado (pelo aviso, pela agenda ou pela
   ficha).
4. **Fechar** (ou o **X**) só **adia**: o aviso volta em **15 minutos**, até o
   agendamento existir. Aviso de um cliente novo abre na hora.
5. **Cada cliente aparece uma vez só**, mesmo que tenha recebido dois pedidos
   (por exemplo, "Agendar apresentação" e depois "URGENTE"). Ao agendar, todos
   os pedidos daquele cliente saem juntos.

> **Início cancelado ou falta: o aviso volta.** Se o início do tratamento for
> **cancelado**, ou o paciente **faltar**, e ele não tiver outro início
> agendado, o aviso "Fechamento! Iniciar tratamento" volta para a recepção,
> com o motivo embaixo do nome (*"O paciente faltou ao início agendado."*).
> Remarcar a data não traz o aviso — o início continua agendado. A
> **apresentação comercial** cancelada não volta sozinha: quem decide tentar de
> novo é o Comercial, pelo botão **Pedir novo agendamento**.

> **Por que não existe mais "Já agendei" nem "Marcar todos como agendados"**
> (relato OC-00080, 27/09/2026): os dois apagavam o aviso sem ninguém conferir
> a agenda — e até "Abrir agenda" apagava no clique, antes de agendar. O
> lembrete podia ser calado sem o paciente ser agendado. Hoje quem tira o aviso
> é o próprio agendamento. Um agendamento criado já **cancelado**, ou de outro
> tipo (sessão, retorno), **não** tira o aviso.

**Tarefa 3 — Receber o paciente no dia**

1. Menu **Atendimento**.
2. **Confirmar a presença** (quando o paciente confirma por telefone ou
   mensagem): no cartão **A chegar**, botão **Confirmar**. O cartão ganha o
   selo verde **Confirmado** e o botão some — é a mesma situação "Confirmado"
   da agenda. (Relato OC-00076.)
3. Botão **Registrar chegada** → confira profissional, horário e sala com o
   paciente na frente → **Confirmar chegada**.
4. **Quem chama é o profissional**, não a recepção.

> **O Atendimento mostra os atendimentos de HOJE** (e as pendências de dias
> anteriores). A confirmação feita na véspera continua pela **Agenda**: clique
> no agendamento → **Confirmado**. Não confunda **Confirmar** (o paciente disse
> que vem) com **Confirmar chegada** (o paciente está na sua frente).

> **O paciente do Comercial tem marca própria** (versão 0.351.0, relatos
> OC-00135/OC-00136). A apresentação comercial fica na **mesma** agenda e no
> **mesmo** Atendimento da unidade, e isso é regra da rede: é você quem
> confirma, dá a chegada e acompanha a apresentação de perto, e duas agendas
> separadas atrapalhariam esse acompanhamento. Para não confundir os
> pacientes, o cartão da apresentação comercial tem **contorno rosa
> (fúcsia)**, o tipo **Apresentação Comercial** escrito nessa cor com o ícone
> de apresentação e, no Atendimento, o selo **Comercial** ao lado do nome. Vale
> no Atendimento e em todas as vistas da Agenda (dia, semana e mês). A **cor de
> fundo** continua dizendo a situação, como antes: azul é agendado, verde é
> confirmado.

**Tarefa 4 — Atender o pedido do Comercial**

Quando o Consultor não consegue realizar a apresentação (o cliente não
compareceu, pediu para remarcar), ele envia um pedido que chega no **seu sino de
avisos**: *"Agendar apresentação: «nome do cliente»"*, com o motivo. Clique no
aviso, abra a ficha e agende — o Comercial vê a nova data no cartão dele
automaticamente, e não precisa ser avisado de volta.

**Erros frequentes:** tentar cadastrar sem CPF; agendar fora do horário da
unidade; fechar o aviso de "agendar apresentação" achando que ele some — ele
só sai quando a apresentação é agendada (Fechar adia 15 minutos).

**Como confirmar que deu certo:** o paciente aparece na lista de Prontuários com
a fase correta, e o horário aparece na Agenda.

**Exercício sugerido (no ambiente de treino):** cadastre um paciente fictício,
agende uma avaliação para hoje e registre a chegada.

**Checklist final:** ☐ cadastrei ☐ agendei ☐ registrei chegada ☐ sei onde ver a
fase do paciente ☐ sei que não sou eu quem chama

### 6.2. Coordenador Clínico

**Objetivo:** avaliar e preparar o caso. **Duração:** 60 minutos.

1. Menu **Atendimento** → **Chamar** o paciente (é você quem chama numa
   avaliação). **A gravação da consulta começa neste clique** — uma faixa
   aparece no rodapé mostrando o tempo correndo — e o sistema já abre o
   **Cockpit de Avaliação** (`/avaliacao/[clientId]`).
3. **Registrar consentimento** — obrigatório para **fotos, exames, vídeos e
   anamnese**. **Nada disso é coletado antes** (exigência de LGPD imposta pelo
   sistema). A **gravação de áudio da avaliação e da reavaliação** é a única
   exceção: ela não espera o consentimento, por orientação do jurídico da
   Risarte (decisão de 21/09/2026).
4. **Levantamento de informações** → escolher a ficha de anamnese → preencher →
   **Salvar anamnese**. Quando uma resposta pede atenção (uma doença, uma
   alergia, uso de remédio), o topo do prontuário mostra **Alertas da
   anamnese** — a mensagem **e o que foi marcado** (ex.: *"Condição de saúde
   relevante marcada"* com as etiquetas **Diabetes** e **AIDS**; *"Alergia a
   medicamento"* com **Dipirona**, se você escreveu no "Especifique").

> **Escreva no "Especifique".** É esse texto que aparece no alerta e chega ao
> Planner. "Alergia a medicamento" sem dizer qual obriga alguém a perguntar de
> novo ao paciente.

> **Quem vê o alerta:** só quem já pode ler a anamnese — equipe clínica,
> Planner, Gerente da unidade e Dentista. A recepção não vê (dado de saúde).
5. Subir fotos e exames.
5b. **Odontograma — o que você encontrou em cada dente** (desde a 0.335.0, no
   passo **3 · Avaliação clínica inicial** do roteiro). Toque no dente (ou em
   vários, ou escolha uma **região** — sextante, arcada…), escolha as
   **faces** (para cárie, restauração…) ou deixe sem face (ausente, coroa,
   canal…), escolha a **situação** e **Sugerir**. A lista só oferece o que cabe:
   com face, só situações de face; o sistema avisa se um dos dentes não tem a
   face escolhida (ex.: Oclusal num incisivo). **A sua marca é uma SUGESTÃO**
   (fica tracejada): quem define é o Planner. Enquanto ele não decidiu, dá
   para **Desfazer** em *Minhas sugestões esperando o Planner*. Na
   reavaliação, o desenho já vem com o que estava definido: sugira só o que
   mudou — inclusive **Sugerir retirar** uma marca que não vale mais. Quando
   o Planner **finaliza**, você recebe **um aviso** com o resumo (quantas
   aceitas, ajustadas e rejeitadas). ⚠️ **Rodada finalizada fica trancada**:
   as considerações, fotos e exames dela não se editam nem se apagam mais (os
   botões de lápis e lixeira somem). O que você registrar depois entra numa
   rodada nova, com o título **"Registros após o diagnóstico"**.
6. **Enviar ao Centro de Planejamento**. O sistema **para a gravação, espera
   o áudio ser salvo na ficha e só então envia** — o Planner recebe o caso já
   com o áudio. É também o que encerra o atendimento, **seja quem for que
   tenha chamado** o paciente.

> **A avaliação termina AQUI, no cockpit — não no Atendimento** (relatos
> OC-00085 e OC-00086, 27/09/2026). No painel de Atendimento, o cartão de uma
> avaliação ou reavaliação em andamento tem **Abrir avaliação**, e não
> **Concluir**: concluir por lá encerrava a consulta sem avaliação nenhuma, e
> o envio pelo cockpit deixava o áudio gravando.
>
> **Avaliação interrompida** (o paciente passou mal, precisou sair): no cartão,
> menu **…** → **Encerrar sem enviar**, com o **motivo** (obrigatório). O
> atendimento fecha, a gravação é salva, e o paciente continua aguardando o
> envio ao Planejamento, para terminar depois. O motivo fica no histórico do
> agendamento, na ficha. Só quem chamou (ou o Admin) pode encerrar assim.
>
> **O áudio não foi salvo?** Se a gravação falhar ao ser salva, o envio **não
> acontece** e o sistema avisa. Clique em Enviar de novo para enviar sem o
> áudio — é uma decisão sua, não um acidente.

**Segunda tarefa — aprovar plano.**

*Onde ver se há plano esperando por você* (qualquer um dos três serve):

- **Início** → cartão **Planos aguardando sua aprovação** (só aparece quando
  há algum) → **Abrir**. Ele leva a **Planos de Tratamento**, já filtrado.
- Menu **Planos de Tratamento** → filtro **Aguardando aprovação** → **Ficha**
  na linha do cliente.
- **Sino** → aviso **Plano aguardando aprovação** → **Abrir**.

Por qualquer um deles, o prontuário do cliente abre **direto na aba Plano**.

*Como aprovar:*

1. Na aba **Plano**, as opções de tratamento já aparecem **abertas** enquanto
   o plano aguarda a sua aprovação (se alguma estiver recolhida, clique na
   setinha ao lado do nome).
2. Leia os procedimentos de cada opção. No fim de cada uma ficam o campo
   **Considerações** e os botões **Aprovar opção** e **Reprovar opção**.
3. Decida **todas** as opções — cada uma precisa da sua decisão.
4. Com todas decididas e **pelo menos uma aprovada**, o plano fica aprovado e
   o Planner envia ao Comercial. Se **todas** forem reprovadas, volta ao
   Planner para revisão.

> **Reprovar exige considerações escritas** — o sistema não deixa reprovar em
> branco (migração 0042). É o que orienta o Planner a corrigir.

> **Abriu a aba Plano e não há botão de aprovar?** Um destes três: o Planner
> **ainda não enviou** o plano para aprovação (a situação do plano não diz
> "Aguardando aprovação do Coordenador"); o plano **já foi avaliado**; ou você
> está em **outra unidade** que não a do cliente (confira no alto do menu).

**Cuidado:** você vê **o total** de cada opção, não o preço item a item. Isso é
proposital: sua aprovação é clínica, não comercial. Desde a 0.336.0 vale
também na **Apresentação** (antes ela mostrava o preço de cada item ao
Coordenador). Cada item mostra **o dente ou a região** onde acontece.

> **A faixa atrapalhando? Mova ou encolha.** Ela aparece no **canto de baixo à
> direita**. Arraste pela **alça** (o pontilhado à esquerda) para onde preferir,
> ou clique no **tracinho** para encolhê-la a uma etiqueta pequena com o tempo.
> O sistema lembra onde você deixou, **neste computador**, para a próxima
> consulta. O que ela **não** faz é fechar: enquanto grava, o ponto vermelho e o
> tempo continuam à vista — é o que garante que ninguém seja gravado sem saber.

> **Esqueceu de apertar "Chamar"? O sistema resolve (v0.272.0).** Se você for
> direto para a ficha e começar a trabalhar, o **primeiro registro** — a
> gravação, a anamnese, uma foto ou uma consideração — já coloca o paciente
> como **Em atendimento**. E quando você **Enviar ao Centro de Planejamento**
> (ou **Concluir a reavaliação**), o atendimento é **encerrado** sozinho.
>
> Duas coisas que ele **não** faz, de propósito: **abrir a ficha não chama
> ninguém** (olhar não é atender), e quem **não passou pela recepção** continua
> fora — é o check-in que move a fase do cliente na jornada, e pular esse passo
> esconderia a passagem.

> **A gravação cuida de si mesma.** Ela **começa** quando você chama o paciente
> para uma avaliação ou reavaliação e **para** quando você envia ao
> Planejamento, conclui a reavaliação ou encerra sem enviar — não existe mais o
> risco de esquecer de ligar ou de desligar. E se a avaliação for enviada por
> **outra pessoa** ou em **outra aba**, a gravação percebe em até um minuto
> que o paciente mudou de fase, e para e salva sozinha — inclusive a iniciada
> pelo botão **Gravar a consulta** da ficha. A
> faixa do rodapé mostra o tempo e continua lá enquanto você navega: pode abrir
> a anamnese, subir fotos, ver o histórico, que a gravação não é cortada.
>
> **Na primeira vez em cada computador**, o navegador pede permissão para o
> microfone — permita. Se você negar (ou se o microfone estiver desligado), o
> sistema avisa **em destaque** que a consulta não está sendo gravada; ele não
> finge que gravou. Nesse caso, resolva o microfone e use o botão **Gravar a
> consulta**, na tela de avaliação.
>
> **Se o paciente pedir para parar**, use **Parar e salvar** na faixa: o que já
> foi gravado é guardado na ficha, e nada mais é registrado a partir dali.
>
> **Sessões de tratamento, urgências e retornos não são gravados
> automaticamente** — só avaliação e reavaliação, que são as que viram
> transcrição e resumo para o planejamento.

**Terceira tarefa — a reavaliação:** quando o paciente volta para a revisão e
**não precisa de plano novo**, use **Concluir a reavaliação** na mesma tela de
avaliação. Ele vai para o **Acompanhamento** sem passar pelo Planejamento.
Precisando de plano novo, o botão é o mesmo de sempre: **Enviar ao Centro de
Planejamento**.

### 6.3. Dentista Planner

**Objetivo:** montar plano e orçamento. **Duração:** 75 minutos.

1. Menu **Centro de Planejamento** → a fila vem **priorizada** (apresentação
   comercial mais próxima primeiro).
2. Abra o caso → cockpit em duas colunas: evidências à esquerda, plano à direita.
   No cartão **Anamnese**, os alertas vêm primeiro, dizendo **o que** foi
   marcado (ex.: **Diabetes**, **AIDS**, **Dipirona**); abaixo, a ficha por
   seção, com pergunta e resposta lado a lado e **em vermelho só o que
   disparou alerta** — as outras opções marcadas aparecem em cinza.
2b. **Odontograma — diagnóstico por dente** (desde a 0.335.0; o quadro fica
   acima do plano e já vem aberto quando há sugestão). Para cada sugestão do
   Coordenador: **Aceitar**, **Ajustar** (troca a face ou a situação — a
   sugestão original fica guardada e ligada) ou **Rejeitar** (o motivo é
   recomendado: o Coordenador vai ver). **Aceitar todas** decide a lista de
   uma vez. Você também marca **direto** (toque no dente → faces → situação →
   **Marcar como definido**). Com tudo decidido, **Finalizar diagnóstico** da
   rodada: a partir daí **nada daquela rodada muda** — marcas, considerações,
   fotos e exames ficam trancados. Precisou corrigir depois? Marque de novo: o
   sistema pede o **motivo do adendo** e guarda o original. Enquanto houver
   sugestão pendente ou nenhuma rodada finalizada, o cockpit mostra o aviso
   **"Diagnóstico a definir"** — desde a 0.336.0 o plano pode ser montado,
   mas **o envio para aprovação só passa com o diagnóstico definido**. Na
   fila, o filtro **Com sugestões a definir** e o selo **"N a definir"**
   mostram quem está esperando.
3. **Iniciar plano de tratamento** → escreva o **Diagnóstico**.
4. **Adicionar opção de tratamento** (marque uma como principal).
5. Dentro da opção, **Procedimento** → escolha do catálogo → **Item**. O nome
   e o **preço vêm do catálogo** da unidade e não se digitam — não existe mais
   "item personalizado". Não achou o procedimento? **Sugira à rede** (o link
   fica logo abaixo da lista; veja adiante).
   **Onde o procedimento acontece** (desde a 0.336.0). Depois de escolher o
   procedimento, aparece o lugar, conforme a regra dele:
   - **por dente / face:** toque nos dentes no desenho (e nas faces, se o
     procedimento for de face — "2 faces" pede duas). **Vários dentes viram
     um item por dente** (quantidade 1 cada): o cliente pode aceitar um dente
     e não outro, e a baixa sai no dente certo. O sistema **recusa** o que
     não cabe (face que o dente não tem, nº de faces, dentição, grupo de
     dentes — ex.: selante não se faz em incisivo) e **avisa** quando a
     situação do dente não combina (ex.: restauração num dente marcado como
     ausente; implante num dente que não está ausente nem com extração
     planejada). Com aviso, o item só entra com o **motivo**, que fica à
     vista no item. O que a **mesma opção** já planeja conta: implante no 36
     + reabertura no 36 passa.
   - **por região / arcada:** escolha a região (sextante, hemiarco…) ou a
     arcada (superior, inferior, as duas).
   - **sem marcação** (consulta, exame…): como sempre, com quantidade.
   Cada opção tem o **Odontograma desta opção**: o diagnóstico em azul/cinza
   e, em **vermelho**, o que ela planeja. Itens lançados antes desta versão
   aparecem com **"sem dente — indique antes de enviar"**: remova e lance de
   novo com o lugar.
5b. **Grupo** (desde a 0.350.0) — para lançar de uma vez procedimentos que
   andam juntos (ex.: **exodontia + implante**, **canal + restauração**). Ao
   lado de **Procedimento**, clique em **Grupo** → escolha o grupo → toque nos
   dentes **uma vez só**: cada dente recebe todos os procedimentos de dente do
   grupo. Se algum é de **face**, escolha as faces dele ali mesmo; se é de
   **região**, escolha a região. A lista **Vai entrar no plano** mostra cada
   item, dente a dente, com o preço do catálogo, e o botão diz quantos itens
   vão entrar (**Lançar 4 itens**). Entram todos ou nenhum.
   - Cada procedimento vira um **item normal** do plano: preço do catálogo,
     sessões do protocolo, a mesma regra do dente (inclusive o aviso de
     situação e o motivo). Dá para editar ou remover um item sem mexer nos
     outros.
   - O item mostra a etiqueta com o **nome do grupo** de onde veio. O
     orçamento, a apresentação e a negociação continuam **item a item**, como
     sempre — o grupo é ferramenta de quem planeja.
   - **A ordem do grupo importa:** o procedimento que prepara o dente vem
     antes. Na exodontia + implante, o implante entra sem aviso porque a
     extração do mesmo dente já está planejada.
   - Procedimento do grupo que não está no catálogo da unidade (ou foi
     desativado) **fica de fora**, e a tela diz qual.
6. Classifique o **pilar** (1 dos 6) → **Salvar pilar**.
7. Monte os **Atendimentos e sequência** (botão no alto do cockpit) — veja
   abaixo.
8. **Enviar para aprovação do Coordenador**. O banco confere: diagnóstico por
   dente **finalizado** e sem sugestão pendente, e o **dente ou região** de
   cada procedimento que se marca na boca. ⚠️ **O preço de cada item congela
   no envio**, pelo preço do catálogo daquele dia (se houve reajuste durante
   o planejamento, vale o do dia do envio).
9. Aprovado, **Enviar ao Comercial**.

**Plano enviado ou aprovado não se edita** (desde a 0.336.0 o banco recusa
por qualquer caminho; o antigo "Reabrir para edição" saiu). Para mudar:
**Criar nova versão** — ela copia tudo, inclusive os dentes, e nasce como
"Plano v2" em rascunho. Enquanto a v2 não for aprovada, a v1 **continua
valendo** (é ela que o Comercial apresenta); quando a v2 é aprovada, a v1
fica **substituída**, guardada para consulta. Procedimento que não combina
mais com o diagnóstico de hoje não é copiado — a tela avisa quantos ficaram
de fora.

**Atendimentos e sequência** — é onde você diz **como o tratamento vai ser
executado**: o que é feito no mesmo horário, em que ordem e por quem.

- **Uma aba por opção do plano** (a principal primeiro). **Configure também as
  alternativas:** vale a configuração da opção que o cliente **comprar**. Se
  ele comprar a alternativa e ela não tiver sido configurada, o tratamento
  começa sem atendimento conjunto, sem tempo ajustado e sem sequência.
- Cada cartão é um **atendimento**. Para juntar sessões no mesmo horário,
  troque **Separado** por **+ Novo atendimento** numa sessão e escolha o mesmo
  atendimento nas outras.
- **Tempo do atendimento:** quando o cartão tem mais de uma sessão, aparece um
  campo com o **total**. Digite quanto o atendimento leva de verdade — dez
  sessões de 60 minutos no mesmo horário não levam 600 — e o sistema **reparte
  entre as sessões**, na proporção de cada uma. Dá para acertar uma sessão
  isolada depois, no campo dela.
- **Profissional** de cada sessão e a **ordem** dos atendimentos (arraste o
  cartão ou use as setas), do **Início** ao **Fim**.

> **As sessões do tratamento saem do que o cliente comprou.** Quando o
> tratamento começa, o sistema cria as sessões da **opção comprada** (principal
> ou alternativa) e só dos **procedimentos que ele levou** — numa compra
> parcial, o que ficou de fora não vira sessão. (Até a versão 0.303.0 as
> sessões saíam sempre da opção principal, mesmo quando a alternativa era a
> comprada.)

**Cuidados:** o sistema exige procedimentos lançados em cada opção para enviar;
plano de tratamento **não tem acréscimo** (o preço vem do orçamento aprovado);
depois de aprovado o plano fica em leitura — há **Reabrir para edição**, que
exige nova aprovação.

**Procedimento que não está no catálogo — sugira à rede.** Desde a versão
0.330.0 o Planner não cadastra procedimento e não lança item livre: o
orçamento usa só o catálogo da rede, com o preço dele. Quando o caso pede algo
que não está lá:

1. Clique em **Sugira à rede** (no plano, abaixo da lista de procedimentos) ou
   em **Sugerir novo procedimento** (em **Procedimentos**).
2. Preencha **nome**, **especialidade**, **pilar**, **quantidade de
   sessões**, **tempo total** (opcional) e a **justificativa** — por que a
   rede deve ter esse procedimento.
3. **Enviar à rede.** A sugestão ganha um código (`SP-`) e o Admin Master
   recebe o aviso no sino.
4. Acompanhe em **Procedimentos → Sugestões de novos procedimentos**. O Admin
   pode **pedir mais informações** (você recebe o aviso; clique em
   **Responder à rede**, escreva a resposta e, se quiser, corrija os campos),
   **recusar** (com o motivo) ou **aprovar** — aprovar já cadastra o
   procedimento no catálogo, com o preço que ele definir, e as sessões que você
   sugeriu viram o protocolo. A partir daí ele aparece na lista do plano.

Se o nome já existe no catálogo, o sistema recusa a sugestão e manda escolher
na lista. **As sessões de um procedimento que já existe** você mesmo ajusta:
em **Procedimentos**, no **relógio** (Protocolo de sessões) da linha do
procedimento — a mudança vale direto para a rede.

**Como ler a lista de Procedimentos** (versão 0.331.0). Os procedimentos vêm
em **blocos por especialidade**, cada um com a quantidade; clique no título
para abrir ou fechar (os botões **Abrir todos** e **Fechar todos** ficam no
alto). Cada procedimento é um cartão com **uma linha de resumo**:

- **preço** (ou "sem preço") e o **tempo** / as sessões;
- **sobra** — quanto fica do preço depois do material do kit e do maior
  repasse entre os níveis. Em vermelho quando é negativa. Não é a margem
  completa: cadeira, imposto e taxa estão na **Precificação**;
- **uso** — em quantos planos ele entrou nos últimos 90 dias;
- **falta …** (amarelo) — o que ainda falta para ele estar pronto para o
  orçamento: preço, tempo, pilar ou repasse. **Completo** (verde) quando não
  falta nada. O botão **Só os com pendência** mostra apenas os incompletos.

Clique no cartão para ver os detalhes (faixa de preço, repasse, repasse por
nível, kits, sessões, histórico e os botões de editar); abre um por vez. Os
**inativos** ficam numa seção própria no fim da lista, em cinza e riscados,
com o botão **Reativar** à vista — eles não aparecem no orçamento nem na venda.

**O repasse ao dentista em R$ ou em %** (versão 0.352.0). No cartão aberto, a
linha **Repasse** mostra o valor e quanto ele é do preço padrão — por exemplo,
*R$ 150,00 (30% do preço)* — e o **Repasse por nível** mostra o mesmo par para
cada nível (*Júnior: R$ 50,00 · 8,2%*). Quem cadastra (o Admin Master) digita
**o valor ou o percentual**, no cadastro do procedimento ou no **Editar** do
repasse por nível: digitou um, o outro aparece ao lado, calculado sobre o
preço padrão. O que fica gravado é sempre o **valor em R$** (regra da rede: o
repasse é valor fixo). Por isso, **se o preço mudar depois, o repasse continua
o mesmo e o percentual muda** — um reajuste de preço não aumenta o repasse de
ninguém sem alguém decidir. Sem preço padrão, o campo de percentual fica
apagado (não há sobre o que calcular).

**O repasse também sobre o preço mínimo** (versão 0.355.0). Quando o
procedimento tem **Preço mínimo**, a linha mostra os dois percentuais — por
exemplo, *R$ 7,50 (5% do preço · 6,82% no mínimo)* — e cada nível também
(*Júnior: R$ 7,50 · 5% do preço · 6,82% no mínimo*). No formulário, embaixo do
par R$ ⇄ %, aparece *"No preço mínimo (R$ 110,00): 6,82%"*. Como o repasse é
fixo, o percentual no mínimo é sempre o maior: é o peso do repasse no pior
caso, quando o procedimento sai pelo menor preço.

**O preço mínimo do procedimento trava a negociação** (versão 0.356.0). Se o
desconto do Comercial deixar um procedimento abaixo do **Preço mínimo**, a
negociação fica **aguardando autorização** do Gerente, como o desconto acima
do teto. Duas regras:

- Se a **unidade tem preço próprio menor** que o mínimo da rede, vale o preço
  dela — só o desconto abaixo disso pede autorização.
- O procedimento lançado por um **grupo com preço de pacote ou com mínimo
  próprio** segue a regra do grupo, não a do procedimento. Grupo sem desconto
  e sem mínimo não muda nada: vale o mínimo do procedimento.

**Grupos de procedimentos** (versão 0.350.0). Em **Procedimentos → Grupos**,
o Planner e o Admin Master montam os grupos que o plano oferece no botão
**Grupo**. Os grupos valem para a **rede inteira**.

1. **Novo grupo** → dê um **nome** (ex.: "Implante + prótese sobre
   implante") e, se quiser, uma descrição de quando usar.
2. Escolha os procedimentos **na ordem em que entram no plano** — o que
   prepara o dente vem antes. As setas mudam a ordem; o **×** tira da lista.
   Um grupo junta de 2 a 30 procedimentos, sem repetir.
3. A **quantidade** vale para procedimento que não se marca no dente
   (consulta, exame…). Procedimento de dente entra **uma vez por dente**
   escolhido no plano.
4. **Criar grupo.** O cartão do grupo mostra o **Preço do pacote** — o total
   pelo preço padrão da rede, um de cada.

**Preço do pacote — desconto ou acréscimo** (versão 0.353.0). Quem define é o
**Admin Master** (o Planner vê o preço, mas não muda — como no catálogo). No
cartão do grupo, **Definir preço e mínimo** (ou **Alterar**): escolha
*Desconto* ou *Acréscimo* e digite **o percentual ou o total do pacote** — o
outro aparece sozinho (ex.: R$ 1.400,00 por R$ 1.260,00 = 10% de desconto).
**Salvar preço do pacote** grava o **percentual**; apagar o percentual volta
cada item ao preço do catálogo.

**De onde sai o desconto** (versão 0.360.0). No mesmo lugar, escolha:

- **Um pouco de cada** — o mesmo percentual em todos (como era).
- **De um procedimento só** — escolha o procedimento e digite o **total do
  pacote**: o desconto inteiro sai dele, e os outros ficam pelo preço de
  tabela (ex.: canal R$ 950,00 + restauração R$ 450,00 por R$ 1.260,00,
  tirando só do canal = canal R$ 810,00).
- **Escolher o preço de cada um** — digite o preço de cada procedimento no
  pacote; o percentual de cada um aparece ao lado.

A tela mostra a prévia antes de salvar, e o cartão do grupo mostra **Sai
de: …**. Fica gravado o percentual de cada procedimento, então continua
valendo para qualquer número de dentes. O desconto não pode passar do preço
do procedimento (a tela avisa "não fecha"). Editar o grupo (ou usar
**Vincular a grupo**) mantém o percentual de quem fica; quem sai e volta
perde o seu.

**Preço mínimo do pacote** (versão 0.354.0), no mesmo lugar e também só do
Admin Master: digite o **% da tabela ou o total mínimo** (ex.: 85% de R$
1.400,00 = R$ 1.190,00). Ele **trava a negociação**: se o desconto do Comercial
deixar o pacote abaixo do mínimo, a negociação fica **aguardando autorização**
do Gerente, como o desconto acima do teto. O mínimo não pode ficar acima do
preço do pacote (a tela não deixa salvar). Em branco = sem mínimo.

**Repasse ao dentista no pacote** (versão 0.354.0). Abra a linha no cartão do
grupo: cada procedimento com o preço **no pacote** e o repasse de cada nível,
em R$ e em % desse preço, mais o total do pacote. Quando o grupo tem **preço
mínimo**, aparece a coluna **Mínimo** e o percentual também sobre ele (versão
0.355.0) — por exemplo, *R$ 100,00 · 11,7% do pacote · 12,38% no mínimo*. É o
mesmo repasse do cadastro do procedimento, na unidade em que você está; em
vermelho, o que ainda não tem repasse. Como o repasse é fixo, o desconto do
pacote **aumenta** o percentual.

**Vincular um procedimento a um grupo sem abrir o grupo** (versão 0.354.0).
No cartão aberto do procedimento (em **Procedimentos**), a linha **Grupos:**
mostra em quais grupos ele está. **Vincular a grupo** abre a lista: marcar põe
o procedimento no **fim** do grupo, com quantidade 1 (a ordem e a quantidade
se ajustam no editor do grupo); desmarcar tira. Um grupo precisa de pelo menos
2 procedimentos — para desfazer um grupo, inative ou exclua o grupo.

- **No plano,** cada procedimento lançado pelo botão **Grupo** entra com o
  preço do catálogo da unidade **já ajustado** pelo percentual — por isso vale
  para qualquer número de dentes. O item mostra *"1 × R$ 855,00 (de ~~R$
  950,00~~, pacote)"* e a opção mostra a linha **Pacote …: de … por …**. O
  diálogo do botão **Grupo** já mostra o total do pacote antes de lançar.
- **O preço vale no ENVIO para aprovação:** se o Admin mudar o percentual
  antes do envio, o plano pega o novo; depois de enviado, não muda mais.
- Procedimento lançado à mão (sem o botão Grupo) fica com o preço do
  catálogo, mesmo que esteja num grupo.
- O **repasse ao dentista não muda** (é valor fixo): o desconto do pacote sai
  da margem da clínica. O Comercial negocia a partir do preço do pacote, com
  o desconto e o teto de sempre.

**Inativar** tira o grupo do plano; o que já foi lançado não muda.
**Excluir** só funciona com grupo que nunca foi usado num plano — usado, o
sistema pede para inativar. Procedimento desativado no catálogo aparece
riscado no grupo e não entra no plano; edite o grupo para tirá-lo. E um
procedimento que está num grupo não pode ser excluído do catálogo: tire do
grupo antes (ou desative).

**Quando faltar informação para planejar**, não devolva o caso em silêncio: use
**Devolver ao Coordenador**, na aba Plano, e escreva o que falta (foto, exame,
consideração). Escolha **Conversão Clínica** quando for só dado faltando, ou
**Reavaliação** quando o caso precisar ser examinado de novo. O Coordenador
recebe o aviso com o seu motivo — sem ele, o caso volta igual.

> **Desde a 0.341.2 esse aviso chega de verdade.** Antes, o sistema mudava a
> fase, mas o recado com o motivo não era entregue (AP58). Se aparecer o
> alerta *"o recado com o motivo não foi entregue"*, o caso voltou mesmo assim:
> avise o Coordenador pelo chat.

### 6.4. Dentista (executor)

**Objetivo:** executar e registrar. **Duração:** 40 minutos.

Seu menu é diferente: **não tem Jornada**, e tem **Meu Dia** e **Minha Agenda**.

1. **Meu Dia** → seus atendimentos.
2. **Atendimento** → **Chamar**.
3. Ficha do paciente → aba **Desenvolvimento Clínico** → descreva o que foi
   feito. **Espere aparecer "Salvo às…"**.
4. **Concluir atendimento** → marque o que foi feito; o que não foi volta para
   "a agendar", com motivo.

> **O botão de concluir só libera depois da anotação.** Não é travamento: é a
> regra de que atendimento sem registro não encerra.

**O que acontece automaticamente ao concluir:** o material do kit **baixa do
estoque** e o repasse do procedimento é apurado. Você não digita nada disso.

**O dente de cada sessão e o odontograma do atendimento (desde a 0.339.0).**

- Cada sessão mostra **onde** é: *"Implante — Dente 46 · Sessão 2 de 3"*,
  *"Selante — 16 (O)"*. Vale na lista de sessões da ficha, no atendimento de
  hoje e na tela **Atendimento**.
- Na aba **Desenvolvimento Clínico**, durante o atendimento, aparece o
  **Odontograma do atendimento**: em **azul** o que já foi feito (com o
  símbolo), em **vermelho** o que falta do tratamento e o achado que pede
  tratamento.
- **Viu algo novo na boca?** Toque no dente, escolha a face e a situação e
  clique **Sugerir**. A sugestão fica presa a esta sessão e vai para o
  Planner decidir (aceitar, ajustar ou rejeitar). Durante o atendimento só se
  **sugere marca nova** — retirar uma marca continua com o Planner. Enquanto
  ninguém decidiu, **Desfazer** apaga a sua sugestão.

> **Quando o procedimento passa a contar como feito:** na **última** sessão
> daquele dente. Um implante de 3 sessões só vira implante no desenho quando a
> 3ª é concluída (decisão do dono, H1). E o feito **resolve o achado** do mesmo
> lugar: a restauração na face O do 16 tira do vermelho a cárie da face O do
> 16, que fica no histórico como **"tratado em …"** (H2). Nada é apagado: o
> desenho é recalculado a cada vez — se uma sessão voltar a pendente, o efeito
> sai sozinho.

**A evolução tranca (desde a 0.340.0, decisão do dono J1).** Enquanto o
atendimento está aberto, escreva e corrija à vontade. **Concluiu o
atendimento, a anotação tranca** (a anotação sem atendimento tranca no fim do
dia em que foi escrita). Para corrigir depois: botão **Adendo** na própria
anotação → o que corrigir + o **motivo** → **Registrar adendo**. O adendo
aparece logo abaixo da original, com o seu nome e a data; a original não muda
e não some. O mesmo vale para os **documentos clínicos**: emitido, não muda —
errou, emita outro.

**Quem conclui o atendimento:** quem atendeu — quem **chamou** o paciente
(ou, se ninguém chamou pelo painel, o profissional do agendamento). Outro
dentista da unidade não conclui o atendimento de um colega (até a 0.339.0 o
banco deixava, quando ninguém tinha chamado — corrigido).

### 6.5. Consultor Comercial

**Objetivo:** negociar e fechar. **Duração:** 60 minutos.

**Tarefa 1 — Enquanto a apresentação ainda não aconteceu**

Na coluna **A apresentar**, cada cartão mostra:

- **quando é a apresentação** e com quem — ou, em **vermelho**, *"Sem
  apresentação marcada"*, que é o caso que trava o funil;
- o selo verde **Confirmado** quando a Recepção confirmou a presença do
  cliente (na Agenda ou no Atendimento). **Sem o selo**, a apresentação está
  marcada mas ninguém confirmou ainda — vale uma mensagem antes;
- **quantas tentativas** já houve e **o que aconteceu da última vez**.

Quando o cliente não comparece, pede para remarcar, ou você fala com ele sem
conseguir remarcar: **Registrar acontecimento**. Escolha o tipo, escreva o que
houve, e pronto — entra no *Histórico do funil* com data, hora e o seu nome.

> **O tipo é o que faz o sistema contar.** É por ele que o cartão diz *"3ª
> tentativa · 2 não comparecimentos"*. Se tudo fosse texto livre, ninguém
> saberia quais casos mais falham.

**Quando não há mais o que tentar: Marcar como perdido** (ou *cancelado*), com o
motivo — que é obrigatório.

> ⚠️ **Isso move o cliente para o Acompanhamento (Fase 7)** e o marca como
> **inativo**. Não é um efeito colateral: é o objetivo.
>
> Enquanto ele ficasse parado na Fase 4, a recepção **não conseguiria nem
> agendar uma reavaliação** se ele ligasse meses depois — só uma apresentação
> comercial ou uma urgência. Na Fase 7 ele volta a ser agendável pelo caminho
> certo. Ver [Fluxo 4](#fluxo-4--o-cliente-que-volta-depois-de-perdido).
>
> **Nada se perde:** o caso continua no *Histórico* do Comercial, com o motivo,
> a data e quem marcou, e a passagem de fase fica registrada na jornada.

**Registro não se apaga.** Errou? Registre outro corrigindo — o histórico é a
memória do caso, e memória que se reescreve não serve de prova.

**Precisa de uma nova data?** Botão **Pedir agendamento**: o aviso vai para a
**Recepção da unidade do cliente**, que tem a agenda e o telefone dele. Escreva
o motivo — é o que ela vai usar ao ligar. Enquanto ela não marcar, o cartão
mostra *"Aguardando a Recepção agendar"*. **Um pedido por dia por cliente:**
clicar de novo não gera um segundo aviso.

Quando a Recepção marcar, **o cartão mostra sozinho** e o histórico ganha a
linha *"Apresentação remarcada para …"*.

**Tarefa 2 — Negociar e fechar**

1. Menu **Comercial** → seu funil.
2. Abra o caso (`/comercial/[clientId]`) → escolha a **forma de pagamento** →
   **Salvar negociação**.
3. **Cliente aceitou** (o botão só habilita depois de salvar).
4. Tela de apresentação (`/apresentacao/[clientId]`) → marque **Contrato
   assinado** e **Pagamento confirmado**.

> **A regra de ouro:** só é venda com os dois. O banco recusa receber dinheiro
> de venda não fechada.

**Depois do fechamento, quem agenda é a Recepção.** O cliente passa sozinho
para a fase **Início de Tratamento** na Jornada, e a Recepção recebe o aviso
**"Fechamento! Iniciar tratamento"**, que fica na tela dela até o início ser
agendado (fechar o aviso só adia 15 minutos). Você não precisa agendar nada.
Para conferir se o seu cliente já tem horário, veja o cartão dele na
**Jornada**: ele mostra o próximo agendamento ou, em amarelo, **"Sem
agendamento"**. **Clicar na marca abre a agenda:** no dia do agendamento,
para ver; ou, se não houver horário, a agenda da unidade — e para quem agenda
(Recepção e SDR) já com o **Novo agendamento** aberto e o cliente escolhido. Se
ficar sem horário mais tempo do que devia, avise a Recepção da unidade.

**Cuidado:** desconto acima do teto da unidade fica **aguardando autorização**,
e a cobrança não muda até alguém autorizar. O mesmo vale para o **pacote
abaixo do mínimo** (versão 0.354.0): se o plano tem procedimentos de um grupo
com preço mínimo e o desconto deixa o pacote abaixo dele, o painel avisa
*"Pacote … abaixo do mínimo"* antes de salvar, e o Gerente precisa autorizar.
O mesmo vale para o **preço mínimo de cada procedimento** (versão 0.356.0):
*"<procedimento> abaixo do mínimo"*. O benefício do programa (PPR+,
Empresarial) não conta — é direito do cliente.

**O quadro "Margem da venda"** (embaixo do resumo da negociação e na venda
direta) mostra quanto sobra para a clínica no preço negociado. Desde a versão
0.359.0 ele conta **tudo o que a Precificação conta**: o repasse do dentista,
a **hora de cadeira** (a hora clínica calculada da unidade, desde a 0.362.0, pelos minutos planejados de cada item), o **material e o
laboratório** dos kits e o **imposto + taxa média** sobre o preço — por isso o
desconto corta também o imposto. Na compra parcial, só os itens aceitos
entram. Abaixo da **margem mínima** da unidade o quadro fica amarelo; com
prejuízo, vermelho. É aviso, não bloqueio. Se aparecer *"Não consegui ler os
custos da unidade"*, a margem mostrada conta só o repasse — a real é menor.

**O odontograma na apresentação e no aceite (desde a 0.338.0).**

- **Slide "O seu odontograma":** o desenho da boca do cliente. Azul é o que já
  existe; **vermelho** é o que o plano faz (e o achado que pede tratamento, como
  cárie). Embaixo, a lista por dente: *"16 (O) — Selante"*. O slide **Proposta
  e investimento** também vem por dente.
- **Alternativas:** a apresentação abre **só na opção principal**. Se o plano
  tem outras opções aprovadas, aparece o botão **Mostrar alternativa: …** —
  cada uma entra como um slide com o seu desenho e o seu total. Clicar de novo
  esconde.
- **O que o cliente NÃO vê:** as anotações clínicas do Coordenador (as da
  avaliação) não vão para a apresentação nem para o deck do Gamma — são
  registro interno. O cliente vê o diagnóstico do plano, o odontograma e as
  considerações do planejamento.
- **No aceite:** cada caixinha diz o dente (*"Selante — 16 (O)"*). Ao lado, o
  **Odontograma do aceite**: tocar num dente marca ou desmarca **todos** os
  itens daquele dente. O que ficou de fora aparece em **cinza tracejado**. A
  aprovação parcial continua pedindo o motivo.

**O orçamento impresso.** Depois de **Salvar negociação**, o botão
**Orçamento** (no alto do painel) abre o documento para imprimir ou salvar em
PDF; no fechamento, o mesmo documento está em **Imprimir orçamento para
assinar**. Ele traz o desenho do que foi aceito, os procedimentos por dente, o
total (subtotal, benefício do programa, desconto), o pagamento, o que ficou de
fora com o motivo, a **validade** e as linhas de assinatura. Quando o plano tem
procedimentos de um **grupo com preço de pacote**, o orçamento e a apresentação
mostram também a linha **Pacote …: de R$ … por R$ …** (versão 0.353.0) — os
procedimentos continuam um a um, já com o preço do pacote.

> **O orçamento lê o que está SALVO**, não o que está na tela. Mudou alguma
> coisa? Salve antes de abrir. Enquanto a negociação estiver aguardando a
> autorização do Gerente, o papel sai com o aviso de que os valores ainda
> podem mudar — não colha assinatura antes.
>
> **Validade:** 15 dias a partir do dia em que foi impresso, salvo se o Admin
> configurou outro prazo para a rede ou para a unidade.
>
> Por enquanto o orçamento é o papel que o cliente assina; o contrato com
> cláusulas virá quando o modelo da Risarte for cadastrado.

**Versão nova do plano durante a negociação.** Se o Planner fizer uma versão
nova do plano e ela for aprovada antes do aceite, a negociação da versão
anterior é **encerrada** com a situação **"Substituída por nova versão do
plano"** — você recomeça na versão nova (o painel já abre nela). Venda já
aceita não muda: o que foi vendido vale.

> **Você trabalha no funil; a sala de espera é da recepção.** As duas telas se
> falam sozinhas desde a v0.270.0:
>
> | A recepção faz | Você vê / o que acontece |
> |---|---|
> | Recebe o cliente e coloca **em espera** | O cartão mostra **Em espera** e há quantos minutos |
> | — | Você move o cartão para **Acontecendo agora** → o cliente vira **Em atendimento** na tela dela |
> | — | Você marca **Apresentado**, **Follow-up**, **Cancelado** ou **Perdido** → o atendimento é **concluído** sozinho |
> | — | A **venda é concluída** (contrato + pagamento confirmados, por você ou pela Assistente) → o atendimento é **concluído** sozinho |
>
> **Follow-up só encerra o que estava acontecendo:** mandar para follow-up um
> cliente que nem foi apresentado não marca a apresentação como feita.
>
> **Um atendimento aberto de cada vez.** Enquanto você tiver um atendimento
> sem concluir, o sistema não deixa chamar outro cliente — é o que mantém a
> sala de espera confiável. A recusa diz **com quem e de quando** é o
> atendimento aberto, e ele aparece em **Em atendimento** na tela da recepção,
> **seja de que dia for** (com o selo *Marcado para…* quando a apresentação
> era de outro dia e foi iniciada antes). Fechar venda em follow-up não
> depende de chamar ninguém: contrato e pagamento não passam pela sala de
> espera.
>
> Por isso o menu **Atendimento** não aparece mais para você: o que você
> precisa saber já está no cartão. O quadro se atualiza sozinho a cada 45
> segundos, então o que a recepção fizer chega até você sem recarregar nada.

> **A sua agenda não é a da unidade.** A apresentação comercial é **online**:
> não ocupa sala nem cadeira, e **não depende de a unidade estar aberta**. Você
> atende várias unidades de onde estiver, e quem manda nos seus horários é a
> **Agenda do Comercial** (Administração → Agenda do Comercial), configurada
> pelo Admin Master ou pela Franqueadora. O padrão da rede é **segunda a sábado,
> das 8h às 20h**; se a sua jornada for outra, peça a configuração própria.
>
> **O que ainda impede uma apresentação:** as suas férias (planejamento anual),
> um fechamento de agenda que inclua você, e um horário em que você já tem outro
> compromisso. Feriado da unidade, não.

**Quando o plano não serve para a negociação** — o paciente pediu algo mais
barato, mudou de ideia sobre o escopo, ou o orçamento não cabe no que ele pode
pagar —, use **Devolver ao Planejamento** e escreva as considerações. O plano
**reabre** para o Planner com o seu texto em destaque, a negociação é encerrada,
e o cliente volta para o **Centro de Planejamento**. É o único jeito de fazer
esse caminho: a fase não se move à mão.

### 6.6. Gerente de Unidade

**Objetivo:** responder pela unidade. **Duração:** 90 minutos (é a função com
mais telas).

Módulos: Financeiro, Estoque, Compras, Comercial, Relatórios, Planos,
Risartanos, Empresarial.

**O prontuário completo do paciente (desde a 0.340.0, decisão do dono J3).**
Quando o paciente pede os dados dele (LGPD), numa transferência, numa
auditoria ou por ordem judicial: ficha do paciente → aba **Linha do tempo** →
**Prontuário completo** → escolha o **motivo** (em "Outro", escreva qual) →
**Gerar e abrir** → **Imprimir / salvar em PDF**.

- O documento traz: paciente, consentimentos, **todas** as versões da
  anamnese, as avaliações (considerações, diagnóstico por dente com o carimbo
  de quando foi finalizado, **fotos e radiografias impressas**; áudio, vídeo e
  outros arquivos na lista), o odontograma de hoje e o que foi feito, os
  planos (versões), a evolução com os adendos e os documentos emitidos.
- O rodapé diz **quem gerou, quando e por quê**. Cada geração e cada abertura
  ficam registradas. O link vale **24 horas**; depois, gere de novo.
- Só o **Gerente da unidade** e o **Admin Master** geram. O documento é dado
  sensível de saúde: entregue só a quem tem direito.

**Rotinas mensais:**
1. **Fechamento de competência** (`/financeiro/fechamento`) — trava o mês.
   A conferência **não bloqueia**: ela lista pendências e o botão vira "fechar
   mesmo assim". Só a **depreciação não rodada** é alerta grave.
2. **Inventário de estoque** — a diferença encontrada vira ajuste **com motivo**.
3. **Requisição de compra** — a lista vem do que o Estoque aponta em falta.

> **Cuidado central:** no financeiro **nada se apaga**. Lançamento liquidado
> gera um **contra-lançamento** com motivo. Conferir antes de salvar vale mais
> aqui do que em qualquer outra tela.

#### Planejamento anual: quantas horas a unidade pode trabalhar — e quantas trabalhou

**Onde:** Agenda → **Mais ações** → **Planejamento anual**
(`/agenda/planejamento-anual`). **Quem vê:** a Gerente da unidade e o Admin.

A tela tem duas contas de **horas possíveis**:

- **Horas de funcionamento** — o relógio da unidade. Um dia das 08h às 18h
  vale 10 horas (o almoço, se configurado, sai da conta).
- **Horas de cadeira** — as horas de funcionamento vezes o número de cadeiras
  ativas. Duas cadeiras num dia de 10 horas são 20 horas de cadeira. **É sobre
  elas que a ocupação é calculada.**

**O que aumenta e o que reduz as horas possíveis:**

| Você faz… | Onde | Efeito |
|---|---|---|
| Libera um **horário avulso** | Configurar agenda | **Aumenta.** Num dia que a unidade não abre, vale o horário liberado. Num dia normal, vale só o que passou do horário de sempre (liberar das 18h às 20h soma 2 horas) |
| **Fecha a agenda** da **unidade toda** | Agenda → Fechar agenda | **Reduz** as duas contas, pelo tempo fechado dentro do horário de atendimento |
| **Fecha a agenda** de uma **sala** | Agenda → Fechar agenda | **Reduz só as horas daquela cadeira**; a unidade continua aberta |
| **Fecha a agenda** de um **profissional** | Agenda → Fechar agenda | **Não reduz** — a cadeira continua disponível para outro. Aparece numa linha à parte |
| Decide que um **feriado fecha** | Planejamento anual | **Reduz** o dia inteiro |
| Lança **recesso, férias coletivas, evento, treinamento ou manutenção** | Planejamento anual | **Reduz** os dias do período — os da unidade e os lançados pela **rede** |

O quadro **Como se chega às horas possíveis** mostra essa conta linha por
linha, com o sinal de cada parcela. Se um número parecer errado, é ali que se
confere.

**O outro lado — o que aconteceu na agenda:**

- **Horas agendadas:** tudo o que está marcado na cadeira e não foi cancelado.
- **Horas trabalhadas:** o **tempo marcado na agenda** de cada atendimento
  **concluído**. Não é o relógio entre chamar o paciente e concluir.
- **Ocupação da agenda:** agendadas ÷ horas de cadeira do período inteiro.
- **Ocupação realizada:** trabalhadas ÷ horas de cadeira **dos dias até hoje**.
  Num período que ainda não começou, aparece um traço — não 0%.

> **Atendimento sem desfecho não conta como trabalhado.** Se o dia passou e
> ninguém concluiu o atendimento nem marcou a falta, ele aparece na linha
> *"Dia já passou e ninguém registrou o desfecho"* e a ocupação realizada fica
> menor do que foi de verdade. **Concluir os atendimentos no sistema é o que
> faz esse número dizer a verdade.**

**Ficam fora da ocupação**, e a tela diz quanto foi: os agendamentos
**cancelados** (o horário voltou a ficar livre) e o atendimento **online**,
que não usa cadeira.

**Período:** os campos **De** e **Até**, ou os atalhos *Ano*, *Este mês*,
*Mês passado* e *Do início do ano até hoje*. Com mais de um mês no período,
aparece a tabela **Mês a mês**.

**Três avisos que a própria tela dá:**

1. **Feriado ainda sem decisão conta como dia normal**, porque a agenda aceita
   agendamento nele. Decidir os feriados acerta a conta.
2. **Os dias que já passaram são calculados com o horário e as cadeiras de
   hoje.** O sistema não guarda como a agenda estava configurada no passado.
3. **Unidade sem sala cadastrada** em Configurar agenda usa o número de
   cadeiras da configuração, e a tela avisa. Cadastrar as salas faz o número
   seguir as cadeiras de verdade.

**Evidência:** EV-160 a EV-162; `src/lib/horas-da-agenda.ts`;
`src/app/(app)/agenda/planejamento-anual/`.

### 6.7. Demais funções

**SDR:** cadastrar e agendar; não move fases. **Assistente Comercial:** enviar
documentos e acompanhar. **TSB/ASB:** apoio clínico e consumo de estoque.
**Franqueado:** leitura da própria unidade. **Financeiro da Franqueadora:**
configuração da rede e visão consolidada. **Comprador:** mesa de negociação.
**Consultor RisLife:** programa Empresarial.

Para essas funções, os passos seguem os módulos descritos na
[seção 7](#7-mapeamento-da-interface). ⚠️ Roteiros detalhados
**não foram escritos** por falta de validação em tela — registrado nas lacunas.

---

## 7. Mapeamento da interface

> ⚠️ **Localização visual não confirmada no código.** A posição de cada botão na
> tela deve ser validada na interface em execução. O que está confirmado é: a
> rota, quem pode abrir, e o que a ação faz.

### 7.1. Entrada e autenticação

| Item | Rota | Quem | O que faz |
|---|---|---|---|
| Tela de login | `/login` | todos | E-mail + senha. **Não há auto-cadastro nem "esqueci minha senha"** |
| Botão **Entrar** | `/login` | todos | Autentica; erro genérico não revela se o e-mail existe |
| Botão **Sair** | barra lateral, rodapé | todos | Encerra a sessão **deste aparelho** e registra a saída |

**Evidência:** `src/app/login/login-form.tsx`; `src/app/login/actions.ts`
(`iniciarAcesso` abre o acesso do dia e grava a entrada na auditoria);
`src/app/auth/encerrar/route.ts` (a saída).

**O sistema desconecta sozinho em dois casos** (desde a versão 0.305.0):

- **Ficou sem uso.** Depois de um tempo sem clicar, digitar ou rolar a tela —
  **60 minutos** como padrão, e o Admin pode definir outro tempo para cada
  função —, o sistema desconecta. **Dois minutos antes** aparece a pergunta
  *"Você ainda está aí?"*, com a contagem: qualquer clique ou tecla mantém
  você conectado. Deixar o sistema aberto **não** conta como uso.
- **Virou o dia.** O acesso vale para a **data** em que foi feito. No primeiro
  clique do dia seguinte o sistema pede a senha de novo — é assim que fica
  registrado cada dia em que você acessou.

Nos dois casos você volta para a tela de login, que **diz o motivo**. Não é
defeito e não é queda do sistema.

> **Salve antes de sair da mesa.** O que estava digitado e não foi salvo se
> perde quando o sistema desconecta.

> **Em atendimento com a gravação ligada, o sistema não desconecta** — nem
> por inatividade, nem pela virada do dia. Enquanto a faixa **Gravando**
> estiver na tela, você continua conectado, mesmo sem tocar em nada.

> **Mais de uma aba aberta?** Mexer em uma mantém todas conectadas. Sair
> desconecta só o aparelho em que você clicou em Sair.

> **Para o Admin Master:** o tempo de cada função fica em **Administração →
> Sessão e inatividade** (em branco, a função segue o padrão; quem tem mais de
> uma função fica com o menor tempo). E em **Administração → Auditoria**, a
> aba **Acessos** mostra um registro por login: o dia, a hora de entrada, a
> saída e o motivo (saiu, inatividade, virada do dia), o **tempo em uso**, o
> **tempo parado**, o navegador e o endereço de internet. O passo a passo da
> Auditoria está na **seção 13c**.

### 7.2. Barra lateral (o menu)

28 itens, agrupados. O bloco **Administração** só aparece para o Admin Master e
vem **fechado**: clique no título "Administração" para abrir ou fechar (a seta
mostra como está), e o sistema lembra a sua escolha. Numa tela de administração
ele abre sozinho. Há também um botão para **minimizar** a barra (a preferência
fica guardada), e o **seletor de unidade** no alto para quem atende em mais de
uma.

No rodapé: seu nome, seu e-mail, a **versão do sistema** e o botão **Sair**.

**No celular** (tela estreita), o menu fica **escondido** para a tela ter a
largura inteira. Toque no **☰**, no canto esquerdo da barra de cima: o menu
abre por cima da tela e **fecha sozinho** quando você escolhe um item (ou toca
fora dele). Em computador e tablet, nada muda (desde a versão 0.319.0).

### 7.3. Telas por área

**Cadastros e consultas:** `/prontuarios`, `/prontuarios/novo`,
`/prontuarios/[id]`, `/procedimentos`, `/risartanos`, `/risartanos/novo`,
`/risartanos/[codigo]` (a ficha), `/risartanos/acesso/[userId]` (login sem
cadastro, só Admin).

**Jornada e clínico:** `/jornada`, `/avaliacao/[clientId]`, `/planejamento`,
`/planejamento/[clientId]`, `/planos`, `/atendimento`, `/meu-dia`,
`/minha-agenda`, `/agenda`.

**Comercial:** `/comercial`, `/comercial/[clientId]`,
`/apresentacao/[clientId]`, `/cancelamentos`, `/renegociacoes/[id]/acordo`.

**Financeiro (21 telas):** `/financeiro` e as subtelas `adquirentes`, `bens`,
`centros-de-custo`, `conciliacao`, `configuracao`, `consolidado`,
`contas-a-pagar`, `dre`, `fechamento`, `fluxo-de-caixa`, `fornecedores`,
`orcamento`, `painel-da-rede`, `plano-de-contas`, `ponto-de-equilibrio`,
`repasses`, `taxas-da-rede`.

**Estoque e compras:** `/estoque`, `/compras`.

**Ortodontia (desde a versão 0.361.0):** `/ortodontia` (Painel), `/ortodontia/atencao`,
`/ortodontia/casos`, `/ortodontia/casos/novo`, `/ortodontia/casos/[id]` (a ficha do
caso), `/ortodontia/casos/[id]/contrato` (o termo para imprimir),
`/ortodontia/mensalidades`, `/ortodontia/configuracao`.

**Programas:** `/ppr`, `/empresarial`.

**Administração (9 telas):** `/admin/clinicas`, `/admin/permissoes`,
`/admin/sla`, `/admin/regras-comerciais`, `/admin/agenda`, `/admin/anamnese`,
`/admin/orientacoes`, `/admin/documentos`, `/admin/chat`, `/admin/auditoria`,
`/admin/odontograma` (desde a versão 0.332.0).
O antigo `/admin/usuarios` **não existe mais**: o acesso de cada pessoa mora na
ficha dela, em `/risartanos`.

**Ajuda:** `/manual`, `/alertas`, `/problemas`.

**Outros:** `/notificacoes`, `/perfil`, `/chat`, `/relatorios`, `/documentos`.

#### Na ficha do cliente: a aba Odontograma (desde a versão 0.334.0; marcas desde a 0.335.0)

A ficha do cliente (`/prontuarios/[id]`) tem a aba **Odontograma**, entre
**Clínico** e **Desenvolvimento Clínico**, e uma **miniatura** no cabeçalho,
na linha da fase e do pilar — clicar nela abre a aba. Quando há sugestão do
Coordenador esperando o Planner, a miniatura mostra **"N a definir"**.

- **O que mostra:** o desenho da boca, dente a dente, na notação de dois
  algarismos (11 a 48 os permanentes, 51 a 85 os de leite), com as **marcas
  do diagnóstico** (desde a 0.335.0): o que está **definido** e, tracejado, o
  que ainda é **sugestão**. Desde a 0.336.0 entra também, em **vermelho**, o
  que o **plano que vale** planeja (a versão aprovada mais nova; sem
  aprovada, a mais nova). O filtro **Todos / Só definidos / Só sugestões / Só
  o plano** troca o que aparece. Desde a 0.339.0, o que já foi **feito** no
  tratamento entra em **azul** (com o símbolo e "feito em …") e sai do
  vermelho; o achado que ele tratou some do desenho e fica no histórico como
  **"tratado em …"**. Desde a 0.340.0, a aba **Linha do tempo** (ao lado)
  junta tudo o que foi registrado no atendimento clínico, por dia, e o botão
  **"ver o odontograma neste dia"** (ou o campo da data) mostra a boca **como
  estava** naquele dia. Embaixo: o **diagnóstico por rodada** (Avaliação 1,
  Reavaliação 2…), com o selo **"Finalizado em … por …"**, e o **Histórico das
  marcas** (quem sugeriu, quem decidiu, quando e o motivo).
- **Na ficha é só leitura.** Quem marca faz isso nos cockpits: o Coordenador
  **sugere** na avaliação (seção 6.2) e o Planner **define** no Centro de
  Planejamento (seção 6.3). A aba traz os botões que levam até lá, para quem
  pode usar.
- **Como ler:** a vista é **de frente para o paciente** — o lado direito dele
  fica à **esquerda** da tela. Em cada dente: **V** (vestibular, a face de
  fora), **P** ou **L** (palatina ou lingual, a de dentro), **M** (mesial,
  voltada para o meio da boca), **D** (distal) e, no centro, **O** (oclusal,
  nos dentes de trás) ou **I** (incisal, nos da frente). O quadro **Como ler o
  desenho** explica as cores: **vermelho** = a realizar (do plano) **ou achado
  a tratar** (cárie, fratura, lesão… — desde a 0.337.0, decisão do dono),
  azul = existente ou já feito, cinza com X = ausente, contorno tracejado =
  sugestão ainda não definida. A cor sempre vem com o símbolo da situação.
- **Dentição:** os botões **Permanente**, **Decídua** e **Mista** trocam o
  desenho. Se o Coordenador ou o Planner já **registraram** a dentição do
  paciente, ela abre assim ("Dentição registrada no odontograma do
  paciente"); senão, pela idade da ficha (até 5 anos, decídua; de 6 a 12,
  mista; depois, permanente). Sem data de nascimento, abre na permanente. Na
  ficha, trocar o botão não grava nada; nos cockpits, quem marca grava.
- **Quem vê:** Admin Master, Dentista Planner, Coordenador Clínico, Dentista,
  Gerente da unidade e Consultor Comercial. **Não veem:** Assistente
  Comercial (decisão do dono: só precisa do que serve para documento e
  pagamento), Recepção e SDR — para eles a aba e a miniatura não aparecem.
- **Se aparecer "Não foi possível carregar os dentes agora":** a leitura da
  referência falhou. Recarregue a página; se continuar, relate pela boia. O
  sistema não mostra um desenho vazio no lugar, para ninguém achar que o
  paciente não tem registro.
- **No celular**, o desenho rola de lado dentro do quadro.

A lista completa das 87 rotas, com as guardas de acesso encontradas em cada
página, está em
[`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json).

### 7.4. Ações do sistema

Foram encontradas **384 ações de servidor** (as operações que gravam ou alteram
dados). Elas estão catalogadas no inventário JSON, com o arquivo de origem de
cada uma.

⚠️ **Não foi produzida a descrição individual das 384 ações.** Seria material
de referência técnica, não de treinamento, e exigiria validação em tela.
Registrado nas lacunas.

### 7.5. Listas com busca

Nas telas de **Compras, Estoque e Financeiro**, as listas que crescem com a
rede — **fornecedor, item do estoque, conta do plano de contas, centro de custo
e procedimento** — têm um campo de busca (a lupa) no alto (desde a versão
0.316.0):

1. **Clique na lista.** Ela abre com o cursor já no campo *"Digite para
   procurar…"*.
2. **Digite parte do nome.** Não precisa de acento nem de maiúscula, e vale
   digitar pedaços de palavras, em qualquer ordem: *"anest lido"* acha
   *"Anestésico lidocaína 2%"*; *"royal"* acha *"2.6.01 · Royalties"*.
3. **Escolha.** A primeira que atende fica destacada: **Enter** escolhe ela.
   Também dá para clicar na que quiser, ou descer com as setas.
4. **Esc** fecha a lista sem mudar a escolha. Dentro de uma janela (como a
   *Nova conta a pagar*), fecha só a lista — a janela continua aberta, com o
   que já estava preenchido.

Se nada atender, a lista diz *"Nada encontrado com essa busca."* — o nome
procurado não está nessa lista.

O filtro de **fornecedor** de Contas a pagar e o de **centro de custo** da
**DRE** e do **Ponto de equilíbrio** também têm a busca, e aplicam assim que
se escolhe.

**Fora desses módulos (desde a versão 0.321.0)**, as mesmas listas que crescem
com a rede também ganharam a busca:

- a **pessoa**, nos filtros da **Auditoria** (todas as abas que filtram por
  pessoa) — escolheu, o filtro aplica;
- o **procedimento do catálogo**, no plano de tratamento do prontuário, na
  **venda direta** e nos **benefícios** do PPR+;
- o **dentista**, na avaliação de qualidade da reavaliação e nos filtros das
  abas de procedimentos e de tratamento da ficha;
- o **profissional**, no filtro do **Atendimento** — escolheu, o filtro aplica.

**Continuam como eram, de propósito:** as listas curtas (unidade de medida,
tipo de movimento, mês, conta bancária), em que rolar é mais rápido que
digitar.

**Evidência:** `src/components/ui/lista-com-busca.tsx` e `src/lib/busca.ts`;
EV-171, EV-172 e EV-182.

---

## 8. Fluxos principais de uso

### Fluxo 1 — Primeiro acesso

**Papel:** qualquer. **Pré-condição:** administrador criou o seu acesso.

1. Abra o endereço do sistema.
2. Informe e-mail e senha.
3. **Se você tem acesso a mais de uma unidade** e não é da Franqueadora, o
   sistema pede para escolher a unidade **antes** de mostrar qualquer tela
   (evidência: `layout.tsx`, `ChooseClinicWelcome`).
4. **Resultado:** você cai na tela Início.

**Erros possíveis:** ver [seção 9](#9-erros-falhas-e-mau-funcionamento).

### Fluxo 2 — Do cadastro ao fechamento (a jornada completa)

**Papéis:** cinco pessoas diferentes. **Este é o fluxo central do sistema.**

1. **Recepção** cadastra o paciente → nasce na **Aquisição**.
2. **Recepção** agenda a avaliação e faz o **check-in** quando o paciente chega
   → o sistema move sozinho para **Conversão Clínica**. (Não existe mais botão
   para mover aqui: quem move é a chegada do paciente.)
3. **Coordenador** registra consentimento → anamnese → fotos → **Enviar ao
   Centro de Planejamento** → paciente vai para a **Fase 3**.
4. **Planner** monta plano + orçamento + pilar → **Enviar para aprovação**.
5. **Coordenador** aprova a opção.
6. **Planner** **Envia ao Comercial** → **Fase 4**.
7. **Consultor** negocia → **Cliente aceitou** → marca **Contrato assinado** e
   **Pagamento confirmado** → venda fechada → **Fase 5**.
8. **Recepção** recebe aviso e agenda o início do tratamento.
9. **Dentista** executa, escreve o Desenvolvimento Clínico e conclui →
   **estoque baixa e repasse é apurado automaticamente**.

**Evidência:** este fluxo está coberto por teste automatizado ponta a ponta
(`e2e/01-jornada.spec.ts` a `e2e/10-estoque.spec.ts`), o que confirma que cada
passo funciona como descrito.

**Pontos de decisão:** o Coordenador pode **reprovar** (volta ao Planner com
orientações); o cliente pode **não aceitar** (vai para follow-up).

### Fluxo 2b — Quem move o cliente de fase (e quando)

**A fase anda sozinha.** Ela é a consequência do trabalho que acabou de ser
feito — não é um campo que alguém arrasta quando lembra. Se a fase pudesse ser
mudada à mão, ela passaria a dizer o que a pessoa achou, e não o que aconteceu.

**O sistema move sozinho quando:**

| O cliente vai de | para | quando |
|---|---|---|
| Aquisição | Conversão Clínica | a recepção faz o **check-in** da **avaliação** |
| Aquisição | Início de Tratamento | check-in de **urgência/emergência** |
| Conversão Comercial | Início de Tratamento | a **venda fecha** (contrato assinado **e** pagamento confirmado) |
| Conversão Comercial | Início de Tratamento | check-in da **1ª sessão** |
| Conversão Comercial | Acompanhamento | o consultor marca a negociação como **perdida** |
| Início de Tratamento | Reavaliação | resposta **SIM** em "necessita reavaliação?" |
| Início de Tratamento | Centro de Planejamento | resposta **SIM** em "necessita novo planejamento?" |
| Início de Tratamento | Acompanhamento | resposta **NÃO** em "necessita novo planejamento?" |
| Acompanhamento | Reavaliação | check-in de uma **reavaliação** |
| Acompanhamento | Início de Tratamento | check-in de uma **sessão** |
| qualquer fase | Reavaliação ou Acompanhamento | **cancelamento de plano** efetivado (o Gerente escolhe o destino) |

**E há cinco botões que movem — porque mover é a consequência do que você
acabou de fazer:**

| Botão | Quem clica | O cliente vai |
|---|---|---|
| **Enviar ao Centro de Planejamento** | Coordenador Clínico | para o Planejamento |
| **Concluir a reavaliação** | Coordenador Clínico | para o Acompanhamento |
| **Enviar ao Comercial** | Dentista Planner | para a Conversão Comercial |
| **Devolver ao Coordenador** (pede o motivo) | Dentista Planner | de volta à avaliação ou à reavaliação |
| **Devolver ao Planejamento** (pede as considerações) | Consultor Comercial | de volta ao Planejamento |

> **Os dois "devolver" pedem o motivo escrito de propósito.** Antes o caso
> voltava e ninguém sabia por quê — então voltava igual, e o tempo perdido
> aparecia no SLA como lentidão de quem recebeu. Agora quem recebe o caso de
> volta recebe junto o que falta.

**E se a fase estiver errada mesmo assim?** Só o **Admin Master** pode mover um
cliente à mão, em qualquer sentido. É a válvula para o caso que a regra não
previu — e toda passagem forçada fica marcada na auditoria como forçada, para
depois se saber que aquela fase andou sem o fato que deveria tê-la movido.

> **Não encontrou o botão de mover?** Ele não sumiu por engano: se você não é
> Admin Master, a fase muda pelo seu trabalho. Quando ela parecer travada, o
> que falta é um passo do fluxo — o check-in que não foi feito, a decisão que
> ninguém respondeu, o pagamento que não foi confirmado.

### Fluxo 3 — Encerrar a sessão

Botão **Sair** no rodapé da barra lateral. A saída fica registrada na
auditoria. Se você não sair, o sistema desconecta sozinho depois do tempo de
inatividade da sua função, e sempre na virada do dia (seção 7.1).

### Fluxo 4 — O cliente que volta depois de perdido

**Papéis:** Consultor Comercial, Recepção, Coordenador Clínico.

Nem todo cliente que some some para sempre. Este é o caminho de volta.

1. **Consultor** marca **perdido** (ou cancelado), com o motivo. O sistema move
   o cliente para o **Acompanhamento (Fase 7)** e o marca como **inativo**.
2. Meses depois, **o cliente liga**. A **recepção** agenda uma **Reavaliação** —
   que é um tipo disponível na Fase 7.
3. O cliente **comparece**, e o **check-in sozinho** o leva para a **Reavaliação
   (Fase 6)**. No mesmo instante ele volta a ser **ativo**.
4. **Coordenador** reavalia e envia ao **Centro de Planejamento**.
5. Novo plano, nova aprovação, e o cliente **volta ao Comercial** — agora com um
   orçamento que reflete a boca dele hoje, não a de um ano atrás.
6. **O cartão reabre sozinho** e o cliente reaparece em **A apresentar**,
   começando uma **rodada nova**: sem o motivo da perda e com as tentativas
   zeradas.

> **Por que passar de novo pela avaliação.** Quando muito tempo se passa desde a
> última, o plano antigo já não descreve o paciente. Reapresentar aquele
> orçamento seria negociar sobre uma fotografia vencida.

> **A fase manda no cartão.** Sair do funil encerra o cartão; entrar no funil
> reabre. Não existe botão para isso, e é de propósito — dois jeitos de dizer a
> mesma coisa acabariam discordando.
>
> **Rodada nova não apaga história:** as tentativas e o motivo da perda anterior
> continuam no **Histórico do funil**. O que zera é o contador da rodada, para o
> cartão não abrir dizendo *"4ª tentativa"* sobre um cliente com quem ninguém
> falou ainda desta vez.

**Se o cliente voltar logo**, sem necessidade de nova avaliação: o Admin Master
move a fase direto para a Conversão Comercial — e o cartão reabre do mesmo
jeito.

### Fluxo 5 — Compras: pedir, negociar, aprovar e receber

A regra que organiza tudo: **a negociação é da rede, o dinheiro é da unidade.**
A Franqueadora negocia por todas; cada unidade aprova, é faturada, paga e
recebe a sua parte. Por isso **quem aprova é quem paga**.

| Passo | Tela | Quem faz | O que fazer |
|---|---|---|---|
| 1. Pedir | Compras → **Pedir** | Gerente, Coordenador Clínico ou ASB da unidade (e o Admin) | **Gerar lista de compras** (o sistema sugere o que está abaixo do mínimo) → ajustar as quantidades, **Acrescentar item** se faltar algo → **Enviar à Franqueadora** |
| 2. Negociar | **Mesa de negociação** | Comprador, Financeiro da Franqueadora, Admin | **Abrir rodada** com as listas recebidas → **Incluir na cotação** os fornecedores com o preço de cada um → escolher o fornecedor de cada item → **Fechar rodada** |
| 3. Aprovar | Compras → **Aprovar** | Gerente da unidade (e o Admin). Na compra da **própria Franqueadora**: o **Financeiro da Franqueadora** | **Aprovar** ou **Recusar** cada item (recusar pede o motivo) → **Gerar pedidos** (um por fornecedor) |
| 4. Receber | Compras → **Receber** | Gerente da unidade, Financeiro da Franqueadora, Admin — **não** o Coordenador nem o ASB: receber cria a conta a pagar | Quando a entrega chega, conferir pela nota → **Registrar entrega**: o material entra no estoque e a conta a pagar nasce sozinha |

**Cada lista diz quem pediu e em que pé está.** Em Compras → **Pedir**, logo
abaixo do código, aparece *"Pedida por Fulana, Gerente de Unidade · Risarte
Cambé - Centro · 26/10/2026 10:47"*, e depois do envio *"Enviada por … em …"*.
A terceira linha diz de quem é a vez:

| Situação da lista | O que quer dizer | Tem algo para aprovar? |
|---|---|---|
| **Rascunho** | Só a unidade vê; ainda não foi enviada | Não |
| **Enviada** | Está com a Franqueadora, esperando entrar numa rodada de negociação | **Não** — a aprovação só nasce quando a Franqueadora fecha a negociação |
| **Em negociação** | A Franqueadora está cotando com os fornecedores | Não, ainda |
| **Concluída** | Negociada — a parte da unidade foi para **Aprovar** (link na própria linha) | **Sim** |

> **"Enviada" não é "esperando a minha aprovação".** Se a lista está Enviada e
> não há nada em Aprovar, o sistema está certo: falta a Franqueadora juntar a
> lista numa rodada e fechá-la. Quem faz isso recebe o aviso no sino.

**Os avisos no sino** (categoria **Compras**, desde a versão 0.348.0):

- **Lista enviada** → avisa o **Comprador**, o **Financeiro da Franqueadora** e
  o **Admin Master**, com quem enviou, a unidade, a hora, quantos itens e a
  previsão. **Abrir** leva à Mesa de negociação. Compra local não avisa: ela
  não passa pela Franqueadora.
- **Rodada fechada** → avisa **quem aprova** em cada unidade que tem parte na
  rodada (o gerente; na compra da própria Franqueadora, o Financeiro da
  Franqueadora). Se a unidade não tem gerente, o aviso vai ao Admin Master.
  **Abrir** leva a Compras → Aprovar — confira se a unidade escolhida no menu é
  a do aviso.

**Quando há algo para aprovar, toda tela de Compras avisa:** uma faixa dourada
no alto (*"3 itens negociados pela Franqueadora esperam a aprovação desta
unidade"*) com o botão **Aprovar agora**.

> **Item sem decisão não vira pedido.** O sistema não aprova sozinho: o
> dinheiro é da unidade. Quem não decide vê, na coluna **Decisão**, quem
> decide (por exemplo, *"Decide: o gerente da unidade ou o Admin"*).

> **A Franqueadora também compra para si.** Quando a unidade da compra é a
> própria Franqueadora, quem aprova é o **Financeiro da Franqueadora** — ela
> não tem gerente (desde a versão 0.318.0; antes, só o Admin aprovava).

O **Painel de compras** mostra quanto a negociação conjunta economizou e quanto
foi comprado por fora. O passo a passo de cada tela também está no botão
**?** da barra de cima (ver *A barra de cima*).

### Fluxos com evidência parcial

⚠️ **Exclusão de registros:** o sistema **não apaga paciente** — a exclusão é
**anonimização** (`status = anonymized`), por exigência de guarda legal do
prontuário. Para procedimentos e itens de estoque, "excluir" significa
**inativar** quando já houve uso.

---

## 9. Erros, falhas e mau funcionamento

### 9.1. Como reconhecer

O sistema avisa por **mensagens que aparecem no canto superior direito**
(sucesso em verde, erro em vermelho) e por mensagens dentro do formulário.

**E existe um terceiro caso, mais raro e mais assustador:** a tela não abre e
aparece uma caixa vermelha dizendo *"Esta tela não conseguiu abrir"*. Ela
mostra em que tela você estava, a versão do sistema e um **código do erro** — e
traz três botões: *Tentar de novo*, *Registrar este problema* (que já abre o
formulário preenchido com esses dados) e *Voltar ao Início*.

> **Isso não é culpa de quem está olhando, e nada do que já estava salvo se
> perde.** Se acontecer duas vezes seguidas, registre — é o botão do meio.

### 9.2. Antes de chamar o suporte — 6 verificações

1. **É preenchimento?** Algum campo obrigatório em branco ou com formato errado?
2. **É permissão?** O botão não aparece, ou some ao clicar? Provavelmente a sua
   função não tem essa ação. Confira na [matriz](#5-matriz-de-permissões).
3. **É a unidade errada?** Veja no alto da barra lateral se a unidade ativa é a
   que você quer.
4. **É conexão?** Se a mensagem falar em servidor ou internet, teste abrir outro
   site.
5. **A tela está velha?** Recarregue com **Ctrl + Shift + R**.
6. **Já aconteceu antes?** Se for a primeira vez, tente de novo **uma vez**.

### 9.3. Quando NÃO repetir a ação

⚠️ **Não repita** se a ação envolve **dinheiro** (receber, pagar, fechar venda)
e você **não tem certeza** de que falhou. Repetir pode gerar lançamento em
dobro. Confira antes se o registro já existe.

O sistema tem travas contra duplicidade em vários pontos (mesma nota fiscal,
mesma emissão de boleto, mesma sessão consumindo kit duas vezes), mas **conferir
custa menos que corrigir**.

### 9.4. Como relatar um problema

**Barra de cima → a boia.** Abre um painel **ao lado** da tela em que você
está — ela continua à vista, e é ela que a captura de tela vai fotografar. O
painel já traz a tela e a parte do sistema preenchidas. Na própria tela de
Problemas, o botão é **"Relatar um problema"**.

> **Você não preenche o que o sistema já sabe.** Quem você é, sua função, a
> unidade, a tela, a versão e o navegador vão junto automaticamente. Até a
> versão anterior deste manual mandava copiar um formulário de doze linhas à
> mão — ninguém preenche isso com paciente esperando, e o relato chegava sem o
> que o torna encontrável.

**Você escreve três coisas, e só:**

1. **Um resumo em uma linha** — *"a agenda não deixa marcar no sábado"*.
2. **O que aconteceu** — o passo a passo: o que você fez e o que o sistema
   respondeu. **Se apareceu uma mensagem, copie o texto exato dela.**
3. **O que você esperava** — opcional, mas é o que separa **defeito** de
   **regra do sistema**. Muita coisa que parece erro é o sistema fazendo o que
   foi combinado.

Você ainda escolhe **o que é** (algo deu errado / dúvida / sugestão), **em que
parte do sistema** aconteceu e **quanto atrapalha** (atrapalha pouco /
atrapalha o trabalho / impede de trabalhar).

> **A parte do sistema já vem sugerida** quando você chega pelo botão
> *Registrar este problema* da tela de erro — o sistema sabe de que tela você
> veio. Confira mesmo assim: às vezes o problema é da tela anterior. Essa
> escolha é obrigatória porque é ela que permite contar, por exemplo, quantas
> sugestões a Agenda recebeu.

**Mostrar o problema — anexos e captura de tela.** No fim do formulário há
três jeitos de capturar, porque o problema nem sempre está na tela atrás do
painel:

| Botão / gesto | Quando usar | O que faz |
|---|---|---|
| **Capturar esta tela** | O problema está na tela atrás do painel | O painel sai da frente por um instante e a tela vira imagem, do jeito que estava |
| **Ir até a tela do problema** | O problema está em **outra tela do sistema** | O painel vira uma **barra no rodapé**. Navegue pelo menu até a tela do problema e clique em **Capturar** (pode tirar vários prints, de telas diferentes). Depois, **Voltar ao relato** |
| **Outra aba ou janela** | O problema está aberto em **outra aba** do navegador ou em **outro programa** | O navegador mostra a lista do que está aberto; escolha e clique em **Compartilhar** |
| **Anexar arquivo** | Você já tem o arquivo | Imagem, PDF ou vídeo (MP4/WebM), do computador ou do celular |
| **Ctrl+V** | Você já tirou o print | Cola em qualquer campo do formulário (tecla **Print Screen**, ou **Win+Shift+S** para recortar um pedaço) |
| **Capturar com tempo** | O print precisa mostrar uma **lista, menu ou calendário ABERTO** | Fotografa a **tela inteira** depois de uma contagem de **8 segundos** — é nesse tempo que você abre o que quer mostrar |
| **Arrastar** | — | Solta o arquivo em cima da área dos anexos |

> **No modo "Ir até a tela do problema" nada se perde.** O que você escreveu e
> os prints ficam guardados enquanto você navega. E, se você não tiver mudado
> à mão os campos *Em que tela* e *Parte do sistema*, eles passam a ser os da
> tela onde você capturou — é lá que o problema está.

> **Fechar o painel no X não apaga o relato**: ao abrir a boia de novo, ele
> está lá (o painel avisa *"Relato começado em …"*). Para desistir de vez, use
> **Cancelar**.

**Na primeira captura o navegador pede permissão** para ver a tela. É só
permitir: o sistema tira uma única foto e para de ver na mesma hora. O arquivo
recebe o nome da tela de onde veio (ex.: *captura-agenda-20260917-0930.png*).

**Precisa mostrar uma lista, um menu ou um calendário ABERTO?** Use
**Capturar com tempo**:

1. Clique em **Capturar com tempo**.
2. Na janela do navegador, escolha a aba **Tela inteira**, clique na imagem da
   sua tela e depois em **Compartilhar**.
3. Aparece uma **contagem grande no alto da tela**: *"Abra agora o que você quer
   mostrar"*. **É nesse tempo que você abre a lista** — são **8 segundos**.
4. A contagem some e a foto sai sozinha, com tudo aberto.

> **Por que tem de ser "Tela inteira", e por que os outros botões não servem.**
> Quando o navegador fotografa só a **aba**, ele copia o desenho da página — e a
> lista aberta **não é desenho da página**: é uma janelinha que o Windows põe
> por cima. Na foto da aba ela simplesmente não existe, por mais tempo que se
> espere. Fotografando a tela inteira, entra tudo o que está no monitor,
> inclusive ela. Se você escolher uma aba por engano, **o sistema avisa depois
> da foto** em vez de deixar você achar que não funcionou.

> ⚠️ **A tela inteira mostra tudo o que está no seu monitor** — outras janelas
> abertas, inclusive. Antes de capturar assim, feche ou minimize o que não tem a
> ver com o problema.

**Não sabe por onde começar?** Clique em **Como usar o print**, logo abaixo dos
botões — o passo a passo está ali.

**Relatando pela tela de Problemas** (menu → **Problemas** → *Relatar um
problema*), você tem **três** caminhos, não dois:

- **Ir até a tela do problema** — o mais direto. O que você já escreveu vai
  para a **barra no rodapé**, o formulário sai de cena, você navega até a tela
  com defeito, clica em **Capturar** (quantas telas quiser) e depois em
  **Voltar ao relato**. Nada do que você digitou se perde.
- **Capturar de outra aba ou janela** — quando o problema está em outra aba do
  navegador ou em outro programa.
- **Anexar arquivo** — quando você já tem o print salvo.

Não existe **Capturar esta tela** aqui, e é de propósito: "esta tela" seria a
própria página do relato.

Até **5 por envio**, **10 MB cada**, e no máximo **10 por relato**. Cada anexo
aparece como miniatura antes de enviar, com um **X** para tirar da lista. O que
não pode entrar é recusado **com o motivo** (tipo ou tamanho).

> **No celular não existem os botões de captura** — o navegador do telefone
> não oferece isso para páginas. Tire o print pelo próprio aparelho e use **Anexar
> arquivo**.

> ⚠️ **O print mostra o que estava na tela, inclusive dado de paciente.** Quem
> vê o relato vê os anexos (a sua unidade e o suporte). Se aparecer paciente que
> não tem a ver com o problema, tire da lista antes de enviar. Enviou por
> engano? **Remover** tira o anexo — veja a seção 15.2.

**Ao salvar, o relato ganha um código** (ex.: `OC-00012`). Pela boia, você
continua na tela em que estava e o aviso traz o botão **Abrir**; pela tela de
Problemas, o sistema abre a página do relato. É por esse código que se fala do
caso depois, sem recontar tudo — e a página tem endereço próprio
(`/problemas/OC-00012`), que pode ser enviado a quem precisa ver.

### 9.5. Categorias

| Categoria | Como reconhecer | Primeira ação |
|---|---|---|
| **Acesso** | Não consegue entrar | Confira e-mail/senha; peça redefinição ao admin |
| **Permissão** | Botão ausente, ou "Você não tem permissão para isto" | Confira a matriz; talvez seja unidade errada |
| **Validação** | Mensagem no próprio campo | Corrija o preenchimento |
| **Dados** | Número que não bate | **Não corrija na mão** — registre e avise |
| **Interface** | Tela em branco, botão que não responde | Ctrl+Shift+R |
| **Indisponibilidade** | "Não consegui falar com o servidor" | Teste a internet; aguarde e tente de novo |
| **Inesperado** | Mensagem com código | Registre o código |

### 9.6. Quando escalar

Escale **imediatamente** se: (a) o problema envolve dinheiro lançado errado;
(b) alguém viu dado de paciente que não deveria; (c) mais de uma pessoa está
travada; (d) o sistema inteiro não abre.

**O canal é o próprio sistema:** *Menu → Sistema → Problemas*. Marque a
gravidade como **"Impede de trabalhar"** nos casos acima — é assim que o seu
relato sobe na fila.

> **E se o sistema inteiro não abrir?** Aí não dá para relatar por dentro dele.
> Nesse caso avise a Franqueadora pelo caminho de sempre, com o horário e o que
> você estava fazendo.

---

## 10. Mensagens do sistema

Foram catalogadas **179 mensagens de tela**: 141 de sucesso, 30 de erro, 6 de
aviso e 2 informativas. A lista completa está no inventário JSON.

### 10.1. Como interpretar

| Cor/tipo | Significa | O que fazer |
|---|---|---|
| **Sucesso** (verde) | A ação foi concluída e gravada | Nada. Pode seguir |
| **Erro** (vermelho) | A ação **não** foi concluída | Corrija e repita — exceto o caso da [seção 9.3](#93-quando-não-repetir-a-ação) |
| **Aviso** (amarelo) | Concluiu, mas há algo a conferir | Leia antes de seguir |

### 10.2. Mensagens de sucesso frequentes

`Configuração salva.` · `Prazos salvos.` · `Usuário criado com sucesso.` ·
`Senha redefinida.` · `Regra comercial salva.` · `Opção adicionada.` ·
`Datas sugeridas para toda a série.` · `Atendimento concluído.`

**Padrão útil:** *"Ajuste removido — vale o padrão da rede"* aparece quando você
apaga uma exceção da unidade. Não é erro: significa que aquela unidade voltou a
seguir a regra geral.

### 10.3. Erros de preenchimento (você resolve)

| Mensagem | Significa | O que fazer |
|---|---|---|
| `Arquivo vazio.` | O arquivo não tem conteúdo | Escolha outro |
| `Arquivo muito grande (máximo 25 MB).` | Passou do limite | Reduza o arquivo |
| `Nenhuma linha válida (confira Nome e CPF).` | A planilha não tem dados aproveitáveis | Confira as colunas |
| `Não foi possível ler a planilha.` | Formato não reconhecido | Use o modelo (botão "Baixar modelo") |
| `Cadastre uma clínica antes de atribuir funções.` | Falta pré-requisito | Crie a clínica primeiro |
| `Este usuário já tem função em todas as clínicas.` | Nada a adicionar | Nenhuma ação |

### 10.4. Erros do financeiro traduzidos

O sistema traduz os erros do banco de dados para linguagem clara
(`src/lib/finance/errors.ts`):

| Código | Mensagem ao usuário |
|---|---|
| `PERIOD_CLOSED` | *Este mês já foi fechado — o resultado dele não muda mais. Para lançar aqui, peça à Franqueadora para reabrir o período.* |
| `PERIOD_NOT_ENDED` | *O mês ainda não terminou. Só dá para fechar depois do último dia.* |
| `EARLIER_PERIOD_OPEN` | *Existe mês anterior ainda aberto com movimento. Feche os meses em ordem.* |
| `REASON_REQUIRED` | *Escreva o motivo da reabertura.* |
| `NOT_ALLOWED` | *Você não tem permissão para isto.* |
| `ACCOUNT_NOT_ANALYTIC` | *Esta conta é um grupo e não recebe lançamento.* |
| `ACCOUNT_NOT_FOUND` | *Conta não encontrada no plano de contas.* |
| `UNIT_LOCKED` | *O item já tem movimento: a unidade de medida não pode mais mudar.* |

> **Se aparecer um código sem tradução**, o sistema mostra o código. Anote-o no
> chamado — é o que identifica a causa.

### 10.5. Erros de equipamento

`Seu navegador não permite gravar áudio aqui.` e `Não foi possível acessar o
microfone.` — o navegador precisa de permissão para o microfone, e a página
precisa estar em endereço seguro (https).

### 10.6. "Não foi possível conferir … Nada foi alterado"

Esta mensagem aparece quando o sistema **precisava conferir alguma coisa antes
de agir e não conseguiu** — por exemplo, *"Não foi possível conferir quantos
titulares a empresa já tem ativos agora. Nada foi alterado — tente de novo em
instantes."*

**O que ela quer dizer:** o sistema preferiu **não fazer** a ter de adivinhar.
Nada foi gravado, cobrado ou apagado; você não precisa desfazer nada. Quase
sempre é uma falha momentânea de conexão — tente de novo em alguns segundos.
Se continuar, relate o problema.

**Por que o sistema é assim:** antes, quando essa conferência falhava, ele
seguia em frente **como se a resposta fosse zero**. Nas travas, isso é
perigoso: "já existe cobrança deste mês?" virava "não" e a empresa podia ser
cobrada duas vezes; "quantos titulares já estão ativos?" virava "zero" e o
limite contratado deixava de valer. Hoje, quando não consegue conferir, ele
para e avisa.

Aparece em: cobrança mensal do Empresarial (ali a empresa fica na lista das
**puladas**, com o motivo), cadastro de titular e de dependente do Empresarial,
documentos da empresa, dependentes do PPR+, salas e cadeiras da agenda,
exclusão de procedimento, cadastro de cliente e cadastro de Risartano.

> **PPR+: um caso diferente.** Ao incluir ou retirar um dependente, se a
> mensalidade não puder ser recalculada naquele momento, o dependente **entra
> (ou sai) normalmente** e aparece um aviso dizendo que a mensalidade **ficou
> com o valor anterior**. Abrir a adesão de novo não corrige: **relate o
> problema com o código da adesão**, para o valor ser acertado. (Antes, nesse
> mesmo caso, o sistema gravava a mensalidade como se não houvesse dependente
> nenhum — e a adesão passava a cobrar menos, sem ninguém saber.)

> **Nas telas de números: "Não foi possível ler … agora"** (desde a versão
> 0.321.0). Em **Relatórios**, **Centro de Planejamento** e **Planos de
> Tratamento**, se a leitura de uma parte dos dados falhar, a tela mostra um
> aviso vermelho no alto — *"Não foi possível ler todos os dados agora — os
> números abaixo podem estar incompletos"* — em vez de mostrar uma conta pela
> metade como se fosse a inteira. Recarregue a página; se continuar, relate o
> problema. Essas telas também
> passaram a somar **todos** os registros: antes, acima de 1.000, a conta
> parava em 1.000 sem aviso.

---

## 11. Segurança e boas práticas

### 11.1. Regras do sistema (impostas, não sugeridas)

- **Não existe auto-cadastro.** Todo acesso nasce de um administrador.
- **Acesso desativado é barrado na hora.** Quem for desativado vê um aviso ao
  abrir qualquer tela e é convidado a sair — o que ele já registrou continua no
  sistema; o que muda é a entrada.
- **Consentimento antes da coleta.** Gravação e coleta de dados clínicos só
  começam depois do consentimento registrado, com data e hora.
- **Paciente não se apaga.** A exclusão é anonimização — guarda legal do
  prontuário.
- **Todo acesso a prontuário é registrado** em auditoria.
- **Toda alteração é registrada pelo próprio sistema**, com o conteúdo de
  antes e de depois e o nome de quem fez — em todos os cadastros. Não depende
  de ninguém lembrar, e o registro **não pode ser editado nem apagado**, nem
  pelo Admin. Só o Admin Master consulta (seção 13c).
- **Mídia clínica abre só por link assinado**, que expira. Nunca é pública.
- **Cada pessoa vê apenas a sua unidade** — imposto pelo banco.
- **O gerente de uma unidade nunca vê o financeiro de outra.**

### 11.2. Recomendações (boa prática, não regra do sistema)

> Estas são recomendações gerais, não políticas oficiais da empresa.

- Não compartilhe a sua senha. Se alguém precisa entrar, peça um acesso próprio
  — a auditoria registra **quem** fez cada coisa.
- Saia do sistema em computador compartilhado.
- Confira antes de salvar em telas de dinheiro: **nada se apaga**.
- Não fotografe telas com dado de paciente.
- O aviso que cobra um agendamento só sai quando o agendamento existe. Se
  precisar da tela, use **Fechar** — ele volta em 15 minutos (seção 6.1).

---

## 12. Glossário

| Termo | O que é | Exemplo no sistema |
|---|---|---|
| **Jornada** | O caminho de 7 fases do paciente | Tela "Jornada" mostra o quadro por fase; cada cartão diz o próximo agendamento ou "Sem agendamento" (em amarelo), e o clique abre a agenda |
| **Fase** | Onde o paciente está agora | "Centro de Planejamento" |
| **Sub-status** | Detalhe dentro da fase | "Aguardando Aprovação" |
| **SLA** | Prazo daquela fase | Estourou → selo vermelho |
| **Pilar** | Classificação do plano (1 de 6) | Saúde, Estética, Prevenção… |
| **Unidade ativa** | A clínica em que você está trabalhando | Alto da barra lateral |
| **Prontuário** | A ficha do paciente | `/prontuarios/[id]` |
| **Kit** | Conjunto de materiais de um procedimento | Baixa sozinho ao concluir a sessão |
| **Competência** | O mês a que o valor pertence | Diferente da data do pagamento |
| **Caixa** | Quando o dinheiro entrou ou saiu | Base do fluxo de caixa |
| **Alçada** | Até quanto alguém pode autorizar | Contas a pagar |
| **Adquirente** | A empresa da maquininha | Cobra taxa e paga em D+n |
| **Repasse** | O que o dentista recebe por procedimento | Valor fixo por nível |
| **Split** | A parte da franqueadora em cada recebimento | Royalty, fundo, etc. |
| **RLS** | Regra do banco que decide quem vê cada linha | É a proteção de verdade |
| **Migração** | Uma alteração na estrutura do banco | "migração 0245" no rodapé |

---

## 13. Perguntas frequentes

**Como acesso o sistema?**
Com o e-mail e a senha que o administrador cadastrou. Não existe "criar conta".

**Esqueci minha senha.**
❔ **Não existe tela de "esqueci minha senha"** no sistema. Peça ao
administrador, que redefine em Admin → Usuários.

**Um botão não aparece para mim. É defeito?**
Provavelmente não. É permissão, ou você está na unidade errada. Confira a
unidade ativa no alto da barra lateral e a [matriz](#5-matriz-de-permissões).

**Vejo um item de menu mas a tela vem vazia.**
Normal. O menu mostra o item, mas os **dados** seguem a sua permissão. Ver
[4.2](#42-as-duas-camadas-de-proteção--e-por-que-isso-importa-para-você).

**Como sei se minha ação foi concluída?**
Pela mensagem verde no canto e pelo dado aparecendo na tela. Em dúvida,
recarregue e confira — **não repita ação de dinheiro** sem conferir.

**Errei um preenchimento. Como corrijo?**
Depende. Cadastro: use **Editar**. Financeiro: **não se apaga** — gera-se um
lançamento de correção. Peça ajuda ao Gerente.

**Como troco de unidade?**
Pelo seletor no alto da barra lateral, se você tiver acesso a mais de uma.

**Quando aciono o suporte?**
Depois das 6 verificações da [seção 9.2](#92-antes-de-chamar-o-suporte--6-verificações),
e **imediatamente** se envolver dinheiro errado ou dado de paciente exposto.

**Como evito duplicidade?**
Sempre comece o cadastro **pelo CPF** — o sistema avisa se o paciente já existe.

**O que é aquele número no rodapé?**
A versão do sistema. Informe-a ao pedir suporte — e, se quiser saber o que
mudou nela, está em *Sistema → Novidades*.

**Onde vejo o que mudou no sistema?**
*Menu → Sistema → Novidades*. Aparece o que muda **para a sua função** — o que
é de outra função não enche a sua lista.

**Este manual está atualizado?**
O que está em *Menu → Manual* está, sempre: ele muda junto com o sistema. Um
arquivo Word que você recebeu há meses, não necessariamente — confira a versão
na capa dele contra a que aparece no rodapé do menu.

---

## 13b. Para o Admin Master: alterar permissões

**Onde:** Administração → **Permissões** (`/admin/permissoes`). Só você entra.

**Três jeitos de olhar, no alto da tela:**

| Visão | Para quê |
|---|---|
| **Por função** | Escolha uma função à esquerda (o número ao lado diz quantas permissões ela tem) e veja todas as permissões com uma **chave** de liga/desliga |
| **Por permissão** | Escolha uma permissão e veja, em duas colunas, **quem tem** e **quem não tem** |
| **Grade completa** | Tudo de uma vez: uma linha por permissão, uma coluna por função |

**Para achar rápido:** a caixa **Procurar permissão** (não precisa de acento),
o filtro de **grupo** e a opção **Só as diferentes do padrão**.

**Como salvar:** marcar **não grava**. Tudo o que você mudou — em qualquer das
três visões — fica numa **barra no rodapé** ("3 alterações em 2 permissões"),
com a lista do que muda ("Recepcionista passa a ter Financeiro"). Clique em
**Salvar** para gravar tudo, ou em **Descartar** para desfazer. Vale para toda
a rede, e passa a valer na próxima tela que a pessoa abrir (peça para ela
recarregar).

**"Diferente do padrão" não é erro.** É o aviso de que a permissão está
diferente do padrão. O padrão é o **original do sistema** até você fixar
outro. Se a diferença é de propósito:

- **Tornar padrão** (na permissão) — o que está valendo vira o padrão. O aviso
  some, e o **Voltar ao padrão** passa a voltar para essa escolha. **Ninguém
  ganha nem perde acesso** ao tornar padrão.
- **Tornar tudo padrão** (no alto) — faz isso de uma vez para todas as
  diferentes, depois de mostrar a lista e pedir confirmação.
- Só dá para tornar padrão o que já está **salvo**: com alteração na barra,
  salve ou descarte antes.
- Na visão **Por permissão**, o rodapé mostra o padrão, quando foi fixado e,
  se for diferente, o **original do sistema** — com **Usar o original como
  padrão** para voltar atrás.

**Três coisas para saber antes de mexer:**

1. **Você não aparece na matriz.** O Admin Master passa por cima de todas as
   permissões, sempre — senão daria para trancar a porta com a chave dentro.
2. **Desligar sempre funciona.** É seguro e imediato.
3. **Ligar** uma permissão com o selo **"o banco também decide"** (Financeiro,
   Estoque, Compras) abre a tela para a pessoa, **mas os dados podem vir
   vazios** — a regra do banco continua a mesma até ser ajustada. E se a
   **ação** for de gravar (lançar, cadastrar, montar lista, configurar) e o
   banco não aceitar aquela função, a tela abre **só para consulta**, com o
   aviso de quem faz. Para lançar pela Franqueadora, a função certa é
   **Financeiro da Franqueadora**; mudar a regra do banco é ajuste de código —
   peça.

**Se errar:** **Voltar ao padrão** (o **↺** na grade) põe o padrão de volta na
barra de alterações — e só vale depois de **Salvar**.

**Fica registrado:** toda alteração vai para a Auditoria, com quem mudou, quando
e quais funções passaram a ter a permissão.

> ⚠️ **No treino, as permissões são cópia do sistema de verdade.** Mude aqui,
> no sistema de verdade: a mudança (e o padrão que você fixar) chega ao treino
> sozinha. No treino a tela é só consulta, e o banco de lá recusa gravar.

---

## 13c. Para o Admin Master: a Auditoria

**Onde:** **Administração → Auditoria**. Só o Admin Master entra — e é o
banco que garante isso, não a tela.

**Para que serve:** responder "quem fez o quê, quando, e o que havia antes".
São sete abas, e a Auditoria abre na primeira (**Painel de uso**). Trocar de
aba mantém a pessoa escolhida.

### Aba Painel de uso — o retrato do uso do sistema

É a que abre. Responde, sem você precisar procurar: **quem está usando o
sistema, quem parou, e o que merece a sua atenção**.

**Filtros (no alto):** os últimos **7, 30 ou 90 dias**; a **unidade**; a
**função**.

> **O que "unidade" quer dizer aqui:** entram as pessoas que **têm função**
> naquela unidade. Quem tem função em duas unidades aparece nas duas, com os
> mesmos números — a pessoa entra no sistema, não numa unidade.

**De cima para baixo:**

1. **Os números.** Quantas pessoas **entraram** (de quantas têm acesso),
   quantas **não entraram** (e quantas **nunca** entraram na vida), a **média
   de dias com acesso**, o **tempo em uso** e a **atividade** (ações nas telas
   mais alterações). Embaixo de cada um, a seta ▲ ou ▼ compara com o período
   anterior do mesmo tamanho. **Sem período anterior, não aparece seta** — o
   painel não inventa uma alta.
2. **O que merece atenção.** O painel lê os números e aponta o que foge do
   esperado. Clique no item para ver **quem** e **quanto**. Cada um tem um selo:
   - **Olhar hoje** — acesso criado há 3 dias ou mais e **nunca usado**
     (acesso sem dono é porta aberta).
   - **Acompanhar** — quem **não entra há 15 dias ou mais**; quem **caiu pela
     metade** no uso, comparado com ele mesmo; quem foi **desconectado por
     inatividade 3 vezes ou mais** (deixa a tela aberta e sai); quem **excluiu**
     ou **exportou** 5 vezes ou mais.
   - **Para saber** — quem fica **conectado por horas quase sem usar**; quem
     **entra e não registra nada**.

   Sem nada fora do esperado, a lista diz isso e fica vazia.
3. **Pessoas que entraram, por dia.** Uma barra por dia. Pare o mouse na barra
   para ver o dia, as pessoas, os acessos e as ações.
4. **Os seis rankings**, cada um com os cinco primeiros:
   - **Quem mais acessou** — em quantos dias do período entrou.
   - **Quem ficou mais tempo conectado** — com o tempo em uso ao lado.
   - **Quem mais teve atividade** — ações nas telas mais inclusões, alterações
     e exclusões.
   - **Quem menos interagiu** — entre quem entrou: quem fez menos coisas.
   - **Quem menos acessou** — entre quem entrou ao menos uma vez.
   - **Há mais tempo sem entrar** — quem **nunca entrou** vem primeiro.

   Clique no **nome** para abrir o dia a dia da pessoa.
5. **Uso por função** e **uso por unidade.** Quantos entraram, a média de dias,
   de tempo em uso e de ações. Clique na função ou na unidade para filtrar o
   painel por ela.
6. **Quando o sistema é usado.** Dia da semana × hora: quanto mais escura a
   casa, mais movimento. A frase em cima diz o **pico** e quanto acontece
   **fora de segunda a sexta, das 7h às 19h**.

> ⚠️ **Ranking não é veredito.** Tempo em uso não é produtividade: quem atende
> na cadeira toca pouco na tela. Por isso existe o **uso por função** — compare
> a pessoa com a média de quem faz o mesmo trabalho, e com ela mesma no período
> anterior.

> ⚠️ **Quem entra em cada lista:** os rankings de "menos" e o "há mais tempo sem
> entrar" contam só quem tem **acesso ativo** (quem foi desligado não aparece).
> Os de "mais" contam todo mundo que usou o sistema no período.

> ⚠️ **O registro de acessos começou em 09/10/2026.** Antes disso só existe a
> data do último login de cada pessoa — é ela que o painel usa para dizer "há
> quantos dias não entra" de quem ainda não voltou desde então.

### Aba Online agora — quem está no sistema neste instante

O Painel de uso responde "como o sistema vem sendo usado". Esta aba responde
"e **agora**?". São quatro listas:

| Lista | Quem aparece |
|---|---|
| **Online** | Está com o sistema aberto e mexeu nele nos **últimos 5 minutos** |
| **Ausente** | Está com o sistema aberto, mas sem clicar nem digitar há mais de 5 minutos |
| **Saiu** | Entrou hoje e não está conectado agora — clicou em Sair, ou caiu por inatividade |
| **Não entrou hoje** | Tem acesso ativo e ainda não entrou hoje |

Para quem está online ou ausente, a linha mostra a **função e a unidade**, **em
qual tela** a pessoa está, **a hora em que entrou** e **há quanto tempo foi a
última atividade**. Para quem saiu, a hora em que entrou e até quando esteve.

A página **se atualiza sozinha a cada minuto**, e diz no alto a hora da última
leitura. O botão **Atualizar agora** lê na hora.

**O mesmo aparece em dois outros lugares:**

- **Na barra de cima**, o desenho de **antena com um número verde** — quantas
  pessoas estão online. Um clique abre a lista de quem está conectado (online
  e ausentes), em qualquer tela.
- **No alto do Painel de uso**, o quadro **Agora**, com os quatro números e o
  atalho **Ver quem**.

> **"Em qual tela" é o módulo, não o endereço.** O sistema registra *Agenda*,
> *Prontuários*, *Financeiro*, *Administração › Auditoria* — nunca qual
> paciente a pessoa está vendo. Isso continua na aba **Ações**, com as regras
> dela.

> **"Não informada"** na coluna da tela quer dizer que aquele acesso começou
> antes de o sistema passar a registrar a tela. Some sozinho na próxima vez
> que a pessoa trocar de tela.

> **A última atividade pode estar até um minuto atrás do que aconteceu.** A
> tela avisa o banco no máximo uma vez por minuto.

> **A bolinha do Chat pode discordar por instantes.** O Chat usa os mesmos 5
> minutos, mas conta também o movimento do mouse; esta lista conta clique,
> tecla, toque e rolagem — o mesmo sinal que decide a desconexão por
> inatividade.

> **Quem está "ausente" há muito tempo vai cair sozinho.** Passado o tempo de
> inatividade da função (60 minutos, se ninguém mudou), o acesso é encerrado e
> a pessoa passa para **Saiu**. Ver *Sessão e inatividade*.

> **Só o Admin Master vê.** O resto da equipe continua vendo apenas a bolinha
> ao lado de cada contato, dentro do Chat.

### Aba Alterações — o que mudou, campo a campo

Cada linha é **uma** inclusão, alteração ou exclusão: a data e a hora, quem
fez, o tipo de cadastro e **qual registro** (o código e o nome; quando o
registro não tem nome próprio — um agendamento, uma parcela —, aparece **de
qual cliente** ele é). Numa alteração, a linha já adianta **quais campos**
mudaram.

1. **Clique na linha** para abrir. Aparece a tabela **Campo · Antes ·
   Depois**. Numa inclusão há só o valor gravado; numa exclusão, **o que
   existia**.
2. Use os filtros no alto: **pessoa**, **cadastrou / alterou / excluiu**,
   **em qual cadastro**, **período** e a caixa **código ou nome do registro**
   (digite e aperte Enter).
3. Dentro da linha aberta: **Abrir o prontuário do cliente** e **Ver tudo o
   que mudou neste cliente** (a história inteira daquele cliente, de todos os
   cadastros ligados a ele).
4. A lista traz 200 por vez; no fim há **Ver as 200 anteriores**.

**Quem é "Sistema"?** Nem toda gravação é feita por uma pessoa logada:

- **Sistema (rotina automática)** — tarefas agendadas e regras do próprio
  banco (a cobrança que vence, o aviso que sai sozinho).
- **Sistema (em nome de alguém)** — o servidor gravando depois de conferir a
  permissão da pessoa. A ação **dela** aparece no mesmo horário, na aba Ações.

**O que você vê em português e o que não:** nomes dos cadastros, dos campos
mais comuns, sim/não, dinheiro, datas, funções, fases e situações saem em
português. **Campo pouco usado pode aparecer com um nome meio torto** (ele é
traduzido palavra a palavra) — pare o mouse em cima para ver o nome técnico.
Valor que o sistema não sabe traduzir aparece **como foi gravado**; nunca é
inventado.

**O que fica de fora, e por quê:** no fim da aba há a lista **"O que NÃO
entra nesta lista"**, com o motivo de cada item — o que já é histórico, o que
é calculado a partir de outro cadastro (o saldo do estoque, por exemplo: o
que conta é o movimento, e ele é registrado), o chat da equipe e os registros
técnicos. **Senha e token nunca são gravados:** aparecem como "oculto".

> ⚠️ **A auditoria guarda o conteúdo completo, inclusive dado pessoal e de
> saúde** (decisão da direção, 09/10/2026). Por isso ela é só do Admin Master
> e não deve ser fotografada nem copiada para fora do sistema. **Quando um
> cliente é anonimizado, o que foi registrado antes continua aqui.**

> ⚠️ **Começa em 09/10/2026.** O que foi alterado antes dessa data não tem o
> "antes e depois" — só o registro da ação, na aba Ações.

**Se aparecer o aviso "N cadastro(s) ainda não estão sendo registrados":** foi
criado um cadastro novo no sistema e ele ainda não entrou na auditoria. Avise
o suporte (botão de relato) — é um ajuste rápido.

### Aba Ações — o que cada pessoa fez nas telas

Consultou uma ficha, exportou um relatório, entrou, saiu. Filtros: pessoa,
ação, tipo de registro e período. Quando o registro é um cliente, o nome do
tipo é um atalho para o prontuário.

### Aba Acessos — um registro por login

O dia, a hora em que entrou, como saiu (saiu, inatividade, virada do dia), o
**tempo em uso**, o **tempo parado**, o navegador e o endereço de internet.
Embaixo, o último login de cada pessoa.

**Até quando o acesso conta:** até a **última atividade** da pessoa — ou até o
clique em **Sair**. Quando é o sistema que encerra (inatividade, virada do
dia), ele só percebe no próximo clique, que pode ser no dia seguinte; esse
intervalo **não** entra como tempo parado. "Parado" são as pausas **dentro** do
acesso.

### Aba O dia de uma pessoa

1. Escolha a **pessoa** e o **dia** (ou use **← dia anterior** / **dia
   seguinte →**).
2. No alto, o resumo: quando **entrou**, a **última atividade**, o tempo **em
   uso** e **parado**, quantas **ações nas telas** e quantas **alterações**
   (quantas inclusões, alterações e exclusões, e em quantos registros).
3. Embaixo, **o dia em ordem**, do primeiro ao último ato. As linhas com a
   seta são alterações: clique para ver o antes e o depois.

O botão **Auditoria** na ficha de acesso de um Risartano abre direto nesta
aba, com a pessoa escolhida.

### Aba Relatório de atividade — os números, com planilha

Responde "quem usou o sistema, quanto e para quê" num período.

1. Escolha **De** e **até** (sem escolher, vêm os últimos 7 dias; o máximo é
   92 dias — pedindo mais, o relatório fica com os 92 mais recentes **e
   avisa**), a **pessoa** (ou todas), a **unidade**, a **função** e a leitura:
   - **Resumo por pessoa** — uma linha por pessoa, somando o período:
     **dias com acesso** (em quantos dias ela entrou, de quantos do período),
     **acessos**, tempo **em uso** e **parado**, quantas vezes **caiu por
     inatividade**, **ações** nas telas, e quanto **cadastrou, alterou e
     excluiu**. Quem mais usou vem primeiro. Clique no **nome** para ver o dia
     a dia daquela pessoa.
   - **Dia a dia** — uma linha por pessoa e por dia, com a hora em que
     **entrou** e a **última atividade**. Clique na **data** para abrir "O dia
     de uma pessoa" e ver o que ela fez, em ordem.
2. No fim, **Com acesso ativo e sem nenhum acesso no período**: quem pode
   entrar e não entrou nem uma vez (só aparece no relatório de todos).
3. **Baixar planilha (Excel)** leva o que está na tela — mesmo período, mesma
   pessoa, mesma leitura — para uma planilha formatada, com linha de total.

**Como ler os números:**

- **Em uso** é o tempo clicando ou digitando. **Parado** são as pausas dentro
  do acesso. Os dois somados dão quanto tempo a pessoa ficou conectada.
- **O acesso conta até a última atividade** (ou até o clique em Sair) — nunca
  até "agora", e nunca até a hora em que o sistema o encerrou sozinho. A aba
  esquecida aberta não vira horas de trabalho.
- **Unidade** filtra por quem **tem função** nela; **função** filtra por quem a
  exerce em qualquer unidade. Os dois juntos: quem tem aquela função naquela
  unidade.
- **Ações** são o que as telas registram: consultar uma ficha, exportar,
  cadastrar. Entrar e sair não contam. Passe o mouse no número para ver
  quantas foram consultas e quantas exportações.
- **Cadastrou / alterou / excluiu** são as gravações, registradas pelo banco
  **desde 09/10/2026**. Antes disso essas colunas ficam vazias.
- Na planilha o tempo vem em **minutos** (para somar e ordenar), arredondado
  linha a linha — a soma pode diferir em 1 ou 2 minutos da tela.

> ⚠️ **Tempo em uso não é produtividade.** O dentista que atende o dia inteiro
> toca pouco na tela; a recepção toca o tempo todo. Compare a pessoa com ela
> mesma em outros dias, não uma função com outra.

> ⚠️ **Baixar a planilha fica registrado** na aba Ações ("Exportou · Relatório
> de atividade"), com o período. A planilha traz só nomes e números — nenhum
> dado de paciente.

## 14. Checklists

### 14.1. Primeiro acesso

☐ Consegui entrar
☐ Sei qual é a minha unidade ativa
☐ Sei qual é a minha função (aparece abaixo do nome da unidade)
☐ Reconheço os itens do meu menu
☐ Sei onde fica a versão do sistema
☐ Sei onde fica o botão Sair
☐ Troquei a senha provisória, se recebi uma

### 14.2. Execução de tarefa

☐ Estou na unidade certa
☐ Conferi os dados antes de salvar
☐ Vi a mensagem de confirmação
☐ O registro aparece na lista
☐ Se era ação de dinheiro, conferi que não dupliquei

### 14.3. Diagnóstico de erro

☐ Anotei data, hora e tela
☐ Copiei a mensagem exata
☐ Tirei print
☐ Verifiquei se é preenchimento
☐ Verifiquei se é permissão
☐ Verifiquei a unidade ativa
☐ Recarreguei com Ctrl+Shift+R
☐ Anotei se acontece sempre
☐ Anotei a versão do sistema

### 14.4. Encerramento do treinamento

☐ Executei ao menos uma tarefa completa da minha função
☐ Sei o que **não** posso fazer
☐ Sei reconhecer erro de permissão × erro de preenchimento
☐ Sei registrar um problema com as informações certas
☐ Sei que ação de dinheiro não se apaga
☐ Sei a quem pedir ajuda

---

## 15. Novidades, problemas e alertas

*Duas telas separadas, cada uma no seu desenho da barra de cima: o **triângulo**
abre os Alertas, a **boia** abre os Problemas.*

> **Elas eram uma só, com abas, até 08/09/2026.** Os dois desenhos abriam a
> mesma tela e mudavam apenas a aba selecionada — quem clicava em Alertas
> encontrava "Relatar um problema" do lado. Agora cada desenho leva ao seu
> assunto e nada mais.
>
> Se você tiver um atalho antigo para `/sistema`, ele continua funcionando: o
> sistema o encaminha para a tela certa.

### 15.1. Novidades — agora na tela de Início

> **Elas saíram desta tela.** Desde 08/09/2026 as novidades aparecem na
> **Início**, que é a primeira que você vê ao entrar. Novidade escondida atrás
> de dois cliques não é lida por ninguém.

O que mudou no sistema, versão por versão, da mais recente para a mais antiga.
Cada mudança vem marcada como **Novidade**, **Melhoria**, **Correção** ou
**Atenção**, e traz a seção deste manual que mudou junto.

**Onde procurar (desde 19/09/2026).** O Início mostra só as **três últimas**
entregas — antes mostrava todas, e a tela virava uma lista enorme. A lista
completa fica na tela **Novidades**, pelo botão **Ver todas as novidades** ou
pelo ícone ✨ da barra de cima. Lá você tem:

- **busca por palavra** (ignora acento e maiúscula: "correcao" acha "correção"),
  que mostra só as linhas que casam, não a entrega inteira;
- **filtro por tipo** (Novidade, Melhoria, Correção, Atenção);
- **filtro por ano**;
- **páginas** de 10 entregas, com "Mais recentes" e "Mais antigas".

Os filtros aplicam-se sozinhos e ficam no endereço: dá para mandar o link de
uma busca para outra pessoa.

**Aparece o que alcança a SUA função.** A correção de um botão do financeiro
não entra na lista de quem trabalha na recepção — lista cheia de coisa que não
é sua é lista que ninguém lê. O Admin Master vê tudo.

O registro começa em **25/08/2026**, quando o sistema entrou em preparação de
lançamento.

### 15.2. Problemas

*Tela `/problemas` — a **boia** na barra de cima.*

Onde se relata e se acompanha. Como relatar está na
[seção 9.4](#94-como-relatar-um-problema).

**O ícone avisa quando há algo esperando.** Se você relatou e foi respondido, a
boia mostra um número até você abrir aquele relato. Se você é Admin Master, ela
mostra quantos relatos ainda dependem de você.

**Quem ainda está só no Início também relata.** Mesmo sem o sistema real
liberado, a boia aparece na barra de cima e a tela de Problemas abre: a pessoa
relata, acompanha a resposta e vê as próprias solicitações. A unidade do relato
é a **da ficha dela** (o cadastro de Risartano), escolhida pelo sistema — não
precisa escolher nada. (Até a versão 0.328.0 a boia pedia "escolha uma unidade
no menu lateral", que no Início não existe, e o relato não entrava — relato
OC-00111.)

**Relatar é igual nos dois ambientes (desde 20/09/2026).** Se você está no
**riSZon Treino** e algo dá errado, relate por lá mesmo, pela boia de sempre —
com a captura de tela funcionando normalmente. O relato **aparece na lista do
sistema real**, com o selo **Treino**, e você acompanha tudo num lugar só:

- **Para você:** na tela Problemas do sistema real estão as suas solicitações
  dos dois ambientes, cada uma com o selo de onde nasceu. Clique e ela abre.
- **Para o Admin Master:** a lista e o número da boia contam os dois ambientes.
  O relato do treino abre na mesma tela, com a conversa e os anexos, e a
  resposta é gravada no treino — que é onde quem relatou vai lê-la.
- **Complementar ou reabrir** um relato do treino se faz no treino: a tela do
  sistema real mostra o link para abri-lo lá.

**Responder vários de uma vez (v0.271.0).** Quando o mesmo assunto chega em
vários relatos — a mesma tela, o mesmo tema, ou várias pessoas relatando a
mesma coisa —, marque a **caixinha** de cada um (ela aparece só para o Admin
Master) e use a barra que surge embaixo:

- **Responder juntos** — a mesma mensagem, situação e versão vão para todos os
  escolhidos. Cada pessoa continua lendo a resposta **no relato dela**; os
  relatos não são fundidos, e reabrir um não mexe nos outros.
- **Pedir a correção do conjunto** — gera um texto único com todos os relatos
  escolhidos (cada um completo, com o contexto de quem abriu) para você levar a
  quem vai corrigir.

A seleção **atravessa abas e filtros**: o mesmo problema costuma chegar como
"erro" de um e "dúvida" de outro. E dá para misturar relatos do sistema e do
**treino** — cada resposta é gravada no banco de onde o relato nasceu.

> **O que não puder ser respondido volta dito, relato por relato** (por exemplo,
> um que já estava encerrado sem nada a mudar). Um lote que responde só "pronto"
> esconde justamente o caso que precisava de você.

**O painel de indicadores conta os dois.** Em Problemas → **Painel de
indicadores**, os números somam o sistema e o treino, com botões para ver **só
o sistema** ou **só o treino**. As regras não mudaram: o período conta pela
data em que o relato foi registrado, "aproveitado" é o que foi resolvido, e os
relatos do próprio Admin Master ficam fora dos rankings.

> **Por que a lista junta fica no sistema real.** O sistema real alcança o
> treino, mas o treino não alcança o real — e é bom que seja assim, porque o
> treino é um ambiente aberto para aprender. Por isso o lugar de ver tudo junto
> é o sistema real.

**Quem vê o quê:** você enxerga os problemas relatados **na sua unidade**.
Assim ninguém abre cinco vezes o mesmo, e quem chegar depois já lê a resposta
que foi dada ao primeiro.

#### A lista

Cinco abas, cada uma com a quantidade ao lado:

| Aba | O que mostra | Ordem |
|---|---|---|
| **Fila** | Abertos e em análise | Quem espera há mais tempo primeiro |
| **Os meus** | Os que **você** relatou | Mais recente primeiro |
| **Respondidos** | Os que já receberam resposta — **é aqui que se acham as respostas** | Resposta mais recente primeiro |
| **Encerrados** | Resolvidos e "não é defeito" | Mais recente primeiro |
| **Todos** | Tudo | Mais recente primeiro |

A tela abre em **Os meus** para quem já relatou alguma coisa, e na **Fila** para
o Admin Master.

**Busca:** pelo código (`OC-00012`, `oc-12` ou só `12`), pelo resumo, pelo
texto ou pelo nome de quem relatou. Acentos e maiúsculas não importam.
**Filtros:** tipo, parte do sistema e unidade. Os números das abas passam a
contar só o que o filtro deixou.

**Etiquetas na linha:**

| Etiqueta | Quer dizer |
|---|---|
| **Resposta nova** (dourada) | Há resposta que você ainda não leu. Some quando você abre o relato |
| **Reaberto** | Quem relatou disse que a solução não funcionou |
| **Sem resposta** / **Aguarda você** | Só o Admin Master vê: ninguém respondeu ainda, ou a última palavra é de quem relatou |

**Há quanto tempo está parado.** Todo relato em aberto mostra *"aberto há 4
dias"*. A cor muda com a idade:

| Idade | Cor |
|---|---|
| Até 2 dias | Normal |
| De 3 a 7 dias | Amarelo |
| Mais de 7 dias | Vermelho |

> A cor segue o tempo **total** desde o registro. Passar para *Em análise* não
> zera a conta — senão bastaria mudar a situação para um relato de dez dias
> parecer novo. Em análise aparece também *"em análise há 2 dias"*, embaixo.

Encerrado mostra **quanto levou** (*"resolvido em 3 dias"*), sem cor.

#### A página do relato — a conversa

Clique numa linha para abrir. Em cima ficam o relato e os dados que o sistema
coletou; embaixo, a **conversa**:

- **Respostas do suporte** à esquerda, com a borda dourada;
- **o que quem relatou acrescentou** à direita;
- **as mudanças de situação** como uma linha fina no meio (*"mudou para Em
  análise"*), com quem mudou e quando.

> **Nada da conversa se apaga nem se edita.** A resposta de ontem continua
> embaixo da de hoje. Até a versão 0.246.0 cada relato guardava uma resposta
> só, e responder de novo apagava a anterior.

**Anexos na página:** os que vieram com o relato ficam no quadro dele; os que
vieram com uma mensagem ficam dentro da mensagem. Imagem abre em tamanho real ao
clicar; vídeo toca ali mesmo; PDF abre em outra aba. Os links valem por uma
hora — se a página ficou aberta muito tempo, recarregue.

**Remover um anexo:** quem enviou, ou o suporte. No lugar dele fica *"Anexo
removido por … em …"* — o arquivo é apagado do servidor, a lápide fica para a
conversa continuar fazendo sentido. Quem só enxerga o relato (colegas da
unidade) vê os anexos, mas não anexa nem remove.

No rodapé do relato: quando foi aberto, **quando veio a primeira resposta** (e
quanto tempo depois), quando foi encerrado e em que versão saiu a correção.

**Quem relatou pode:**

- **Acrescentar informação** enquanto o relato está aberto ou em análise
  (*"aconteceu de novo agora"*), **com anexos**, que ficam presos àquela
  mensagem;
- **Reabrir** um relato encerrado pelo botão **Não resolveu** — com a
  obrigação de contar o que não funcionou. O relato volta para **Aberto** e
  para a fila, marcado como *Reaberto*.

> Reabrir exige motivo porque sem ele quem vai corrigir recebe de volta o mesmo
> problema que achava ter resolvido, sem pista do que faltou. E quem relatou
> **não consegue encerrar** — só reabrir. Depois de uma reabertura, a
> versão informada passa a aparecer como *"Correção tentada na versão"*.

**As quatro situações:**

| Situação | O que significa |
|---|---|
| **Aberto** | Registrado, ainda não olhado |
| **Em análise** | Alguém está olhando |
| **Resolvido** | Corrigido — vem com a versão em que a correção saiu |
| **Não é defeito** | O sistema está fazendo o que foi combinado; a resposta explica |

> **"Não é defeito" não é recusa.** É a resposta mais comum e uma das mais
> úteis: muita coisa que parece erro é regra do sistema. A explicação fica no
> relato, para a próxima pessoa que estranhar a mesma coisa.

**Quem responde é o Admin Master**, e ele **não consegue encerrar sem
escrever** — o sistema recusa. Encerrar em silêncio é o que faz uma equipe
parar de relatar. Cada resposta entra **como mensagem nova** na conversa; o
campo vem vazio de propósito, para escrever só o que é novo. A resposta também
aceita anexos (um print mostrando onde fica a configuração, por exemplo) — mas
só junto com texto: mudar apenas a situação não cria mensagem para prendê-los. Mudar apenas a
situação, sem texto, também fica registrado na conversa.

**Para quem relata, isso significa uma coisa prática:** quanto melhor o seu
relato, mais rápido vem a resposta. O sistema manda junto a tela, a versão, a
unidade, a sua função e o navegador — o que falta é só o que **você** viu.

#### O painel de indicadores

*Tela `/problemas/painel` — botão **Painel de indicadores**, no alto da tela de
Problemas.*

**Quem vê:**

| Quem | O que vê |
|---|---|
| **Admin Master** e **equipe da Franqueadora** | A rede inteira (ou uma unidade escolhida), com o ranking de **unidades** e de **pessoas** |
| **Gerente de unidade** e **Franqueado** | Só a(s) própria(s) unidade(s). **Sem ranking de pessoas** |
| O resto da operação | Não abre o painel (o botão não aparece) |

**Período:** *Últimos 30 dias*, *Últimos 90 dias* (o padrão), *Este mês*,
*Este ano*, ou datas escolhidas em **De** e **Até**.

**Os quadros:**

| Quadro | O que mostra |
|---|---|
| **Relatados** | Quantos relatos foram registrados, separados em problemas, dúvidas e sugestões |
| **Problemas solucionados** | Dos problemas relatados no período, quantos já estão resolvidos (e quantos não eram defeito) |
| **Sugestões implantadas** | Das sugestões do período, quantas viraram melhoria (e quantas não seguiram adiante) |
| **Respostas enviadas** | Quantas mensagens do suporte foram escritas no período |
| **Tempo até a 1ª resposta** | A **mediana**: metade dos relatos foi respondida em até esse tempo. A média aparece embaixo |
| **Tempo até concluir** | O mesmo, até o relato ser encerrado |
| **Ainda em aberto** | Dos relatados no período, quantos continuam abertos — e quantos nem resposta tiveram |
| **Reabertos** | Quantos voltaram porque a solução não funcionou |

Abaixo vêm:

- o gráfico **Relatados × concluídos** (por semana; por mês em períodos
  longos);
- a tabela **Por parte do sistema** — onde estão os problemas e quantas
  sugestões de cada parte viraram melhoria;
- **Unidades que mais contribuem** e **Pessoas mais colaborativas**;
- **Esperando há mais tempo**: o que está aberto **agora**, de qualquer data,
  com a mesma cor de idade da lista (amarelo a partir de 3 dias, vermelho
  depois de 7).

> **Como o ranking conta.** Vem primeiro quem teve mais relatos
> **aproveitados** — problema corrigido, sugestão implantada ou dúvida
> esclarecida. "Não é defeito" conta como participação, mas não como
> aproveitado: o ranking premia o relato que melhorou o sistema, não a
> quantidade. Os relatos do próprio Admin Master ficam de fora (é quem
> corrige). Unidade maior tende a relatar mais — por isso a tabela mostra
> quantas pessoas relataram em cada uma.

> **Por que mediana e não só média?** Um relato esquecido por um mês puxa a
> média para cima e esconde que o resto foi respondido no mesmo dia. A mediana
> diz o que aconteceu com a maioria. E relato ainda sem resposta **não entra**
> na conta — contá-lo como zero o faria parecer o mais rápido de todos.

> A lista *Esperando há mais tempo* **não mostra o título** do relato: ele é
> texto livre e pode citar paciente. Mostra o código, que abre o relato para
> quem tem acesso a ele.

O painel tem, no fim, o quadro **Como ler este painel** com essas regras.

#### Só para o Admin Master: preparar para correção

Na página do relato, ao lado do título *Conversa*, existe **Preparar para
correção**. Ele reúne o relato e todo o contexto que o sistema coletou num
texto pronto para pedir o conserto — sem ninguém reescrever o caso à mão, que é
onde a informação se perde. **A conversa vai junto**, na ordem, sem nomes: o
complemento de quem relatou e o motivo de uma reabertura costumam ser
justamente a parte que faltava.

Antes de gerar, há um campo para as **suas considerações**: o que você sabe e o
sistema não sabe (*"acontece só na Cambé"*, *"eu reproduzi"*, *"acho que é
permissão, não defeito"*).

E há dois caminhos:

| Botão | Serve para |
|---|---|
| **Corrigir o problema** | pedir diagnóstico e conserto |
| **Responder a quem relatou** | quando **não é defeito** — pede uma explicação em linguagem simples, para você revisar e colar no campo *Resposta* |

> ⚠️ **O texto aparece para revisão antes de ser copiado, e isso é de
> propósito.** O relato é texto livre: se alguém escreveu o nome de um paciente,
> copiar tira esse dado de dentro do sistema. Troque por *"o paciente"* — quem
> vai consertar não precisa saber de quem é a ficha.
>
> **O nome de quem relatou nunca entra no texto.** A função e a unidade dizem
> tudo o que importa para corrigir.

### 15.3. Alertas

*Tela `/alertas` — o **triângulo** na barra de cima.*

O que o sistema está avisando agora, reunido num lugar só: os alertas do
Financeiro (orçamento perto do limite, caixa projetado negativo, faturamento
atrás do ponto de equilíbrio, atraso acumulado) e os do Estoque (sessão
concluída sem kit, embalagem acabando, item acima do máximo).

**Esta tela reúne, não libera.** Você só vê alerta de assunto que já podia ver
no módulo — quem não enxerga o Financeiro não enxerga alerta financeiro.

**Vermelho** é o que já dói; **amarelo**, o que ainda dá para resolver. Os
alertas financeiros são apurados **uma vez por dia, às 9h**: a tela mostra o
retrato da última apuração, e diz isso.

### 15.4. Relógio

No alto da tela de **Alertas** fica o **relógio**: a data e a hora de
Brasília por extenso, e — ao lado — o fuso do seu computador e o do servidor.

**Para que serve:** computador com data ou hora erradas faz o sistema parecer
com defeito. Horários viram "passado" sem terem passado, e ninguém desconfia do
relógio da própria máquina. Se a diferença passar de 2 minutos, o painel avisa
e diz o que fazer.

> **Foi exatamente esse tipo de desencontro que causou o defeito corrigido em
> 05/09/2026** — só que do lado do servidor. A agenda recusava remarcações
> dizendo que o horário já tinha passado, e não tinha. Este painel existe para
> que a próxima vez seja visível em vez de misteriosa.

---

## Documentos relacionados

- [`evidencias-riSZon.md`](evidencias-riSZon.md) — de onde veio cada afirmação
- [`lacunas-riSZon.md`](lacunas-riSZon.md) — o que não foi possível confirmar
- [`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json) — rotas, menus, mensagens e ações
- [`matriz-permissoes-riSZon.csv`](matriz-permissoes-riSZon.csv) — 16 papéis × 27 colunas
