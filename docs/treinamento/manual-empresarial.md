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

**Mover o card** é feito pelo seletor no próprio card. **Abrir** leva à ficha.
Dentro dela, registre **nota/ligação** na linha do tempo — é o histórico que
sustenta a negociação três semanas depois, quando ninguém lembra do que foi
combinado por telefone.

**A agenda do comercial** (**Empresarial → Agenda**) é a agenda das reuniões e
apresentações do programa, separada da agenda clínica.

---

## 5. A ficha da empresa no funil, aba por aba

A ficha tem **cinco abas**, e ela **abre na etapa em que a empresa está** — quem
abre uma empresa em follow-up não quer reler a entrevista inicial.

**Levantamento · Proposta · Apresentação · Envio e selos · Fechamento**

Cada aba mostra embaixo do nome a sua situação (*falta 2 campos*, *modelo da
rede*, *nada enviado*, *em aberto*, *implantação 3/7*).

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

O desfecho, e os passos da implantação. Empresa **perdida** também abre aqui —
é onde está a resposta, e abrir no levantamento sugeriria que ainda há o que
preencher.

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
| 1 | **Quem paga e quanto** | modelo de pagamento, quantos entram, mensalidade, implantação |
| 2 | **Condições comerciais** | faixas por quantidade, mínimo, máximo, excedente |
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

### 6.3. Dependentes

Três formas: **individual**, **pacote familiar** (um valor cobrindo até N
pessoas, com preço do extra) e o que a negociação combinar.

> ⚠️ **A proposta NÃO soma o total dos dependentes**, de propósito. Ninguém sabe
> quantos dependentes cada família tem antes da implantação; um total estimado
> viraria promessa. O documento mostra a **tabela de valores** e diz que o total
> sai na implantação.

### 6.4. Implantação

**Valor fixo pela empresa** ou **por adesão**. No valor fixo, o documento mostra
o valor único, sem multiplicar pela quantidade.

### 6.5. Limites: mínimo e máximo

- **Mínimo** — abaixo dele a aba **avisa** (⚠️), mas **não trava**: negociação
  pode fechar abaixo, é decisão de quem vende.
- **Máximo** — acima dele a aba **impede** (⛔).
- **Valor mínimo da proposta** — avisa quanto falta, e **não trava**.

### 6.6. Se passar do contratado

O que acontece quando a empresa quiser incluir mais gente depois:

- **Por adesão** — cada pessoa a mais tem preço.
- **Novo valor fixo do pacote** — o pacote inteiro passa a valer outro valor.

> **Combine isso ANTES.** É o que permite o termo de inclusão (seção 11) nascer
> com o número pronto, em vez de virar uma renegociação do zero toda vez que
> entrar uma pessoa a mais. Sem isso, o termo nasce **sem valor** e o sistema
> avisa.

### 6.7. Vantagens e benefícios

**Incluir um procedimento** e dizer o que o programa faz com ele:

| Tipo | O que sai no documento |
|---|---|
| **Sem custo** | "Sem custo" |
| **Desconto (%)** | "30% de desconto" |
| **Desconto (R$)** | o valor abatido |
| **Não coberto** | fica de fora do programa |

Cada benefício tem ainda **quantas vezes**, **a cada quantos meses** e
**carência própria**.

**Vale para quem:** as duas caixas — *titular* e *dependente* — vêm **marcadas**.
Desmarcar as duas é recusado: benefício que não vale para ninguém não é
benefício.

**Grupos de benefícios.** Uma combinação usada com frequência pode virar grupo
(*Guardar esta combinação como grupo da rede*) e ser aplicada em outras
propostas (*Aplicar um grupo pronto*). Ao aplicar, a tela diz **quantos incluiu
e quais trocou** — e **nada é salvo até você salvar**. O grupo **substitui** o
benefício do mesmo procedimento e **mantém** os outros.

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
validade, o quadro de valores, quem paga o quê, *O que está coberto*, *Quando o
programa começa a valer*, *Onde o programa é atendido*, e a comparação com o
convênio atual.

> ⚠️ **O que NÃO pode estar lá:** interesse, chance de fechar e observações do
> consultor são **notas internas**. O documento vai para a mão da empresa.

> ⚠️ **O documento não esconde má notícia.** Se o convênio atual da empresa for
> **mais barato** que o programa, ele diz que custa mais. Proposta que esconde
> isso é descoberta na primeira conferência da empresa, e aí o problema deixa de
> ser o preço.

> **Proposta incompleta não vira documento.** Com o levantamento faltando, o
> botão fica desligado e a página recusa, listando o que falta. Ela não imprime
> "R$ 0,00" com cara de proposta.

---

## 7. Fechar o negócio

Botão **Fechar — ganho**. O sistema **cria a empresa** no cadastro e **leva a
proposta junto**:

- **Preços de adesão** — os da proposta, não os da rede.
- **Faixas por quantidade** — continuam valendo no cadastro.
- **Benefícios** — inclusive o "vale só para o titular".
- **Carência** — a da empresa e a do titular.
- **Unidades da parceria** e a restrição de cada benefício.
- **Quantidade contratada** e a regra do excedente.

Na linha do tempo do lead fica a anotação do fechamento. **Se ela disser que
algo não foi copiado, confira aquilo no cadastro** — é um aviso, não um detalhe.

---

## 8. O cadastro da empresa

Menu **Empresarial**, clique na empresa. Sete abas:

| Aba | O que tem |
|---|---|
| **Dados Gerais** | CNPJ, razão social, categoria, modelo de pagamento, vencimento, meios de pagamento, carência |
| **Documentos** | os documentos da empresa |
| **Titulares** | as pessoas do programa |
| **Plano & Benefícios** | mensalidade atual, simulador, preços de adesão, benefícios |
| **Financeiro** | cobranças, economia gerada, benefícios utilizados |
| **Riso+ Social** | as fichas sociais |
| **Contratos** | contratos e assinatura |

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
2. O sistema calcula a diferença pela regra combinada na proposta (seção 6.6).
3. **Abrir** mostra o documento, curto, pronto para PDF.
4. **Aceitar** libera exatamente aquela quantidade.

> ⚠️ **É o ACEITE que libera, não o rascunho.** Enquanto está em rascunho, os
> cadastros continuam barrados: é o aceite que a empresa vai reconhecer quando a
> diferença for cobrada.

> **Cancelar devolve as vagas** e mantém o termo no histórico, riscado.

> **O termo não repete a proposta.** Benefícios, carência e unidades continuam
> sendo os do contrato. Dois documentos dizendo a mesma coisa é um documento a
> mais para discordar do outro.

> **Termo sem valor não é aceito.** Se a regra do excedente não foi combinada na
> proposta, o termo nasce com R$ 0,00 e o sistema avisa **junto com o sucesso** —
> ele existe, e existe sem valor. Ajuste a proposta e gere outro.

> **Empresa sem quantidade contratada não tem trava** e o cartão nem aparece. É
> o caso de toda empresa cadastrada antes desta regra.

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

Aba **Plano & Benefícios** → **Mensalidade atual**: soma titular + dependentes
dos titulares **ativos**, aplicando a faixa por quantidade quando houver. O
**Simulador** ao lado recalcula com outros números, sem gravar nada.

### As cobranças

**Por empresa:** aba **Financeiro** → **Gerar cobrança mensal**. Nasce
**Pendente**, com valor e vencimento.

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

**A implantação não espera os cadastros.** Ao clicar em **Gerar implantação**:

- Se a empresa tem **quantidade contratada** (veio da proposta), a conta usa
  **ela**, mesmo que ainda haja menos gente cadastrada — e a tela diz isso,
  com os dois números.
- Se **não há titulares nem quantidade contratada**, a tela **pede o valor**.
- A **mensalidade**, essa sim, só é gerada com titulares ativos: são perguntas
  diferentes.

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

Aba **Riso+ Social** da empresa. Nos modelos **integral** e **parcial**, escolha
um gatilho e **Gerar ficha social**; depois **Atribuir** um beneficiário e
**Marcar utilizada**.

No modelo **Titular paga**, o botão explica que a empresa não participa — e isso
é regra, não defeito: não há parcela da empresa de onde tirar a ficha.

---

## 15. Configurações da rede

**Empresarial → Configurações**. Cinco abas:

- **Preços de adesão** — os padrões da rede (titular, dependente).
- **Split de pagamento** — a divisão Risarte/RisLife.
- **Benefícios** — os benefícios **padrão da rede**, que chegam nas propostas
  novas. Tem a coluna **Margem (rede)**.
- **Proposta comercial** — validade padrão e os **blocos de texto** que saem em
  toda proposta sem texto próprio.
- **Grupos de benefícios** — criar, editar e desligar grupos.

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
- [ ] Implantação: fixa ou por adesão
- [ ] **Se passar do contratado: combinado** (senão o termo nasce sem valor)
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
