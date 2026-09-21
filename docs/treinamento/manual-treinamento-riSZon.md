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

> **Se alguma letra sumir no modo escuro, é defeito — relate.** Até setembro de
> 2026 isso acontecia em dois lugares: as opções das caixas de seleção e os
> cartões da agenda apareciam apagados, porque a cor tinha sido escolhida para
> o tema claro. Os dois foram corrigidos, e o sistema passou a ter uma
> verificação automática que impede o problema de voltar. Se você encontrar
> outro canto assim, use a **boia** — é exatamente o tipo de coisa que só quem
> usa o sistema todo dia percebe.

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

> **O número do painel é o mesmo da tela para onde ele leva.** O resultado do
> mês no painel é o mesmo lucro líquido da DRE, do mesmo período — as duas usam
> a mesma conta, não duas parecidas.

**Na Franqueadora a tela é outra:** em vez do resultado de uma unidade, o
**resumo da rede** — quantas unidades estão no vermelho e no amarelo, quais
pedem atenção primeiro e por quê, e quanto das taxas está em aberto. Esse
resumo mostra o **retrato da última apuração dos alertas**, e diz na tela
quando ela foi; apurar na hora é botão do Painel da rede.

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

**A ficha** (clique em qualquer linha) tem **duas abas**:

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
3. Terminado o treinamento, o Admin clica **Liberar** no **riSZon** (ficha →
   aba Acesso). A partir daí ela usa o sistema real.

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

## A barra de cima

**O que você usa de dentro de qualquer tela mora no alto**, e não no menu
lateral. O menu da esquerda é só o caminho entre os módulos.

**À esquerda: "Procurar paciente".** O caminho mais curto para uma ficha:
clique (ou **Ctrl + K**), digite, escolha com as setas e abra com **Enter**.
Procura por **nome**, pelo **código** (ex.: `CAM-00001`) e pelo **CPF** —
inclusive digitando só os números, sem pontos nem traço.

> **Dois pacientes com o mesmo nome?** A lista mostra o código e a unidade de
> cada um, para você escolher sem precisar abrir as duas fichas.

**À direita, a data e a hora** — sempre no **horário de Brasília**, que é o que
o sistema usa para decidir se um horário já passou, quando uma parcela vence e a
que mês um lançamento pertence. Se o relógio do seu computador mostrar outra
coisa, quem manda é este.

**E seis desenhos:**

| | O que é |
|---|---|
| Lua / Sol | **Claro ou escuro** — troca a aparência do sistema. A escolha fica no seu computador |
| Balão de conversa | **Chat** da equipe, com o número de mensagens não lidas |
| Sino | **Notificações**, com o número de avisos não lidos |
| Triângulo | **Alertas do sistema** — o que o financeiro e o estoque estão avisando |
| Boia | **Relatar um problema** — abre um painel ao lado da tela em que você está. Dali também se chega aos relatos e respostas. **Tem número** (veja abaixo) |
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

> **Por que o triângulo não tem número.** O que é urgente já chega pelo sino: os
> alertas do financeiro disparam notificação. O triângulo é para consultar a
> lista completa quando você quiser. (Contar tudo o que ele mostra sairia caro e
> daria um número diferente do que a tela apresenta — número que não bate com a
> tela é pior que número nenhum.)

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
| Procedimentos | `/procedimentos` | Catálogo: preço, protocolo de sessões, comissionamento |
| Planos de Tratamento | `/planos` | Visão gerencial dos planos |
| Comercial | `/comercial` | Funil de negociação e fechamento |
| Financeiro | `/financeiro` | Abre no **Painel** (ver [seção 2.3](#23-a-porta-do-financeiro)); dentro dele, DRE, fluxo de caixa, contas, taxas, repasses |
| Estoque | `/estoque` | Itens, kits, saldo, inventário |
| Compras | `/compras` | Requisição, cotação, pedido, recebimento |
| PPR+ | `/ppr` | Programa de prevenção |
| Empresarial | `/empresarial` | Convênio com empresas parceiras. **Funil**: o quadro comercial de 8 fases, da captação à implantação — clicar no nome da empresa abre o levantamento, a simulação da proposta, a apresentação em PDF, o registro do envio e, no fechamento, a conferência do consultor e os passos da implantação. **Painel**: conversão fase a fase, tempo em cada fase, quem está parado e o desempenho por consultor e por canal. **Agenda**: as reuniões do programa. **Cobranças**: as de todas as empresas. **Boas-vindas**: a fila de ligação da recepção/SDR em cada empresa |
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
  auditoria.
- **Riscos:** é o único que pode apagar configuração da rede inteira. Um engano
  aqui atinge todas as unidades.
- **Depende de:** ninguém.

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
- **Não vê:** Financeiro, Compras, Comercial.
- **Riscos:** aprovar plano sem ler o orçamento. Ele vê **o total** de cada
  opção, não o preço item a item (✅ regra do LOTE F4).
- **Depende de:** Dentista Planner (que monta o plano).

#### Dentista Planner *(franqueadora)*

- **Objetivo:** transformar o caso em diagnóstico, plano e orçamento.
- **Pode:** criar plano com opções, lançar procedimentos, classificar o pilar,
  pedir aprovação, enviar ao Comercial.
- **Vê também:** Procedimentos (catálogo), Relatórios, Planos de Tratamento,
  Estoque (papel clínico).
- **Não pode:** avaliar paciente, agendar, negociar.
- **Riscos:** enviar ao Comercial sem aprovação — o sistema barra.
- **Depende de:** Coordenador (aprovação).

#### Dentista (executor) *(unidade)*

- **Objetivo:** executar o plano aprovado.
- **Menu diferente dos outros:** ✅ **não tem "Jornada"**, e ganha **Meu Dia** e
  **Minha Agenda**.
- **Pode:** ver a agenda dele, chamar o paciente, escrever o Desenvolvimento
  Clínico e concluir o atendimento; consumo avulso de estoque.
- **Não vê:** Financeiro, Comercial, Compras, Relatórios.
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
  (`canManagePurchaseRequests`), autorizar contas dentro da alçada.
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
- **Não pode:** aprovar a própria conta lançada (regra de alçada, FIN3).

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

- **Vê:** Relatórios ✅, Planos ✅, Risartanos ✅, Empresarial ✅.
- **Não vê:** Financeiro ⚠️ — `canViewFinance` **não** inclui
  `franchisor_staff`. **Ponto que merece validação** (ver lacunas).

#### Consultor RisLife *(franqueadora)*

- **Objetivo:** gerir o programa Empresarial (B2B).
- **Vê:** Empresarial ✅ (é gestor do programa).

#### TSB e ASB *(unidade)*

- **Pode:** consumo avulso de estoque ✅ (são papéis clínicos).
- **Não vê:** Financeiro, Comercial, Compras, Relatórios, Planos.

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
| Dentista Planner | não | SIM | não | não | SIM | SIM | não |
| Coordenador Clínico | não | SIM | não | não | não | SIM | não |
| Dentista | não | SIM | não | não | não | não | não |
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
| Lançar/editar dinheiro | Admin, Financeiro da Franqueadora, **Gerente** |
| Configurar financeiro da REDE | Admin, Financeiro da Franqueadora |
| Entrada e inventário de estoque | Admin, Financeiro da Franqueadora, **Gerente** |
| Consumo avulso de estoque | Os acima **+ Dentista, Coordenador, Planner, TSB, ASB** |
| Cadastrar item no catálogo | Admin, Financeiro da Franqueadora |
| Criar requisição de compra | Admin, **Gerente** |
| Mesa de negociação de compras | Admin, **Comprador** |
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
5. **Resultado esperado:** a janela fecha e o horário aparece na agenda.

> **Quem atende depende do tipo.** Numa Avaliação o sistema oferece só o
> Coordenador. Isso não é erro: é a regra da fase.

**Tarefa 3 — Receber o paciente no dia**

1. Menu **Atendimento**.
2. Botão **Registrar chegada** → confira profissional, horário e sala com o
   paciente na frente → **Confirmar chegada**.
3. **Quem chama é o profissional**, não a recepção.

**Tarefa 4 — Atender o pedido do Comercial**

Quando o Consultor não consegue realizar a apresentação (o cliente não
compareceu, pediu para remarcar), ele envia um pedido que chega no **seu sino de
avisos**: *"Agendar apresentação: «nome do cliente»"*, com o motivo. Clique no
aviso, abra a ficha e agende — o Comercial vê a nova data no cartão dele
automaticamente, e não precisa ser avisado de volta.

**Erros frequentes:** tentar cadastrar sem CPF; agendar fora do horário da
unidade; fechar o aviso modal de "agendar apresentação" clicando em *"Já
agendei"* sem ter agendado — isso afirma um fato que não aconteceu.

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
   aparece no rodapé mostrando o tempo correndo.
2. Abra a ficha → tela de avaliação (`/avaliacao/[clientId]`).
3. **Registrar consentimento** — obrigatório para **fotos, exames, vídeos e
   anamnese**. **Nada disso é coletado antes** (exigência de LGPD imposta pelo
   sistema). A **gravação de áudio da avaliação e da reavaliação** é a única
   exceção: ela não espera o consentimento, por orientação do jurídico da
   Risarte (decisão de 21/09/2026).
4. **Levantamento de informações** → escolher a ficha de anamnese → preencher →
   **Salvar anamnese**.
5. Subir fotos e exames.
6. **Enviar ao Centro de Planejamento**.

**Segunda tarefa — aprovar plano:** na ficha, aba **Plano** → expandir a opção →
**Aprovar opção** ou **Reprovar opção**.

> **Reprovar exige considerações escritas** — o sistema não deixa reprovar em
> branco (migração 0042).

**Cuidado:** você vê **o total** de cada opção, não o preço item a item. Isso é
proposital: sua aprovação é clínica, não comercial.

> **A gravação cuida de si mesma.** Ela **começa** quando você chama o paciente
> para uma avaliação ou reavaliação e **para** quando você conclui o
> atendimento — não existe mais o risco de esquecer de ligar ou de desligar. A
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
3. **Iniciar plano de tratamento** → escreva o **Diagnóstico**.
4. **Adicionar opção de tratamento** (marque uma como principal).
5. Dentro da opção, **Procedimento** → escolha do catálogo → **Item**.
6. Classifique o **pilar** (1 dos 6) → **Salvar pilar**.
7. **Enviar para aprovação do Coordenador**.
8. Aprovado, **Enviar ao Comercial**.

**Cuidados:** o sistema exige procedimentos lançados em cada opção para enviar;
plano de tratamento **não tem acréscimo** (o preço vem do orçamento aprovado);
depois de aprovado o plano fica em leitura — há **Reabrir para edição**, que
exige nova aprovação.

**Quando faltar informação para planejar**, não devolva o caso em silêncio: use
**Devolver ao Coordenador**, na aba Plano, e escreva o que falta (foto, exame,
consideração). Escolha **Conversão Clínica** quando for só dado faltando, ou
**Reavaliação** quando o caso precisar ser examinado de novo. O Coordenador
recebe o aviso com o seu motivo — sem ele, o caso volta igual.

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

### 6.5. Consultor Comercial

**Objetivo:** negociar e fechar. **Duração:** 60 minutos.

**Tarefa 1 — Enquanto a apresentação ainda não aconteceu**

Na coluna **A apresentar**, cada cartão mostra:

- **quando é a apresentação** e com quem — ou, em **vermelho**, *"Sem
  apresentação marcada"*, que é o caso que trava o funil;
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

**Cuidado:** desconto acima do teto da unidade fica **aguardando autorização**,
e a cobrança não muda até alguém autorizar.

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

**Rotinas mensais:**
1. **Fechamento de competência** (`/financeiro/fechamento`) — trava o mês.
   A conferência **não bloqueia**: ela lista pendências e o botão vira "fechar
   mesmo assim". Só a **depreciação não rodada** é alerta grave.
2. **Inventário de estoque** — a diferença encontrada vira ajuste **com motivo**.
3. **Requisição de compra** — a lista vem do que o Estoque aponta em falta.

> **Cuidado central:** no financeiro **nada se apaga**. Lançamento liquidado
> gera um **contra-lançamento** com motivo. Conferir antes de salvar vale mais
> aqui do que em qualquer outra tela.

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
| Botão **Sair** | barra lateral, rodapé | todos | Encerra a sessão |

**Evidência:** `src/app/login/login-form.tsx`; `src/app/login/actions.ts`
(`recordLogin` grava o acesso na auditoria).

### 7.2. Barra lateral (o menu)

28 itens, agrupados. O bloco **Administração** só aparece para o Admin Master e
vem **fechado**: clique no título "Administração" para abrir ou fechar (a seta
mostra como está), e o sistema lembra a sua escolha. Numa tela de administração
ele abre sozinho. Há também um botão para **minimizar** a barra (a preferência
fica guardada), e o **seletor de unidade** no alto para quem atende em mais de
uma.

No rodapé: seu nome, seu e-mail, a **versão do sistema** e o botão **Sair**.

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

**Programas:** `/ppr`, `/empresarial`.

**Administração (9 telas):** `/admin/clinicas`, `/admin/permissoes`,
`/admin/sla`, `/admin/regras-comerciais`, `/admin/agenda`, `/admin/anamnese`,
`/admin/orientacoes`, `/admin/documentos`, `/admin/chat`, `/admin/auditoria`.
O antigo `/admin/usuarios` **não existe mais**: o acesso de cada pessoa mora na
ficha dela, em `/risartanos`.

**Ajuda:** `/manual`, `/alertas`, `/problemas`.

**Outros:** `/notificacoes`, `/perfil`, `/chat`, `/relatorios`, `/documentos`.

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

Botão **Sair** no rodapé da barra lateral.

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
- Ao receber um aviso modal insistente, **não clique em "Já agendei" sem ter
  agendado** — isso afirma um fato que não aconteceu.

---

## 12. Glossário

| Termo | O que é | Exemplo no sistema |
|---|---|---|
| **Jornada** | O caminho de 7 fases do paciente | Tela "Jornada" mostra o quadro por fase |
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

**Como:** cada linha é uma permissão, cada coluna é uma função. Marque ou
desmarque e clique em **Salvar** na linha. Vale para toda a rede, e passa a
valer na próxima tela que a pessoa abrir (peça para ela recarregar).

**Três coisas para saber antes de mexer:**

1. **Você não aparece na matriz.** O Admin Master passa por cima de todas as
   permissões, sempre — senão daria para trancar a porta com a chave dentro.
2. **Desligar sempre funciona.** É seguro e imediato.
3. **Ligar** uma permissão com o selo **"o banco também decide"** (Financeiro,
   Estoque, Compras) abre a tela para a pessoa, **mas os dados podem vir
   vazios** — a regra do banco continua a mesma até ser ajustada. Se acontecer,
   é ajuste de código; peça.

**Se errar:** o botão **↺** ao lado da linha devolve ao padrão de fábrica.

**Fica registrado:** toda alteração vai para a Auditoria, com quem mudou, quando
e quais funções passaram a ter a permissão.

> ⚠️ **A permissão que você mudar aqui NÃO vai para o ambiente de treino**, e
> vice-versa. Cada ambiente tem o seu banco. Se a mudança é algo que a equipe
> vai encontrar, faça **nos dois** — leva o mesmo clique.

---

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
é a do cadastro dela.

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
