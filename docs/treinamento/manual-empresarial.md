# Manual do Risarte Empresarial

> **Para quem é este manual.** Para quem opera o programa corporativo dentro do
> riSZon: o **Consultor RisLife**, a **Franqueadora**, o **Admin**, e a
> **recepção e a gestão da unidade** que atendem os titulares. Não é o material
> que vai para a empresa parceira — o que se explica a ela está reunido na
> última seção, para ser copiado.
>
> **Como este material foi produzido.** Saiu do código deste repositório: rotas,
> abas, rótulos de tela, regras de negócio e migrações do módulo `empresarial`.
> Onde não foi possível confirmar, está escrito **"Não identificado no código
> analisado"** — e não substituído por descrição genérica.
>
> **Este manual muda junto com o sistema.** Ele viaja no mesmo envio que o
> código, então o texto em *Empresarial → Manual* é sempre o da versão no ar.
> Não existe manual velho aqui. O número da versão aparece no alto da tela.
>
> **Limitação declarada:** a análise é do código, não da aplicação rodando.
> Posições visuais (onde cada botão fica) não foram confirmadas uma a uma.

---

## Índice

1. [O que é o Risarte Empresarial](#1-o-que-é-o-risarte-empresarial)
2. [Início rápido — o caminho inteiro em 8 passos](#2-início-rápido--o-caminho-inteiro-em-8-passos)
3. [Quem faz o quê](#3-quem-faz-o-quê)
4. [O funil comercial](#4-o-funil-comercial)
5. [A ficha da empresa no funil, aba por aba](#5-a-ficha-da-empresa-no-funil-aba-por-aba)
6. [Montar a proposta](#6-montar-a-proposta)
7. [Fechar o negócio](#7-fechar-o-negócio)
8. [O cadastro da empresa](#8-o-cadastro-da-empresa)
9. [Titulares e dependentes](#9-titulares-e-dependentes)
10. [Boas-vindas: a fila de ligação](#10-boas-vindas-a-fila-de-ligação)
11. [Quantidade contratada e termo de inclusão](#11-quantidade-contratada-e-termo-de-inclusão)
12. [Mensalidade, cobranças e split](#12-mensalidade-cobranças-e-split)
13. [O benefício na hora do orçamento](#13-o-benefício-na-hora-do-orçamento)
14. [Riso+ Social](#14-riso-social)
15. [Configurações da rede](#15-configurações-da-rede)
16. [Painéis e relatórios](#16-painéis-e-relatórios)
17. [Quando alguma coisa dá errado](#17-quando-alguma-coisa-dá-errado)
18. [O que ainda NÃO está ligado](#18-o-que-ainda-não-está-ligado)
19. [Glossário](#19-glossário)
20. [Checklists](#20-checklists)
21. [O que explicar para a empresa parceira](#21-o-que-explicar-para-a-empresa-parceira)

---

## 1. O que é o Risarte Empresarial

O **Risarte Empresarial** é o programa que liga **empresas parceiras** à rede
Risarte. A empresa contrata; as pessoas dela entram no programa; e cada uma
vira **cliente do riSZon como qualquer outro paciente** — mesma ficha, mesma
agenda, mesmo prontuário —, só que com um **selo ★ Risarte Empresarial** e com
**benefícios** que reduzem o valor do tratamento.

Três palavras aparecem o tempo todo, e vale fixá-las antes de qualquer tela:

- **Titular** — a pessoa da empresa que entra no programa. (Até setembro de
  2026 a tela dizia "colaborador"; mudou porque nem toda parceria é de
  empregados: há sócios de empresa, associados de associação, condôminos.)
- **Dependente** — quem entra pendurado num titular (cônjuge, filho, etc.).
- **Benefício** — o que o programa dá naquele procedimento: sem custo,
  desconto em % ou em R$, ou "não coberto".

**O que o programa NÃO é.** Ele não é um plano odontológico nem um convênio: não
há rede credenciada de terceiros, nem reembolso. É um acordo comercial direto
entre a Risarte e a empresa, com mensalidade e com preço diferenciado no
tratamento.

**Por que existe a mensalidade.** A empresa (ou o titular, conforme o modelo)
paga um valor mensal por pessoa. É isso que sustenta o benefício no
tratamento — e é isso que faz o programa ser previsível para a clínica, em vez
de virar desconto solto.

---

## 2. Início rápido — o caminho inteiro em 8 passos

Este é o caminho completo, do primeiro contato até a pessoa sentar na cadeira.
Cada passo tem a sua seção detalhada mais adiante.

1. **Entra o lead.** Menu **Empresarial → Funil**, botão **Novo lead**: empresa,
   CNPJ, contato, valor estimado e uma **próxima ação** com data.
2. **Levantamento.** Abra a empresa e preencha o que ela tem hoje: convênio
   atual, quanto paga, quantas pessoas, interesse.
3. **Proposta.** Na aba **Proposta**, monte a oferta: preço por titular,
   faixas por quantidade, dependentes, benefícios, unidades, prazo e carência.
4. **Apresentação.** Registre a apresentação e gere o documento (**Ver a
   proposta**) para imprimir ou salvar em PDF.
5. **Envio e selos.** Registre o envio e acompanhe os dois selos (documento
   assinado e pagamento) — são eles que autorizam o fechamento.
6. **Fechar — ganho.** O sistema **cria a empresa** já com os preços, as
   faixas, os benefícios e a carência da proposta.
7. **Cadastrar titulares.** Na ficha da empresa, aba **Titulares**: um a um ou
   por planilha. Depois, **Completar cadastro** liga cada pessoa a um
   prontuário do riSZon.
8. **Boas-vindas.** A recepção liga para cada pessoa, completa o cadastro e
   marca a primeira consulta.

> **A ordem não é trancada.** Nenhuma aba do funil é bloqueada: dá para ir ao
> Envio com o levantamento incompleto. A tela **avisa** o que falta; quem decide
> a ordem é quem atende.

---

## 3. Quem faz o quê

O módulo tem dois níveis de acesso, e a diferença importa.

**Gestor do programa** — vê e faz tudo na parte comercial: funil, proposta,
fechamento, configurações da rede, cobranças, termos de inclusão. São:

- **Admin Master**
- **Franqueadora (rede)**
- **Consultor Comercial Empresarial (RisLife)**

**Financeiro da Franqueadora** — cuida do **financeiro do programa**, e só
dele (desde a versão 0.80.0, relato OC-00105): na aba **Financeiro** da
empresa, **Gerar cobrança mensal**, **Gerar implantação**, **Checar
inadimplência**, **Marcar pago**, **Editar** e **Cancelar**; na tela
**Cobranças**, as mensalidades e as baixas em lote e o estorno; e o **Acordo de
cobrança** em Dados Gerais. Vê todas as empresas do programa para poder
cobrá-las. **Não** mexe no funil, na proposta, no contrato, nos termos de
inclusão nem nas configurações — isso continua com o gestor do programa.
Separar quem vende de quem cobra é de propósito.

> **Os botões de cobrança só aparecem para quem pode cobrar.** Antes eles
> apareciam para todo mundo que abria a ficha, e quem não podia recebia
> "Sem permissão" no clique.

**Quem só enxerga o módulo** — gestão e atendimento da unidade, que veem as
empresas com titulares na sua unidade. Isso é controlado pela matriz de
permissões (**Administração → Permissões**, chave `modulo.empresarial`), então
o Admin pode ajustar sem mexer no código.

**Quem cadastra titular** é uma lista mais larga que a de gestores, de
propósito: gestor do programa, **SDR**, **recepção**, **gerente de unidade** e
**franqueado**. Cadastrar gente é trabalho de balcão; decidir preço não é.

> **Para criar um Consultor RisLife:** como Admin, em **Administração →
> Usuários (acesso)**, dê ao usuário o papel **Consultor Comercial Empresarial
> (RisLife)** na **Franqueadora**.

**O que o Consultor RisLife não faz:** ele não acessa dado clínico. O programa
é comercial; prontuário é outro assunto, e a separação é exigência de LGPD.

---

## 4. O funil comercial

Menu **Empresarial → Funil**. Cada empresa é um card, e o card anda pelas
etapas. As etapas são:

| Etapa | O que significa |
|---|---|
| **Captação** | Entrou, ainda não houve contato |
| **Contato** | Já se falou com alguém |
| **Reunião agendada** | Tem data marcada |
| **Apresentado** | A apresentação foi feita |
| **Proposta enviada** | O documento foi para a empresa |
| **Follow-up** | Esperando resposta, cobrando |
| **Fechamento (ganho)** | Fechou |
| **Fechamento (perda)** | Não fechou |
| **Implantação** | Fechou e está entrando no ar |

**★ Hoje do consultor**, no topo, junta o que tem próxima ação para hoje. É por
onde o dia começa.

> **O seletor do card só oferece as fases em aberto.** Fechamento (ganho) e
> Implantação não se escolhem: a empresa chega ao ganho pelos **dois selos** e
> à implantação pela **conferência** (seção 7). O sistema recusa qualquer
> outro caminho.

**Mover o card** é feito pelo seletor no próprio card. **Abrir** mostra a
janela rápida da empresa, e dela se vai à **ficha completa**. Registre cada
**tentativa de contato, reunião e anotação** — na janela do card ou na aba
**Histórico** da ficha, tanto faz: é o mesmo registro. É ele que sustenta a
negociação três semanas depois, quando ninguém lembra do que foi combinado por
telefone.

**A agenda do comercial** (**Empresarial → Agenda**) é a agenda das reuniões e
apresentações do programa, separada da agenda clínica.

---

## 5. A ficha da empresa no funil, aba por aba

### O alto da ficha: quem é a empresa e o que fazer agora

Antes das abas, a ficha mostra três coisas:

1. **A fase e o que ela significa** — no cabeçalho, embaixo do nome da empresa
   (*"O programa já foi apresentado. Agora é levantar os dados e montar a
   proposta."*).
2. **Dados da empresa** — CNPJ, contato, telefone, consultor, origem, valor
   estimado, há quanto tempo está na fase e a **próxima ação** agendada (em
   vermelho quando já passou da data). O botão **Editar dados** abre o mesmo
   formulário do card do funil.

   > **"Sem histórico anterior"** ao lado do tempo na fase quer dizer que o
   > relógio começou a contar em 14/09/2026, quando a empresa já estava
   > naquela fase — o número não mede desde a entrada de verdade.

   > **Sem o CNPJ completo não dá para criar o cadastro da empresa** no
   > fechamento. A ficha avisa enquanto ele estiver faltando.
3. **Próximo passo** — uma frase só, dizendo o que se faz agora com aquela
   empresa, e um botão que leva à aba onde isso se resolve. Quando a empresa
   andou no funil e algo ficou para trás (por exemplo: está em *Apresentado* e
   o levantamento não começou), o quadro vira **Atenção** e aponta o buraco
   antes do passo seguinte.

| A empresa está em… | O próximo passo diz… |
|---|---|
| Captação | Fazer o primeiro contato |
| Contato | Conseguir a reunião (e quantas tentativas já houve) |
| Reunião agendada | Preparar a apresentação |
| Apresentado | Completar a proposta — ou enviá-la, se já está pronta |
| Proposta enviada / Follow-up | Registrar o envio, conseguir a assinatura, confirmar o pagamento — nessa ordem |
| Fechamento (ganho) | Criar o cadastro da empresa; depois, fazer a conferência |
| Implantação | Concluir a implantação (*2 de 5 passos resolvidos*) |
| Fechamento (perda) | Não há passo: mostra o motivo registrado |

### As abas

A ficha tem **seis abas**, e ela **abre na etapa em que a empresa está** — quem
abre uma empresa em follow-up não quer reler a entrevista inicial.

**Levantamento · Proposta · Apresentação · Envio e selos · Fechamento · Histórico**

Cada aba mostra embaixo do nome a sua situação (*falta 2 campos*, *modelo da
rede*, *nada enviado*, *em aberto*, *falta criar a empresa*, *implantação
3/5*, *8 registros*). Âmbar é pendência; cinza é informação.

> **Empresa perdida não tem pendência.** As abas continuam dizendo o que ficou
> por fazer (*nada enviado*), mas sem o âmbar — ninguém vai completar a
> proposta de um negócio que acabou.

### Levantamento — o que a empresa TEM

Aqui se registra a realidade da empresa, não a oferta: convênio atual, quanto
ela paga hoje, quantas pessoas, interesse, chance de fechar, observações.

> **Levantar e oferecer são dois atos diferentes.** Por isso são abas
> separadas: quem vai ajustar um valor não precisa reler a entrevista inteira
> pelo caminho.

> **"Não começou" ≠ "falta 1 campo".** Empresa sem levantamento nenhum diz
> *não começou*. É informação diferente, e o sistema separa as duas.

### Proposta — o que a gente OFERECE

É a seção 6 inteira deste manual. O botão **Ver o levantamento** abre um pop-up
com o que a empresa contou, **só para leitura**, para você configurar a oferta
sem trocar de aba.

### Apresentação

Onde se registra a apresentação do programa para aquela empresa.

### Envio e selos

Registra o envio da proposta e acompanha **dois selos**: o documento assinado e
o pagamento. **Quando os dois ficam verdes, a empresa vai para Fechamento
(ganho).** É a regra de ouro do riSZon aplicada aqui: só é venda com documento
assinado **e** pagamento confirmado.

### Fechamento

O que a aba mostra depende de onde a empresa está:

- **Ainda em negociação** — *O que falta para fechar*: os dois selos (contrato
  assinado e boleto da implantação pago), o que falta, e o botão **Marcar em
  Envio e selos**, que leva à aba onde eles são marcados. Embaixo, **O negócio
  não vai acontecer?**: escreva o motivo e marque como perdido.

  > **O motivo da perda é obrigatório** — é essa lista que mostra o que
  > corrigir na oferta. Se a empresa voltar a procurar, a negociação pode ser
  > **reaberta** (abaixo).
- **Ganha, sem cadastro** — o botão **Criar empresa** (o mesmo do card do
  funil). Ele exige os **dois selos** e o CNPJ completo. A conferência só é
  aceita depois dele.
- **Ganha, com cadastro** — a **conferência do consultor responsável**.
- **Em implantação** — a conferência e os **passos da implantação**.
- **Perdida** — *Negócio perdido*, com o motivo registrado. A ficha de uma
  empresa perdida abre nesta aba: é onde está a resposta. Logo abaixo,
  **A empresa voltou a procurar?**: escolha a fase em que a negociação
  recomeça, escreva por que foi retomada e clique em **Reabrir negociação**.

  > **Reabrir traz a mesma ficha de volta**, com o levantamento, a proposta e
  > o histórico — inclusive o motivo da perda, que é o que mais vale numa
  > retomada. **A perda continua contando no painel**: reabrir não melhora a
  > taxa de ganho de ninguém.

### Histórico

Tudo o que já aconteceu com a empresa no funil, numa **linha do tempo** só, do
mais recente para o mais antigo: cada mudança de fase (com quanto tempo ficou
nela, quem moveu e — na perda — o motivo), cada tentativa de contato, reunião,
envio, selo, a conferência e as anotações. Os botões no alto da lista filtram
por tipo.

Ao lado, **Registrar**: tentativa de contato, reunião e anotação. São os mesmos
registros da janela do card — o que se lança num lugar aparece no outro.

> **Marcar reunião aqui move a empresa para "Reunião agendada"**, como no card.
> O desfecho de cada reunião continua sendo dado na **Agenda do programa**.

> **"Já estava em … quando o registro começou"** é a primeira linha das
> empresas que entraram no funil antes de 14/09/2026: o sistema não sabe a
> data de entrada delas, e diz isso em vez de inventar uma.

> **Trocar de aba não apaga nada.** Digite no Levantamento, vá para a
> Apresentação e volte: o que você digitou continua lá. As abas escondem, não
> apagam. Mas **salvar continua sendo salvar** — sair da ficha sem salvar,
> perde.

---

## 6. Montar a proposta

Tudo nesta seção fica na aba **Proposta** da ficha do funil.

### 6.0. A trilha de seis passos

A aba não é mais uma lista comprida: ela tem uma **trilha à esquerda** com seis
passos, na ordem do trabalho, e a **simulação fica fixa ao lado** — o valor
responde a cada mudança sem você precisar rolar a tela.

| # | Passo | O que se decide |
|---|---|---|
| 1 | **Quem paga e quanto** | modelo de pagamento, quantos entram, mensalidade, valores dos dependentes |
| 2 | **Condições comerciais** | faixas por quantidade (com o total de cada uma), mínimo, máximo, excedente |
| 3 | **Benefícios e unidades** | o que está coberto e onde vale |
| 4 | **Prazo e carência** | validade da proposta e as duas carências |
| 5 | **Texto da proposta** | os blocos de texto do documento |
| 6 | **Dados do contrato** | razão social e quem assina |

**Cada passo mostra o seu resumo embaixo do nome** — *"R$ 39,90 por titular ·
90 titulares"*, *"2 faixas · máx. 200"*, *"5 benefícios · 2 unidades"*. Dá para
ver o estado da proposta inteira sem abrir passo nenhum.

> **Não é um assistente: é uma trilha.** Não existe "próximo" obrigatório nem
> passo trancado. Quem volta numa proposta em follow-up quer mexer numa faixa e
> sair, não reler seis passos.

> ⚠️ **Os passos 1, 4 e 6 são um formulário só** e salvam juntos, no botão
> **Salvar proposta** (a tela diz isso ao lado do botão). Os passos 2, 3 e 5
> têm **cada um o seu salvar**, dentro do próprio passo. Trocar de passo **não
> apaga** o que você digitou — mas sair da ficha sem salvar, sim.

> **O amarelo quer dizer alguma coisa.** Passo sem faixa nenhuma ou sem
> benefício fica cinza, não amarelo: são decisões legítimas. Amarelo aparece
> quando falta mesmo — por exemplo, **máximo de adesões combinado sem a regra
> do excedente**, que é o que faz o termo de inclusão nascer sem valor
> (seção 11).

### 6.1. Prazo e carência

- **Validade da proposta** — quantos dias ela vale. Em branco, usa o padrão da
  rede (**15 dias**, configurável em Configurações → Proposta comercial).
- **Carência da empresa** — contada do início do contrato.
- **Carência do titular** — contada da entrada de cada pessoa.

As duas carências **viajam para o cadastro da empresa no fechamento** — não são
redigitadas depois.

> **Vale a mais longa.** Entre a carência da empresa e a do titular, quem manda
> é a maior das duas. Benefício pode ainda ter carência própria, que é tratada
> procedimento a procedimento.

### 6.2. Quantas pessoas e por quanto

- **Quantos titulares entram** e **mensalidade por titular**.
- **Faixas por quantidade** — *a partir de 1: R$ 39,90*, *de 50: R$ 34,90*,
  *de 100: R$ 29,90*.

> ⚠️ **A faixa vale para TODO MUNDO, não só para quem passou.** Chegando a 120
> titulares na faixa "de 100", os **120** passam a pagar R$ 29,90 — não só os 20
> que passaram de 100. É assim que a empresa entende a negociação, e é assim que
> a mensalidade é calculada.

- Faixa maior **mais cara** que a anterior: a tela **avisa** e **deixa salvar**
  (existe negociação assim). Duas faixas na mesma quantidade: **recusa**.
- **O total de cada faixa aparece embaixo dela**, enquanto você digita — por
  exemplo, *"Total no início da faixa: 50 × R$ 34,90 = R$ 1.745,00/mês"*. A
  faixa que vale para os titulares desta proposta ganha um **✓** com o total
  para essa quantidade. No valor fixo por empresa, o total é o próprio valor da
  faixa.

> **O total da faixa é só para quem monta a proposta.** O documento que vai
> para a empresa continua mostrando o preço por titular de cada faixa.

**Valor fixo por empresa.** Em vez de preço por titular, a proposta pode
combinar **um valor só pela empresa**. É esse valor que ela paga todo mês,
**com qualquer número de titulares cadastrados** — as faixas, se houver,
escolhem o valor pelo tamanho da empresa. No fechamento, o acordo **viaja para
o cadastro da empresa** (valor fixo já com a faixa aplicada) e passa a mandar
na mensalidade, na ficha, no painel e na cobrança.

> Fechar uma proposta de valor fixo **sem o valor preenchido** é recusado: não
> existe mensalidade sem o número combinado.

**Padrão × proposta — quanto a empresa economiza.** O quadro *Simulação da
proposta* (ao lado da tela) compara esta proposta com o **preço padrão da
rede** (Configurações → Preço da adesão), para a **mesma empresa**: os mesmos
titulares e os mesmos dependentes estimados, pelo preço de tabela, sem faixa.
Por exemplo: *"Padrão R$ 3.990,00/mês → Proposta R$ 2.990,00/mês · a empresa
economiza R$ 1.000,00/mês (R$ 12.000,00/ano)"*. Se a implantação também ficar
mais barata, a economia dela aparece embaixo.

- A caixa **"Mostrar no documento: padrão × proposta"**, logo abaixo dos
  preços, decide se essa comparação vai para o papel. Ela **já vem marcada**;
  desmarque e salve a proposta para tirar.
- Marcada, o documento ganha a seção **Condição especial para a sua empresa**
  com o preço padrão, o proposto e a economia por mês e por ano — **só quando
  a proposta sai mais barata**. Igual ou mais cara que o padrão, nada aparece
  no documento (a tela avisa).
- Dependentes: o padrão conta do mesmo jeito que a proposta (o mesmo quadro ou
  "como individual"). Se a proposta não calcula dependentes, o padrão também
  não. No valor fixo por empresa, o padrão conta os dependentes como
  individuais.

### 6.3. Dependentes

Os valores dos dependentes ficam no passo **Quem paga e quanto**. Ao responder
**"Dependentes entram nesta fase?" → Sim**, abre o quadro **Valores dos
dependentes**. Ele tem três partes.

**1. Como os dependentes são cobrados** — duas opções:

- **Individual** — cada dependente paga o mesmo valor. Um campo só: **Valor por
  dependente**.
- **Plano familiar** — o titular com **1 dependente** paga o **avulso**; a
  partir de **2**, paga o **pacote**; quem passa do tamanho do pacote paga o
  **extra** por dependente. Campos: **dependente avulso**, **valor do pacote**,
  **até quantos dependentes ele cobre** e **cada dependente além do pacote**.

> ⚠️ **A escolha vale também na cobrança.** No fechamento, ela vai para o
> cadastro da empresa, e a mensalidade é cobrada família a família por essa
> regra. Proposta sem escolha gravada vale **plano familiar** — é o que a
> cobrança sempre fez.

**2. Calcular os dependentes na proposta?** — três opções:

- **Detalhar por titular** — abre um quadro de **quantos titulares terão
  quantos dependentes**. Ele já vem com as linhas de 0 a 4 dependentes; basta
  preencher quantos titulares estão em cada uma (por exemplo: 3 sem
  dependentes, 4 com 1, 2 com 2, 3 com 3, 1 com 4). **Nova linha** acrescenta
  famílias maiores. Cada linha mostra quanto cada titular paga pelos
  dependentes e o subtotal; embaixo, o total de dependentes e o valor por mês.
  O campo **Quantos dependentes** passa a ser a soma do quadro.
- **Calcular como individual** — para quando não se sabe a distribuição: a
  conta é **quantos dependentes × o valor individual**.
- **Não calcular** — a proposta só explica a tabela de valores; o total dos
  dependentes sai dos cadastros.

> **O quadro usa a mesma conta do boleto.** Se o quadro estiver certo, a
> primeira mensalidade com todos cadastrados dá o mesmo valor que a proposta.

> **Os avisos do quadro:** duas linhas com a mesma quantidade de dependentes
> **impedem salvar** (junte as duas). Se o quadro somar mais ou menos titulares
> que os da proposta, aparece um **aviso em amarelo** — ele não impede salvar.
> Quem não terá dependente entra na linha **0**.

**3. A implantação (1º pagamento) cobra** — aparece quando os dependentes são
calculados:

- **Só os titulares** (o padrão) — os dependentes começam a pagar na
  mensalidade.
- **Titulares e dependentes** — os dependentes estimados entram já no primeiro
  pagamento.

**O que muda na simulação e no documento.** Com os dependentes calculados, a
**mensalidade** passa a ser **titulares + dependentes**, e a simulação diz de
onde veio o valor dos dependentes. O documento mostra **Titulares**,
**Dependentes (estimado)** e **Total mensal estimado**, a tabela de valores e,
quando houve quadro, a linha "**Como estimamos**" de cada grupo de famílias.
Ele também diz que o valor dos dependentes é **estimativa** e que a cobrança é
feita pelos dependentes efetivamente cadastrados.

> **A parte da empresa vale só sobre os titulares.** Quando a empresa paga tudo
> ou parte, a parte dela é calculada sobre os titulares; os dependentes ficam
> por conta do titular — a simulação e o documento dizem isso.

Os valores são gravados no botão **Salvar proposta**, junto com o resto do
passo. Responder "Não" depois **não apaga** os valores nem o quadro já salvos.
Em **Condições comerciais** fica só um atalho, **Configurar dependentes**, que
leva até este quadro.

Na proposta de **valor fixo por empresa** não há preço de dependente: eles já
estão dentro do valor combinado, e a tela e o documento dizem isso.

### 6.4. Implantação

**A implantação é o primeiro pagamento**, cobrado ao iniciar o programa: o
valor dos titulares — e, se a proposta marcou **"Titulares e dependentes"**
(seção 6.3), também o dos dependentes estimados. O valor não se negocia à
parte, e a proposta não tem campo para isso (decisão da direção, 27/09/2026).

> **Por que os campos saíram:** a proposta tinha "implantação por titular" e
> "implantação fixa ou por adesão", e o documento imprimia esses valores — mas
> a cobrança **nunca os usou**: a implantação sempre foi cobrada pelo preço da
> mensalidade. A empresa lia um número e recebia o boleto de outro. Hoje o
> documento mostra exatamente o que será cobrado.
>
> **Proposta antiga** que tinha esses campos preenchidos: o valor continua
> guardado, mas o documento passa a mostrar o primeiro pagamento.

### 6.5. Limites: mínimo e máximo

- **Mínimo** — abaixo dele a aba **avisa** (⚠️), mas **não trava**: negociação
  pode fechar abaixo, é decisão de quem vende.
- **Máximo** — acima dele a aba **impede** (⛔).
- **Valor mínimo da proposta** — avisa quanto falta, e **não trava**.

### 6.6. Se passar do contratado

O que acontece quando a empresa quiser incluir mais gente depois **depende de
como ela paga**:

- **Proposta por titular** — **não há nada a combinar.** Quem passa do
  contratado entra pelo **preço da tabela** da empresa, com a faixa — o mesmo
  preço dos outros titulares. O passo mostra só essa explicação.
- **Proposta de valor fixo** — combine uma das duas:
  - **Por adesão** — cada pessoa a mais tem preço.
  - **Novo valor fixo do pacote** — o pacote inteiro passa a valer outro valor.

> **Por que por titular não tem regra própria** (decisão da direção,
> 27/09/2026): antes dava para combinar um "preço do excedente" diferente do
> titular — mas a mensalidade sempre somou todos os titulares pela tabela. O
> termo assinado dizia um valor e o boleto cobrava outro. Hoje os dois dão o
> mesmo número.

> **No valor fixo, combine ANTES.** É o que permite o termo de inclusão
> (seção 11) nascer com o número pronto. Sem isso, o termo nasce **sem valor** e
> o sistema avisa — e a trilha marca o passo em amarelo (*"sem regra de
> excedente"*) quando há máximo combinado.

### 6.7. Vantagens e benefícios

O passo **Benefícios e unidades** tem, de cima para baixo:

**1. Inserir um grupo de benefícios.** Cada grupo pronto aparece numa linha com
o nome, quantos benefícios traz, quantos são *sem custo*, *com desconto* e *não
coberto*, e para que serve. **Ver o que tem** mostra os procedimentos do grupo;
**Inserir** coloca todos na proposta. O **Padrão da rede** (Configurações →
Benefícios) aparece como o primeiro da lista. Ao inserir, a tela diz **quantos
incluiu e quais trocou** — o grupo **substitui** o benefício do mesmo
procedimento e **mantém** os outros. **Nada é salvo até você salvar.**

**2. A lista, em três seções:** **Sem custo**, **Com desconto** (em % ou em R$)
e **Não coberto**, cada uma com quantos procedimentos tem. Clicar no título
**recolhe ou abre** a seção.

Cada procedimento fica **recolhido em uma linha**, com o resumo do que foi
combinado — por exemplo *"50% de desconto · 1 vez a cada 12 meses · após 2
meses de programa · Titular e dependente"*. O **lápis** abre os campos para
editar; **Pronto** fecha de novo. Benefício com algo a corrigir mostra o
problema em vermelho mesmo recolhido, e o título da seção diz quantos há.

| Tipo | O que sai no documento |
|---|---|
| **Sem custo** | "Sem custo" |
| **Desconto (%)** | "30% de desconto" |
| **Desconto (R$)** | o valor abatido |
| **Não coberto** | fica de fora do programa |

Cada benefício tem ainda **quantas vezes**, **a cada quantos meses** e
**carência própria** (o *Não coberto* não tem: não há o que usar). Trocar o
tipo muda o procedimento de seção.

**Incluir um procedimento:** no fim de cada seção, *+ Incluir procedimento sem
custo / com desconto / não coberto*. Ele entra já com o tipo da seção e
**aberto**, pronto para configurar.

**Vale para quem:** as duas caixas — *titular* e *dependente* — vêm **marcadas**.
Desmarcar as duas é recusado: benefício que não vale para ninguém não é
benefício.

**3. Salvar os benefícios.** Ao lado do botão, o total e a conta por categoria
(*"6 benefícios — 3 sem custo · 3 com desconto"*); em amarelo, **"há mudanças
não salvas"** enquanto houver. Recolhido **não é removido**: salvar grava todos
os procedimentos da lista, abertos ou não.

**4. Outras vantagens** (abaixo das três seções): o que a empresa ganha além
dos procedimentos. **+ Incluir outra vantagem** escolhe do catálogo da rede
(Configurações → Benefícios e grupos), e ao lado se escreve o **detalhe desta
empresa** — por exemplo *"2 palestras por ano"* ou *"TVs da unidade Cambé"*.
Sem detalhe, o documento usa a descrição da rede. Inserir um grupo traz
também as vantagens dele.

As outras vantagens aparecem no **documento da proposta** (seção *Outras
vantagens*), no **contrato** (no anexo, depois dos procedimentos) e, depois do
fechamento, viram **compromissos** na ficha da empresa (seção 8).

**Guardar como grupo.** Uma combinação usada com frequência pode virar grupo
(*Guardar esta combinação como grupo da rede*) e ser inserida em outras
propostas — com os procedimentos **e** as outras vantagens.

**5. Pagamento do tratamento e Riso+ Social** (último cartão do passo, com
**salvar próprio**):

- **Pagamento do tratamento** — como o titular e o dependente pagam o
  tratamento na clínica: os meios aceitos (**boleto, Pix, cartão**) e o
  **parcelamento em até** (1 a 24x). Soma-se à regra da unidade: o programa
  acrescenta meios, nunca tira. Sem definir, vale o padrão (os três, 24x).
- **Riso+ Social** — só aparece quando a empresa **paga a mensalidade dos
  colaboradores** (integral ou parcial, no passo 1). Esse é o pré-requisito:
  se só os titulares pagam, a empresa **não participa**. Marque se ela
  participa e combine as **metas** que rendem indicações de pessoas carentes.

  **Nova meta** cria uma meta. Cada meta tem:
  - **Condições** — em **Incluir condição…**, quantas quiser (cada uma uma
    vez). **Todas precisam valer ao mesmo tempo** para a meta render:
    - **Titulares ativos** — pelo menos N titulares ativos;
    - **Dependentes ativos** — pelo menos N dependentes ativos;
    - **Tempo de programa** — pelo menos N meses de programa;
    - **Comparecimento às avaliações** — pelo menos X% de comparecimento às
      avaliações e reavaliações nos últimos 12 meses;
    - **Gasto em tratamento** — pelo menos R$ X em tratamentos fechados;
    - **Mensalidades em dia** — nenhuma mensalidade do programa vencida sem
      pagamento.
  - **Rende (indicações)** — quantas indicações a meta dá.
  - **Renova a cada (meses)** — em branco, a meta rende **uma vez só**.
    Preenchido (ex.: 12), rende de novo **a cada 12 meses de contrato**,
    desde que as condições continuem valendo naquele período.

  Exemplo: *1 indicação uma vez, com pelo menos 20 titulares ativos e pelo
  menos 6 meses de programa*. Várias metas funcionam como **degraus** (ex.: uma
  segunda meta com 50 titulares e 12 meses rendendo mais 2). Embaixo de cada
  meta aparece a frase exatamente como sai na proposta.

O pagamento e as metas saem no **documento da proposta**, no **contrato** e
**vão para a empresa** no fechamento.

> **De onde vêm os benefícios na proposta nova.** Uma empresa que ainda não tem
> benefício salvo chega com os **benefícios padrão da rede** (Configurações →
> Benefícios), marcados como vindos do padrão e **ainda não salvos**. Depois do
> primeiro salvar, quem manda é a proposta dela — inclusive se você salvar
> vazio de propósito.

### 6.8. Unidades da parceria

**Unidade principal** (a que responde pela empresa, marcada e sem poder ser
desmarcada) mais as **unidades vinculadas**.

Cada benefício pode ser restrito a unidades específicas (*Vale nestas
unidades*). **Nenhuma marcada = todas.** Com uma unidade só na parceria, as
caixas nem aparecem.

> A restrição **vale de verdade**: um benefício de custo zero restrito a Cambé
> não aparece num orçamento feito em Londrina.

### 6.9. O documento

Botão **Ver a proposta**. Abre em outra aba, pronta para imprimir ou salvar em
PDF; os botões do topo somem na impressão.

O que o documento traz: cabeçalho, razão social, CNPJ, data de emissão,
validade, o quadro de valores, quem paga o quê, a *Condição especial para a sua
empresa* (padrão × proposta, quando marcada e mais barata — ver 6.2), *O que
está coberto*, *Quando o programa começa a valer*, *Onde o programa é
atendido*, e a comparação com o convênio atual.

**Os benefícios saem resumidos.** *O que está coberto* mostra só o resumo —
por exemplo, *"12 procedimentos sem custo (R$ 0,00)"* e *"48 procedimentos com
descontos de 10% a 40%"*. A relação completa vai no **Anexo — Procedimentos e
descontos**, no fim do documento (na impressão, começa em página nova):

- ordem do **maior desconto para o menor** — os sem custo primeiro; empate,
  pelo nome;
- cada linha traz o desconto, para quem vale, o limite de uso, a carência e,
  quando houver, as unidades;
- desconto em **reais** é convertido em % pelo preço de tabela do procedimento,
  para entrar na faixa e na ordem — por exemplo *"R$ 50,00 (25%)"*. Sem preço
  cadastrado, ele é contado à parte (*"3 procedimentos com desconto em reais"*)
  e vai para o fim do anexo;
- os **não cobertos** não entram no resumo nem no anexo.

> ⚠️ **O que NÃO pode estar lá:** interesse, chance de fechar e observações do
> consultor são **notas internas**. O documento vai para a mão da empresa.

> ⚠️ **O documento não esconde má notícia.** Se o convênio atual da empresa for
> **mais barato** que o programa, ele diz que custa mais. Proposta que esconde
> isso é descoberta na primeira conferência da empresa, e aí o problema deixa de
> ser o preço.

> **Proposta incompleta não vira documento.** Com o levantamento faltando, o
> botão fica desligado e a página recusa, listando o que falta. Ela não imprime
> "R$ 0,00" com cara de proposta.

### 6.10. O contrato

Botão **Ver o contrato**, ao lado de *Ver a proposta*. Abre em outra aba o
**contrato do programa já preenchido** com aquela empresa, pronto para
imprimir ou salvar em PDF. O texto é o modelo da rede; o que muda de uma
empresa para outra o sistema preenche sozinho:

| No contrato | De onde vem |
|---|---|
| Razão social, CNPJ/CAEPF, quem assina, cargo e CPF | Passo 6 da proposta (*Dados do contrato*) |
| Endereço da sede, RG, nacionalidade | Na própria tela do contrato (abaixo) |
| Valores da cláusula quarta (titular, dependente, pacote familiar, dependente extra) | A proposta desta empresa, com o valor por extenso |
| Dia de vencimento | O dia combinado; sem combinado, dia 5 |
| Cidades de abrangência | As unidades da parceria; sem parceria definida, todas as unidades da rede |
| A Risarte (razão social, CNPJ, endereço, quem assina) | Configurações → Contrato |
| Data | A de hoje |
| **Anexo I** — procedimentos, cobertura, limite e carência | Os benefícios salvos no passo 3 da proposta |

**No alto da tela, antes do documento** (não sai na impressão):

- **Falta preencher** — em vermelho, o que ainda não tem valor. O contrato sai
  com uma **linha em branco** nesses pontos, como o modelo em papel.
- **Leia antes de enviar** — em âmbar, onde a proposta **não cabe** no texto
  do modelo. O sistema avisa; ele não reescreve a cláusula.
- **Endereço da sede, RG e dia de vencimento** — o que o contrato pede e a
  proposta não guardava. Salve ali mesmo.

> **RG e nacionalidade são opcionais.** Em branco, o contrato sai com a linha
> para preencher à mão.

> ⚠️ **Proposta de VALOR FIXO ou com PREÇO POR QUANTIDADE.** A cláusula quarta
> do modelo fala em valor por colaborador. O contrato avisa quando a proposta
> é diferente disso. Nesses casos use **Personalizar o texto** (abaixo) e
> ajuste a cláusula daquela empresa — no valor fixo, o campo
> `{{valor_fixo_mensal}}` traz o valor já por extenso.

> ⚠️ **Sem benefícios salvos, o Anexo I sai vazio** — e as cláusulas oitava,
> nona e décima apontam para ele. Salve os benefícios no passo 3 antes.

> **O endereço e o dia de vencimento seguem para o cadastro da empresa** no
> fechamento. Se o contrato diz "vencem todo dia 10", a cobrança nasce no dia
> 10.

> **O sistema não guarda cópia do contrato impresso.** Ele é montado na hora,
> com a proposta SALVA e a data do dia. O que vale é o PDF assinado — guarde-o
> nos documentos da empresa (tipo *Contrato do programa*).

**Personalizar o texto** (botão no alto da tela do contrato) abre o texto
inteiro para **esta empresa**: título, qualificação das partes, cada cláusula
e o fecho. Salvar cria o texto próprio dela; as outras continuam com o modelo
da rede. **Voltar ao modelo da rede** desfaz a personalização.

> **Os campos entre chaves duplas** — `{{contratante_razao_social}}`,
> `{{valor_titular}}` — são preenchidos pelo sistema. A lista completa está
> no alto do editor. **Campo escrito errado é recusado ao salvar**: ele sairia
> impresso com as chaves num documento que vai para assinatura.

> **Empresa com texto próprio deixa de acompanhar o modelo da rede.** Se o
> modelo mudar depois, o texto dela continua como foi salvo.

---

## 7. Fechar o negócio

**O caminho é um só, e nesta ordem:**

1. **Os dois selos** — na aba *Envio e selos* da ficha, marque **Contrato
   assinado** e **Boleto da implantação pago**. Com a empresa em *Proposta
   enviada* ou *Follow-up*, ela passa **sozinha** para *Fechamento (ganho)*.
2. **Criar empresa** — na aba *Fechamento* da ficha (ou no card).
3. **A conferência do consultor** — na aba *Fechamento*. Confirmada com "está
   tudo certo", a empresa passa **sozinha** para *Implantação*.

> ⚠️ **Só é ganho com contrato assinado E implantação paga** (regra do dono,
> 13/10/2026). O botão "Fechar (ganho)" que existia na janela do card saiu, e
> o "Mover para Implantação" também: os dois passavam por fora dos selos e da
> conferência. Hoje **o próprio banco recusa** ganho sem os dois selos e
> implantação sem conferência — por qualquer caminho.

> **Marcou os selos cedo demais?** Com a empresa ainda em *Apresentado*, os
> selos ficam marcados e ela não fecha. Fecha ao chegar em *Proposta enviada*
> — registre o envio da proposta.

> **Desmarcou um selo de uma empresa ganha?** Sem cadastro criado, ela volta
> para *Follow-up*. Com o cadastro já criado, o selo é desmarcado e a fase
> não muda (o fato fica registrado no Histórico).

> **Empresas que já estavam em Fechamento ou Implantação antes desta regra**
> continuam onde estão. A ficha de uma ganha sem selos pede os selos antes de
> criar o cadastro.

> **Empresa que não passou pelo funil** continua podendo ser cadastrada
> direto em *Empresarial → Nova empresa* — só pelo gestor do programa. A
> regra dos selos é do funil.

Ao **criar a empresa**, o sistema **leva a proposta junto**:

- **Preços de adesão** — os da proposta, não os da rede.
- **Faixas por quantidade** — continuam valendo no cadastro.
- **Benefícios** — inclusive o "vale só para o titular".
- **Pagamento do tratamento** — os meios aceitos e o parcelamento combinados
  (antes, toda empresa nascia com boleto, Pix e cartão em 24x).
- **Riso+ Social** — se participa, e as metas.
- **Outras vantagens** — viram **compromissos** da empresa, com o nome e o
  detalhe copiados da proposta e a situação **Pendente** (seção 8).
- **Carência** — a da empresa e a do titular.
- **Unidades da parceria** e a restrição de cada benefício.
- **Quantidade contratada** e a regra do excedente.

Na aba **Histórico** fica a anotação do fechamento. **Se ela disser que algo
não foi copiado, confira aquilo no cadastro** — é um aviso, não um detalhe.

---

## 8. O cadastro da empresa

Menu **Empresarial**, clique na empresa. Sete abas:

| Aba | O que tem |
|---|---|
| **Dados Gerais** | CNPJ, razão social, categoria, modelo de pagamento, vencimento, meios de pagamento, carência, **acordo de cobrança** |
| **Documentos** | os documentos da empresa |
| **Titulares** | as pessoas do programa |
| **Plano & Benefícios** | **outras vantagens combinadas**, mensalidade atual, simulador, preços de adesão, benefícios |
| **Financeiro** | cobranças, economia gerada, benefícios utilizados |
| **Riso+ Social** | metas, o que elas conquistaram, indicações e fichas (seção 14) |
| **Contratos** | contratos e assinatura |

**Outras vantagens combinadas** (cartão no alto de Plano & Benefícios) — o que
a empresa ganhou **além dos procedimentos** e se já foi entregue. Vêm da
proposta no fechamento, com o nome e o detalhe **copiados** (renomear a
vantagem em Configurações não muda o que foi assinado), todas **Pendentes**.
O resumo diz, por exemplo, *"2 entregues · 1 pendente"*.

- Cada vantagem tem a **situação** — **Pendente**, **Em andamento** ou
  **Entregue** —, o detalhe e uma **anotação** (ex.: *"palestra marcada para
  12/11"*). **Salvar** grava, com a data da atualização.
- **Incluir vantagem** acrescenta uma do catálogo — para a empresa cadastrada
  direto ou o que foi combinado depois. A **lixeira** retira.
- Quem altera é o **gestor do programa**; os demais veem a lista.

**Acordo de cobrança** (cartão em Dados Gerais) — como a mensalidade é cobrada
(**por titular** ou **valor fixo**), a **quantidade contratada** (titulares e
dependentes) e o que acontece **se passar do contratado**. Numa empresa que veio
do funil, isso já chega preenchido no fechamento. Numa empresa **cadastrada
direto**, é aqui que se define. Para isso, use **Editar** no próprio cartão.

- Quantidade em branco = **sem trava** (como toda empresa antiga).
- No valor fixo, o **novo valor fixo do pacote** tem de ser **maior** que o
  atual — o termo cobra a diferença; se não for, o sistema recusa.
- Na empresa por titular, o valor fixo e a regra do excedente **somem da tela**
  e continuam guardados; voltar para valor fixo mostra o que estava lá.
- Mudar o acordo vale para as **próximas** cobranças — as já geradas não mudam
  — e fica registrado na **Auditoria**, com o antes e o depois.
- Numa empresa que passou de por titular para valor fixo, os termos de inclusão
  da época "por titular" **não somam** ao valor fixo: o valor fixo já cobre
  tudo o que foi combinado até ali.

**Modelo de pagamento** — é a decisão que muda tudo o mais:

- **Empresa paga integral** — a empresa paga a mensalidade de todos.
- **Empresa paga parcial** — divide com o titular.
- **Titular paga** — cada um custeia a própria.

**Categoria** — empresa privada, órgão público, consórcio, condomínio, produtor
rural, autônomo, obra civil, estrangeira. Ela sugere o tipo de documento.

**Preços de adesão da empresa** — mudar um valor aqui cria um **override**
(aparece *Voltar ao padrão da rede*), e a mensalidade passa a usar o valor dela.

---

## 9. Titulares e dependentes

Aba **Titulares** da empresa.

**Cadastrar um a um:** *Novo titular* — nome, CPF, telefone, plano de
dependentes.

**Cadastrar por planilha:** *Importar Excel* — baixe o modelo
(`modelo-titulares.xlsx`), preencha e importe.

**Dependentes:** dentro de um titular, *Adicionar dependente* (CPF +
parentesco).

**Completar cadastro** — é o passo que liga a pessoa ao riSZon. Escolha a
**unidade** e confirme: ela passa a mostrar **★ Cliente vinculado** e o botão
**Ver ficha**. Na ficha (ou em **Prontuários**) aparece o selo **★ Risarte
Empresarial** no topo.

> **Enquanto não for completado, a pessoa está no programa mas não tem
> prontuário** — e sem prontuário não há agenda nem orçamento com benefício.

---

## 10. Boas-vindas: a fila de ligação

Aba **Titulares** → botão **Boas-vindas**. Serve à **recepção e à SDR**: ligar
para quem entrou, dar as boas-vindas, completar o cadastro e marcar a primeira
consulta.

- **Uma linha por pessoa** — titular e cada dependente —, agrupadas por família,
  com telefone, o que falta no cadastro e **a partir de quando cada um pode
  agendar**. Dependente sem telefone próprio mostra o do titular.
- No alto, **Carências desta empresa**: a da empresa, a do titular e a lista de
  **procedimentos com carência própria**.
- **Registrar** guarda o resultado da ligação. *"Não atendeu"* e *"pediu para
  ligar depois"* **continuam** na aba *Falta ligar*; *"falei com a pessoa"* e
  *"não quer agora"* saem. Registrar de novo na mesma pessoa **atualiza**, não
  duplica. A seta **desfaz** e devolve a pessoa para a fila.
- A aba **Todas as pessoas** mostra quem já foi contatado, com data, quem ligou
  e a observação.

> ⚠️ **A data mostrada é a carência GERAL** (empresa + titular). Procedimentos
> com carência própria aparecem na lista do topo e **não** entram na data de
> cada pessoa — como o prazo é diferente por procedimento, uma data única
> estaria errada para quase todos os casos. Quem decide na hora é o motor de
> benefícios, no orçamento.

> ⚠️ **Só aparece quem está ATIVO.** Quem saiu não recebe boas-vindas.

---

## 11. Quantidade contratada e termo de inclusão

A empresa contratou 100 e mandou 120 nomes. Os 20 a mais **não entram** até
alguém decidir — e decidir custa dinheiro, então vira documento.

**No cartão "Quantidade contratada"** (aba Titulares) você vê o que o contrato
fechou, o que os termos aceitos acrescentaram, quantos estão cadastrados e
quantas vagas restam. **Sem vagas**, ele avisa que os cadastros estão
bloqueados — o aviso aparece **antes** de alguém ser recusado.

**O cadastro além do limite é recusado** dizendo os dois números e o caminho:
*"Esta empresa já tem 100 titular(es) ativos, e o contrato fechou 100. Para
incluir mais, gere um termo de inclusão…"*.

**Incluir mais titulares** gera o **termo de inclusão** (código `TI-`):

1. Informe quantos titulares e dependentes entram.
2. O sistema calcula a diferença:
   - **Empresa por titular** → pela **tabela da empresa**, com a faixa. O termo
     mostra a mensalidade dos titulares **antes e depois** — por exemplo, *"passa
     de 3 × R$ 39,90 = R$ 119,70 para 5 × R$ 39,90 = R$ 199,50"*. Se a nova
     quantidade mudar a faixa, o preço novo vale para **todos**, e o termo diz
     isso; a diferença pode até ser **a menos**. Os **dependentes** aparecem
     pela tabela de dependentes do contrato, conforme o plano de cada família —
     sem total estimado.
   - **Empresa de valor fixo** → pela regra combinada (seção 6.6), partindo do
     que ela **paga de verdade hoje** (o valor fixo + os termos já aceitos):
     **novo valor fixo** cobra o novo fixo menos isso; **por adesão**, cada
     pessoa a mais pelo preço combinado.

   A **implantação** dos que entram também aparece no termo — é o primeiro
   pagamento deles: na empresa por titular, cada titular novo pelo preço da
   tabela depois da inclusão; na de valor fixo, o **acréscimo mensal** do termo.
   É o mesmo número que **Gerar implantação** vai cobrar.
3. **Abrir** mostra o documento, curto, pronto para PDF.
4. **Aceitar** libera exatamente aquela quantidade.

> ⚠️ **É o ACEITE que libera, não o rascunho.** Enquanto está em rascunho, os
> cadastros continuam barrados: é o aceite que a empresa vai reconhecer quando a
> diferença for cobrada.

> **Cancelar devolve as vagas** e mantém o termo no histórico, riscado.

> **O termo não repete a proposta.** Benefícios, carência e unidades continuam
> sendo os do contrato. Dois documentos dizendo a mesma coisa é um documento a
> mais para discordar do outro.

> **Termo sem valor não é aceito** (só acontece no valor fixo). Se a regra do
> excedente não foi combinada, o termo nasce com R$ 0,00 e o sistema avisa
> **junto com o sucesso** — ele existe, e existe sem valor. Ajuste a regra (na
> proposta, ou no **Acordo de cobrança** em Dados Gerais) e gere outro. Na
> empresa por titular o termo **sempre** tem valor: é a tabela.

> **"Não foi possível conferir os termos de inclusão já aceitos / o tamanho
> atual da empresa…"** — o sistema não conseguiu ler, naquele instante, um
> número de que o termo depende. **Nada foi gerado.** Tente de novo em
> instantes: um termo é documento com valor, e sai certo ou não sai.

> **Empresa sem quantidade contratada não tem trava** e o cartão nem aparece. É
> o caso de toda empresa cadastrada antes desta regra. Para passar a ter, defina
> a quantidade no **Acordo de cobrança** (Dados Gerais).

### 11.1. O teto de dependentes

O contrato pode limitar **titulares, dependentes ou os dois**. Quando há teto de
dependentes, o cartão mostra **duas linhas** — uma para cada — com as suas
vagas, e o cadastro de dependente é recusado do mesmo jeito, com a frase falando
de dependentes.

O termo de inclusão resolve os dois: informe quantos **titulares** e quantos
**dependentes** entram, e o aceite libera exatamente aquilo.

> ⚠️ **Inativar um titular devolve as vagas dos dependentes dele.** É de
> propósito: senão a empresa que trocou de funcionário ficaria travada por gente
> que não está mais no programa.

> **O teto é da empresa, não de cada titular.** O acordo combina "até 50
> dependentes"; como eles se distribuem entre as famílias é decisão dela.

---

## 12. Mensalidade, cobranças e split

### A mensalidade

Aba **Plano & Benefícios** → **Mensalidade atual**: soma titular + dependentes,
aplicando a faixa por quantidade quando houver. Os dependentes de cada família
seguem a regra combinada na proposta (seção 6.3): **individual** (cada um paga
o valor individual) ou **plano familiar** (1 paga o avulso, a partir de 2 o
pacote, acima do pacote o extra, com o tamanho de pacote combinado). O **Simulador** ao lado
recalcula com outros números, sem gravar nada.

**O contratado é o mínimo.** A mensalidade cobra o **maior** entre os titulares
cadastrados e a **quantidade contratada** (o contrato mais os termos de inclusão
aceitos). A empresa fechou 20 titulares e mandou os dados de 1? A mensalidade é
a dos **20**, pelo preço da faixa de 20 — foi o que se combinou, e o cadastro
que falta depende da empresa. Os **dependentes** entram só os de quem já está
cadastrado. A tela escreve a conta: *"20 titular(es) · R$ … — cobrada pelo
contratado: 1 cadastrado(s), 19 ainda sem cadastro"*. É o mesmo número na
ficha, no relatório, no painel (MRR) e no boleto.

> **Empresa sem quantidade contratada** (cadastrada direto, sem passar pelo
> funil) continua sendo cobrada só pelos titulares cadastrados. Para ela valer
> como as outras, informe os **Titulares contratados** em **Dados Gerais →
> Acordo de cobrança**.

> **Faltam cadastros de colaboradores.** Enquanto a empresa tiver menos
> titulares cadastrados do que contratou, um **alerta amarelo** fica no alto da
> ficha dela, em todas as abas, com os números (*"só 1 dos 20 titulares
> contratados está cadastrado"*). Ele aparece para quem gere o programa — é
> quem cobra os dados da empresa. Some sozinho quando os cadastros chegam.

**Empresa de valor fixo:** a mensalidade é **o valor fixo + os acréscimos dos
termos de inclusão aceitos** — não depende de quantos titulares estão
cadastrados. A tela escreve *"Acordo de valor fixo: R$ … + R$ … dos termos de
inclusão aceitos"*, e é esse o número que aparece na ficha, no relatório, no
painel (MRR) e na cobrança. Exemplo: fixo de R$ 5.000,00; um termo passou o
pacote para R$ 6.000,00 → a mensalidade é R$ 6.000,00 (5.000 + 1.000 do termo). O **Simulador** ao lado continua fazendo a conta por titular — ele avisa que, nesta empresa, serve só para comparar.

### As cobranças

**Por empresa:** aba **Financeiro** → **Gerar cobrança mensal**. Nasce
**Pendente**, com valor e vencimento.

> **A mensalidade não espera os cadastros.** Se a empresa ainda não mandou os
> dados dos colaboradores, a cobrança sai do mesmo jeito, **pelo contratado**
> (ou pelo valor fixo, no acordo de valor fixo). A janela de confirmação avisa
> em amarelo — *"Faltam cadastros de colaboradores. A empresa contratou 20
> titular(es) e só 1 está cadastrado"* — e, ao gerar, **quem gere o programa
> recebe um aviso no sino**: *"Cadastros pendentes no Empresarial: (empresa)"*,
> com os números e um **Abrir** que leva à aba Titulares. É **um aviso por
> empresa por mês**: gerar, cancelar e gerar de novo não repete. Na geração
> **em lote**, o resultado lista as empresas que saíram assim.
>
> **O valor pode ser ajustado depois de gerar.** A cobrança nasce Pendente e o
> **Editar** troca valor, vencimento e descrição enquanto ela não for paga.
> Hoje nenhum boleto é emitido ao gerar (seção 18).

> **A mesma mensalidade não sai duas vezes.** Se a mensalidade do mês já foi
> gerada — por esta tela ou pela cobrança de todas as empresas —, o sistema
> recusa e diz: *"A mensalidade de setembro/2026 desta empresa já foi gerada.
> Para refazê-la, cancele a atual primeiro."* A trava é do **banco**, então
> vale para qualquer caminho, inclusive dois cliques seguidos.
>
> **Empresa com mais de um documento** (CNPJ/CAEPF) recebe **um boleto por
> documento** no mesmo mês — isso é normal, e a trava deixa. O que ela barra é
> o **mesmo documento** cobrado duas vezes no **mesmo mês**.
>
> **Para corrigir uma mensalidade errada:** cancele a atual e gere de novo.
> Cobrança cancelada não conta para a trava.

> **"Não foi possível conferir o preço e os titulares da empresa agora…"** —
> o sistema não conseguiu ler, naquele instante, o preço combinado, as faixas,
> os titulares ou os dependentes. **Nada foi gerado.** Tente de novo em
> instantes. É de propósito: antes, uma falha momentânea fazia a cobrança sair
> com o preço padrão da rede ou **sem os dependentes** — mais barata ou mais
> cara, e sem ninguém perceber. O mesmo vale para o **termo de inclusão** e
> para a **proposta**: sem conseguir ler os valores, eles não são montados.
> Na geração **em lote**, a empresa aparece entre as **puladas**, com esse
> motivo.

**Empresa de valor fixo:** a implantação é **um mês do valor fixo**. Depois de
um termo de inclusão aceito, **Gerar implantação** cobra **só o acréscimo** que
o termo trouxe (a mensalidade de hoje menos o que as implantações anteriores já
cobraram), e a tela mostra a conta. Se não há acréscimo novo, o sistema **não
gera** e diz por quê. O restante desta seção vale para a empresa **por
titular**.

**A implantação não espera os cadastros.** Ao clicar em **Gerar implantação**:

- Se a empresa tem **quantidade contratada** (veio da proposta), a conta usa
  **ela**, mesmo que ainda haja menos gente cadastrada — e a tela diz isso,
  com os dois números.
- Se **não há titulares nem quantidade contratada**, a tela **pede o valor**.
- A **mensalidade** segue a mesma base (o contratado é o mínimo). A diferença:
  sem titulares **e** sem quantidade contratada, a mensalidade **não é gerada**
  — não existe valor combinado — e o sistema diz o que fazer.

**Os dependentes na implantação seguem o que a proposta combinou**, e a tela
diz qual regra vale:

- **Só os titulares** (o padrão, e o de toda empresa que fechou antes desta
  versão): a implantação **nunca** cobra dependente. Antes, com todos os
  titulares cadastrados, ela somava os dependentes cadastrados — sem ninguém
  ter combinado isso.
- **Titulares e dependentes**: com os cadastros completos, entram os
  dependentes **cadastrados**; com cadastros faltando, entra a **estimativa da
  proposta**, guardada no fechamento — do mesmo jeito que os titulares vão pela
  quantidade contratada.
- A implantação de **titulares novos** (segunda etapa, termo de inclusão)
  cobra só os titulares novos.

**Cada titular paga a implantação UMA vez — na etapa em que entra.** Quando
a empresa inclui titulares depois (pelo **termo de inclusão**), o primeiro
pagamento desses titulares novos é a implantação deles. Exemplo: empresa de
100 colaboradores aderiu com 80 e, meses depois, incluiu os outros 20. A
primeira implantação cobrou os 80; ao clicar de novo em **Gerar
implantação**, a tela cobra **só os 20** e mostra a conta: quantos a empresa
tem hoje (contratados + termos aceitos), quantos já pagaram e a diferença.

- O **preço por titular** é o da **faixa da empresa inteira** (100, no
  exemplo), não a de 20 — quem entra depois não paga mais caro por isso.
- Se **todos já pagaram**, o sistema **não gera** e diz por quê. É também o
  que impede a mesma implantação de sair duas vezes por dois cliques.
- **Cobrança cancelada não conta** como paga: se a implantação foi cancelada,
  a próxima cobra aqueles titulares de novo.
- A segunda etapa pode ser cobrada **antes** de os 20 serem cadastrados — o
  termo de inclusão aceito já basta, igual à primeira implantação.

> **Aviso em amarelo "implantação(ões) gerada(s) antes do registro":** as
> implantações feitas **antes da versão 0.72.0** não guardaram quantos
> titulares cobriram. Quando a empresa tem uma delas, a tela faz a conta do
> jeito antigo (todos) e avisa que pode estar repetindo quem já pagou.
> **Confira e use Editar para acertar o valor.** O mesmo aviso aparece quando
> a primeira implantação teve o **valor informado à mão** (sem titulares nem
> quantidade contratada): ninguém sabe quantos titulares aquele valor cobriu.

> **O vencimento e o valor são editáveis depois.** Toda cobrança ainda não paga
> tem o botão **Editar** (valor, vencimento e descrição). O vencimento padrão
> vem do **dia de vencimento** que está no cadastro da empresa, em Dados
> Gerais — mudar lá muda o padrão das próximas.

**De todas as empresas:** **Empresarial → Cobranças**. Quatro quadros (**Em
aberto**, **Vencidas**, **Pagas**, quantas estão na tela) que somam **o que
está na lista, com os filtros aplicados**. Filtros por situação, período de
vencimento e nome.

- **Dar baixa** em lote: ao terminar, o aviso diz **quantas entraram e quais
  ficaram de fora, com o motivo**. Cobrança já paga vem desabilitada.
- **Gerar mensalidades** em lote: empresa que **já tem cobrança do mês é
  pulada**, e o aviso diz quais.
- **Imprimir a lista** manda a tabela para o papel.

### O split

Ao dar baixa, o pagamento é dividido **Risarte / RisLife**. O padrão da rede é
**0% / 100% no primeiro pagamento** e **50% / 50% nas mensalidades**
(Configurações → Split de pagamento).

### Estornar uma baixa

Baixa errada acontece; o que não pode é ficar sem saída. Na linha **Paga**,
botão **Estornar**:

- **Motivo obrigatório** (mínimo 5 letras), e o sistema avisa o que vai
  acontecer antes de confirmar.
- A cobrança volta à **situação do vencimento** — *Em atraso* se já venceu,
  *Pendente* se não.
- **O pagamento e o split são apagados**, e o motivo fica gravado com o nome de
  quem estornou.
- Se a empresa tinha sido reativada por aquela baixa e continua devendo, ela é
  **suspensa de novo** — estornar não pode virar um jeito silencioso de manter
  ativa uma empresa inadimplente.
- Estornar duas vezes a mesma cobrança é recusado.

### Inadimplência

**Checar inadimplência** marca as vencidas e, passada a carência, **suspende** a
empresa. Empresa **Suspensa** tem os benefícios **bloqueados** — e o aviso
aparece na ficha do cliente e no orçamento. Quando a dívida some, a suspensão
que o **sistema** aplicou é desfeita sozinha.

---

## 13. O benefício na hora do orçamento

É aqui que o programa aparece para o paciente, e quem faz é o **Planner**, na
ficha do cliente → **Plano de Tratamento**.

1. Crie a opção e lance o procedimento.
2. O banner **★ Risarte Empresarial** aparece no alto.
3. Na opção, a linha **"Com Risarte Empresarial: R$ … · economia R$ …"** mostra
   o valor cheio e o com programa.

**O motor decide** olhando, para cada procedimento: se há benefício, se vale
para aquela pessoa (titular ou dependente), se a **carência** já passou, se a
**frequência** permite (quantas vezes a cada quantos meses), se a **unidade**
está na parceria e se a empresa está **ativa**.

**A frequência é contada pelo uso de verdade:** depois de **concluir** o
atendimento daquele procedimento, ele passa a contar como usado. Ao orçar de
novo antes do prazo, o painel do cliente mostra **"aguardando liberação"** com a
data.

**O painel do cliente** (card **★ Programa Empresarial** na ficha) mostra
economia acumulada, benefícios usados, disponíveis agora e histórico.

---

## 14. Riso+ Social

Aba **Riso+ Social** da empresa. **Pré-requisito: a empresa paga a
mensalidade dos colaboradores**, integral ou parcialmente — no modelo
**integral**, cada ficha indica um beneficiário próprio; no **parcial**, as
fichas entram no pool coletivo da rede. No modelo **titular paga** a aba
explica que a empresa não participa — e isso é regra, não defeito. O sistema
**recusa** liberar ficha para empresa que não paga ou não participa, por
qualquer caminho.

A aba tem quatro partes, na ordem do trabalho:

1. **Metas da empresa** — a participação e as metas combinadas na proposta.
   **Editar participação e metas** muda as duas (para a empresa cadastrada
   direto, ou uma renegociação).
2. **O que as metas conquistaram** — para cada meta (**Meta 1**, **Meta 2**…):
   o selo **Cumprida** ou **Ainda não**; cada condição com ✓ ou ✗ e como está
   hoje (ex.: *"19 titulares ativos (mínimo 20)"*); o período; quantas
   indicações ela **conquistou** e quantas já foram **liberadas**. O botão
   **Liberar (n)** libera uma ficha daquela meta. **O sistema conta, quem
   libera é o gestor.**
   - Meta **uma vez só**: liberada a ficha, não há mais o que liberar.
   - Meta que **renova**: a tela mostra o período atual (ex.: *"2º período,
     de 15/01/2026 a 14/01/2027"*) e conta só as fichas liberadas nele. O que
     não foi liberado num período que terminou não passa para o seguinte.
   - O comparecimento olha os **últimos 12 meses fechados** (o mês em
     andamento não entra). Sem nenhuma avaliação nesse tempo, a condição não
     vale.
   - **Mensalidades em dia** olha as mensalidades do programa que passaram do
     vencimento e não foram pagas.
   - Ficha liberada **não é recolhida** se uma condição cair depois
     (titulares que saíram, por exemplo).
   - **Liberar ficha avulsa** — para uma exceção combinada fora das metas.
   - Se aparecer *"Não foi possível medir as metas agora"*, nada foi liberado:
     tente de novo em instantes.
3. **Indicações de pessoas carentes** — **Nova indicação** registra quem a
   empresa indicou (nome, telefone, CPF se houver, por que precisa). A
   indicação entra **Em análise**:
   - **Aprovar (usa 1 ficha)** — consome uma ficha liberada e livre. Sem ficha
     livre, o botão diz isso: libere antes pelas metas.
   - **Recusar…** — pede o motivo, que fica registrado.
   - Aprovada, a pessoa é cadastrada como cliente **pela recepção, do jeito de
     sempre** (CPF, consentimento). Depois, **Vincular ao cliente pelo CPF**
     liga a indicação e a ficha ao cadastro.
4. **Fichas liberadas** — cada ficha com a situação: **Livre**, **Com
   indicação** ou **Tratamento iniciado** (botão quando o tratamento começa).
   Ficha livre pode ser removida.

> Medidas usadas: titulares e dependentes **ativos** (dependente conta só se
> o titular dele está ativo); os clientes com o selo da empresa; avaliações e
> reavaliações **já decididas** (compareceu ou faltou — agendamento que
> ninguém marcou não conta como falta); e vendas **fechadas** do Comercial e
> da venda direta, sem as canceladas.

---

## 15. Configurações da rede

**Empresarial → Configurações**. Cinco abas:

- **Preços de adesão** — os padrões da rede (titular, dependente).
- **Split de pagamento** — a divisão Risarte/RisLife.
- **Benefícios e grupos** — tudo o que o programa oferece, numa aba só, em três
  partes. No alto, os botões **Procedimentos (n)**, **Outras vantagens (n)** e
  **Grupos (n)** mostram **uma parte de cada vez** (o número é quantos há):
  - **Procedimentos** — os benefícios **padrão da rede**, que chegam nas
    propostas novas. Ficam em **blocos por especialidade** (a do cadastro de
    Procedimentos), **fechados** ao abrir a tela: clique no nome da
    especialidade para abrir ou fechar; **Abrir todas** e **Fechar todas**
    fazem isso de uma vez. Para achar rápido:
    - **Procurar procedimento…** — digite parte do nome; os blocos com
      resultado abrem sozinhos.
    - Os botões do resumo também **filtram**: **benefício(s)** (todos),
      **sem custo**, **com desconto** e **sem preço cadastrado** — este último
      mostra os procedimentos que ainda precisam de preço no cadastro.

    Cada linha mostra o **Preço** — o **normal** (o preço
    padrão do cadastro de Procedimentos), o **com benefício** (o que o
    beneficiário paga) e quanto ele **economiza** — e a coluna **Margem
    (rede)**. Quando falta cadastrar algum custo, aparece o selo **custo
    incompleto**: passe o mouse ou clique nele para ler o que falta (a margem
    mostrada é um teto otimista). Procedimento sem preço cadastrado diz
    *"sem preço cadastrado"*.
    **Adicionar benefícios** inclui **vários procedimentos de uma vez**, com as
    mesmas regras:
    1. **Marque os procedimentos.** A lista mostra **só os que ainda não têm
       benefício**, separados por especialidade e com o preço ao lado; o campo
       **Procurar** filtra, e **Marcar todos** pega a especialidade inteira (só
       o que está à vista, se houver busca). Os escolhidos aparecem embaixo,
       cada um com um **×** para tirar, e **Limpar** desmarca tudo.
    2. **Preencha as regras uma vez** — cobertura, desconto, usos, a cada
       (meses), carência e parcelas. Valem para todos os marcados.
    3. Clique em **Adicionar N benefícios**. Entram **todos ou nenhum**: se
       algum dos marcados ganhou benefício nesse meio-tempo (outra pessoa
       incluiu), a tela recusa, diz quantos, e nada é gravado — atualize a
       página e marque de novo.

    Para mudar um que já tem, use o **Editar** da linha (um por vez, o
    procedimento não muda). Com todos incluídos, o botão diz
    *"Todos os procedimentos já têm benefício"*. A aba **Plano & Benefícios**
    de cada empresa funciona igual para os benefícios próprios dela.
  - **Outras vantagens** — o que o programa oferece **além dos
    procedimentos**: desconto em parceiros, palestras na empresa, publicidade
    nas TVs da unidade, unidade exclusiva de atendimento. **Nova vantagem**
    cadastra (nome e "o que é"); o **lápis** edita; desmarcar **Disponível**
    tira a vantagem das próximas propostas e grupos. Só dá para **excluir** a
    vantagem que nunca foi usada — usada, a tela manda desmarcar *Disponível*.
    Renomear **não muda** o que uma empresa já assinou.
  - **Grupos de benefícios** — criar, editar e desligar grupos. Em **Editar os
    benefícios**, o grupo também pode trazer **outras vantagens**, com um
    detalhe sugerido que a proposta pode reescrever.
- **Proposta comercial** — validade padrão e os **blocos de texto** que saem em
  toda proposta sem texto próprio.
- **Contrato** — **A Risarte no contrato** (razão social, CNPJ, endereço,
  cidade da assinatura e quem assina pela Risarte: nome, cargo, nacionalidade,
  RG e CPF) e o **modelo de contrato da rede**, cláusula por cláusula.
  Mudar o modelo muda o contrato de toda empresa que não tem texto próprio.
  Enquanto faltar o nome, o RG ou o CPF de quem assina pela Risarte, todo
  contrato sai com essa linha em branco e a tela avisa.

### A coluna Margem

Mostra quanto sobra em cada procedimento depois do benefício, usando preço e
repasse cadastrados.

- Com desconto, mostra a margem que sobra **e** quanto o benefício custou.
- Em **Sem custo**, a margem fica **negativa** e a tela diz que o procedimento
  fica no prejuízo — porque o repasse e o material continuam sendo pagos.
- Sem repasse cadastrado, a tela avisa que a margem é um **teto otimista**.
  **Não confie no número enquanto esse aviso estiver lá.**

> ⚠️ **Rede sem benefício cadastrado = proposta nascendo vazia.** Se
> Configurações → Benefícios estiver vazio, toda proposta nova começa sem nada
> para oferecer. Vale conferir isso antes de culpar a tela da proposta.

### Desligar um grupo

O grupo some da lista de aplicar e **continua existindo**. As propostas que já o
usaram **não mudam** — elas guardam os benefícios, não um atalho para o grupo.

---

## 16. Painéis e relatórios

**Empresarial → Painel** — empresas ativas, titulares, **mensalidade (MRR)**,
**economia gerada** e funil aberto, mais a tabela por empresa.

**Funil → Painel** — os indicadores e alertas da parte comercial.

> **As perdas são contadas pelo histórico.** Empresa perdida e depois reaberta
> continua valendo uma perda para o consultor e para o canal — e, se depois
> for ganha, vale também um ganho. A taxa de ganho é ganhos ÷ (ganhos +
> perdas).

**Na empresa, aba Financeiro** — economia gerada e benefícios utilizados
daquela empresa.

> **Os relatórios da rede não expõem dado de paciente.** É exigência de LGPD, e
> é por isso que eles mostram números e não nomes.

---

## 17. Quando alguma coisa dá errado

| O que você vê | O que é | O que fazer |
|---|---|---|
| *"Esta empresa já tem N titular(es) ativos, e o contrato fechou N"* | A trava da quantidade contratada | Gere e aceite um termo de inclusão (seção 11) |
| *"O termo TI-… foi gerado SEM valor"* | A regra do excedente não foi combinada | Ajuste a proposta (seção 6.6) e gere outro |
| *"Este termo está sem valor"* ao aceitar | O mesmo caso | Idem |
| A aba Proposta com **faixa amarela** | Falta rodar uma migração no banco | Avise o Admin: o que você digitar ali não grava |
| **Ver a proposta** desligado | Falta preencher o levantamento | A tela lista o que falta |
| Benefício não aparece no orçamento | Carência, frequência, unidade, "vale para quem", ou empresa suspensa | Confira nessa ordem; o painel do cliente mostra a data de liberação |
| *"Esta empresa não tem titulares cadastrados nem quantidade contratada registrada…"* ao gerar a mensalidade | Não há número combinado para cobrar | Informe os **Titulares contratados** (Dados Gerais → Acordo de cobrança) ou cadastre os titulares |
| Alerta amarelo **"Faltam cadastros de colaboradores"** | A empresa cadastrou menos titulares do que contratou; a mensalidade é cobrada pelo contratado | Cobre da empresa os dados que faltam (seção 12) |
| Empresa **Suspensa** | Inadimplência passada da carência | Dê baixa na cobrança; a reativação é automática |
| Proposta nova chega **sem benefício nenhum** | A rede não tem benefício padrão cadastrado | Configurações → Benefícios |

> **Achou algo que não está aqui?** Use **Sistema → Problemas** e informe a
> versão que aparece no alto do manual. Relato com a versão é relato que dá para
> reproduzir.

---

## 18. O que ainda NÃO está ligado

Dizer isso é parte do manual: quem não sabe o que falta descobre no pior
momento, na frente do cliente.

- **Boleto pelo ASAAS não é emitido.** O sistema registra valor, vencimento e
  pagador; **a baixa é manual**. A função existe no código e não é chamada por
  lugar nenhum. Quando a emissão for ligada, o link entra na mesma tela.
  **Combinado para a integração:** o boleto será emitido num passo próprio
  (**Emitir boleto**), depois de a cobrança ser conferida e, se preciso,
  editada — gerar a cobrança não vai emitir o boleto sozinho.
- **Assinatura pela ZapSign** funciona por **Enviar** → **Marcar assinado**
  (simulação) enquanto as chaves não estiverem cadastradas.
- **Proposta no Gamma** depende de chave configurada; sem ela, o cartão explica
  que está desativado.
- **A implantação não tem trava no banco** (a mensalidade tem, desde a
  0.71.0). Duas pessoas clicando em **Gerar implantação** no MESMO instante
  ainda podem gerar duas; um clique depois do outro, não — o segundo é
  recusado. Se acontecer, cancele uma delas.
- **Controle por lote e baixa FIFO** não fazem parte deste módulo.

---

## 19. Glossário

- **Titular** — a pessoa da empresa que entra no programa.
- **Dependente** — quem entra pendurado num titular.
- **Lead** — a empresa enquanto está no funil, antes de fechar.
- **Levantamento** — o que a empresa tem hoje (convênio, quanto paga, quantas
  pessoas).
- **Proposta** — o que a Risarte oferece: preços, benefícios, prazos, unidades.
- **Faixa** — preço por quantidade de titulares. Vale para todos, não só para
  quem passou.
- **Carência** — o tempo até o benefício começar a valer.
- **Benefício** — o que o programa faz naquele procedimento.
- **Grupo de benefícios** — combinação pronta, reaplicável em outras propostas.
- **Implantação** — o primeiro pagamento e a entrada da empresa no ar.
- **Split** — a divisão do pagamento entre Risarte e RisLife.
- **Termo de inclusão (`TI-`)** — documento curto que acrescenta gente ao
  acordo existente.
- **Override** — valor próprio da empresa, que substitui o padrão da rede.
- **MRR** — a mensalidade recorrente somada.

---

## 20. Checklists

### Antes de mandar a proposta

- [ ] Levantamento preenchido (o documento depende dele)
- [ ] Preço do titular e faixas conferidos
- [ ] Dependentes: valores definidos
- [ ] Valor fixo por empresa? Conferir o valor — é ele que a empresa paga, com qualquer número de titulares
- [ ] **Valor fixo: se passar do contratado, combinado** (senão o termo nasce sem valor; por titular, vale a tabela)
- [ ] Benefícios com "vale para quem", frequência e carência
- [ ] Unidades da parceria e restrições por benefício
- [ ] Validade e carências
- [ ] **Abriu o documento e leu** — inclusive para conferir que nota interna não
      vazou

### Depois de fechar

- [ ] Preços de adesão no cadastro são os da proposta
- [ ] Benefícios chegaram, com o "só titular" preservado
- [ ] Carência da empresa e do titular conferidas
- [ ] Quantidade contratada conferida
- [ ] Titulares cadastrados
- [ ] **Completar cadastro** feito (senão não há prontuário)
- [ ] Fila de **Boas-vindas** iniciada
- [ ] Primeira cobrança gerada

### Toda semana

- [ ] **★ Hoje do consultor** zerado
- [ ] Cobranças vencidas olhadas
- [ ] Termos de inclusão em rascunho: aceitos ou cancelados

---

## 21. O que explicar para a empresa parceira

Este trecho é para ser **dito ou copiado** para o RH da empresa. Ele não é a
proposta — é o que evita as cinco dúvidas que sempre voltam.

**Como as pessoas entram.** A empresa manda a lista. Cada pessoa é cadastrada
como **titular**, e pode incluir **dependentes**. Depois disso a Risarte liga
para cada uma para dar as boas-vindas e marcar a primeira consulta.

**Quando começa a valer.** Existe **carência** — combinada na proposta, contada
do início do contrato e da entrada de cada pessoa. Alguns procedimentos podem
ter prazo próprio. A pessoa é informada da data dela na ligação de boas-vindas.

**O que o programa cobre.** O que está na proposta, procedimento a
procedimento: sem custo, desconto, ou não coberto — e com **quantas vezes** e
**a cada quanto tempo**. Não é plano nem convênio: não há reembolso.

**Onde é atendido.** Nas unidades da parceria, listadas na proposta. Alguns
benefícios podem valer só na unidade principal — quando é o caso, está escrito.

**Para incluir mais gente depois.** O contrato tem uma quantidade fechada. Para
passar dela, a Risarte emite um **termo de inclusão**: um documento curto,
referente ao acordo que já existe, com a diferença de valor. Assim que a empresa
aceita, os cadastros são liberados.

**Se a mensalidade atrasar.** Passado o prazo de tolerância, o programa é
**suspenso** e os benefícios ficam bloqueados até a regularização. A reativação
é automática quando a pendência é resolvida.

---

## Documentos relacionados

- `docs/risarte-empresarial/FUNIL-COMERCIAL.md` — as decisões do funil, bloco a
  bloco, com a razão de cada uma.
- `docs/risarte-empresarial/ROTEIRO-TESTE.md` — o roteiro de teste, passo a
  passo.
- `docs/risarte-empresarial/Briefing_Executavel_Risarte_Empresarial.md` — o
  briefing original.
- `docs/treinamento/manual-treinamento-riSZon.md` — o manual do sistema inteiro.
