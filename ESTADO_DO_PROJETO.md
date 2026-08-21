# Estado do Projeto — Risarte Odontologia (MVP RIZON)

_Atualizado em: 17/08/2026 · Versão do sistema: **0.212.0** · Última migração: **0235**_

> **FIN8.1c — DESCONTO POR PONTUALIDADE (v0.212.0, migração 0235).** Fecha os
> quatro pedidos sobre as taxas da rede.
>
> Em **Taxas da rede**, cada taxa ganhou o campo *"Desconto se pagar em dia
> (%)"*. Ele segue a mesma cascata: o padrão da rede vale, e uma unidade pode
> ter acordo próprio.
>
> **Como você escolheu:** a conta **nasce cheia** e o abatimento entra na hora
> de pagar. Em **Contas a pagar**, ao abrir a baixa de uma conta de taxa dentro
> do prazo, aparece uma faixa verde com o desconto e o valor já vem descontado.
> Marcar/desmarcar recalcula.
>
> - **O desconto é redução de despesa, não entrada de dinheiro.** A unidade não
>   ganhou nada por pagar em dia — ela gastou menos, e a DRE mostra a despesa
>   líquida.
> - **A franqueadora também recebe menos**, e o lançamento dela cai junto. Sem
>   isso, a receita da rede ficaria inflada no valor dos descontos concedidos.
> - **A tela sugere; o banco decide.** Desconto acima do concedido é recusado.
> - Incide sobre o **saldo**, não sobre o valor original: conta paga pela
>   metade fora do prazo não ganha prêmio sobre a parte atrasada.
> - Vale só para **contas de taxa da rede**. Conta de fornecedor tem desconto
>   negociado caso a caso.
>
> **545 testes** (6 novos).

> **Campanha vale para VÁRIAS taxas (v0.211.1, migração 0234).** Ao criar a
> campanha, marque **todas as taxas** ou escolha **quantas quiser** na lista.
> Antes só dava para escolher uma ou todas, e o caso comum é o meio-termo:
> "campanha de abertura: royalty e fundo pela metade, o resto normal".
>
> Campanha com taxas escolhidas **ganha** de campanha que vale para todas — o
> mais específico manda, como no resto do sistema.
>
> Se a seleção misturar taxa percentual com taxa fixa, "trocar o valor" fica
> indisponível (trocar por qual?) e a tela pede para usar **descontar do valor
> vigente**, que serve para as duas naturezas.
>
> **Excluir uma taxa que está em campanha passa a ser recusado:** se ela saísse
> sozinha da lista, a campanha ficaria sem taxa nenhuma — e campanha sem taxa
> vale para TODAS.

> **FIN8.1b — CADASTRAR TAXAS E LANÇAR CAMPANHAS (v0.211.0, migração 0233).**
> Em Financeiro › Taxas da rede.
>
> **Botão "Nova taxa".** As seis deixaram de ser uma lista fixa no sistema: você
> cadastra quantas quiser, dizendo o nome, se é percentual ou valor fixo, e as
> **duas contas do plano** (a despesa na unidade, a receita na franqueadora).
> As contas são escolhidas entre as que já existem — se faltar a certa, crie no
> Plano de contas antes.
>
> **Inativar ou excluir.** Inativar para de cobrar daqui para frente e mantém o
> histórico. Excluir **só se a taxa nunca foi cobrada**; se já tem cobrança, o
> sistema recusa e explica por quê. As seis originais podem ser inativadas, mas
> nunca apagadas.
>
> **Campanhas por período.** *"Royalty a 3% em setembro e outubro"*, *"isenção
> da taxa de sistema nos 3 primeiros meses"*. Com data de início e fim, para a
> rede inteira ou para uma unidade, e com o motivo registrado. Dois formatos:
> **trocar o valor** (zero = isenção) ou **descontar** uma porcentagem do que
> está valendo.
>
> A campanha **ganha do acordo da unidade**, que ganha do padrão da rede — e a
> faixa verde no topo da tela mostra o que está valendo hoje.
>
> **Campanha não mexe no passado:** o percentual fica congelado em cada baixa. E
> ele vale pelo **dia da baixa**, não pelo dia de hoje — baixa lançada com
> atraso cobra o que valia quando o dinheiro entrou.
>
> **535 testes** (10 novos). **Próximo: o desconto por pontualidade** (o quarto
> pedido), que mexe no pagamento dentro de Contas a pagar.

> **FIN8.1 — TAXAS DA REDE E SPLIT DE PAGAMENTO (v0.210.0, migração 0232).** Em
> Financeiro › Taxas da rede.
>
> **Seis taxas:** royalty, fundo de propaganda, centro de planejamento e
> comercial (percentuais) + taxa de sistema e SDR (valores fixos mensais).
>
> **A base é o dinheiro que entra.** Cada baixa de parcela cobra os percentuais
> sobre o valor recebido, na hora. Três coisas que isso resolve sozinho:
> desconto concedido já está embutido no que entrou; parcela que nunca foi paga
> não gera taxa; e o franqueado confere olhando o próprio extrato.
>
> **A tela de configuração** tem o padrão da rede e a exceção por unidade — e a
> linha da exceção guarda **o motivo do acordo diferente**. Configuração que
> diverge sem registro de por quê vira discussão de memória seis meses depois.
> *Desligar* uma taxa (acordo: esta unidade não paga) é diferente de *apagar* a
> exceção (volta a seguir a rede).
>
> Tem também um simulador: *"se eu receber R$ X no mês, pago R$ Y"* — inclusive
> mostrando que mês sem faturar ainda paga as taxas fixas.
>
> - **O percentual fica congelado em cada baixa.** Mudar a regra não recalcula o
>   que já foi cobrado.
> - **Cada taxa vira uma conta a pagar por mês**, que cresce conforme os
>   recebimentos entram — é por lá que ela aparece no fluxo de caixa e na DRE.
> - **Padrão da rede começa em zero**, desligado, até você definir os números.
> - **Receber nunca é recusado:** se a baixa cai num mês já fechado, a taxa vai
>   para o mês aberto, como nota que chegou atrasada.
>
> **Limite declarado:** o ASAAS ainda não está plugado, então o split **não é
> retido** — a unidade recebe tudo e paga a rede pela conta. Quando entrar, o
> mesmo cálculo vira o valor retido.
>
> **525 testes** (13 novos).

> **FIN7.4 — FECHAMENTO DE COMPETÊNCIA (v0.209.0, migração 0231).** Em
> Financeiro › Fechamento. **Fecha o FIN7.**
>
> Fechar um mês faz o sistema **recusar lançamento novo de competência** nele:
> depois de conferido, o resultado não muda mais sozinho na semana seguinte.
>
> **O que continua livre:** receber uma parcela, pagar uma conta e conciliar o
> extrato. Pagar hoje uma conta de janeiro não altera o resultado de janeiro —
> se a trava pegasse nisso, fechar o mês quebraria o trabalho da recepção no dia
> seguinte, e na prática ninguém fecharia mês nenhum.
>
> - **A unidade fecha; a Franqueadora reabre**, com motivo escrito que fica
>   registrado. Trava que quem está travado destrava sozinho vira lembrete, não
>   controle.
> - **A conferência antes de fechar não bloqueia** — mostra o que ficou pendente
>   (depreciação não rodada, contas vencidas, parcelas sem baixa, banco não
>   conciliado, sessões que não baixaram material) e o botão passa a dizer
>   *"fechar mesmo assim"*. Bloquear faria o mês nunca fechar.
> - **A depreciação é a pendência em vermelho:** fechar sem ela deixa o
>   resultado do mês subestimado, e corrigir depois exige reabrir.
> - **Não dá para fechar fora de ordem** nem mês que ainda não terminou.
> - A DRE ganha um **selo de período fechado** quando você olha um mês travado.
>
> **512 testes** (19 novos).

> **FIN7.3 — OS ALERTAS DO FINANCEIRO (v0.208.0, migração 0230).** Quatro
> avisos, verificados **todo dia às 9h**, direto na Central de Notificações
> (categoria nova, **Financeiro**):
>
> 1. **Orçamento estourando** — uma despesa já passou de 90% da meta antes de o
>    mês acabar. Só despesa: estar com 90% da meta de receita é notícia boa.
> 2. **Caixa negativo previsto** — com a data e quanto falta.
> 3. **Faturamento atrás do ponto de equilíbrio**, faltando poucos dias.
> 4. **Atraso a receber acima do limite.**
>
> **Cada aviso sai uma vez.** Ele só volta se a situação sumir e reaparecer —
> alerta que repete todo dia vira paisagem, e aí o gerente ignora inclusive o
> que importava.
>
> **Quem recebe:** gerente e franqueado **da unidade**. A franqueadora fica de
> fora de propósito: com 200 unidades seriam centenas de avisos por dia.
>
> **Os limites são seus.** Em Financeiro › Configuração, um bloco novo com os
> quatro números e um botão **Verificar agora**. A unidade ajusta os próprios
> limites; multa e juros continuam sendo regra da rede.
>
> **Correção que entrou junto:** a configuração financeira dizia funcionar em
> cascata "campo a campo", mas não funcionava — qualquer linha de unidade
> congelava multa e juros nos valores padrão, e uma mudança futura da rede nunca
> chegaria naquela unidade, sem nada na tela denunciando.
>
> **493 testes** (2 novos).

> **FIN7.1/7.2 — ORÇAMENTO E ORÇADO × REALIZADO (v0.207.0, migração 0229).** Em
> Financeiro › Orçamento, com duas vistas: **Planejar** e **Comparar**.
>
> O sistema responde o que aconteceu; o orçamento acrescenta o que **deveria**
> ter acontecido. É a diferença entre descobrir no dia 30 que o marketing
> estourou e ser avisado no dia 12.
>
> **Suas decisões:** a **unidade** monta o próprio orçamento (a franqueadora vê,
> não impõe); a meta cobre **receita e despesa**; e o realizado é por
> **competência**, o mesmo recorte da DRE.
>
> - **Diferença positiva é sempre "melhor que o previsto"** — receita acima da
>   meta e despesa abaixo dela dão o mesmo sinal. Você digita sempre valor
>   positivo; o sistema sabe se a conta soma ou subtrai.
> - **Mês e acumulado do ano lado a lado.** Quem paga o seguro anual em março
>   estoura março e fecha o ano no lugar — só o acumulado mostra isso.
> - **Farol com folga de 5%** (acima de 10%, "fora"): orçamento acertado no
>   centavo não existe, e alarme que dispara com 1% ninguém olha.
> - **Copiar o ano anterior com reajuste** ou **sugerir pela média dos últimos 3
>   meses** — nenhum dos dois apaga meta já preenchida. A sugestão é rascunho: a
>   média achata o sazonal.
> - **Limite:** orçamento por conta e mês, **sem centro de custo**.
>
> **491 testes** (17 novos).

> **FIN6.3 — PONTO DE EQUILÍBRIO E A PONTE LUCRO × CAIXA (v0.206.0, migração
> 0228).** Em Financeiro › Ponto de equilíbrio. **Fecha o FIN6.**
>
> **Quanto preciso faturar para não dar prejuízo?** A conta depende de separar
> custo que acompanha o faturamento (material, repasse, taxa do cartão,
> imposto) de custo que existe com a cadeira vazia (aluguel, salário). Essa
> separação **já estava no Plano de contas** desde o FIN0 e é **editável** —
> se uma conta estiver do lado errado, você corrige lá e o número muda junto.
>
> - **Dois pontos, não um:** o contábil inclui a depreciação; o **de caixa**
>   não. "Estou destruindo valor?" e "vai faltar dinheiro este mês?" são
>   perguntas diferentes.
> - **Margem de segurança:** quanto o faturamento pode cair antes de virar
>   prejuízo — o número que diz se o mês bom foi folga ou sorte.
> - **O dia da virada:** no ritmo do período, o dia em que o faturamento passou
>   do ponto. Virar no dia 12 ou no dia 28 é a mesma conta com folgas
>   diferentes.
> - **Se os custos variáveis comerem toda a receita**, a tela diz que não existe
>   faturamento que resolva: o problema é preço ou custo direto, não volume.
>
> **Do lucro ao caixa** — a segunda metade da tela responde "deu lucro, então
> por que o caixa caiu?". Sai do lucro e chega na variação do caixa, linha por
> linha: depreciação que não sai do bolso, vendas ainda não recebidas, despesas
> ainda não pagas, compra de bens, distribuição de lucros.
>
> **A ponte fecha por construção, não por estimativa:** cada lançamento cai num
> de três baldes (só competência, só caixa, os dois). Se sobrar um centavo sem
> explicação, **a tela avisa** em vez de esconder numa linha "outros".
>
> **474 testes** (15 novos).

> **FIN6.2 — O FLUXO DE CAIXA (v0.205.0, migração 0227).** Em Financeiro ›
> Fluxo de caixa. A DRE responde *"o mês deu lucro?"*; esta responde a outra,
> que é a que quebra clínica lucrativa: **vai faltar dinheiro, e quando?**
>
> **Realizado** vem do razão, pela data em que o dinheiro entrou ou saiu — é
> exatamente a metade que a DRE passou a ignorar na 0226. **Previsto** vem das
> parcelas e contas em aberto, pelo que **ainda falta** (valor − já pago): o
> razão guarda o valor cheio, e só o documento sabe o saldo. Cartão entra pela
> **data de liquidação**, não pelo vencimento.
>
> O que a tela mostra:
>
> - **O aviso:** o primeiro dia em que o saldo fica negativo, e de quanto. Sai
>   sempre da conta **diária** — agrupado por mês, um buraco no dia 8 coberto
>   por um recebimento no dia 25 sumiria, e é ele que faz o cheque voltar.
> - **Vencido fica FORA da projeção**, numa faixa própria: a data já falhou uma
>   vez, e contá-la de novo é como projeção de caixa mente para o lado otimista.
> - **Operacional × investimento × financiamento** — separa "a operação gera
>   caixa" de "fechou no azul porque vendeu uma cadeira".
> - **Todo período abre** até o lançamento e o documento.
> - Agrupamento por dia, semana ou mês; padrão 30 dias para trás e 90 para a
>   frente, porque o passado é a régua que diz se a projeção é plausível.
>
> **Saldo de partida** = o saldo inicial das contas bancárias (campo que a
> Conciliação já pede) mais o caixa anterior. Sem conta cadastrada começa em
> zero **e a tela avisa**.
>
> **Correção de segurança junto:** função `security definer` passa por cima do
> RLS, e a DRE e a lista de bens tinham ficado sem checagem de quem pode ler.
> Agora todas usam a mesma guarda (`can_see_clinic_finance`).
>
> **459 testes** (17 novos).

> **CORREÇÃO — A DRE SOMAVA QUASE O DOBRO (v0.204.1, migração 0226).**
> Conferência no razão contra os dados reais, antes de o teste terminar. Duas
> causas, as duas corrigidas:
>
> 1. **Liquidação não é fato gerador.** O razão grava duas linhas por venda, de
>    propósito: uma na competência (a parcela nasce) e outra no caixa (o cliente
>    paga). É o que permite DRE e fluxo de caixa lendo o mesmo razão — e a DRE
>    estava somando as duas. Parcela paga virava receita de novo; conta paga,
>    despesa de novo. Agora `receipt_cash` e `payable_cash` ficam de fora — são
>    exatamente as linhas que o **fluxo de caixa (FIN6.2)** vai ler.
>    Multa, juros, taxa de adquirente, boleto e extrato conciliado **continuam**:
>    nascem já pagos e são o único registro do fato.
> 2. **Venda cancelada continuava como receita** — 43 parcelas, R$ 10.941 de
>    receita fantasma. As contas a pagar já cancelavam o lançamento desde a
>    0194; o recebimento nunca fez. Gatilho nos dois sentidos (descancelar
>    devolve a receita), e parcela cancelada que já recebeu **mantém** a receita
>    — senão o dinheiro ficaria no caixa sem origem no resultado.
>
> **Renegociação não muda:** a parcela vira `renegociada`, não `cancelada`, e
> mantém o lançamento — a receita foi reconhecida na venda.

> **FIN6.1 — A DRE (v0.204.0, migração 0225).** A tela que responde **"o mês deu
> lucro?"** — em Financeiro › DRE.
>
> Por **competência**, como o dono decidiu: cada valor aparece no mês em que o
> fato aconteceu, não no mês em que o dinheiro entrou. A venda de março aparece
> em março mesmo que o cliente pague em junho. É isso que separa esta tela do
> fluxo de caixa, que responde outra pergunta e vem na 6.2.
>
> **Três coisas que fazem a diferença entre uma DRE que se lê e uma que se
> ignora:**
>
> - **Toda linha abre os lançamentos por trás** — a invariante do módulo desde o
>   FIN0 ("todo número chega ao documento") finalmente aparece na tela. Número
>   que não se explica não se usa para decidir.
> - **Análise vertical sobre a receita líquida** — é assim que se enxerga que o
>   material subiu de 8% para 13% mesmo com o faturamento crescendo. Sobre a
>   bruta, toda unidade pareceria mais eficiente do que é.
> - **Comparação com período do mesmo tamanho** — comparar janeiro (31 dias) com
>   fevereiro (28) mostraria uma queda de 10% que é só calendário.
>
> **Duas decisões de estrutura que evitam erro silencioso:** o sinal vem da
> direção do lançamento (entrada soma, saída subtrai), então cada subtotal é uma
> soma simples e nenhuma conta nova precisa ser cadastrada numa tabela de
> "soma/subtrai". E **estorno some dos dois lados**: filtrar só por status
> deixaria o contra-lançamento sozinho, e a receita estornada entraria como
> despesa.
>
> **Compra de bens e de estoque não aparecem na DRE** — viram ativo e entram no
> resultado aos poucos, pela depreciação e pelo consumo. A tela diz isso.
>
> **442 testes** (14 novos).

> **FIN6.0 — BENS E DEPRECIAÇÃO (v0.203.0, migração 0224).**
>
> **Comprar um bem não é gastar** — a mesma regra que já vale para o estoque.
> Uma cadeira de R$ 30 mil não afunda o mês em que foi comprada: ela entra como
> **ativo** e vira **R$ 250 por mês durante dez anos**, que é o que de fato
> custa usá-la. É essa conta que faz a DRE dizer a verdade sobre cada mês — sem
> ela, o mês da compra pareceria péssimo e os dez anos seguintes, bons demais.
>
> O dono escolheu **construir o cadastro de bens** em vez do lançamento manual
> que eu havia recomendado pelo prazo. A escolha é melhor: a DRE passa a
> consumir um número **calculado**, não digitado.
>
> **Regras travadas:**
>
> - **Depreciação linear, e a última parcela absorve o resíduo** — a mesma regra
>   das parcelas de venda. Sem ela, R$ 10.000 em 36 meses deixaria centavos
>   órfãos e o bem nunca zeraria.
> - **Começa no mês seguinte à entrada em uso** — que é diferente da data da
>   compra: equipamento comprado em dezembro e instalado em fevereiro só
>   deprecia a partir de março.
> - **Rodar duas vezes é seguro** (único por bem + mês) e **nunca deprecia além
>   do custo**.
> - **Vida útil com padrão por categoria, editável.** Padrão que ninguém pode
>   mudar vira número errado com cara de oficial.
> - **Baixa** para a depreciação e joga o valor restante no resultado — senão o
>   sistema depreciaria para sempre uma cadeira que já foi para o lixo.
>
> A tela mostra o número que a DRE vai usar: **quanto de depreciação por mês** —
> o custo fixo que a clínica carrega só por ter os equipamentos que tem, mesmo
> num mês sem gastar nada. Ele entra no ponto de equilíbrio (FIN6.3).
>
> **428 testes** (11 novos). **Próximo: FIN6.1 — a DRE.**

> **LEITURA DO XML DA NOTA FISCAL (v0.202.0, migração 0223).**
>
> **O problema não é ler a nota — é saber que item é aquele.** O fornecedor
> escreve `RESINA COMP Z350XT A2 4G 3M`; no cadastro está `Resina composta A2`.
> Nenhuma regra de texto faz um virar o outro: a mesma resina tem descrição
> diferente em cada distribuidor, e às vezes muda entre duas notas do mesmo
> fornecedor. Casar por nome seria a maneira certa de gravar material errado
> dando baixa em procedimento errado.
>
> **A saída é não usar o nome.** A nota traz códigos, e código não muda:
>
> 1. **GTIN** (código de barras) — identifica o produto **no mundo**: um
>    fornecedor novo já é reconhecido de primeira. Validado com dígito
>    verificador, porque a NF-e aceita "SEM GTIN" e alguns emissores põem lixo
>    ali — e um GTIN inválido virando chave amarraria dois produtos diferentes
>    ao mesmo item, sem ninguém perceber.
> 2. **CNPJ + código do produto** — aquele item naquele fornecedor.
> 3. **Descrição** — só **sugere**; nunca casa sozinha.
>
> **É a sua confirmação que cria o vínculo** — por isso o sistema acerta mais a
> cada nota. E o aprendizado é **da rede**: o que Cambé amarra, Londrina recebe
> pronto.
>
> A tela lê o arquivo, monta a nota (fornecedor pelo CNPJ, número, data e **os
> vencimentos, que saem das duplicatas**) e marca cada linha: *código de
> barras*, *já vinculado*, *sugestão — confira* ou *sem item*. **Nada é gravado
> antes de você confirmar**; ao confirmar, entra pela mesma porta da E4.
>
> **A mesma nota não entra duas vezes** (chave de 44 dígitos travada no banco):
> importar de novo dobraria o estoque **e** a conta a pagar. O XML fica guardado
> em bucket privado — é documento fiscal.
>
> **Padrão do nosso nome:** o que tem campo próprio não entra no nome. `Resina
> composta A2` — marca, embalagem e fator já são campos. Senão o mesmo item vira
> dois no consolidado da rede.
>
> **417 testes** (19 novos). **Fora do escopo:** download da SEFAZ (certificado
> A1), PDF/DANFE (exigiria OCR) e notas de serviço.

> **ESTOQUE E5 — INVENTÁRIO, REPOSIÇÃO E EXCESSO (v0.201.0, migração 0222).
> MÓDULO ESTOQUE COMPLETO.**
>
> **1. Inventário.** Você abre a contagem, conta a prateleira e informa o que
> achou. A **diferença não é um erro a apagar** — ela mede perda, furto, kit mal
> cadastrado e consumo fora do previsto. Por isso vira **ajuste com motivo**, ao
> lado do que o sistema esperava, e não uma correção silenciosa.
>
> **A contagem congela o esperado.** Entre contar a gaveta e aplicar a contagem
> pode ter havido um atendimento. Se o ajuste fosse *"deixe o saldo igual ao
> contado"*, ele **apagaria esse consumo legítimo**. O ajuste sai contra o que o
> sistema dizia **quando você começou a contar**.
>
> Contar e corrigir são atos diferentes: a folha fica aberta enquanto se conta e
> só vira ajuste quando aplicada — dá para descartar sem deixar rastro no saldo.
> **Sobra e falta aparecem separadas**: compensar as duas esconderia que faltou
> um item caro e sobrou um barato.
>
> **2. Lista de reposição.** O que comprar, em **embalagens** — é assim que se
> compra — e arredondado para cima: meia caixa não existe, e faltar custa mais
> que sobrar um pouco. Sem máximo definido, o alvo é o dobro do mínimo; repor só
> até o mínimo deixaria o item em alerta no dia seguinte.
>
> **3. Acima do máximo.** O alerta que faltava: falta todo mundo olha, sobra
> ninguém olha. Excesso é dinheiro parado — e, em material com validade, perda
> marcada para acontecer. A tela mostra quanto sobra e quanto isso vale.
>
> **398 testes** (10 novos). **Próximo: leitura do XML da nota fiscal.**

> **ESTOQUE E4 — A COMPRA ENTRA NA CONTABILIDADE (v0.200.0, migração 0221).**
> Até aqui o estoque andava sozinho: o material entrava e saía e o Financeiro
> não ficava sabendo. Esta etapa fecha o círculo, e é ela que faz o DRE do FIN6
> nascer certo em vez de nascer torto.
>
> **Comprar não é gastar.** A nota vira conta a pagar classificada em **6.1.01
> (Estoque de materiais)** — um ativo, que não entra no resultado. **Gastar é
> usar:** o consumo vira custo em **2.2.01**, com competência na data do
> procedimento. Sem isso, o mês da compra parece péssimo e o mês do uso parece
> ótimo.
>
> Como cada movimento também baixa o ativo, **o saldo de 6.1.01 é o valor do
> estoque** — e a tela compara os dois: *"prateleira R$ X · contabilidade R$ Y"*.
> Divergiu, algo escapou; melhor descobrir por um número do que por um balanço.
>
> **Perda não é custo de procedimento** (decisão do dono): consumo em 2.2.01,
> quebra/vencimento/inventário em **2.2.02**. Juntos, o custo dos seus
> procedimentos subiria por causa de material que caiu no chão — e o
> desperdício, que é o problema de verdade, ficaria escondido dentro do custo do
> serviço.
>
> **Uma tela só:** a nota de compra cria as entradas de estoque **e** as contas a
> pagar de uma vez, numa transação. Se a conta a pagar falhasse depois das
> entradas, o estoque subiria sem a obrigação e a conferência nunca mais
> fecharia. As parcelas têm de fechar com o total da nota.
>
> **Limites declarados:** nota com serviço junto (frete) → só as linhas de
> estoque aqui · devolução ao fornecedor fica de fora · **entrada manual não
> contabiliza** (não há documento nem obrigação), e a conferência mostra a
> diferença em vez de escondê-la · nada retroativo.

> **ENVIAR PARA USO — UM CLIQUE, UMA EMBALAGEM (v0.199.0, migração 0220).**
>
> Pedido do dono: botão rápido em cada item, e **a embalagem sai inteira**.
> *"um tubo de resina, um frasco de adesivo, um pacote de algodão, um pacote de
> sugador não deve ser retirado 1 a 1 do estoque"* — está certo: ninguém retira
> 40 sugadores da caixa, retira a caixa.
>
> A 0219 já sabia abrir embalagem, mas só para itens fracionados (resina,
> adesivo) e com o botão escondido dentro do aviso. Agora o botão **usar** fica
> em cada item que vem em embalagem, e o saldo é lido em embalagem:
>
> > **Sugador** — 2 caixas fechadas **+ 1 em uso (~35%)**
>
> **O percentual é a leitura honesta:** o rendimento já é estimado, então
> "~35% do frasco" diz mais que "7 aplicações", que sugere uma precisão que a
> conta não tem.
>
> **Regra única do consumo:** sai do que está em uso; sem nada em uso, sai do
> fechado. A exceção é o item fracionado, onde o consumo sem nada aberto fica
> negativo de propósito — é o único jeito de o sistema dizer "usaram resina sem
> ninguém ter aberto tubo nenhum". Para sugador esse aviso seria ruído.
>
> Enviar um segundo pacote para a sala **não** encerra o primeiro: o acerto da
> sobra/falta só acontece quando a embalagem é dada por encerrada. O custo
> continua igual — enviar para uso não move valor, só muda de prateleira.

> **QUEM ABRE A EMBALAGEM É GENTE (v0.198.0, migração 0219).** Correção pedida
> pelo dono, e ele está certo:
>
> *"não permitir que o sistema abra o próximo sozinho (...) pode ser que o
> sistema vai achar que acabou um produto mas ainda não acabou."*
>
> A 0218 abria a embalagem seguinte quando a conta zerava. **O erro está na
> premissa:** o consumo do kit é *estimativa* — 0,2 g de resina, 1 aplicação de
> adesivo — e estimativa não sabe se o frasco acabou. Abrir sozinho fazia o
> sistema afirmar um fato físico que ele não tem como conhecer, e o saldo de
> embalagens fechadas passava a cair por conta própria.
>
> Agora: o consumo desconta do que está em uso e **pode ficar negativo** —
> negativo aqui não é erro, é a estimativa dizendo *"pela conta este frasco já
> deveria ter acabado"*. O sistema **avisa** ("confira o que está em uso") com
> três situações: *acabando*, *deve ter acabado* e *houve consumo sem nenhuma
> embalagem aberta*. Quem olha a bancada decide, com um botão **"Abrir frasco"**.
>
> **A troca é o momento da verdade,** e é onde a estimativa se acerta com a
> realidade: a sobra (ou a falta) da embalagem anterior vira um **ajuste
> registrado com motivo**, em vez de ser arrastada para a próxima — senão o erro
> de uma contamina todas as seguintes.

> **VENDA DIRETA BAIXA · FRASCO EM USO · KIT DE ATENDIMENTO (v0.197.0, 0218).**
>
> **1. Bug, e maior do que ele viu.** Na venda direta o procedimento já nasce
> concluído: a sessão é *criada* pronta, não criada e depois concluída. Os
> gatilhos escutavam só a *mudança* de status, então nunca eram acionados.
> **O mesmo buraco estava no repasse ao dentista (FIN5):** procedimento vendido
> na venda direta nunca gerou repasse. No banco: **68 sessões concluídas por
> venda direta, zero repasses, zero baixas.** Sem apuração retroativa (decisão
> do dono). Fica a regra: *gatilho de conclusão tem de ouvir a criação — há
> fluxo que nasce concluído*.
>
> **2. "1 frasco em uso" no lugar de "2,78 ml".** Ele está certo, e o problema é
> de leitura, não de conta: ninguém tem 2,78 ml de adesivo, tem **um frasco pela
> metade**. O saldo passa a ter dois números — **fechados** e **em uso** — e o
> consumo sai do frasco aberto. Quando ele acaba, o sistema **abre o próximo** e
> registra a abertura, então o "1 em uso" nunca é um número sem origem. A conta
> do custo não mudou em nada, como ele pediu.
>
> **3. Gorro, máscara e propé — são duas coisas.**
> - **Do paciente** (gorro, propé, babador): **kit de atendimento**, baixado
>   **uma vez por atendimento**. Quem faz três procedimentos na mesma consulta
>   não usa três gorros.
> - **Do profissional** (máscara e gorro dele, que veste de manhã e tira no fim
>   do dia): item de **uso geral**. Rastrear por paciente seria trabalho diário
>   sem retorno, e o número sairia errado do mesmo jeito.
>
> **A razão de fundo:** o custo da máscara que o dentista usa o dia inteiro **já
> está na hora de cadeira** do precificador — é estrutura, como aluguel e luz.
> Rateá-la também por procedimento contaria o mesmo custo duas vezes e inflaria
> o preço sugerido sem motivo.

> **ESTOQUE E3 — A BAIXA AUTOMÁTICA (v0.196.0, migração 0217).** É a etapa que
> dá sentido ao resto: sem ela o kit é uma tabela bonita e o saldo depende de
> alguém lembrar de digitar no meio do atendimento — que é exatamente como
> controle de estoque de clínica morre.
>
> **O gancho é o mesmo do repasse ao dentista:** a sessão passa a *concluída*.
> Nenhuma tela nova para o dentista; ele conclui como já faz, e o estoque se
> move sozinho. O movimento fica marcado como *"Sessão concluída — &lt;
> procedimento&gt;"*, então dá para ir do saldo até o atendimento que o gerou.
>
> **Cinco regras travadas:**
>
> 1. **Concluir de novo não consome de novo** (índice único por sessão + item).
>    Sem isso, um duplo clique viraria estoque negativo sem ninguém entender.
> 2. **Reabrir NÃO devolve o material** — ele foi usado de verdade; devolvê-lo
>    seria inventar gaze que não está mais na gaveta.
> 3. **Nunca bloqueia o atendimento** — sem saldo fica negativo e alerta; sem
>    kit não consome e segue.
> 4. **O que não tem kit fica visível:** a tela lista *"concluídos sem baixar
>    estoque (últimos 30 dias)"*. Silêncio aqui viraria rotina, e rotina vira
>    saldo que ninguém confia.
> 5. **O consumo é o previsto, não o medido** — usou duas anestesias? o registro
>    avulso corrige, e a tela diz isso.
>
> O mesmo item em dois kits vira **uma linha só** (soma antes de baixar). **Não
> há baixa retroativa:** ninguém sabe o que foi usado nas sessões antigas, e
> inventar consumo velho estragaria o custo médio de hoje.
>
> A conta do movimento saiu para uma função interna, e a porta pública ficou só
> com a guarda de papel — o gatilho e a tela passam a usar **a mesma conta**.
>
> **Falta:** E4 (entrada por nota + conta a pagar + as duas metades do razão) ·
> E5 (mínimo, inventário, alertas) · lote · transferência entre unidades.

> **CUSTO DE MATERIAL CALCULADO, NÃO GUARDADO (v0.195.0, migração 0216).**
>
> **O dono achou o bug somando na mão:** os kits do procedimento davam R$ 17,92
> e a Precificação mostrava R$ 11,69. A diferença era exatamente a linha da
> resina (0,2 × R$ 31,125 = R$ 6,23).
>
> **A causa foi desenho meu.** Na 0213 fiz o kit *escrever* o resultado num
> campo, para não mexer nas três telas que já liam aquele campo. Mas valor
> guardado é **foto**: fica certo no instante em que é tirada e envelhece
> sozinho — e todo caminho que muda o custo passa a ter de lembrar de tirar
> outra. Um não lembrou.
>
> E o buraco era maior que o caso dele. No banco: **Cambé** com R$ 11,69
> guardado contra R$ 17,92 real; **Roteiro** com **R$ 220,00** contra R$ 0,00. O
> da Roteiro expõe o defeito estrutural: o recálculo só cobria a **clínica
> ativa**, então salvar um kit **da rede** deixava as outras unidades com o
> número velho, e nada denunciava.
>
> **A correção não foi lembrar de tirar a foto em mais lugares — foi parar de
> guardar.** O material passa a ser calculado na leitura: kits do procedimento ×
> custo médio da unidade. Não existe "velho" porque não existe foto. O campo
> continua servindo para quem informa o valor à mão (procedimento sem kit), e
> com kit ele fica travado na tela, apontando o Estoque.
>
> **Regra que fica:** não cachear número derivado de dinheiro. Recalcular custa
> milissegundos; preço formado com custo velho custa margem.
>
> Junto: **Procedimentos** mostra os kits de cada procedimento com o custo de
> cada um e "ver itens" sem sair da tela; **Estoque** abre os detalhes do kit ao
> clicar, sem entrar no modo de edição.

> **KIT COM NOME PRÓPRIO + EDITAR/INATIVAR ITEM (v0.194.0, migração 0215).**
>
> **1. O kit deixou de ser filho do procedimento.** Ele era uma lista presa a
> UM procedimento — "Kit restauração" viraria três cópias (1, 2 e 3 faces), e
> manter cópias iguais é garantia de que uma fica desatualizada sem ninguém
> perceber. Agora o kit **tem nome**, existe sozinho e **se liga a vários
> procedimentos** (você marca todos numa lista, de uma vez). E **um
> procedimento pode ter mais de um kit** — o básico ("luva, sugador, babador")
> mais o específico; sem isso, o básico seria copiado dentro de cada kit, que é
> o mesmo problema com outro nome. O custo soma os kits ligados.
>
> **Nada do que estava cadastrado se perdeu:** cada kit da 0213 virou um kit
> nomeado "Kit — &lt;procedimento&gt;", com os itens copiados e o vínculo já
> criado. As tabelas antigas só saíram depois da cópia, no mesmo script.
>
> **2. Editar item** — nome, marca, categoria, embalagem e fator. Com duas
> travas:
>
> - **Mudar o fator não mexe no saldo.** Ele já está contado em unidades de
>   consumo; 240 sugadores continuam 240. O fator novo vale para as próximas
>   entradas.
> - **Mudar a unidade de consumo é BLOQUEADO** quando há saldo ou movimento
>   (trava no banco, `UNIT_LOCKED`). Trocar "unidade" por "grama" num item com
>   240 em estoque transformaria 240 sugadores em 240 gramas de nada — e levaria
>   junto o custo de todo procedimento que usa o item.
>
> **3. Excluir = inativar** quando o item tem movimento ou está num kit (mesma
> regra do catálogo de procedimentos): ele some das listas de lançamento e o
> histórico continua inteiro. Apagar de verdade, só o que nunca foi usado.

> **ESTOQUE — EMBALAGEM × CONSUMO, LOTE E MOVIMENTO DETALHADO (v0.193.0,
> migração 0214).** Cinco pedidos do teste do dono, e dois deles eram o mesmo
> problema — o mais grave que este módulo tinha.
>
> **1. Você compra num tamanho e consome noutro.** *"Pago R$ 25,00 na caixa de
> sugadores, mas vem 100 unidades."* A 0213 tratava os dois como iguais, então
> cada sugador entrava no procedimento por **R$ 25,00** — erro de 100 vezes, e
> silencioso: o preço sugerido sairia absurdo sem nada apontar o motivo.
>
> A correção é **um conceito só**: unidade de **CONTROLE** (o que se consome) +
> **fator de conversão** da embalagem. Resolve os três casos que ele levantou:
>
> | | compra | fator | controle | custo |
> |---|---|---|---|---|
> | sugador | caixa R$ 25,00 | 100 | unidade | R$ 0,25 |
> | resina | tubo R$ 180,00 | 4 | grama | R$ 45,00/g |
> | adesivo | frasco R$ 240,00 | 20 | aplicação | R$ 12,00 |
>
> O adesivo é o que prova a escolha: ninguém mede ml de adesivo na clínica — o
> que se sabe é **rendimento** ("um frasco dá 20 restaurações"). O fator aceita
> isso sem mecanismo novo. **O saldo vive sempre na unidade de controle**; a
> entrada é lançada como está na nota e o banco converte.
>
> **2. Lote e validade são da COMPRA, não do item.** A caixa de março tem lote e
> validade diferentes da de agosto — no item, a compra nova apagaria a
> informação da anterior. Vão no movimento de entrada, junto de fornecedor e
> nota fiscal, e a tela aponta o que vence primeiro. **Limite declarado:** o
> consumo ainda não escolhe lote (decisão do dono: depois da baixa automática).
>
> **3. Cadastro completo:** marca, categoria, embalagem, fator; e, **por
> unidade**, mínimo, máximo, onde fica guardado e fornecedor habitual.
>
> **4. Unidades viraram listas fechadas** — com campo livre, "un", "und", "UN" e
> "unid" viram quatro itens no consolidado da rede.
>
> **5. Movimento com data e hora**, quem lançou, as duas versões da quantidade
> ("1 caixa a R$ 25,00 = 100 un a R$ 0,25"), lote, validade, fornecedor, nota e
> saldo depois — mais **histórico por item**.
>
> Custo unitário passou a carregar 4 casas (R$ 180,00 ÷ 7 g = 2571,4286
> centavos/g): arredondar a cada movimento erraria sempre para o mesmo lado.
> Valor total continua em centavo inteiro. **388 testes** (8 novos).

> **ESTOQUE E1+E2 (v0.192.0, migração 0213).** Cadastro, saldo, movimentos e o
> **kit do procedimento**, em `/estoque`.
>
> **O desenho parte do jeito de este módulo morrer,** que o documento base já
> registrava: *"falta de baixa no uso"*. Se alguém precisar digitar o consumo no
> meio do atendimento, em três meses o saldo não vale nada. Por isso o **kit**
> nasce junto da fundação: é dele que a baixa automática (E3) vai sair.
>
> **O saldo é projeção, nunca um número digitado.** Tudo nasce em movimentos, e
> a única porta é uma função no banco que calcula, congela e projeta de uma vez
> — assim dá para descobrir *por que* um saldo está errado, não só que está.
>
> **Custo médio ponderado**, com a saída congelada no movimento: comprar mais
> caro amanhã não reescreve o que foi usado ontem (a regra que o repasse já
> seguia). O teste trava a diferença: 10 unidades a R$ 5,00 + 90 a R$ 10,00 dá
> **R$ 9,50**, não os R$ 7,50 da média simples.
>
> **Saída não é recusada por falta de saldo** — fica negativo e avisa. Travar
> aqui seria parar atendimento por causa de cadastro. O negativo é a informação:
> faltou dar entrada em alguma nota.
>
> **O kit alimenta o preço** escrevendo no mesmo campo que o precificador, a
> margem da negociação e a venda direta já liam — nenhuma das três precisou
> mudar, e o material passa a ser custo real em vez de estimativa. Comprar mais
> caro recalcula o custo de todo procedimento que usa o item.
>
> **Compra vira estoque, não despesa** (decisão do dono): material comprado em
> janeiro e usado em março não pode afundar janeiro. Entrou o grupo **6
> (Ativos)** no plano de contas, com a natureza `asset` — a única que não entra
> na DRE. **380 testes** (20 novos).
>
> **Falta:** E3 baixa automática · E4 entrada por nota + conta a pagar · E5
> mínimo, inventário e alertas · transferência entre unidades.

> **REPASSE POR NÍVEL + TAXA MÉDIA SUGERIDA (v0.191.0, migração 0212).**
>
> **1. Júnior × sênior deixou de ser invisível.** Só existia a pergunta "quanto
> ganha o Dr. Fulano"; faltava "quanto ganha *um* sênior" — e sem ela não há
> comparativo. Agora o repasse por nível aparece em **três lugares**: quadro
> **procedimento × nível** em Repasses (célula clicável para editar), **repasse
> por nível** dentro do cadastro do procedimento, e **margem por nível** no
> precificador ("no preço de hoje: Júnior 41% · Pleno 36% · Sênior 30%").
> Como o repasse é fixo, **trocar quem executa mexe na margem sem mexer no
> preço** — um procedimento saudável na mão do júnior pode dar prejuízo na do
> sênior, e essa conta não existia em lugar nenhum.
>
> Valor em **itálico** = veio do cadastro do procedimento, não do nível. Os dois
> mostram o mesmo R$; é essa diferença que denuncia a tabela pela metade.
> As três telas usam `payout_matrix`, que aplica os **mesmos quatro degraus da
> apuração** — mostrar uma conta e gravar outra seria pior que não mostrar nada.
>
> **2. A taxa média do pagamento agora é sugerida.** O sistema já sabia a
> resposta: `taxas de adquirente ÷ recebido` nos últimos 90 dias, direto do
> razão. Botão **"Usar esta taxa"**. Quando não há taxa lançada no período, ele
> **não sugere 0%** — diz que ainda não sabe, porque 0% seria lido como "não
> pago taxa".
>
> **3. Reajuste em massa e comissão em massa mudaram para a Precificação.**
> Mexer em preço sem ver custo e margem na mesma tela é exatamente o que o
> precificador existe para impedir. O catálogo ficou com o caminho apontado.
>
> Também: `payout_rate_for` ganhou o desempate **unidade vence rede** — sem ele,
> um valor da rede criado depois passaria por cima do contrato próprio da
> unidade. Nada recalcula repasse já apurado: o valor continua congelado.

> **PRECIFICADOR (v0.190.0, migração 0211).** Aba **Precificação** em
> Procedimentos — onde o dono decidiu que ela mora, porque o preço nasce do
> procedimento e quem simula é quem conhece a clínica por dentro. Simula, vê o
> custo real e **aplica o preço ali mesmo**, sem copiar número entre telas.
>
> **A conta separa dois tipos de custo,** e confundi-los é o erro clássico da
> precificação: o **direto** (material, laboratório, repasse, cadeira) não muda
> com o preço; o **proporcional** (imposto, taxa) sobe junto com ele. Por isso o
> preço sugerido usa markup — `custo ÷ (1 − imposto − taxa − margem)` — e não
> "custo + margem".
>
> Está travado em teste com o exemplo do porquê: custo R$ 200, imposto 6%, taxa
> 3%, margem 40%. "Custo + 40%" daria R$ 280 — que entrega **19,6%** de margem
> real, menos da metade do pretendido. A fórmula devolve **R$ 392,16**, que
> entrega os 40% de verdade.
>
> O custo de material também alimenta a **margem da negociação**, fechando o
> buraco declarado no FIN5. **360 testes.**
>
> **Limite:** não é controle de estoque — é o custo **padrão** informado por quem
> conhece a clínica. Quando o Estoque existir, ele substitui a estimativa pelo
> consumo real, sem mudar a estrutura. A tela avisa o que ficou de fora da conta
> (sem tempo de cadeira, sem custo-hora, sem repasse cadastrado).

> **FIN5 — REPASSE AO DENTISTA + ALERTA DE MARGEM (v0.188.0, migração 0209).**

> **FIN5 — REPASSE AO DENTISTA + ALERTA DE MARGEM (v0.188.0, migração 0209).**
>
> O repasse é **valor fixo por procedimento**, por nível do plano de carreira,
> com vigência. A apuração nasce quando a sessão é **concluída**, com
> competência na data do procedimento e **valor congelado** — reajustar a tabela
> não reescreve o que já foi produzido. O fechamento mensal aplica o **bônus
> sobre o total do período** (nunca por procedimento) e gera **duas contas a
> pagar por dentista**: fixo em 2.1.01 e bônus em 2.1.02, porque o plano de
> contas separa produção de premiação. O sistema **não paga ninguém** — quem
> paga é o Financeiro, com a alçada que já existe.
>
> **O alerta de margem** é a peça que o repasse fixo torna necessária: o
> dentista recebe o mesmo valor independente do preço fechado, então **cada real
> de desconto sai inteiro da margem**. A negociação mostra a conta ao vivo e
> avisa abaixo do mínimo — **sem bloquear**, porque o teto de desconto já é a
> trava e travar duas vezes só ensina a ignorar o aviso.
>
> **348 testes**, 11 novos só nas regras de repasse e margem.
>
> **Limites declarados:** material e laboratório **não entram** na margem (são
> do módulo de Estoque, que vem depois) — a tela diz isso em vez de apresentar
> margem incompleta como completa. Procedimento sem valor cadastrado apura
> **R$ 0,00 e aparece na lista** com aviso, em vez de sumir: silêncio aqui
> viraria dentista recebendo a menos.

> **Qual OPÇÃO o cliente comprou (v0.187.1, sem migração).** O dono abriu um
> plano com duas opções aprovadas e apresentadas, das quais o cliente comprou
> uma — e não tinha como saber qual. Precisava deduzir.
>
> Erro do meu desenho anterior: pus o código da venda no **cabeçalho do plano**,
> mas quem é comprada é a **opção**. Com duas ou três opções aprovadas, o código
> no topo não diz nada. O sistema já sabia (`plan_negotiations.option_id`) —
> só não mostrava.
>
> Agora a opção vendida traz o selo **"Comprada pelo cliente · PT-00003"** (ou
> **"Comprada — cancelada"**, em vermelho), no mesmo lugar dos selos de
> aprovação. Deduzir qual opção virou dinheiro é o tipo de dúvida que termina em
> tratamento errado executado.

> **O histórico do plano parava no Comercial (v0.187.0, migração 0208).** O dono
> abriu o Histórico de um plano já vendido E cancelado e viu quatro linhas:
> criado, enviado, aprovado, enviado ao Comercial. Depois disso, silêncio.
>
> A tabela de eventos existe desde a 0148, mas **só o clínico escrevia nela**.
> Aceite, código de venda, contrato, cobrança, pagamento, conclusão e
> cancelamento não chegavam ao histórico — quem abrisse a ficha meses depois não
> conseguiria contar a história do caso.
>
> O registro passa a ser por **gatilho**, não dentro de cada função: pega todos
> os caminhos, inclusive os que ainda vão existir, e nenhuma função nova precisa
> lembrar de registrar. Foi esquecer disso que criou o buraco. Cada evento leva
> o **código da venda** junto. Com reparo do que já aconteceu, usando a data
> verdadeira.
>
> Também: o **código da venda** aparece agora no cabeçalho de cada plano (com o
> selo **Plano cancelado** quando for o caso) e nos cartões do **Histórico do
> Comercial** — é ele que amarra plano, cobranças, termo e histórico.

> **O plano cancelado sumia de três telas (v0.186.1, sem migração).** O dono
> testou o cancelamento e achou três buracos — todos de **tela**, nenhum de
> dado: o banco estava certo (cartão em `cancelado`, negociação `cancelada`,
> código `PT-00003` intacto, paciente na Fase 6).
>
> 1. **Não aparecia no Histórico do cockpit.** A tela busca clientes das Fases 4
>    e 5 — e cancelar manda para a Fase 6/7. O caso saía da consulta inteira,
>    inclusive do Histórico, que existe justamente para guardar encerramentos.
>    Agora a busca abre exceção para quem tem cartão `cancelado`/`perdido`.
> 2. **Não havia onde ver o termo depois de efetivado.** O cartão do prontuário
>    só aparecia enquanto o termo estava em aberto; efetivado, sumia junto com o
>    link. Agora fica permanente, com **"Ver termo assinado"**.
> 3. **O plano cancelado "perdia" o código da venda.** Ele nunca foi perdido — a
>    aba Plano é que só carregava negociação `aceita`. O código amarra cobranças,
>    termo e histórico; sumir da ficha transforma o cancelamento num buraco.
>    Agora a aba mostra o código, o selo **Plano cancelado** e o link do termo.

> **Cancelar tratamento mudou de lugar — e aparecia em lugar nenhum (v0.186.0,
> migração 0207).** O dono perguntou "onde eu clico para cancelar?" e a resposta
> expôs dois erros meus.
>
> **O botão estava enterrado na tela de apresentação.** Errado por dois motivos:
> o paciente já está na Fase 5, então apresentação é passado e ninguém procura
> lá; e quem cancela é o **Gerente**, que não usa a tela do Consultor. Foi para
> o **prontuário, aba Plano** — junto do plano e das sessões, onde ele está
> quando decide. Termo em andamento aparece ali com atalho para continuar.
>
> **O cancelamento não marcava o cartão do cockpit.** A coluna "Cancelado" lê o
> `stage` do cartão, não a negociação — sem marcar, um plano cancelado sumia do
> quadro E do histórico, como se nunca tivesse existido. A 0207 marca o cartão,
> registra o evento na linha do tempo com o saldo do acerto, e repara os
> cancelamentos anteriores.
>
> O Histórico do cockpit (Aguardando iniciar / Tratamento iniciado / Cancelado /
> Perdido) **já existia** desde a 0203 — era só o cancelamento que não chegava
> lá.

> **Cancelamento de plano com TERMO ASSINADO (v0.185.0, migração 0206).** O dono
> corrigiu duas coisas da 0205 e pediu o documento.
>
> **O destino estava errado.** Eu mandava todo cancelamento para a Fase 4. Quem
> já estava em tratamento não volta para a fila comercial como caso novo: vai
> para a **Fase 6 (reavaliação com o Coordenador)** ou **Fase 7 (acompanhamento,
> com data de retorno obrigatória)** — o Gerente escolhe no ato. Quem **não**
> fechou continua na Fase 4, sem termo e sem pergunta.
>
> **A recusa por causa de dinheiro recebido saiu.** Ela existia porque não havia
> como resolver o já pago; agora existe o **termo de cancelamento**, que apura o
> acerto e é assinado pelo paciente.
>
> **Três passos, e nada é desfeito antes do último:** apurar (congela o acerto) →
> assinar → efetivar. Descartar no meio não deixa rastro no tratamento — é o que
> permite conversar com o paciente sem medo.
>
> **O acerto** (regras do dono): realizado cobrado **com o desconto** do
> contrato; multa de rescisão percentual configurável, **padrão 0%**, sobre o
> **não executado**; cliente devendo vira cobrança nova, clínica devendo vira
> conta a pagar em 1.9.03 com a forma decidida no Financeiro. Sessão concluída
> nunca é desfeita.
>
> O termo (`/cancelamentos/[id]/termo`) traz realizado, pendente, pago, estorno
> anterior, devido e o resultado, e **cita o contrato de origem** (`PT-`, data do
> fechamento). **337 testes**, 9 deles só na conta do acerto.
>
> **Limite declarado:** o sistema **não lê o contrato assinado** — não há texto
> armazenado. Ele aplica as regras configuradas e cita o documento; divergência
> é conciliada por gente, nas observações do termo.

> **Cancelar venda do Comercial + plano sem acréscimo (v0.184.0, migração
> 0205).** As duas assimetrias que faltavam do comparativo.
>
> **Cancelar** desfaz as sessões não realizadas e as cobranças em aberto, e
> devolve o cliente à **Fase 4** — de onde ele pode ser renegociado ou marcado
> como perdido, sem refazer avaliação e planejamento. **Com recebimento, não
> cancela** (`HAS_RECEIPTS`): dinheiro que entrou sai por estorno ou
> renegociação. É ato de **Gerente/Admin**, com motivo obrigatório.
>
> *Limite conhecido:* o benefício do programa **não** volta no cancelamento do
> Comercial (na venda direta volta). O consumo em `ppr_benefit_usages` não
> guarda vínculo com a negociação — nasce no atendimento, não no fechamento.
> Inventar o vínculo agora devolveria benefício errado; fica como pendência.
>
> **Plano de tratamento não tem acréscimo.** Trava no banco
> (`SURCHARGE_NOT_ALLOWED`), campo removido da tela e ajustes positivos antigos
> zerados. A venda direta mantém acréscimo, restrito ao Gerente.
>
> **E o aviso que faltava:** o dono deu baixa num cartão e não viu taxa nenhuma.
> Não era falha do cálculo — a adquirente que atende a unidade (Asaas rede) só
> tinha taxa de **boleto** cadastrada, e o sistema pulava **em silêncio**. O
> silêncio era decisão minha do FIN4c e estava errada: agora a baixa avisa
> *"a taxa não foi lançada: não há taxa de X cadastrada"*. Cadastro incompleto
> continua não derrubando a baixa, mas para de esconder despesa.

> **FIN4c — a taxa da adquirente nunca era lançada (v0.183.0, migração 0204).**
> Descoberto ao conferir o teste do boleto: `apply_acquirer_fee` existia no
> banco, a action existia no código e **nenhuma tela as chamava**. Na prática,
> toda baixa no cartão deixava de registrar a despesa da maquininha (2.4.01) e a
> data em que o dinheiro cai — o FIN4b estava pela metade.
>
> - **A baixa aplica a taxa sozinha.** A modalidade vem do **meio da baixa**,
>   não do meio da venda: parcela de boleto paga por PIX no balcão custou o PIX.
> - **Sem taxa cadastrada, a baixa não falha** — segue sem taxa. Erro aqui
>   assustaria a recepção por um problema que é de cadastro.
> - **O estorno reverte a taxa** (migração 0204), com a direção invertida: o
>   contra-lançamento antigo era "saída" fixa, o que dobraria a despesa em vez de
>   anulá-la. A taxa de **emissão de boleto não volta** — o banco cobrou por
>   emitir, e isso independe da baixa.
> - A tela mostra **taxa · líquido · data em que cai**, no aviso da baixa e no
>   histórico da cobrança.
>
> **328 testes.** Não lança retroativamente a taxa das baixas antigas: reescrever
> razão do passado é o que o módulo proíbe.
>
> **Teste do boleto (FIN4b.2) confirmado no banco:** 1 lançamento de taxa
> (R$ 1,99, origem `boleto_issue`), nenhum na baixa. **Não cobrou duas vezes.**

> **Entrou dinheiro numa venda que nunca foi fechada (v0.182.0, migração
> 0203).** O dono tentou fechar um plano e recebeu *"Esta venda já tem
> recebimento… o plano de cobrança não pode mais ser reescrito"*. O banco
> explicou:
>
> | PT-00003 | |
> |---|---|
> | Situação | Em negociação — **nunca aceita** |
> | Registro de fechamento | **não existe** |
> | Cobranças / baixas | 11 / 4 — **R$ 869,00 recebidos** |
>
> A trava que ele encontrou estava **certa** (reescrever cobrança já paga
> apagaria histórico). O problema era outro: a **regra de ouro** — *só é venda
> com documentos assinados E pagamento confirmado* — estava na documentação e na
> tela, mas **não no banco**. As cobranças nascem quando o plano de pagamento é
> salvo, ainda em negociação, e a aba Financeiro aceitava baixa nelas.
>
> Três correções:
>
> 1. **Baixa só com a venda fechada** (decisão do dono). Gatilho em
>    `payment_receipts` levanta `SALE_NOT_CLOSED`. Estorno e cobrança de
>    renegociação passam — desfazer não se bloqueia, e dívida renegociada já era
>    devida. Não invalida o que já foi recebido.
> 2. **A tela diz quando a cobrança travou**, com o caminho certo escrito
>    (renegociação na aba Financeiro), e nem tenta salvar o plano de cobrança.
> 3. **Cockpit do Consultor virou fila de trabalho**: o quadro vai até
>    *Fechamentos*; "Aguardando iniciar", "Tratamento iniciado", cancelados e
>    perdidos vão para o **Histórico**, com filtro por situação e valor da venda.
>
> Lição registrada no CLAUDE.md: **quando uma regra de negócio importa, ela mora
> no banco** — não na tela nem na documentação.

> **Paridade dos fluxos de venda (v0.181.0, migração 0202).** Duas das quatro
> assimetrias do comparativo, escolhidas pelo dono:
>
> **1. Desconto automático à vista no Comercial agora é do servidor.** Era
> calculado pela TELA; o servidor só conferia o teto. Se a tela errasse, o
> cliente **perderia os 5% em silêncio** — sem erro, sem aviso, sem ninguém
> perceber. É a mesma família do bug da venda direta, virada do avesso (lá o
> erro pelo menos travava o salvamento). Agora o servidor garante o piso nos
> dois fluxos. O desconto manual maior continua prevalecendo, e acréscimo
> lançado não é revertido pelo automático.
>
> **2. "Cobrança emitida" entrou no fechamento do Comercial.** Eram 3 passos na
> venda direta contra 2 no Comercial. Hoje seria só diferença de tela, mas é
> exatamente esse o passo que o **ASAAS** vai preencher sozinho — e o Comercial
> não teria onde encaixá-lo. Os três caminhos que geram cobrança (venda direta,
> Comercial, renegociação) agora falam a mesma língua. **A regra de ouro não
> mudou:** só contrato assinado + pagamento confirmado conclui a venda.
>
> Ficam em aberto, por decisão: **cancelar venda fechada pelo Comercial**
> (etapa própria antes do lançamento — exige decidir o que acontece com sessões
> agendadas, fase da jornada e benefício do programa) e **acréscimo em plano de
> tratamento** (recomendação: não ter; aguarda resposta do dono).

> **O sistema virava o dia às 21h (v0.180.0, migração 0201).** O dono viu uma
> parcela vencendo **hoje** já contada como atrasada, e a baixa dada em 06/08
> gravada como 07/08.
>
> **Causa, medida na hora:** às 21h45 de Londrina, `new Date().toISOString()`
> devolvia **2026-08-07**. App e banco usavam a data em **UTC**, e o Brasil está
> 3 horas atrás — das 21h à meia-noite o sistema inteiro já estava no dia
> seguinte. Nesse intervalo, parcela do dia entrava na conta de multa e juros, e
> a receita ia para o dia errado no fluxo de caixa.
>
> Correção em duas frentes: `src/lib/dates.ts` (`todayInBrazil()`) passa a ser a
> única fonte de "hoje" do app, e o **fuso do banco** vira `America/Sao_Paulo`,
> o que corrige de uma vez os ~40 usos de `current_date` nas funções do
> Financeiro. `public.today_br()` fica como forma explícita para funções novas.
> **325 testes**, incluindo o instante exato que causou o erro.
>
> **Não corrige dados já gravados:** as baixas que ficaram com 07/08 continuam
> assim — corrigir dinheiro por trás é contra a regra do módulo; o caminho é
> estornar e lançar de novo.
>
> **Revisão comparativa dos dois fluxos de venda** em
> `docs/COMPARATIVO-VENDAS.md`: o que é igual, o que difere por decisão e
> **quatro assimetrias** que parecem falha — desconto automático à vista
> calculado pela tela no Comercial (e pelo servidor na venda direta); não existe
> cancelar venda fechada pelo Comercial; passos de fechamento 3 × 2 (o
> "cobrança emitida" que o ASAAS vai preencher não existe no Comercial); e
> acréscimo só na venda direta.

> **A cobrança não sabia como seria paga (v0.179.1, migração 0200).** O dono fez
> uma venda direta em 2× no **boleto** e o botão "Registrar emissão" não
> apareceu.
>
> **Causa (confirmada no banco):** `payment_installments.payment_method` estava
> **nulo em todas as cobranças** do sistema. O meio de pagamento só existia na
> venda (`direct_sales.payment_method` = 'boleto'); a coluna da parcela só era
> preenchida se a tela mandasse um meio por cobrança — o que ela nunca faz.
> A premissa que eu usei no FIN4b.2 (a parcela sabe o meio) estava errada.
>
> Isso era maior que o botão: a aba Financeiro da ficha também deixava de
> mostrar como cada cobrança seria paga, e qualquer regra futura que dependa do
> meio (repasse, conciliação, projeção) leria nulo. Agora **a cobrança herda o
> meio da venda** ao salvar, com reparo das que já existiam — na venda direta e
> na negociação do Comercial.
>
> Também: o **meio de pagamento agora aparece no resumo** das duas telas
> ("2× de R$ 465,00 · Boleto"). Faltava nas duas — dava para ver o parcelamento
> sem saber se era boleto, PIX ou cartão, que é justamente o que muda taxa,
> prazo de liquidação e risco do benefício.
>
> E a elegibilidade do botão passou a ser **por cobrança**, olhando a adquirente
> daquela cobrança — não mais "alguma adquirente da unidade cobra na emissão".
> Duas adquirentes da mesma unidade podem cobrar em momentos diferentes (foi
> exatamente o caso no teste: Asaas da unidade no pagamento, Asaas da rede na
> emissão), e oferecer o botão na errada só daria erro.

> **FIN4b.2 — abrangência, taxa na emissão e edição de faixa (v0.179.0,
> migração 0199).** Três pedidos do dono depois do teste do FIN4b:
>
> 1. **Adquirente da rede.** O cadastro tinha dono obrigatório (uma unidade), e
>    a franqueadora que negocia uma tabela com o Asaas para a rede precisaria
>    recadastrar a mesma coisa em cada unidade — cada erro de digitação virando
>    caixa errado lá. Agora tem **abrangência**: só esta unidade / toda a rede /
>    unidades específicas. Rede e específicas são ato da **Franqueadora**; a
>    unidade vê com o selo `Rede` e não edita. Na escolha automática, **o
>    cadastro próprio da unidade ganha do padrão da rede** — quem tem contrato
>    próprio é quem paga aquela taxa. A **franquia gratuita conta por unidade**
>    (a fatura da adquirente chega por conta/CNPJ).
> 2. **Taxa de boleto na emissão.** A faixa passa a dizer se a taxa é cobrada
>    **no pagamento** ou **na emissão** — e "na emissão" é o custo que o sistema
>    perdia inteiro: boleto emitido e não pago ficava com custo zero. Na ficha,
>    a cobrança de boleto ganha **"Registrar emissão"**, que lança a despesa em
>    **2.4.01** na hora.
>
>    **A preocupação do dono virou a trava principal:** quando o ASAAS emitir
>    sozinho, o botão não pode fazer o custo ser lançado duas vezes. Então a
>    regra mora no **banco**, não na tela — a emissão recusa se a configuração
>    disser "no pagamento" (`FEE_NOT_ON_ISSUE`) ou se a baixa já cobrou; a baixa
>    **não cobra** quando a faixa diz "emissão", nem se a emissão não tiver sido
>    registrada; e a origem `boleto_issue` aponta para a **parcela** no índice
>    único do razão, então botão e webhook caem na mesma porta e o segundo
>    lançamento é impossível.
> 3. **Editar faixa de taxa.** Antes só dava para excluir — e excluir uma faixa
>    já usada apaga a explicação de números que foram ao razão. Agora: **editar**
>    (para consertar digitação, com aviso de quantas cobranças aquela faixa já
>    precificou), **encerrar a vigência** (o caminho certo quando a taxa mudou)
>    e **exclusão bloqueada** para faixa já usada (`RATE_IN_USE`, gatilho no
>    banco).
>
> **321 testes.** Adiado: **segunda via de boleto** (hoje o sistema cobra uma
> emissão por parcela; reemissão vira ação própria quando entrar).

> **Venda direta — desconto à vista aparecia sem explicação (v0.178.1, sem
> migração).** O dono lançou uma venda e viu o cabeçalho com R$ 1.596,00 e o
> painel com R$ 1.680,00, sem nada dizendo de onde vinham os R$ 84,00 — e ao
> salvar: *"A soma das cobranças precisa fechar exatamente com o valor da
> venda."*
>
> **Causa:** o SERVIDOR aplica o desconto automático à vista da regra comercial
> (5%) quando o cliente não é de programa e o pagamento é 1×; **a tela não
> aplicava**. O painel montava as cobranças sobre o valor cheio, e o banco
> recusava porque a soma não batia com o `final_cents` já descontado.
>
> Agora a prévia aplica a mesma regra do servidor, a linha do resumo diz
> **"Desconto à vista (5%)"** e um aviso explica que parcelando esse desconto
> não vale. Também: o desconto automático **não é mais relido como manual** ao
> reabrir a venda — ficava congelado e continuava valendo no parcelado.

> **FIN4b.1 — cadastro de taxas como a tabela real (v0.178.0, migração 0198).**
> O dono trouxe a tabela do Asaas e ela mostrou três buracos no modelo da 0197:
>
> 1. **Taxa fixa por transação** — "2,39% **+ R$ 0,29**", "R$ 1,99 por boleto",
>    "R$ 1,49 por PIX". Só percentual não representa a realidade: numa cobrança
>    de R$ 50 a parte fixa é a maior parte do custo (2,97% contra 2,42% numa de
>    R$ 1.000 — está em teste).
> 2. **Boleto e PIX também custam.** A 0197 só tinha modalidades de cartão, o
>    que fazia o sistema tratá-los como grátis. Agora as modalidades cobrem
>    boleto, PIX, débito, crédito à vista, crédito parcelado por faixa, cartão
>    voucher e recorrência.
> 3. **Franquia mensal** — "100 recebimentos gratuitos por mês".
>
> E o prazo passou a distinguir **dias corridos × dias úteis** ("1 dia útil" do
> boleto contra "32 dias" do cartão). **Feriado não é considerado** — não há
> calendário de feriados no sistema; em janeiro e no carnaval a data projetada
> sai otimista. Registrado como pendência.
>
> A tela mostra a prévia em **dois valores** (R$ 1.000 e R$ 50) justamente para
> a taxa fixa ficar visível. **310 testes.**
>
> **Adiado por decisão do dono:** antecipação de recebíveis (etapa própria) e
> tabela de tarifas de movimentação (transferência entra como despesa normal,
> lançada pela conciliação em 4.2.02).

> **FINANCEIRO — FIN4b: ADQUIRENTES ✅ (v0.177.0, migração 0197).** Dois erros
> que o sistema cometia todo dia com cartão: registrava o **valor cheio** (a
> maquininha desconta a taxa) e assumia que o dinheiro caía **no vencimento**
> (na prática é D+1 no débito, D+30 no crédito).
>
> Nova aba **Adquirentes**: cadastro por unidade, com **taxa e prazo por
> modalidade** (débito, crédito à vista, crédito parcelado por faixa de
> parcelas, recorrência) e **vigência** — renegociar a taxa não reescreve o que
> já foi recebido. Ao cadastrar, a tela mostra o efeito numa venda de R$
> 1.000,00: quanto entra e em que dia.
>
> A cobrança passou a guardar **`expected_settlement_date`** — quando o dinheiro
> cai de verdade. No boleto e no PIX é o próprio vencimento; no cartão é D+n da
> adquirente padrão da unidade. Sem isso a projeção 30/60/90 do DFC mentiria.
>
> Na baixa no cartão: o cliente paga o **bruto** (é o que quita a dívida dele),
> a **taxa vira despesa da unidade** (conta 2.4.01, decisão do dono) e a entrada
> de caixa passa a valer **na data da liquidação**.
>
> Regras puras em `src/lib/finance/acquirers.ts` com **301 testes** no total.
>
> **FIN4 completo.** Próximo: FIN5 — repasse de dentistas e split.

> **FIN4a — trava do extrato trocado + desfazer importação (v0.176.1, migração
> 0196).** O dono importou o **mesmo extrato em duas contas diferentes** e os
> lançamentos duplicaram. A chave anti-duplicidade da 0195 é única por CONTA —
> certo para o caso normal (duas contas podem ter movimentos iguais), mas
> deixava passar o erro real: escolher a conta errada. Resultado: o sistema
> mostrando o dobro do dinheiro.
>
> **Duas travas novas:** o OFX traz `<BANKACCTFROM><ACCTID>` — se não bate com
> o número da conta cadastrada, a importação para; e se as mesmas chaves já
> existem em **outra conta da unidade**, também para, dizendo em qual. Vale
> para CSV, que não identifica a conta. Ambas podem ser forçadas, mas aí é
> decisão consciente, com aviso na tela.
>
> **E o caminho de volta:** `Importações` lista os arquivos que entraram e
> permite **desfazer** um deles. Só apaga linha **pendente** — o que já foi
> conciliado é dinheiro conferido e exige desfazer a conciliação antes.

> **FINANCEIRO — FIN4a: CONCILIAÇÃO BANCÁRIA ✅ (v0.176.0, migração 0195).**
> Enquanto o saldo do sistema não bate com o do banco, o caixa é opinião — e a
> projeção do FIN6 mentiria.
>
> **Importa OFX e CSV.** O arquivo é lido **no navegador** (nenhum extrato sobe
> para o servidor) e chegam só as linhas limpas. No OFX o `FITID` do banco
> impede duplicar; no CSV a chave é data + valor + descrição + a ordem da
> repetição — dois pagamentos idênticos no mesmo dia continuam sendo dois.
>
> **Cada linha tem três saídas:** casar com um lançamento (o sistema sugere por
> valor exato e data próxima, mesmo dia primeiro), **lançar o que faltava** (já
> classificado e conciliado, para tarifa e rendimento) ou **ignorar com motivo**
> (transferência entre contas próprias sai do saldo do banco).
>
> Cards de **saldo pelo banco × saldo pelo sistema × diferença** — a diferença
> fica vermelha até fechar em zero. O saldo de abertura da conta é o ponto de
> partida.
>
> **Travas:** o valor tem de bater exatamente **e no mesmo sentido**
> (entrada/saída); um lançamento do razão só concilia com **uma** linha do
> extrato (índice único), senão o mesmo dinheiro fecharia duas vezes.
>
> Leitor e casamento em `src/lib/finance/reconciliation.ts` com **288 testes**
> no total — incluindo o caso que estraga conciliação: `1.234` é R$ 1.234,00,
> não R$ 1,23.
>
> **Próximo:** FIN4b — adquirentes (taxa do cartão e liquidação D+n).

> **FIN3 — tela das despesas recorrentes (v0.175.0, sem migração):** o botão
> **Recorrentes** em Contas a pagar cadastra aluguel, software e contabilidade
> (conta, centro de custo, fornecedor, valor, dia do vencimento e vigência) e
> **gera as contas do mês** com um clique. A mesma despesa nunca gera duas
> contas para o mesmo mês — índice único no banco, então clicar de novo é
> seguro. Dia 31 em mês curto cai no último dia.

> **FINANCEIRO — FIN3: CONTAS A PAGAR ✅ (v0.174.0, migração 0194).** O outro
> lado do caixa. Até aqui o sistema sabia tudo o que ENTRA e nada do que SAI —
> sem isso não existe DRE, nem fluxo de caixa, nem ponto de equilíbrio.
>
> **Toda despesa nasce classificada** (conta do plano de contas + centro de
> custo). É isso que faz a DRE fechar sozinha depois, em vez de alguém
> classificar tudo no fim do mês.
>
> **Alçada configurável** (decisão do dono): cada conta tem um modo —
> **Automática** (despesa contratada: nunca pede autorização nem olha o teto),
> **Sem autorização** (livre, mas respeita o teto) ou **Com autorização**
> (sempre exige). Cascata rede→unidade e geral→conta, com uma trava de
> governança: **a conta pesa mais que o escopo**, senão bastaria a unidade criar
> um teto geral para escapar da regra da rede sobre uma conta sensível — furo
> que os testes acharam antes de ir ao ar. **Quem lançou não autoriza a própria
> conta.**
>
> Também: fornecedores por unidade, despesas recorrentes (aluguel, software)
> que geram as contas do mês, pagamento total/parcial com estorno e motivo,
> cancelamento com motivo, e a tela com filtros por situação, período e
> fornecedor + cards de **a pagar · vencidas · a autorizar · pago no período**.
>
> **Multa e juros que NÓS pagamos são informados** (quem define é o fornecedor,
> não a nossa configuração) e vão para **4.2.01**, separados da despesa. No
> razão: competência no lançamento, caixa no pagamento. **Recepção não entra
> aqui** — pagar fornecedor não é ato de balcão.
>
> Regras puras em `src/lib/finance/payables.ts` com **269 testes** no total.
>
> **Próximo:** FIN4 — conciliação (OFX + adquirente).

> **v0.173.2 (sem migração):** a venda de origem no termo virou uma tabela com
> **valor de tabela × benefício por pagar em dia × valor contratado**, por
> procedimento e no total, mais a frase que **justifica** o "benefício perdido"
> do topo do documento — inclusive dizendo quais procedimentos ficaram sem
> custo e nunca voltam a ser cobrados.

> **v0.173.1 (sem migração):** o termo de renegociação passou a trazer as
> **vendas de origem** — código (`PT-…`/`VD-…`), tipo, data, procedimentos e
> total de cada uma — e cada cobrança substituída aparece com o código da venda
> de onde veio. O cliente reconhece o que está renegociando.

> **FIN2.4 — fechamento da renegociação (v0.173.0, migração 0193).** O dono
> pediu ZapSign + ASAAS na renegociação, "como no fechamento das vendas".
> **Correção de premissa:** o fechamento das vendas do core **não** chama
> ZapSign nem ASAAS — ele marca três etapas à mão. As integrações reais só
> existem no módulo Empresarial. Decisão do dono: a renegociação ganha o
> **mesmo fluxo manual**, para as duas entrarem juntas quando o core ganhar as
> integrações.
>
> A renegociação aplicada ganhou **Termo do acordo** (página imprimível em
> `/renegociacoes/[id]/acordo`, com a dívida apurada, as cobranças
> substituídas, o novo plano e as linhas de assinatura) e as três etapas —
> **acordo assinado / cobrança emitida / pagamento confirmado**. Assinado +
> confirmado = **acordo fechado** (a mesma regra de ouro da venda). Quem marca
> é quem atende no balcão (recepção, gerente, financeiro, admin).

> **FIN2.3 — o benefício corre risco em TODA promessa de pagamento (v0.172.0,
> migração 0192).** O dono mostrou a **VD-00038**: benefício de R$ 300,00,
> venda parcelada com vencimentos mensais, parcela 4 dias em atraso — e nada de
> benefício perdido. Conferi no banco: o cálculo estava certo (recuperável =
> R$ 300,00, já excluindo a limpeza gratuita). **O errado era a regra que eu
> escrevi na 0188:** ela olhava o RÓTULO do meio de pagamento e só aceitava
> `boleto` e `credito_recorrente`. A venda foi fechada em **PIX parcelado** —
> mesmo risco de um boleto. O critério do dono sempre foi o **risco**, não o
> nome: agora toda cobrança corre risco, **exceto no cartão**, onde a
> adquirente já garantiu o dinheiro.
>
> Também: o resumo da venda mostra **as cobranças dela e qual foi a clicada**
> ("você clicou na 2ª de 4"), e a aba ganhou **filtro por documento** (PT/VD/RN)
> para cliente com várias vendas.

> **FIN2.2 — código no fechamento + detalhe da renegociação (v0.171.0,
> migração 0191).**
>
> **Bug de capacidade encontrado por uma pergunta do dono** ("e quando passar de
> 99.999?"): o `lpad` do Postgres **TRUNCA** quando o número é maior que o
> tamanho pedido — `lpad('100000', 5, '0')` devolve `'10000'`. Na venda de
> número 100.000 o código sairia repetido, bateria no índice único e **o
> fechamento da venda falharia**. Não era "parar de contar", era quebrar. Agora
> o preenchimento é o maior entre 5 dígitos e o tamanho real: PT-00001 …
> PT-99999 … PT-100000 … e segue. A sequência é BIGINT — na prática não acaba.
>
> **O código nasce no FECHAMENTO**, não na criação: plano de tratamento em
> `aceita`, venda direta em `concluida` (assinado + pago). Negociação perdida
> não queima número. Os códigos dados pela 0190 a vendas que nunca fecharam
> foram devolvidos.
>
> **O código aparece** na venda direta, no painel de Negociação e em cada
> cobrança da ficha. **A renegociação detalhada:** clicando no `RN-…` aparecem
> as cobranças substituídas (parcela, vencimento, valor, código da venda de
> origem e quanto já fora pago) e as novas cobranças que nasceram dela.

> **FIN2.1 — correção da renegociação + código da venda (v0.170.0, migração
> 0190).** No teste da 0189 o dono viu que a renegociação era gravada mas
> **nada acontecia** — as parcelas antigas não viravam `renegociada`, as novas
> não nasciam, e por isso a MESMA parcela podia ser renegociada várias vezes.
> **Causa:** `save_renegotiation` já gravava a linha com status `aplicada`, e
> `apply_renegotiation` começava com `if status = 'aplicada' then return` — a
> guarda de idempotência barrava a própria primeira aplicação. Agora a guarda
> olha `applied_at`. As renegociações que ficaram pelo caminho foram marcadas
> como **canceladas** (não aplicadas retroativamente de propósito: aplicar
> todas duplicaria dívida). Também entrou trava para cobrança que já está numa
> renegociação **aguardando autorização**.
>
> **Juros do parcelamento (Tabela Price):** a renegociação ganhou o campo
> *Juros ao mês (%)*. Quanto mais tempo o cliente leva para quitar, mais paga —
> e o valor aparece antes de salvar. Entra no razão como receita financeira
> (4.1.01), separado do desconto.
>
> **Código da venda:** cada plano de tratamento (**PT-00001**), venda direta
> (**VD-00001**) e renegociação (**RN-00001**) tem código único. Ele aparece na
> cobrança e **abre o resumo**: procedimentos, preço de tabela, benefício
> aplicado e total — ou, na renegociação, a composição da dívida.

> **FINANCEIRO — FIN2: RENEGOCIAÇÃO ✅ (v0.169.0, migração 0189).** Na aba
> Financeiro da ficha, marcar as cobranças → **Renegociar**. A tela apura a
> dívida de hoje (o que falta das parcelas + benefício perdido + multa + juros),
> monta o novo parcelamento no **mesmo editor de entrada + parcelas** da venda,
> e mostra o que a diferença significa: **desconto** ou **acréscimo**.
>
> **As decisões travadas (dono, 04/08/2026):** a dívida nova nasce com **tudo**
> o que é devido — nada é perdoado por acidente; o que for perdoado é
> **desconto**, tem o **mesmo teto da regra comercial da unidade** e vira
> lançamento em **1.9.02 (Descontos concedidos)**, com motivo e autor. Acima do
> teto — ou qualquer desconto do **Financeiro da Franqueadora** — a
> renegociação fica **aguardando autorização do Gerente** e as cobranças só
> mudam quando ele aprovar (notificação nos dois sentidos). Recepção não
> renegocia.
>
> **Nada se apaga:** as antigas viram `renegociada` e continuam na ficha,
> ligadas por `renegotiated_by_id`; as novas nascem com `renegotiation_id`. A
> marca de que a parcela **esteve em atraso sobrevive** — senão renegociar
> zeraria a inadimplência da unidade.
>
> **Sem contar receita duas vezes:** as cobranças novas **não** geram
> lançamento de competência (a receita do serviço já foi reconhecida pelas
> originais). Só o que é novo entra no razão: multa e juros incorporados
> (4.1.01), benefício perdido incorporado (1.1.01) e o desconto (1.9.02).
>
> **Trava nova de segurança:** `save_payment_schedule` passou a **recusar**
> reescrever o plano de cobrança de uma venda que já tem baixa, pagamento ou
> renegociação — antes, editar a venda apagava as parcelas e levava junto o
> histórico do dinheiro (cascade).
>
> Regras puras em `src/lib/finance/renegotiation.ts` com **251 testes**.
>
> **Próximo:** FIN3 — contas a pagar.

> **FIN1.1 — atraso na lista de Prontuários (v0.168.0, sem migração):** o selo
> **"N cobranças em atraso"** passou a aparecer na linha do cliente, e a barra
> de filtros ganhou **"Somente com parcela em atraso"** — a fila de cobrança da
> recepção. Só quem enxerga o financeiro do cliente (Recepção, Gerente,
> Franqueado, Financeiro da Franqueadora, Admin Master) vê o selo e o filtro.

> **FIN1.1 — ajustes do teste (v0.167.0, sem migração):** o card **Recebido**
> passou a dizer o que tem dentro (`R$ 510,00 de parcelas + R$ 4,27 de multa e
> juros`) — o número sozinho parecia faturamento; o **atraso virou selo no
> cabeçalho da ficha** ("1 cobrança em atraso"), porque a barra de abas rola e o
> selo da aba Financeiro ficava fora da tela (a aba também fica vermelha); e a
> aba ganhou **filtro de período** (Tudo / Este mês / Mês passado / Este ano /
> Período específico) que vale para as cobranças **pelo vencimento** e para o
> recebido **pela data do dinheiro**.

> **FINANCEIRO — FIN1.1: PONTUALIDADE E DETALHAMENTO DA BAIXA ✅ (v0.166.0,
> migração 0188).** Cinco correções do teste do FIN1:
>
> 1. **A baixa guarda o detalhamento.** Antes o diálogo sugeria o *saldo* e o
>    banco recusava receber mais que ele — o que o cliente pagou de multa e
>    juros não tinha onde entrar. Agora cada recebimento é gravado repartido em
>    **principal / benefício perdido / multa / juros**, e o razão recebe uma
>    linha por natureza (multa e juros vão para **4.1.01**, receita financeira).
>    O campo já abre preenchido com o **valor atualizado**.
> 2. **Perda do benefício por falta de pontualidade.** Cliente de programa
>    (PPR+ / Empresarial) que paga por **boleto ou recorrência no cartão** só
>    tem o desconto porque paga em dia: atrasou, aquela parcela volta ao preço
>    sem benefício. **Cartão parcelado e à vista não perdem** (o dinheiro já
>    entrou). **Procedimento 100% gratuito nunca é cobrado** — sai da base. O
>    valor em risco é rateado entre as parcelas e **congelado** no fechamento
>    (`benefit_discount_cents`).
> 3. **Multa e juros integrais.** Recebimento parcial estava cortando multa e
>    juros na mesma proporção (desconto disfarçado). A base passou a ser o valor
>    **cheio** da parcela até ela ser quitada. *Revisa a decisão de 31/07.*
> 4. **Sem desconto na baixa:** valor menor vira baixa **parcial**, nunca
>    quitação. Perdoar diferença é ato de **renegociação** (FIN2).
> 5. **Filtro por situação** (Todas / Em aberto / Em atraso / Pagas /
>    Canceladas / Renegociadas, com contador) e **selo vermelho na aba
>    Financeiro** com o número de cobranças vencidas.
>
> Regras puras em `src/lib/finance/receivables.ts` (`allocateReceipt`,
> `matchesFilter`, `methodRunsLateRisk`) com **239 testes** no total, incluindo
> o caso exato do print do dono (R$ 1.000 com 5 dias de atraso → R$ 1.021,67; e
> R$ 500 recebidos → R$ 521,67, não R$ 510,83).
>
> **Próximo:** FIN2 — renegociação das parcelas em atraso.

> **FINANCEIRO — FIN1: CONTAS A RECEBER ✅ (v0.165.0, migração 0187).** A ficha
> do cliente ganhou a aba **Financeiro**: resumo (em aberto / em atraso com
> multa e juros / recebido no mês), lista das cobranças com a **origem**
> (negociação × venda direta), atraso em vermelho com **dias e valor
> atualizado**, e **baixa com valor parcial** — paciente pagando metade da
> parcela é rotina em clínica.
>
> **A parcela virou documento contábil.** Ela nasce com as **taxas congeladas**
> (multa/juros/carência do momento) e **gera lançamento no razão**: competência
> na criação (DRE) e caixa a cada baixa (DFC). A aba do cliente é uma *visão*
> sobre `financial_entries`, não uma base paralela.
>
> **Baixa = tabela `payment_receipts`.** A situação da parcela deixou de ser
> digitada e passou a ser **derivada** da soma das baixas (em aberto → parcial →
> paga). Isso trouxe de graça: **idempotência** (token por baixa — duplo clique
> não vira dois recebimentos), **estorno com motivo obrigatório**
> (contra-lançamento; a baixa original fica no histórico) e o registro de quem
> recebeu. `mark_installment_paid` (telas do I9) foi reescrita para usar o mesmo
> caminho — sem duas verdades.
>
> **Quem faz o quê:** recepção e gerente **dão baixa** (a recepção recebe no
> balcão — decisão do dono); **estorno** só gerente, Financeiro da Franqueadora
> ou Admin Master. Franqueado vê, não mexe.
>
> **Regras puras** em `src/lib/finance/receivables.ts` com **8 testes novos**
> (232 no total): saldo, valor atualizado, resumo e a ordem de abatimento da
> baixa parcial (**o principal primeiro**). A parcela também guarda
> `was_overdue` — a marca de que esteve em atraso **sobrevive à renegociação**,
> senão renegociar viraria forma de zerar a inadimplência da unidade (indicador
> 9.28). *A regra de multa e juros sobre o saldo foi revista na 0188.*

> **FIN0 — escopo da unidade corrigido ✅ (v0.164.1, migração 0186):** testando
> como Gerente, o dono viu telas abertas demais. Agora: **Configuração** mostra
> só a da própria unidade (sem o padrão da rede nem as outras unidades);
> **Centros de custo** viraram leitura para a unidade — quem define a árvore é a
> Franqueadora (RLS fechada na 0186, não só a tela) — e a unidade ganhou o
> **relatório de movimento por centro** (mês, entradas/saídas, com filtro e
> destaque de lançamento sem centro); **Plano de contas** na unidade lista só as
> contas que valem para ela e **esconde a coluna "Onde vale"**. Essa coluna
> passou a ser **editável** pela Franqueadora, e a 0186 corrigiu **1.2.02
> (Risarte Empresarial — adesão e mensalidade)** de unidade para
> **franqueadora**, com o grupo 1.2 virando "ambas".

> **MÓDULO FINANCEIRO — FIN0: FUNDAÇÃO ✅ (v0.164.0, migrações 0184 + 0185).**
> Base contábil sobre a qual todas as telas financeiras serão apenas *visões*.
> Especificação em `docs/financeiro/`; regras e decisões travadas na seção 8b do
> `CLAUDE.md`.
>
> **Duas migrações, nesta ordem:** a **0184** só cria o papel
> `finance_franchisor` (o Postgres não deixa criar e usar um valor de enum na
> mesma transação — mesma armadilha da 0096/0097); a **0185** traz a fundação.
>
> **O que entrou:** `clinics.ownership` (própria × franqueada, base do Resultado
> do Grupo × Faturamento da Rede); **`chart_of_accounts`** — plano gerencial
> único, 47 contas seedadas, com **fixo × variável** desde já (é o que permite
> ponto de equilíbrio) e `fiscal_account_code` em branco para o de-para futuro;
> **`cost_centers`** — por ÁREA, com as 5 da rede seedadas, código imutável,
> centro em uso não some (só desativa) e unidade só cria filho de centro da rede
> (trava no banco); **`financial_entries`** — o razão, com competência × caixa,
> `expected_settlement_date` para a projeção do DFC, rastreio por
> `source_type`/`source_id`, estorno por contra-lançamento e imutabilidade de
> lançamento liquidado; **`finance_settings`** em cascata (multa 2% + juros 1%
> a.m., carência, arredondamento; teto de 2% travado por *check* — limite do
> CDC); **`fiscal_periods`** (estrutura do fechamento, trava efetiva no FIN6);
> helpers de RLS `is_finance_franchisor()`, `finance_visible_clinic_ids()` e
> `can_post_finance()`.
>
> **Código:** `src/lib/finance/` (money, late-fees, accounts, access) — regras
> puras com **29 testes novos** (224 no total), incluindo tabela de casos fixos
> de multa/juros e a prova de que taxas congeladas não são reescritas.
> **Telas:** `/financeiro/configuracao` (cascata, mostrando herdado × próprio,
> com exemplo ao vivo), `/financeiro/centros-de-custo` (árvore) e
> `/financeiro/plano-de-contas`. Menu lateral ganhou **Financeiro** para Admin
> Master, Financeiro da Franqueadora, Gerente e Franqueado.
>
> **Próximo:** FIN1 — aba Financeiro na ficha do cliente (contas a receber),
> com baixa **parcial**, que é rotina em clínica.

> **J11: concluir atendimento voltou a funcionar no painel ✅ (v0.163.0,
> migração 0183):** "Não foi possível concluir o atendimento", sem motivo.
> Causa: a migração 0176 criou `conclude_attendance_partial` com um argumento
> novo (`p_extra_ids`), mas a versão antiga de 3 argumentos (0105) **continuou
> existindo** — `create or replace` com assinatura diferente CRIA outra função.
> Com duas versões, a chamada de 3 argumentos do painel de Atendimento ficava
> ambígua (**PGRST203**, confirmado chamando as duas assinaturas no banco).
> Concluir pela aba *Desenvolvimento clínico* funcionava porque de lá já iam os
> 4 argumentos. A 0183 **remove a versão antiga** (e lista no log qualquer outra
> função duplicada do projeto — a mesma armadilha pode se repetir). O app passou
> a mandar sempre os 4 argumentos e a **traduzir os erros**: NOTE_REQUIRED →
> "Descreva o atendimento no Desenvolvimento clínico antes de concluir",
> NOT_ALLOWED e APPOINTMENT_NOT_FOUND com texto próprio; o caso não mapeado
> agora diz o que fazer.

> **J10: aviso de cadastro incompleto se revalida ✅ (v0.162.1, sem migração):**
> depois de completar a ficha, o agendamento continuava mostrando o aviso
> antigo. O dado estava CERTO no banco (conferido: `registration_complete =
> true`, nenhum campo vazio) — era a tela restaurada pelo navegador com o
> estado anterior. Agora, **toda vez que o agendamento abre** com um cliente
> escolhido, o cadastro é conferido de novo no servidor
> (`getClientSchedulingInfo` no `actualOpen`), e o aviso ganhou o botão **"Já
> completei — conferir"** para revalidar na hora (útil quando se completa a
> ficha em outra aba). A trava de verdade continua no servidor, que recusa
> agendar cadastro incompleto.

> **J9: SDR vê a agenda REAL da unidade + cadastro abre editável ✅ (v0.162.0,
> sem migração):** o J8 tinha dado à SDR só um resumo com profissionais e
> horário. Agora, escolhendo a unidade no filtro, ela **entra na mesma tela da
> recepcionista** — a página passa a tratar aquela unidade como a clínica da
> agenda (`sdrUnitView`): salas, fechamentos por sala/profissional, dias
> avulsos, feriados decididos, dias não úteis e horário/almoço reais, e o botão
> de agendar liberado (o papel dela fica na matriz, por isso `canSchedule`
> considera o escopo). Cabeçalho mostra o nome da unidade + link "voltar para
> todas as minhas unidades". **Cadastro incompleto:** o botão do agendamento
> agora abre a ficha **já em edição** de verdade — só a prop do servidor não
> bastava porque, em ficha já visitada, o Next serve a página do cache de
> navegação; `ClientDataSection` passou a ler `?editar=1` também no navegador
> (`useSearchParams`), com o estado derivado da URL (sem efeito colateral).

> **J8: três ajustes do teste ✅ (v0.161.0, sem migração):**
> **(1) Prontuários mostram o PPR+** — selo dourado "★ PPR+ <plano>" ao lado do
> nome (o do Empresarial já existia) e nova opção **"Somente PPR+"** no filtro
> de Programa. O dado já existia em `clients.ppr_membership_id`/`ppr_active`
> (mantidos por gatilho); faltava exibir. **(2) Agenda da SDR** — ao escolher
> uma unidade no filtro, a SDR da franqueadora passa a ver a agenda **completa**
> daquela unidade (profissionais em coluna, salas e horário de funcionamento,
> via `getUnitSchedulingData`), em vez de só a lista de agendamentos; sem
> unidade escolhida, um aviso explica que ela está vendo todas e que escolher a
> unidade abre a agenda cheia. **(3) Cadastro incompleto no agendamento** — o
> link que não abria (o dialog engolia o clique) virou **botão "Completar o
> cadastro do cliente"**, que fecha o agendamento e abre a ficha **já em modo de
> edição** (`?editar=1` → `ClientDataSection startEditing`).

> **LOTE J — J7: o benefício do programa entra no VALOR da negociação ✅
> (v0.160.0, migração 0182):** bug relatado com print — no cockpit o valor final
> **não descontava** os benefícios (cartão dizia "cobertos R$ 1.500,00" e cobrava
> os R$ 7.280,00 cheios). Causa: a negociação nasce do orçamento do plano e
> ninguém aplicava o benefício por procedimento; o J3 só usava a lista de
> cobertos para tirá-los da base do desconto manual — o benefício em si nunca
> era concedido. Agora: `program_discount_cents` por item e no total, calculado
> no SERVIDOR pelo mesmo motor da venda direta (carência/limite/frequência), e
> `evaluate_negotiation_rules` calcula **final = subtotal − benefício +
> ajuste**. O desconto de pagamento do **PPR+** virou **automático** pela faixa
> do parcelamento escolhido (era um botão "aplicar desconto" manual, que
> congelava percentual antigo) e **cliente de programa não recebe desconto
> manual** (§7.5, igual à venda direta). O desconto manual passou a ser medido
> sobre a base descontável, não sobre o subtotal cheio. Na tela: cada item
> mostra o preço riscado + "★ −valor", e o resumo ganhou a linha "Benefício do
> programa".

> **LOTE J — J6: refinamento visual das duas telas do dinheiro ✅ (v0.159.0,
> sem migração):** venda direta e cockpit do consultor passaram a ser montadas
> com os MESMOS componentes, em **passos numerados**: venda direta = 1 O que
> foi vendido → 2 Como o cliente vai pagar → 3 Fechamento; cockpit = 1 O que o
> cliente aprovou → 2 Como o cliente vai pagar → 3 Quem decide e observações.
> Três componentes novos em `src/components/commercial/`: **FlowSection**
> (passo numerado com título e uma linha de ajuda), **MoneySummary** (um resumo
> só — entra apenas a linha que muda o total, com o valor final em destaque) e
> **PaymentFields** (a pergunta "como vai pagar?" + os campos daquele formato,
> componente único usado nas duas telas, o que impede as duas de divergirem).
> Também: selo "salvo/não salvo" no passo 2 em vez do aviso grande, "Cancelar
> venda" discreto no fim, campos maiores (h-9) e venda concluída/cancelada
> mostrando o resumo do dinheiro sem campos de edição.

> **LOTE J — J5: condição de pagamento do programa é automática ✅ (v0.158.0,
> migração 0181):** cliente do **Risarte Empresarial** ou do **PPR+** passa a
> ter automaticamente a condição diferenciada do programa na venda do
> tratamento — boleto liberado e parcelamento próprio. Descoberta: a condição
> do Empresarial **já existia** e é editada na ficha da empresa
> (`companies.payment_methods` = BOLETO/PIX/CARD e
> `default_max_installments`, padrão **24×**), mas era usada só na
> **mensalidade** do programa; a venda do tratamento continuava presa à regra
> da unidade (era a causa real do boleto não aparecer). Agora a regra efetiva é
> a da unidade **ampliada** pelos programas: formas de pagamento = **união** (o
> programa acrescenta, nunca tira) e parcelamento = o **maior** dos dois. Vale
> nas 4 pontas — ficha do cliente, lista de vendas diretas, validação do
> servidor e cockpit do consultor — e no banco (`empresarial_client_conditions`
> dentro de `evaluate_negotiation_rules`). Isso substitui o "libera todas as
> formas" provisório da 0180, que ignorava o que cada empresa contratou.
> `ruleWithProgramConditions` em `src/lib/commercial.ts` com 5 testes novos
> (195 no total).

> **LOTE J — J4: pagamento em UMA tela + cancelamento de verdade ✅ (v0.157.0,
> migração 0180):** feedback do teste do dono. (a) **Venda cancelada agora
> cancela os procedimentos** — a sessão do prontuário passou a guardar de qual
> venda veio (`treatment_sessions.direct_sale_id`, com preenchimento
> retroativo) e `cancel_direct_sale` cancela venda + procedimentos + cobranças
> e devolve o benefício do programa; procedimento cancelado aparece riscado
> ("Cancelado") e sai de todas as listas de pendentes. Reparo das vendas já
> canceladas incluído. (b) **Cobranças AO VIVO**: o plano aparece na tela antes
> de salvar (era preciso salvar para depois personalizar) e **um único botão**
> grava condições + cobranças exatamente como estão. (c) **Lista compacta em 2
> colunas** — 10 parcelas não viram uma tela inteira. (d) **Boleto no
> Empresarial**: cliente do programa vê TODAS as formas de pagamento da rede
> (decisão do dono), na tela e no banco. (e) **Paridade**: o cockpit passou a
> usar a mesma regra da venda direta (`effectiveRuleWithPpr`), então o PPR+
> amplia formas de pagamento nos dois.

> **LOTE J — J3: programas acima das regras no cockpit ✅ (v0.156.0, sem
> migração) — LOTE J (J1–J3) COMPLETO:** o cockpit do consultor passou a
> consultar a **camada única de programas** (PPR+ **e** Risarte Empresarial):
> procedimento coberto por **qualquer** programa não recebe desconto manual de
> novo (a base do desconto exclui os cobertos), o selo dourado mostra o
> programa certo (cliente Empresarial vê "cliente do programa" com a trava,
> sem faixas de parcelamento — o benefício dele é por procedimento), e o PPR+
> continua sobrepondo teto de desconto/parcelas da unidade. A parcela mínima
> do programa vale nas cobranças das duas telas (J1).

> **LOTE J — J2: mudar a data pergunta sobre as próximas ✅ (v0.155.0, sem
> migração):** no **Personalizar** (venda direta E cockpit do consultor, mesmo
> componente), mudar a **data** de uma cobrança que tem outras depois abre a
> pergunta: **"Só esta cobrança"** ou **"As seguintes acompanham"** (mesmo dia
> dos meses seguintes; dia 31 vira o último dia do mês curto). Mudar o **valor**
> continua recalculando as seguintes sozinho. Regra pura `resequenceDatesFrom`
> em `src/lib/payments.ts` com 4 testes novos (190 no total).

> **LOTE J — J1: entrada + parcelas no cockpit do consultor ✅ (v0.154.0,
> migração 0179):** a negociação do consultor ganhou a MESMA tela de pagamento
> da venda direta: pergunta única **"Como o cliente vai pagar?"** (À vista /
> Parcelado / Entrada + parcelas), campos condicionais (entrada, parcelas, 1º
> vencimento), **desconto automático à vista da unidade** (parcelado sem
> automático) e **Salvar negociação** que também grava as cobranças; elas
> aparecem em leitura com **Personalizar**. A 0179 também CONSERTA regressões
> da 0167/0177 em `evaluate_negotiation_rules`: voltou a gravar
> `subtotal_cents`/`final_cents`/`is_partial`, a filtrar pela **opção
> selecionada**, a **reabrir a rodada** (devolvida/aceita → em negociação ao
> salvar) e a zerar a autorização; e `ppr_client_conditions` ganhou
> `min_installment_cents` (a 0177 lia um campo que não existia — negociação
> parcelada estourava erro ao salvar). Reparo retroativo dos totais incluído.

> **I9b: o fechamento da venda ficou UMA tela só ✅ (v0.153.0, sem migração):**
> o dono apontou que a tela tinha valores repetidos, escolha contraditória
> ("à vista" com entrada logo abaixo) e **dois lugares para salvar**. Agora:
> **uma pergunta** — "Como o cliente vai pagar?" **À vista / Parcelado /
> Entrada + parcelas** — e só os campos daquele formato aparecem; **um resumo**
> (total → descontos → valor final → "como fica"); **um botão** — *Salvar
> pagamento*, que grava as condições **e** gera as cobranças no mesmo clique. As
> cobranças aparecem **em leitura**; quem quiser mudar data ou valor clica em
> **Personalizar** (aí sim há um "Salvar alterações", só nesse modo). E o que
> mais incomodava: **editar o valor de uma cobrança recalcula as seguintes**
> sozinho — entrada R$ 500 + 2ª parcela R$ 500 redistribui o resto para o plano
> continuar fechando com o total (`redistributeFrom`, 5 testes novos; 186 no
> total).

> **LOTE I — I9: entrada + parcelas personalizadas ✅ (v0.152.0, migração 0178)
> — LOTE I (I1–I9) COMPLETO:** a venda passa a ter **plano de cobrança**:
> **entrada** (valor livre) + **parcelas**, cada uma com **data de vencimento e
> valor próprios** — o que o dono pediu para o boleto. O editor gera o plano
> sozinho (entrada + nº de parcelas + 1º vencimento, mensal ou a cada N dias,
> com a sobra dos centavos na última) e **cada linha continua editável**. A soma
> **tem de fechar exatamente** com o valor da venda — regra garantida no banco
> (`TOTAL_MISMATCH`), não só na tela — e a **parcela mínima do meio de pagamento
> (I8) é respeitada** (a entrada é livre). Nova tabela
> `public.payment_installments` (entrada/parcela, vencimento, valor, situação,
> baixa) ligada à negociação **ou** à venda direta: ela é, de propósito, a
> **base do módulo Financeiro** (boletos em aberto, atraso e renegociação).
> Regras puras em `src/lib/payments.ts` com **14 testes** (181 no total).

> **LOTE I — I8: regra comercial (parcela mínima + desconto só à vista) ✅
> (v0.151.0, migração 0177):** em **Regras comerciais** entraram dois campos
> novos, no mesmo padrão cascata (rede → unidade): **valor mínimo da parcela por
> meio de pagamento** (boleto, cartão parcelado etc. — a unidade sobrescreve só
> os meios que ela definir) e **desconto automático à vista (%)**. As duas
> regras valem nos dois fluxos: a **negociação do consultor** e a **venda
> direta** recusam parcela abaixo do mínimo do meio escolhido (dizendo o valor
> da parcela e o mínimo), e o **desconto automático só existe à vista (1×)** —
> no parcelado não entra desconto nenhum sozinho: vale só o que o consultor
> aplicar à mão, dentro do desconto máximo da unidade. O automático nunca passa
> do teto, e o PPR+ continua **superior** (mínimo do plano prevalece quando é
> maior). Regras puras com **9 testes novos** (167 no total).

> **LOTE I — I7c: relógio do atendimento ✅ (v0.150.0, sem migração):** no
> Desenvolvimento Clínico, o dentista passou a ver **cronômetro do atendimento**
> (roda de segundo em segundo desde a chamada), **quanto o cliente esperou na
> recepção** e um **alerta da sala de espera** com o **nome** e o **tempo** de
> cada pessoa aguardando na unidade — em vermelho e piscando quando passa do
> limite de espera configurado para a unidade (o mesmo da tela Atendimento,
> padrão 20 min). Os nomes são clicáveis e abrem o prontuário.

> **LOTE I — I7b: o atendimento fecha pelo Desenvolvimento Clínico ✅ (v0.149.0,
> migração 0176):** o dentista **conclui o atendimento sem sair da aba** — marca
> o que foi feito, o que não foi (com motivo) e pode **executar uma sessão que
> não estava programada** para o dia (só as dele ou ainda sem dentista
> definido). **Só conclui depois de descrever** o Desenvolvimento Clínico — e
> essa trava está no banco (`NOTE_REQUIRED`), não só na tela. Agora existe
> **uma anotação por atendimento** (índice único), e o **resultado de cada
> atendimento fica registrado** em `attendance_session_outcomes`: no histórico,
> cada anotação mostra o que foi **finalizado** (✓), o que estava programado e
> **não foi** (com o motivo) e o que foi feito **fora do programado**. Esse
> registro era impossível antes: a sessão não realizada volta para "a agendar" e
> perdia o vínculo com o atendimento. A conclusão pela tela **Atendimento**
> continua funcionando igual.

> **LOTE I — I7: procedimentos do atendimento à vista ✅ (v0.148.0, sem
> migração):** o **Desenvolvimento Clínico** do prontuário abre com o quadro
> **"Procedimentos deste atendimento"** — as sessões ligadas ao atendimento em
> curso (ou ao próximo de hoje), com o procedimento, qual sessão é (nome do
> protocolo ou "Sessão 2 de 4"), a **etapa** do plano, o tempo previsto e se já
> está concluída; junto, o lembrete de que a baixa é confirmada na tela
> **Atendimento**. No **painel de Atendimento**, cada card passou a listar os
> mesmos procedimentos (antes só apareciam dentro do pop-up de conclusão), e o
> rótulo da sessão deixou de sumir quando o protocolo não tem nome próprio.

> **LOTE I — I6: Risarte Empresarial no prontuário ✅ (v0.147.0, migração 0175)
> — LOTE I (I1–I6) COMPLETO:** o selo do programa agora diz **por qual empresa**
> o cliente entrou — na **ficha**, na **lista de prontuários** e no **cockpit do
> Planner** (que precisa disso porque a empresa define os benefícios do
> orçamento). O nome da empresa é copiado para `clients.empresarial_company_name`
> pelo mesmo gatilho do selo, então nenhuma tela precisa conversar com o schema
> `empresarial`. A lista ganhou o filtro **"Somente Risarte Empresarial"**.
> E o que estava faltando: o bloco **titular ↔ dependentes** aparece nos **dois**
> prontuários (o do titular lista os dependentes; o do dependente mostra o
> titular e os demais dependentes), com **nomes clicáveis** que levam de uma
> ficha à outra, marcando quem está inativo e quem ainda **não é cliente**. Vem
> de `public.empresarial_client_family()`, com guarda de acesso igual à da ficha.

> **LOTE I — I5b: cadastro do Empresarial começa pelo CPF ✅ (v0.146.0, sem
> migração):** no cadastro de **colaborador** e de **dependente**, o **CPF é o
> primeiro campo** e, ao sair dele, o sistema **autopreenche** nome, telefone e
> e-mail quando a pessoa já é cliente da Risarte (avisando o código dela, que é
> mantido) — mesma ideia do cadastro do prontuário e do PPR+. O **modelo de
> planilha** ganhou a aba **"Dependentes"** (CPF do Titular · CPF do Dependente ·
> Nome · Parentesco · Telefone): a importação lê as duas abas de uma vez e liga
> cada dependente ao titular pelo CPF, sem duplicar quem já existe.

> **LOTE I — I5: origem do cadastro (código PRE) + fila da SDR ✅ (v0.145.0,
> migração 0174):** o colaborador **novo** cadastrado pelo Risarte Empresarial
> passa a receber o código **`PRE-00001`** (mesma ideia do `PPR-` do Programa de
> Prevenção); quem **já era cliente** da Risarte **mantém o código de sempre**.
> Todo cliente agora guarda **por onde entrou**: `origin_program`
> (unidade / empresarial / ppr), `origin_clinic_id` e `origin_at` — marca
> **imutável**, que transferência de unidade não apaga. Segunda parte: o
> colaborador que ainda **não é cliente da Risarte** entra na fila da **SDR**
> (ela faz o primeiro agendamento de todo cliente novo) e **não aparece** na
> lista da recepção até ter o primeiro horário marcado; a lista da SDR mostra o
> selo **"Novo · Empresarial · 1º agendamento"**. Quem já era cliente segue
> normalmente com a recepção. Busca por nome continua encontrando todo mundo.
> ⚠ Esta migração toca duas funções do schema `empresarial`
> (`complete_employee` e `link_dependent`) — autorizado pelo dono para o LOTE I,
> mudança mínima e numerada na faixa do core.

> **LOTE I — I4: cadastro incompleto ✅ (v0.144.0, migração 0173):** clientes que
> entram **pré-cadastrados** (Risarte Empresarial e integrações) agora são
> reconhecidos como tal. "Cadastro completo" é **a mesma régua do formulário de
> novo cliente** (decisão do dono): nome · CPF (ou "cliente sem CPF") ·
> nascimento · telefone · e-mail · CEP · endereço · número · bairro · cidade ·
> UF, e **menor de 18 exige responsável**. O resultado fica em
> `clients.registration_complete`, mantido por gatilho. Na prática: **selo
> "Cadastro incompleto"** na lista de prontuários e na ficha (com a lista do que
> falta), **filtro** "Somente cadastro incompleto" na lista, **aviso** no
> formulário de agendamento com link para o cadastro e — a barreira de verdade —
> **o servidor recusa agendar** enquanto faltar dado, dizendo o que falta. Vale
> para **todos os clientes** (decisão do dono), então clientes antigos sem
> e-mail ou CEP também aparecem no filtro: é a fila de faxina da base. A marcação
> "cliente sem CPF" passou a ser gravada (`clients.no_cpf`) — antes se perdia ao
> salvar. Regra pura em `src/lib/clients.ts` com 8 testes.

> **I2c (ajuste do teste):** o pop-up de informações do agendamento mostra o
> selo de **atendimento conjunto** e os nomes usando o que a agenda já carregou
> — não depende mais de uma segunda consulta para aparecer.

> **LOTE I — I3: prazos com unidade de tempo + SLA que desliga ✅ (v0.143.0,
> migração 0172):** em **Prazos (SLA)** cada prazo agora tem **quantidade +
> unidade** — minutos, horas, dias ou meses (1 mês = 30 dias) — e a mesma
> liberdade vale para as regras de **ativo/inativo**, que antes só aceitavam
> dias. O sistema converte tudo para minutos e passou a comparar em minutos
> (inclusive o recálculo de ativo/inativo no banco), então prazos menores que um
> dia finalmente funcionam. As colunas antigas (`hours` e `value_days`) seguem
> preenchidas por gatilho, para nada que ainda as leia quebrar. Segunda
> correção: o prazo **"Fechamento → início do tratamento" para de correr** assim
> que o cliente entra em **"Em Tratamento"** (ou finalizado/cancelado) — antes
> ficava vermelho para sempre mesmo com o tratamento já em andamento.

> **LOTE I — I2b: ajustes do teste ✅ (v0.143.0, sem migração):** o seletor de
> horário **não oferece mais** o horário em que o dentista está num atendimento
> conjunto (poupa a recepção de tentar e levar erro), e a tela **Meu Dia** —
> hoje, próximos 14 dias, produção e futuros — passou a incluir os atendimentos
> em que o dentista entra como **profissional adicional**, com o selo
> "atendimento conjunto".

> **LOTE I — I2: atendimento conjunto (H4.7), 4 correções ✅ (v0.142.0,
> migração 0171):** mesma família de erro do I1 — a regra de escrita de
> `appointment_participants` (0116) só liberava recepção, SDR e admin, então
> quando quem agendava era o **coordenador, o gerente ou o dentista** nenhum
> profissional adicional era gravado (card vazio, agenda do B vazia), embora o
> aviso ao B fosse disparado do mesmo jeito. Agora: (1) os adicionais são
> gravados por função de banco (`set_appointment_participants`) com a mesma
> régua do agendamento, que **recusa** incluir quem já tem atendimento no
> horário; (2) a trava de conflito passou a enxergar o profissional **adicional**
> — antes a agenda dele continuava "livre" e aceitava outro cliente no mesmo
> horário; (3) o aviso ao profissional agora diz **com quem** é o atendimento
> conjunto, o paciente, a data, a unidade e a **sala**, e leva para "Minha
> agenda"; (4) "Minha agenda" mostra **com quem** e **em qual sala**. O filtro
> por profissional na agenda da unidade também encontra quem entra como
> adicional. Falhas deixaram de ser silenciosas: viram aviso na tela.

> **LOTE I — I1: sessão agendada não volta para o formulário ✅ (v0.141.0,
> migração 0170):** a sessão que já tinha atendimento marcado continuava
> aparecendo como opção e podia ser agendada de novo. A **causa** era de
> permissão: quem agenda pode ser a recepção **ou a SDR**, mas a regra de
> escrita das sessões (migração 0058) só liberava recepção, coordenador e
> dentista — quando a SDR agendava, o "marcar como agendada" era barrado em
> silêncio e a sessão continuava "a agendar". Agora o vínculo passa por uma
> função de banco estreita (`link_appointment_sessions`, só mexe em situação e
> agendamento), que autoriza pela mesma régua do agendamento, **recusa**
> vincular sessão que já pertence a outro atendimento e devolve aviso na tela.
> O formulário também só oferece sessões realmente livres, e a migração
> **conserta os dados** que ficaram desencontrados (sessão presa a atendimento
> cancelado volta para "a agendar"; sessão vinculada a atendimento vivo passa a
> "agendada").

> **PPR+ — Painel: período, filtro no pop-up e crescimento refeito ✅
> (v0.140.0, sem migração):** o painel ganhou **filtro de período** (Hoje / Esta
> semana / Este mês / Últimos 3 meses / Tudo / período escolhido), que vale para
> o **movimento** (entradas, saídas e limpezas realizadas) — planos,
> beneficiários e receita continuam mostrando a situação de **hoje**, e o
> cabeçalho diz isso. Dentro dos pop-ups agora há **chips de filtro com
> contagem**: beneficiários por **titular × dependente**, planos por
> **ativo/aguardando/suspenso** e o movimento por **entraram × saíram**. O
> cartão de crescimento foi refeito: em vez de um percentual que virava "+100%"
> com 2 planos, mostra o **saldo do período** (`+2 plano(s)`, verde/vermelho),
> com "quantos entraram · quantos saíram", a comparação `base → hoje` e o
> percentual **só quando a base tem 5 planos ou mais** (regra pura
> `growthPercent`, com testes). O pop-up do movimento fecha com a **receita que
> entrou e a que saiu**. A mesma regra vale para a taxa de cada plano no quadro
> "Por plano".

> **PPR+ — Painel clicável + gráficos separados ✅ (v0.139.0, sem migração):**
> como no Dashboard do Comercial, **todo número do painel do PPR+ abre um
> pop-up com a lista por trás dele** — planos ativos (leva à adesão),
> beneficiários (leva ao prontuário), receita mensal (mensalidade de cada
> adesão, da maior para a menor), movimento do mês (quem entrou × quem saiu),
> cada plano do quadro "Por plano", e os cinco números da "Prevenção em dia"
> (em dia, sem usar o plano, limpezas realizadas, agendados em 7 dias e as
> liberações previstas em 7/30 dias, com selo "Já agendado" ou "Chamar"). O
> **gráfico de crescimento foi dividido em dois**, porque quantidade e dinheiro
> são grandezas diferentes: **"Planos vivos por mês"** (com o número em cima de
> cada barra e, embaixo, quantos entraram naquele mês) e **"Receita mensal por
> mês"** (valor em cima da barra, arredondado; o valor exato aparece ao passar o
> mouse).

> **PPR+ — PPR7: painel do programa + ranking ✅ (v0.138.0, sem migração) —
> MÓDULO PPR+ COMPLETO (PPR1–PPR7):** nova tela **PPR+ → Painel**, com filtro de
> unidade para a Franqueadora. Traz **planos ativos** (+ aguardando ativação e
> suspensos), **beneficiários** (titulares + dependentes), **receita mensal** com
> **ticket médio**, **crescimento do mês** (novos × cancelados), o **gráfico dos
> últimos 6 meses** (planos vivos e receita lado a lado), o quadro **por plano**
> (quantidade, receita, participação e quantos entraram no mês com a taxa) e o
> bloco **Prevenção em dia**: quem está **em dia com a limpeza** (usou nos
> últimos 3 meses ou já tem agendamento), quem está **sem usar o plano** (+4
> meses sem agendamento — a fila de ligar), limpezas realizadas, agendamentos dos
> próximos 7/30 dias e a **projeção de liberações** pela frequência do plano. Para
> a Franqueadora, o **ranking das unidades** por receita, planos, beneficiários,
> novos, cancelados e limpezas.

> **PPR+ — PPR6: mensalidades, inadimplência e Riso+ Social ✅ (v0.137.0,
> migração 0169):** nova tela **PPR+ → Mensalidades**: **gerar as cobranças do
> mês** (uma por adesão ativa, sem duplicar), **dar baixa** no pagamento e
> **aplicar a inadimplência** (suspende quem passou do prazo, cancela quem
> passou do limite de `ppr_settings`, avisando a recepção/gerente). A baixa da
> **primeira mensalidade** completa a regra de ouro (com o contrato, ativa o
> plano) e, quando o plano participa, credita os **pontos do Riso+ Social**
> proporcionais ao valor pago. Regularizou tudo? o plano **volta a ativo**
> sozinho. A tela da adesão passou a mostrar as **12 últimas mensalidades** com
> baixa ali mesmo. A migração também **conserta as vendas diretas abertas** que
> ficaram com o desconto congelado, e o fechamento avisa **"Condições não
> salvas"** quando o resumo do topo ainda não reflete a escolha atual.

> **CORREÇÃO — desconto da faixa ficava congelado ✅ (v0.136.1, migração 0168):**
> o desconto do PPR+ era gravado como valor fixo no momento do clique em
> "aplicar desconto do plano" (15% do à vista) e **não mudava ao trocar as
> parcelas** — em 18× (faixa sem desconto) os R$ 222 continuavam lá. Agora, para
> cliente com PPR+, o desconto da faixa é **100% automático**: a tela recalcula
> ao trocar o seletor de parcelas (18× → R$ 0) e o **servidor recalcula de novo
> ao salvar** (`setDirectSaleConditions` ignora o valor vindo da tela — nunca
> mais valor congelado). O botão "aplicar desconto do plano" saiu; no lugar, o
> selo "aplicado automaticamente: −R$ X" / "sem desconto nesta quantidade de
> parcelas". "À vista só PIX/depósito" também é validado no servidor. A migração
> 0168 fecha o lado do banco na **negociação**: o teto de desconto sobe só até o
> **percentual da faixa escolhida** (`ppr_client_tier_percent`) — 15% em 18× vai
> para autorização do Gerente — e o painel avisa quando o % aplicado ficou maior
> que o da faixa após trocar as parcelas.

> **Pagamento: seletor de parcelas + à vista de verdade ✅ (v0.136.0, sem
> migração):** as **parcelas viraram um seletor** (À vista (1×), 2×, 3×… até o
> máximo que o plano ou a unidade libera) — na venda direta e na negociação; nada
> de digitar número inválido. **À vista = 1×** e, nesse caso, a forma de
> pagamento fica limitada a **PIX ou depósito**. As faixas do plano passaram a
> ser exibidas como **intervalos claros** ("à vista (1×) 10% · 2× a 6× 15% · 7× a
> 12× 10% · 13× a 18× 5%"), acabando com a confusão de achar que 3× estava
> pegando o percentual do à vista. O fechamento da venda direta ganhou o **resumo
> do dinheiro**: **Valor total (sem descontos)**, **Total de descontos** (com o
> quanto veio do plano), acréscimo quando houver, **Valor final** e o
> parcelamento (ex.: 3× de R$ 444,00).

> **PPR+ — 7 ajustes do teste ✅ (v0.135.0, migração 0167):** (1) **parcelamento
> do plano liberado de verdade** — a recusa vinha da validação no BANCO
> (`evaluate_negotiation_rules`) e da action da venda direta, que ainda olhavam
> só a regra da unidade; as duas agora somam as condições do PPR+;
> (2) **boleto do plano aceito** mesmo quando a unidade não permite (união das
> formas); (3) **faixas de desconto aparecem no fechamento da venda direta**, com
> o botão "aplicar desconto do plano" e a base já sem os procedimentos cobertos;
> (4) **excluir dependente** com pop-up de confirmação explicando as consequências;
> (5) **notificação da adesão** para recepção, gerente e coordenador + **filtro
> PPR+** na central de notificações; (6) no novo dependente o **CPF é o primeiro
> campo** e puxa o cadastro (nome, nascimento e unidade), e quem entra pelo
> programa recebe **código PPR-00000** (`next_client_code_prefixed`, pronta
> também para o `PRE` do Empresarial); (7) nova tela **PPR+ → Sem agendamento**:
> a recepção vê os beneficiários que ainda não têm agendamento nem atendimento,
> com **há quanto tempo entraram** ("2 meses e 12 dias"), data de entrada, plano,
> titular/dependente (e quem é o titular) e botões de agendar/abrir prontuário.

> **PPR+ — o plano vence a regra da unidade ✅ (v0.134.0, sem migração):** nova
> regra pura `effectiveRuleWithPpr` (6 testes; 135 no total) usada na **venda
> direta** (lançamento, fechamento e lista) e na **negociação**: o PPR+ só
> **amplia** — mais parcelas (unidade 6× + plano 10× = **10×**), mais formas de
> pagamento (**boleto do plano vale mesmo se a unidade não aceita**) e teto de
> desconto maior. Nunca reduz o que a unidade já permitia. E o **desconto de
> pagamento não incide sobre procedimento que já tem benefício do plano**: a
> base do desconto passa a excluir os itens cobertos, com o aviso na tela ("os
> procedimentos já cobertos pelo plano (R$ X) não recebem desconto de novo").

> **CORREÇÃO URGENTE — venda direta fechava sozinha ✅ (v0.133.1, migração
> 0166):** o gatilho de "R$ 0,00 fecha sozinha" (0165) também disparava no
> **INSERT**, e como a venda nasce com `final_cents = 0` (o total só é gravado
> depois dos itens), **toda venda direta era concluída na hora** — mesmo com
> valor a pagar. Agora o gatilho só roda no **update do total** e só quando a
> venda **já tem itens**. A migração 0166 **reabre** as vendas fechadas por
> engano (reconhecidas por estarem fechadas, com valor > 0 e **sem ninguém**
> registrado como quem assinou/confirmou). **PPR+ — uma pessoa, um plano:** ao
> incluir um dependente, o CPF **puxa o cadastro existente** e autopreenche; se
> a pessoa já é beneficiária de um plano vivo, aparece o aviso vermelho e a
> inclusão é bloqueada (trava também no banco, `ALREADY_IN_PPR`) — para entrar
> em outro plano é preciso cancelar o atual.

> **PPR+ — PPR5b: brinde, aviso de benefício usado e fechamento correto ✅
> (v0.133.0, migração 0165):** (1) o **brinde** do benefício (escova a cada
> limpeza) aparece no lançamento da venda direta e na lista de itens do
> fechamento — "Entregar ao cliente: Escova nova"; (2) quando o benefício está
> em carência ou **já foi usado**, o aviso fica **destacado em âmbar** ("Benefício
> não liberado: Já utilizado. Libera em 25/11/2026 — o cliente paga o valor
> normal"), tanto no seletor quanto na linha do procedimento e no fechamento;
> (3) venda **sem valor a pagar (R$ 0,00)** agora **fecha sozinha** — contrato,
> cobrança e pagamento automáticos, venda concluída (gatilho no banco, também
> corrige as antigas); (4) com valor a pagar, **contrato e cobrança só liberam
> depois de definir a forma de pagamento** (trava na tela e no banco,
> `CONDITIONS_REQUIRED`). Além disso, a **negociação comercial** passou a mostrar
> as **condições do PPR+** (à vista, faixas por parcelamento, parcela mínima e o
> teto de parcelas do plano, acima da regra da rede) com o botão **"aplicar
> desconto"** para o percentual da forma de pagamento escolhida.

> **PPR+ — PPR5: motor de benefícios + unidades ✅ (v0.132.0, migração 0164):**
> nasceu a **camada única de programas** (`src/lib/programs.ts`): o orçamento e a
> venda direta perguntam uma vez só e recebem o **melhor benefício** entre PPR+ e
> Risarte Empresarial, procedimento a procedimento (nunca soma). O PPR+ resolve
> cobertura (isento/%), **carência a partir da ativação** e **frequência** (a
> limpeza só libera de novo depois de N meses), e plano suspenso/aguardando
> **bloqueia** com o motivo na tela. Cada procedimento coberto vendido **registra
> o uso** (`ppr_benefit_usages`) e agenda a próxima liberação; cancelar a venda
> devolve o benefício. **Regras de unidade (migração 0164):** o beneficiário fica
> vinculado a uma **unidade** (aparece no cartão); o **dependente pode ficar em
> outra unidade** (muda só a informação — o titular segue responsável pelo
> contrato e pagamento); na **transferência do titular** a nova unidade tem o
> botão **"Continuar o PPR+"**, que puxa plano e dependentes da adesão anterior e
> deixa as duas ligadas no histórico; e os **benefícios valem em toda a rede**
> (mesmo em atendimento compartilhado). **Falta o PPR5b:** aplicar o desconto à
> vista e as faixas do parcelado do plano dentro da **negociação comercial**.

> **PPR+ — PPR4: prontuário e cartão ✅ (v0.131.0, sem migração):** o prontuário
> ganhou o **selo PPR+** (plano + situação) na linha de pílulas e um **bloco do
> programa**: avisa quando está suspenso ou aguardando ativação, mostra se o
> cliente é **titular** (com a lista de dependentes e o parentesco, cada um
> clicável para abrir o prontuário) ou **dependente** (com o titular clicável),
> traz o código do cartão e os atalhos "Cartão do beneficiário" e "Ver adesão".
> Quem já teve plano cancelado vê o **histórico** ("fez parte do X até …"). O
> **cartão do beneficiário** (`/ppr/cartao/[beneficiarioId]`) sai em tamanho de
> cartão, navy com dourado, com nome, plano, vínculo, situação e o **código
> rastreável** — para imprimir ou salvar em PDF e mandar pelo WhatsApp. A tela
> **Validar cartão** (`/ppr/validar`) confere o código e responde na hora se os
> **benefícios estão liberados ou bloqueados**, listando o que o plano inclui.
> (QR code no cartão ficou para depois — hoje a validação é pelo código.)
> **Próximo: PPR5** — motor de benefícios ligado ao orçamento e à venda direta.

> **PPR+ — correção da adesão com dependente ✅ (v0.130.1, migração 0163):**
> "Adesão criada, mas falhou ao ligar os beneficiários" — no cadastro em lote o
> titular ia sem as colunas `relationship`/`is_extra` e os dependentes iam com
> elas; o PostgREST **exige as mesmas colunas em todas as linhas** e recusava o
> lote. Corrigido; além disso, se o cadastro dos beneficiários falhar a adesão é
> **desfeita** (não fica registro solto). A migração 0163 apaga as adesões órfãs
> (sem beneficiário, aguardando ativação e sem cobrança) do teste.

> **PPR+ — PPR3: venda, adesão e contrato ✅ (v0.130.0, sem migração):** o botão
> **"Oferecer PPR+"** aparece no **prontuário** (venda direta) e no **cockpit do
> consultor** (fluxo comercial), respeitando quem pode vender em cada fluxo. O
> pop-up mostra os planos com vantagens e preço, permite **incluir dependentes**
> (nome, nascimento, CPF opcional e parentesco — reaproveitando o cadastro se o
> CPF já existir na rede), escolher a **forma recorrente** e o **dia da
> cobrança**, e calcula a mensalidade com os **dependentes extras**. Quem já
> participa vê o **selo do plano**, que abre a adesão. Nova tela
> **`/ppr/adesoes`** (lista com filtros por situação e o total mensal ativo) e a
> tela da adesão com a **regra de ouro** (contrato assinado + 1ª mensalidade →
> **ativa**), beneficiários clicáveis com o **código do cartão**, inclusão/saída
> de dependente (recalculando a mensalidade), **suspender/reativar/cancelar**
> (Gerente) e o **histórico do plano**. O **contrato de adesão** sai pronto para
> imprimir em `/ppr/adesoes/[id]/contrato`.
> **Próximo: PPR4** — selo no prontuário (titular/dependentes) e cartão do
> beneficiário.

> **PPR+ — PPR2: seção dedicada + configuração ✅ (v0.129.0, sem migração):** o
> menu ganhou **PPR+ (Prevenção)**. A tela `/ppr` explica **o que é o programa**
> (descrição + os 6 objetivos) e mostra os **planos ativos** em cartões, com
> mensalidade, dependentes, vantagens e as condições de pagamento. Em
> `/ppr/configuracao` (Admin Master) dá para **criar/renomear/ativar planos**,
> editar **tudo** de cada um em `/ppr/configuracao/[planId]`: mensalidade,
> dependentes incluídos/extras e limite, desconto à vista, máximo de parcelas,
> **valor mínimo da parcela**, carência, formas de pagamento do tratamento e da
> mensalidade, Riso+ Social (com a régua de pontos), **vantagens** (texto da
> venda/contrato), **faixas de desconto por parcelamento** e **benefícios por
> procedimento ou especialidade** (isento/%, carência, "libera a cada N meses",
> limite de usos e brinde — a escova da limpeza). A tela também traz os prazos
> de **inadimplência** (suspende/cancela) no padrão cascata rede + unidade.
> **Próximo: PPR3** — botão "Oferecer PPR+", adesão com dependentes e contrato.

> **PPR+ — PPR1: fundação ✅ (v0.128.0, migração 0162):** começou o **Programa
> de Prevenção Riso+**, o módulo que antecede o Financeiro. Especificação
> completa em **`docs/PPR.md`** (o que é o programa, os 4 planos, o que é
> configurável, venda, situações, prontuário, motor de benefícios, cartão,
> dashboard, ranking, Riso+ Social e as **12 decisões do dono**). A migração
> 0162 cria toda a base: `ppr_plans` (+ vantagens, faixas de desconto por
> parcelamento e benefícios por procedimento), `ppr_settings` (inadimplência em
> cascata), `ppr_memberships`, `ppr_beneficiaries`, `ppr_charges`,
> `ppr_benefit_usages`, `ppr_events`, `ppr_social_points`, os campos
> `ppr_membership_id`/`ppr_active`/`referred_by_client_id` no cliente, a RLS de
> todas elas, os **4 planos já cadastrados** com valores e vantagens, e os
> gatilhos que mantêm o **selo PPR+ do prontuário** em dia (cancelou → sai do
> selo e fica só no histórico). As regras puras ficam em `src/lib/ppr/`
> (mensalidade, dependentes, parcela mínima, tabela de desconto, carência,
> frequência, inadimplência 30/90, pontos sociais e "melhor benefício" entre
> PPR+ e Empresarial), com **36 testes novos** (129 no total).
> **Próximo: PPR2** — seção `/ppr` com "Sobre o programa" + configuração.

> **Dashboard — quebra por origem nos 4 cartões do topo ✅ (v0.127.1, sem
> migração):** **TOTAL GERAL de vendas**, **TOTAL GERAL em R$**, **Aguardando
> fechamento** e **Valor aguardando** ganharam o mesmo pé de cartão dos
> indicadores consolidados: comercial × venda direta com % do total / ticket /
> valor. Os dois cartões "aguardando" continuam clicáveis (`DrillCard` aceita
> `parts`).

> **Dashboard — indicadores consolidados (comercial + venda direta) ✅
> (v0.127.0, migração 0161):** cinco indicadores que só olhavam o fluxo comercial
> passaram a somar as **vendas diretas**, sempre mostrando o **Geral** em
> destaque e, embaixo, quanto vem de cada origem: **Ticket médio da parcela**
> (agora inclui as vendas diretas parceladas), **Desconto concedido** (na venda
> direta soma o desconto manual + o do programa Empresarial), **Cancelados**
> (funil + vendas diretas canceladas, com data e quem cancelou na lista),
> **Por tipo de pagamento** (cada forma mostra a quebra comercial × direta) e
> **Ticket médio por tipo de cliente**. Regra da venda direta para o tipo de
> cliente (definida pelo dono): **Fase 1 ou Fase 2 = cliente novo**; qualquer
> outra fase = **cliente Risarte**. A migração 0161 grava **quem e quando**
> cancelou uma venda direta.

> **Dashboard — Total Geral + composição + período específico ✅ (v0.126.0, sem
> migração):** o topo agora abre com o **TOTAL GERAL de vendas** (quantidade e
> R$, somando **fluxo comercial + venda direta**, com ticket médio geral). A
> antiga seção separada de vendas diretas virou **"Composição das vendas"**: uma
> **barra proporcional** + **tabela comparativa** (qtd, **% da quantidade**,
> valor, **% do valor** e ticket médio de cada origem, com a linha TOTAL GERAL),
> e dois cartões clicáveis — **Vendas do fluxo comercial** e **Vendas diretas
> concluídas** — que abrem a lista de quem comprou. **Aguardando fechamento** e
> **Valor aguardando** passaram a **incluir as vendas diretas pendentes**, e na
> lista cada uma aparece com o selo **"Venda direta"** + o que falta (contrato/
> pagamento). O filtro de período ganhou **período específico (de/até)**. Regra:
> venda direta só conta como realizada com **contrato assinado + pagamento
> confirmado**.

> **Dashboard comercial — cartões que abrem a lista ✅ (v0.124.0/0.125.0, sem
> migração):** clicar no cartão abre um **pop-up com os clientes por trás do
> número** (nome, código, unidade, situação e valor de cada um, com o total no
> rodapé; cada linha abre o Cockpit do Consultor). Vale para **Vendas fechadas**
> (mostra "Concluída"/"Falta fechar" e o parcelamento), **Aguardando fechamento**
> e **Valor aguardando**, **Em follow-up** (tentativas + próxima data, marcando
> "Follow-up na clínica") e a **nova seção "Perdas e cancelamentos"** —
> **Perdidos** e **Cancelados** com **motivo, data e quem marcou**. Tudo respeita
> os filtros de unidade e período; cartão sem itens fica cinza e não clicável.
> Componente reutilizável `drill-card.tsx`.

> **Dashboard comercial — redesenho visual ✅ (v0.123.0, sem migração):** a tela
> foi reorganizada em **seções com título** (Resultado do período · Em aberto ·
> Ciclo de vendas · Pagamento/Pilar · Vendas diretas · Especialidade/Ranking).
> **Cabeçalho navy** com a marca, o contexto ("Todas as unidades · Este mês") e
> os **filtros embutidos** (chips dourados quando ativos). Os números viraram
> **cartões com ícone colorido, faixa de cor no topo e uma linha de contexto**
> (ex.: "ticket médio R$ X"), com **barra de progresso** na taxa de conversão.
> As listas (pagamento, pilar, especialidade, ranking) ganharam **barras
> proporcionais**, medalha nos 3 primeiros e "média" ao lado; o ciclo de vendas
> e o ticket por tipo de cliente ficaram em **caixas comparativas**. Sem mudança
> nos números — só apresentação.

> **Dashboard comercial v2 + preço da unidade visível ✅ (v0.122.0, sem
> migração):** (1) **Procedimentos:** no modo REDE a lista agora avisa quando
> alguma unidade tem **preço próprio** (selo azul "ajustado: Unidade R$ X" /
> "ajustado em N unidades", com o detalhe no tooltip) — antes o ajuste parecia
> ter sumido. (2) **Filtro "Todas" do dashboard corrigido** (ia explícito como
> `unidade=all`; trocar o período mantém a unidade). (3) Indicadores novos:
> **ticket médio da parcela**, **oportunidades aguardando fechamento**
> (quantidade **e** valor), **ciclo de vendas** (clientes novos: cadastro →
> início do tratamento; clientes Risarte: reavaliação/acompanhamento → novo
> tratamento, via `journey_phase_history`), **ticket médio por tipo de cliente**
> (novos × Risarte), **vendas por especialidade** e o **ranking completo de
> procedimentos mais vendidos** com filtro de origem (**Todos / Fluxo comercial /
> Vendas diretas**).

> **MÓDULO COMERCIAL — COM6: Dashboard comercial ✅ (v0.121.0, sem migração) —
> MÓDULO COMPLETO:** nova tela **`/comercial/dashboard`** (botão "Dashboard" no
> funil) com **filtros de unidade** (todas × específica) e **período**
> (hoje/semana/mês/tudo): indicadores de **vendas fechadas, valor total, ticket
> médio, taxa de conversão, oportunidades, perdas, em follow-up, parcelamento
> médio**; quadros **por tipo de pagamento** (com desconto total concedido) e
> **por pilar da metodologia**; e a seção **Vendas Diretas** (quantidade, valor
> total, ticket médio, nº de procedimentos e **ranking dos mais vendidos**).
> Consolidado (Admin/Franqueadora) ou por unidade (Gerente/Franqueado). Com isso
> o **Módulo Comercial (COM1–COM6) + Venda Direta v2 (VD1–VD3) estão completos**;
> falta apenas plugar as integrações reais (ZapSign/ASAAS/Meet/IA) e o módulo
> Financeiro (split + honorário do consultor).

> **VENDA DIRETA v2 — transparência do preço ✅ (v0.120.1):** o preço da venda
> direta usa o **preço da unidade** (`clinic_procedure_prices`) quando existe —
> o pop-up agora mostra "(preço da unidade) · padrão da rede R$ X" para não
> confundir com desconto.

> **VENDA DIRETA v2 — detalhes e discrição ✅ (v0.120.0, sem migração):** (1)
> **valor da parcela** aparece no fechamento e no detalhe ("Nx de R$ Y"). (2)
> Cliente do **Risarte Empresarial** mostra **valor original → desconto do
> programa → final** por item e no total. (3) A lista de procedimentos da venda
> direta ganhou **detalhes** (concluído por quem/quando, agendado com quem e
> para quando) + **quem fez o fechamento** (contrato/pagamento). (4) Tudo com
> **"Ver detalhes / Ocultar detalhes"** — some por padrão para não ocupar espaço,
> sem perder a informação; vendas concluídas já vêm recolhidas.

> **VENDA DIRETA v2 — ajustes 2 ✅ (v0.119.0, migração 0160):** (1) **Bug do
> procedimento que não aparecia:** o carregamento das vendas do cliente engolia
> um erro de consulta e escondia junto os procedimentos — agora os **itens são
> buscados em separado** (sem embed), os **procedimentos avulsos aparecem
> independentemente** da venda (com logs de erro), e o bloco na aba **"Sessões &
> Procedimentos"** mostra cada um com **Em aberto / Agendado / Concluído** (e a
> data de conclusão). (2) **Sem desconto para cliente de programa:** quem é do
> **Risarte Empresarial** (ou outro programa com desconto automático) **não
> recebe desconto manual** — bloqueado na RPC, na action e escondido na tela;
> quem **não** é de programa segue podendo receber desconto (dentro da regra).
> (3) **Campo de desconto/acréscimo reformulado:** virou **um único seletor**
> (Sem ajuste / Desconto R$ / Desconto % / Acréscimo R$) com **prévia do novo
> total** ao vivo, mostrando o **desconto máximo** permitido, e refletindo o que
> já está aplicado.

> **VENDA DIRETA v2 — ajustes de fluxo e bugs ✅ (v0.118.0, migração 0159):**
> (1) **Fluxo mais rápido:** o **fechamento** agora acontece **no próprio
> prontuário** — na aba **"Sessões & Procedimentos"** aparece o bloco **"Vendas
> diretas deste cliente"** com o pagamento + fechamento inline (não precisa mais
> ir até Comercial → Venda direta). (2) **Bug do desconto acumulado corrigido:**
> o desconto de **programa** (Empresarial) e o **manual** viraram colunas
> separadas; salvar as condições **substitui** o desconto manual (não soma) e o
> limite (%) é sempre sobre o **preço cheio** (subtotal − programa), nunca sobre
> o valor já descontado. (3) **Procedimentos aparecem na aba Sessões:** cada
> procedimento da venda direta vira uma sessão com estado **Em aberto / Agendado
> / Concluído**. (4) **Baixa automática:** venda de atendimento **já realizado**
> nasce **Concluída**, com a baixa no nome do **dentista do atendimento**.

> **VENDA DIRETA v2 — VD3: tela Comercial + fechamento + notificações ✅
> (v0.117.0, sem migração nova — usa a 0158):** a tela **Comercial → Vendas
> diretas** foi reescrita para o v2: **filtros de unidade** (todas × específica)
> e **período** (hoje/semana/mês/tudo), **resumo** (pendências / concluídas /
> total concluído / canceladas), e a **lista** separada em pendentes, concluídas
> e canceladas. Cada venda expande e mostra os itens + o **fechamento**: a
> **recepção/gerente** define as **condições de pagamento** (forma/parcelas
> **limitadas pela regra comercial**; **desconto** só dentro do configurado;
> **acréscimo só o Gerente** — bloqueio real na action) e faz o **fechamento em
> dois passos** (contrato assinado + cobrança emitida → pagamento confirmado;
> **R$ 0,00** = cobrança já conta como paga). **Painel de exceções** ("atendeu
> antes de vender") para gestão. As notificações ganharam a categoria/filtro
> **"Vendas Diretas"**. **Bug corrigido (VD2):** o seletor de atendimento no
> pop-up ficava vazio porque a query comparava o enum de status com o rótulo
> inválido `"canceled"` — agora os cancelados/faltas são filtrados no app.

> **VENDA DIRETA v2 — VD2: pop-up no prontuário ✅ (v0.116.0, migração 0158):**
> botão **"Venda Direta"** no prontuário, ao lado de "Novo agendamento", abrindo
> o **pop-up de lançamento**: vínculo **obrigatório** com um **atendimento** do
> cliente (se o atendimento já passou, o sistema marca sozinho e mostra o
> **alerta de fluxo invertido** — o Gerente e o Franqueado são avisados); lança
> **vários procedimentos** (só os que **aquele usuário** pode lançar, pela
> configuração do VD1); aplica o **desconto do programa** (Risarte Empresarial)
> mostrando **valor normal → desconto → valor final**, e avisa quando o total
> fica **R$ 0,00**. Ao lançar, cria os **procedimentos EM ABERTO** na aba
> **"Sessões & Procedimentos"** (que agora aparece em **qualquer fase**, não só
> na Fase 5) para o **dentista dar baixa**; notifica o **Consultor da unidade
> com o valor** e, quando quem lançou não pode fechar (Coordenador), aciona a
> **recepção**. Preços e descontos são **recalculados no servidor** (o navegador
> nunca define valor). RPCs: `create_direct_sale_v2`,
> `direct_sale_set_conditions`, `direct_sale_close_step`.
> **Correção do dono:** o Coordenador Clínico **apenas lança** (responsável
> técnico) — não define pagamento/parcelamento nem fecha; quem fecha é a
> **Recepcionista ou o Gerente**.

> **VENDA DIRETA v2 — VD1: configuração + base ✅ (v0.115.0, migração 0157):**
> a spec completa da Venda Direta (passada pelo dono em 23/07) está em
> **`docs/COMERCIAL.md` §7** — o COM5 v1 era uma versão simples e será
> substituída em 3 lotes (VD1 config/base → VD2 pop-up no prontuário + fechamento
> → VD3 tela Comercial + notificações + exceções). **VD1 entregue:** em
> **Procedimentos**, cada procedimento ganhou o seletor **"Autorizado para VENDA
> DIRETA"** + **quem pode lançar (Recepção / SDR)**, com **selo verde indicador**
> na lista; o **modelo de planilha** de importação ganhou as 3 colunas novas
> (Sim/Não) e as instruções. Base no banco: `direct_sale_items` (venda com
> **vários procedimentos**), vínculo com o **atendimento** (`appointment_id`),
> marca de **exceção** (atendeu antes de vender) e fechamento em **dois passos**
> (cobrança emitida → pagamento confirmado). Regras puras em
> `src/lib/direct-sale.ts` (quem lança, quem fecha, e a regra comercial que
> **bloqueia** o fechamento: desconto só dentro do configurado, **acréscimo só o
> Gerente**) — **19 testes novos** (91 no total).

> **MÓDULO COMERCIAL — COM5: Venda direta + ajustes ✅ (v0.114.0, migração
> 0156):** (1) **Venda direta na unidade** (`/comercial/venda-direta`): fluxo
> excepcional (urgência, consulta avulsa, limpeza) — **lista configurável** de
> procedimentos vendáveis (flag `procedures.direct_sale`, Admin configura na
> própria tela); a **Recepção fecha** (pagamento), o **Coordenador lança**
> (procedimento), o **Gerente faz os dois** — nada trava; tudo registrado
> (tabela `direct_sales`, entra nos números). Botão "Venda direta" no funil.
> (2) **Perdido/Cancelado** agora mostram **data e quem** marcou. (3) Na tela
> **Planos de Tratamento**, clientes em **Fase 4/5** ganharam o atalho **"Cockpit
> do Consultor"** (time comercial). (4) O funil abre com o filtro **"Todas"** por
> padrão quando a clínica ativa do Consultor é a Franqueadora.

> **MÓDULO COMERCIAL — Ajustes do funil ✅ (v0.113.0, migração 0155):**
> (1) **Escopo por unidade** — o funil `/comercial` agora mostra por padrão só a
> **unidade logada** (corrige o Gerente ver todas as unidades). O time comercial
> e o Admin têm **filtro** (Todas / unidade específica). (2) **Permissões** —
> Gerente/Franqueado da unidade só **VISUALIZAM** o funil (sem cockpit, sem
> botões); o cartão leva à **ficha**. Só quando o Consultor **libera o follow-up
> para a clínica** é que a unidade ganha a ação de **registrar tentativa** (ajuda
> nos contatos); o **fechamento continua sendo do Consultor**. (3) **Funil** — a
> coluna "Follow-up na clínica" saiu; virou um **indicador** ("Conduzido pela
> clínica") na coluna **Follow-up**. **Cancelados** e **Perdidos** viraram
> **botões** com a lista/detalhe. Sequência: A apresentar → Acontecendo agora →
> Apresentados → Follow-up → Fechamentos → Aguardando iniciar → Tratamento
> iniciado. (4) **Cronômetro** ao vivo em "Acontecendo agora". (5) **Histórico do
> funil** por cliente (`commercial_card_events`) — botão no cockpit. Tabela +
> colunas novas no cartão; RPC `commercial_transfer_followup`; guards
> `commercial_is_team`/`commercial_is_unit`.

> **MÓDULO COMERCIAL — COM4: Fechamento (regra de ouro) ✅ (v0.112.0, migração
> 0154):** quando o cliente aceita, aparece o **painel de Fechamento** (na
> apresentação e no cockpit) com o **resumo que vai no contrato** (valor,
> desconto/acréscimo, pagamento/parcelas, **aprovação parcial** = itens não
> aprovados + motivo, e o **resumo da apresentação** do COM2). Marcação
> **manual-primeiro** de **Contrato assinado** (ZapSign depois) e **Pagamento
> confirmado** (ASAAS depois). **Regra de ouro:** só quando os DOIS estão
> marcados a venda é concluída → o cliente vai à **Fase 5** (Aguardando iniciar
> tratamento) e disparam os avisos: **pop-up FORTE à recepção** (novo
> `TreatmentStartPopup` — falar com o cliente e agendar), **Coordenador**
> (acompanhar o tratamento) e **Gerente** (com o **VALOR** da venda). Quando a
> **1ª sessão** é concluída, o cliente vira **"Em Tratamento"** (já existia) e
> agora o **Consultor é avisado** (sai da sua lista ativa) + Gerente. Tabela
> `commercial_sales`; RPC `commercial_close_step`.

> **MÓDULO COMERCIAL — COM3: Kanban + Follow-up ✅ (v0.111.0, migração 0153):**
> a tela **`/comercial`** virou o **kanban do funil comercial** (10 colunas:
> A apresentar → Acontecendo agora → Apresentados → Follow-up → Fechamentos →
> Aguardando iniciar tratamento → Tratamento iniciado + Follow-up na clínica,
> Cancelado, Perdido). As colunas de fechamento e da Fase 5 são derivadas
> (negociação aceita/jornada); as demais vêm do **cartão** (`commercial_cards`).
> Cada cartão tem menu de ações (iniciar apresentação, marcar apresentado,
> iniciar/registrar follow-up, perder/cancelar com motivo), WhatsApp e atalho ao
> cockpit. **Follow-up com cadência configurável** pelo Admin em
> `/admin/regras-comerciais` (nº de tentativas, intervalo, prazo máximo — cascata
> rede→unidade, `commercial_followup_settings`); cada tentativa é **registrada**
> (`commercial_followup_attempts`, canal + resultado + observações) e, ao esgotar
> as tentativas/prazo, o cliente é **encaminhado à Gerente** (coluna "Follow-up na
> clínica" + notificação). O **histórico do plano** passou a aparecer também no
> painel de negociação (Consultor **e Gerente**, útil ao autorizar). Item
> **"Comercial"** no menu para o time comercial + Gerente.

> **MÓDULO COMERCIAL — COM2: Cockpit do Consultor ✅ (v0.109.0, migração 0151):**
> nova tela **`/comercial/[clientId]`** — a mesa de trabalho do Consultor durante
> a apresentação: cabeçalho com cliente/unidade/fase/pilar/selo Empresarial +
> consultor responsável; botões rápidos **WhatsApp** (conversa pré-preenchida),
> **Apresentação do plano** e **Ficha completa**; painel **Apresentação** com
> link do Meet (abrir em 1 clique), **link da gravação do início ao fim**
> (manual-primeiro: o Meet grava e o consultor cola o link; a transcrição por IA
> pluga aqui depois), **Resumo da apresentação** (vai no contrato do fechamento —
> COM4) e considerações; **Planos do cliente** com a situação de cada um;
> **Pendências** (procedimentos em aberto + revisão/reprovados do controle de
> qualidade); **Situação financeira** (placeholder ASAAS); e o **painel de
> negociação** (o mesmo do COM1) na coluna direita — só na Fase 4. A tela de
> apresentação ganhou o atalho "Cockpit do Consultor". Tabela
> `commercial_presentations` (uma mesa por cliente).

> **Negociação multi-plano + GUT colorida + histórico detalhado ✅ (v0.108.0,
> migração 0150):** (1) no painel de negociação os procedimentos ficam em **ordem
> de prioridade GUT** com as **pílulas oficiais coloridas** (Alta vermelho /
> Média amarelo / Baixa verde — mesmas faixas do Planner). (2) **Marcações por
> plano preservadas**: trocar entre plano principal e secundários não perde o que
> foi assinalado — todas as marcações acompanham a devolução; os **totais** da
> negociação contam só o plano selecionado. (3) **Histórico do plano mais
> detalhado**: registra também **"Plano editado"** (diagnóstico/opções/orçamento)
> com o usuário (no máx. 1 evento por autor a cada 30 min) e a linha mostra
> "por Fulano" em todos os eventos.

> **Fix: Replanejamento visível + selo dos excluídos ✅ (v0.107.1, sem
> migração):** dois furos do teste — (1) a situação do plano só aparecia na lista
> de chips quando havia 2+ planos; agora a **"Situação do plano"** aparece SEMPRE
> acima do editor (chip colorido, ex.: "Replanejamento (devolvido pelo
> Comercial)") e a tela **/planos ganhou o chip/contador "Replanejamento
> (Comercial)"**. (2) o selo "Não aprovado pelo cliente" dependia de o Consultor
> clicar "Salvar negociação" antes de devolver; agora **"Devolver ao
> planejamento" salva a negociação automaticamente antes** — os procedimentos
> assinalados acompanham o plano sempre.

> **Ajustes pós-teste da devolução ✅ (v0.107.0, migração 0149):** (1) **BUG
> corrigido** — negociação só existe com o cliente **na Fase 4**: fora dela o
> painel some e o banco bloqueia (WRONG_PHASE). (2) Procedimento excluído pelo
> cliente na negociação ganha o selo **"Não aprovado pelo cliente (Comercial)"**
> no próprio item do plano (editor e resumo). (3) Nova situação de plano:
> **"Replanejamento (devolvido pelo Comercial)"** — o plano devolvido nunca fica
> "aprovado"; refaz todo o ciclo (elaboração → aprovação do Coordenador →
> Comercial), e ao ser **reaprovado** a nota da devolução é limpa (a história
> fica no histórico do plano). (4) As considerações do Consultor **saíram** das
> "informações complementares do Coordenador" e ganharam **pop-up próprio
> "Devoluções do Comercial"** no cockpit do Planner. 68 testes.

> **Devolução ao planejamento completa + HISTÓRICO por plano ✅ (v0.106.0,
> migração 0148):** correção do feedback do dono — as informações da devolução
> não se perdem mais. (1) Ao devolver (Fase 4→3), o plano aprovado é **reaberto
> automaticamente** (mesmo plano, não um novo) e as **considerações do Consultor
> ficam gravadas NO PLANO**, exibidas num **destaque vermelho** no topo do editor
> (cockpit do Planner / ficha) até o plano ser reaprovado. (2) O Planner recebe
> notificação **"Plano DEVOLVIDO pelo Comercial"** que abre **direto o cockpit**
> (o aviso "Novo caso no Centro de Planejamento" também passou a abrir o
> cockpit). (3) **Histórico próprio por plano** (`treatment_plan_events` +
> gatilho automático): criado → enviado ao Coordenador → aprovado/devolvido →
> enviado ao Comercial → apresentado → aceito → em tratamento → concluído →
> devolvido pelo Comercial (com as considerações) → reaberto — com data e autor,
> visível no botão **"Histórico do plano"** junto ao editor (todas as telas).
> Backfill leve dos planos existentes.

> **MÓDULO COMERCIAL — COM1: Negociação + Regras comerciais ✅ (v0.105.0,
> migração 0147):** início do módulo Comercial (briefing em `docs/COMERCIAL.md`).
> (1) **Regras comerciais em cascata** (`/admin/regras-comerciais`, só Admin):
> desconto máx (%), parcelas máx e meios de pagamento — padrão da rede + ajuste
> por unidade. (2) **Painel de negociação** na tela de apresentação: o Consultor
> escolhe o plano (principal ★ ou secundário aprovado = carta na manga), desmarca
> procedimentos que o cliente não aprovou (**aprovação parcial**, guiada pela
> prioridade **GUT**, com **motivo obrigatório**), aplica desconto/acréscimo,
> define pagamento/parcelas e registra o **principal decisor**. Totais ao vivo.
> (3) **Fora da regra → autorização**: a negociação trava em "aguardando
> autorização", o **Gerente da unidade** é notificado e autoriza/nega na própria
> tela. (4) **"Cliente aceitou"** → notifica o Assistente Comercial (fechamento =
> COM4). (5) **Devolver ao planejamento (4→3)** com considerações obrigatórias
> que chegam ao Planner (nova transição na `move_client_phase`; a 4→5 também
> passou a aceitar o consultor da Franqueadora com escopo). (6) **Alerta ao
> Planner** no cockpit da Fase 3 com os procedimentos não aprovados em negociação
> passada. +12 testes unitários (regras comerciais) — total 67.

> **Testes automatizados — camadas 1 + 2 ✅ (v0.104.0, sem migração):** primeiro
> conjunto de **testes unitários** (Vitest, `npm test`, 55 testes em ~3s) travando
> as regras de negócio puras: matriz "quem move a jornada" (`allowedNextPhases`),
> pilar exibido por fase, SLA estourado, tipos de agendamento por fase (inclui
> REVISÃO/REFAÇÃO sempre disponíveis), máscaras CPF/CNPJ/telefone/CEP, dinheiro em
> centavos (formatar/parsear BRL, total do orçamento, preço em cascata), estágio
> do plano (lifecycle > status), categorias de notificação e cascata de SLA/
> inatividade. **CI no GitHub Actions**: a cada push no `main`, roda testes +
> build na nuvem (aba **Actions** do GitHub mostra ✅/❌). O portão de cada entrega
> agora é `npm run build` + `npm test`. E2E (Playwright + banco de teste) fica
> para a preparação de lançamento.

> **Cockpit — Bloco F: histórico completo em pop-ups ✅ (v0.103.0, sem migração):**
> abaixo do painel de status, uma barra "Histórico:" com 3 botões que abrem
> pop-ups sem sair do cockpit: **Desenvolvimento clínico** (anotações de evolução
> dos dentistas), **Atendimentos** (todos os agendamentos, mais recentes primeiro,
> com tipo/data/profissional/situação) e **Planos** (todos os planos com a situação
> de cada um). Cada botão mostra a contagem. Fecha o Bloco F do cockpit.

> **Cockpit — Bloco A: painel de status do cliente ✅ (v0.102.0, sem migração):**
> no topo do cockpit do Coordenador (`/avaliacao/[clientId]`), abaixo do cartão de
> identidade, um painel de status que fica visível durante toda a consulta:
> **andamento do tratamento (%) com barra**, **procedimentos finalizados × em
> aberto**, **último atendimento**, **próximos agendamentos** (contagem + data do
> próximo), **planos em andamento** e **financeiro** (placeholder "Em breve —
> integração ASAAS", até o módulo financeiro existir).

> **Aba "Sessões & Procedimentos" redesenhada ✅ (v0.101.0, sem migração):** a aba
> virou uma **única lista centrada em procedimentos** (fim da divisão em duas
> visões que confundia). No topo: **resumo compacto** (procedimentos concluídos,
> sessões feitas, qualidade, tempo/previsão) + **chips de status com contagem**
> (Em aberto / Agendados / Sem agendamento / Concluídos / Aprovados / Em revisão /
> Reprovados) que **filtram** a lista, além dos filtros de plano/procedimento/
> dentista. Cada procedimento é um cartão com **selo de estado + selo do controle
> de qualidade**, plano, dentista e progresso; ao expandir, mostra as sessões com
> data/profissional e os botões de **agendar** (por sessão ou várias juntas) e
> **sugerir datas da série** — tudo no mesmo lugar.

> **Bloco único "Sessões & Procedimentos" + agenda pré-carregada ✅ (v0.100.0,
> migração 0146):** (1) **refino da recepção** — a notificação para agendar a
> revisão/refação agora abre a **agenda já com o cliente e o tipo REVISÃO/REFAÇÃO
> selecionados** (link `/agenda?cliente=…&tipo=…`), em vez do prontuário. (2)
> **reformulação estética** da aba: os dois blocos separados (linha do tempo +
> procedimentos) viraram **um único cartão** "Sessões & Procedimentos" com
> **filtros compartilhados** (plano / procedimento / dentista) e uma chave para
> alternar **Linha do tempo × Procedimentos**. Na **linha do tempo** cada sessão
> mostra agora **de qual plano** faz parte (selo) e pode ser **filtrada**. Os
> "Tratamentos finalizados" entram no mesmo cartão. Nada de funcionalidade perdida
> (agendar, sugerir datas, agendar juntas, controle de qualidade continuam).

> **Dentista enxerga a ficha + refino do Coordenador + Planner (replan) ✅ (v0.99.0,
> migração 0145):** (A) **BUG corrigido** — o dentista designado para **revisar/
> refazer** um procedimento (controle de qualidade, Fase 6) não conseguia abrir a
> ficha quando ainda não havia agendamento com ele (caso "indicar outro dentista").
> A RLS agora libera o **dentista executor/indicado** de uma revisão/reprovação —
> a aba **Sessões & Procedimentos** aparece. (B) **Refino** — quando o procedimento
> reaberto é **refinalizado**, o **Coordenador é avisado** para refazer o controle
> de qualidade. (C) **Entrega 4 (Planner)** — procedimento **reprovado → "incluir no
> próximo plano"** agora pede o **motivo da troca** (inviabilidade clínica ×
> falha profissional) e, ao **enviar ao Centro de Planejamento**, leva ao **Planner**
> a lista dos procedimentos + motivo como informação complementar (não duplica).
> _Refino ainda pendente: notificação da recepção abrir a agenda já carregada com o
> tipo REVISÃO/REFAÇÃO automático._

> **Reabrir procedimento (backfill) + indicador insistente ✅ (v0.98.0, migração
> 0144):** (fix) os procedimentos marcados como revisão/reprovado-refazer ANTES da
> lógica de reabertura continuavam "finalizados" — a 0144 **reabre** os já marcados
> (revisão cria a sessão de Revisão; reprovado-refazer reabre as sessões). (Entrega
> 3) **indicador insistente** no topo do prontuário quando há procedimento para
> revisar/refazer — só desaparece quando 100% finalizado e aprovado. O **dentista**
> já vê a aba **Sessões & Procedimentos** (mesmo em Fase 6) para finalizar. _Refino
> pendente: avisar o Coordenador automaticamente ao refinalizar + agenda pré-
> carregada REVISÃO/REFAÇÃO na recepção._

> **Reabrir procedimento na revisão/refação ✅ (v0.97.0, migração 0143):** ao
> marcar **Revisão**, o procedimento volta a **"aberto"** (as sessões antigas ficam
> finalizadas; cria uma **sessão de Revisão** a agendar). Ao marcar **Reprovado →
> refazer**, **todas as sessões + o procedimento** voltam a **"aberto"**. Assim o
> procedimento reaparece como pendente na aba Sessões & Procedimentos e no checklist
> (só volta a avaliar quando refinalizado). Novos **tipos de agendamento REVISÃO e
> REFAÇÃO** (a recepção escolhe ao agendar). _Refino: a notificação abrir a agenda
> já carregada + o tipo automático virão em seguida._

> **Controle de qualidade não trava mais a jornada ✅ (v0.96.1, migração 0142):**
> reformulação — revisão/reprovação **não movem** a fase do cliente e **não
> bloqueiam** o envio ao planejamento (reverte a 0141). O cliente segue a jornada
> como o Coordenador definir, levando as pendências. O botão de qualidade só
> **avisa a recepção**. _Próximas entregas do lote: reabrir procedimento +
> agendamento REVISÃO/REFAÇÃO; aba liberada ao dentista + indicador insistente;
> pendência do Planner (replan). Financeiro adiado (regras registradas)._

> **Refação move para a Fase 5 ✅ (v0.96.0, migração 0141) — Entrega 5:** quando
> há procedimentos para **revisar** ou **reprovados para refazer** (mesmo dentista
> ou outro), o botão do controle de qualidade **"Enviar para refação"** avisa a
> recepção **e move o cliente para a Fase 5 (Início de Tratamento)** para reagendar
> a refação com o profissional escolhido. Se o reprovado for **"incluir no próximo
> plano"**, o cliente **fica na Fase 6** e só vai à Fase 3 quando o Coordenador
> enviar ao Centro de Planejamento. **Prioridade:** havendo refação, o **envio ao
> planejamento fica bloqueado** ("envie primeiro para refação"). O dentista
> indicado recebe a notificação com o prontuário. _Falta: o Planner consumir o item
> marcado p/ replanejar + os dados no envio (marca já existe)._

> **Sessões: complemento + "com sessões" + Tratamentos finalizados ✅ (v0.95.0,
> migração 0140):** (1) **complemento de sessões** — procedimentos incluídos no
> plano DEPOIS do início do tratamento não geravam sessões (função rodava uma vez);
> a `topup_treatment_sessions` gera só as que faltam ao abrir a ficha, então o
> procedimento passa a mostrar suas sessões. (2) o botão **"Com sessões"** agora
> **abre todas** as sessões automaticamente, com colapso individual. (3) **Entrega
> 4 — "Tratamentos finalizados":** quando um plano fica **100% aprovado** no
> controle de qualidade, aparece num card de histórico (nº de procedimentos + data
> da aprovação). _Falta a Entrega 5 (reprovado + outro dentista vê o prontuário
> como tarefa)._

> **Sessões & Procedimentos — centrada em procedimentos ✅ (v0.94.0, sem
> migração):** a aba agora lista **todos os procedimentos** dos planos aprovados
> (inclui os **sem sessão gerada** — corrige o "aparecia 4 de 5"). Cada procedimento
> mostra **de qual plano** faz parte, o **estado** (a agendar / em aberto / agendado
> / finalizado), o **status do controle de qualidade** + motivo, e o **dentista
> executor**. Um **toggle** "Procedimentos × Com sessões" abre as sessões de cada
> procedimento; e há **filtros** por **plano**, **procedimento** (busca) e
> **dentista**. _(Entrega 3 de 5 do lote checklist ↔ Sessões & Procedimentos.)_

> **Checklist — fix "aparecia em aberto" + status na aba Sessões ✅ (v0.93.0, sem
> migração):** (fix) a consulta das sessões no cockpit não desambiguava a FK
> `treatment_sessions ↔ appointments` (PGRST201) e voltava vazia — por isso todo
> procedimento aparecia "em aberto"; corrigido com o nome explícito da FK. **Entrega
> 2:** na aba **Sessões & Procedimentos**, cada procedimento mostra o **status do
> controle de qualidade** (Aprovado / Em revisão / Reprovado) definido pelo
> Coordenador, com o **motivo** (revisão/reprovado) — para o dentista que vai
> revisar/refazer ler.

> **Checklist de qualidade — só avalia finalizados ✅ (v0.92.0, migração 0139):**
> no checklist da reavaliação, **todos** os procedimentos do plano aparecem, mas
> só os **finalizados** (todas as sessões realizadas) podem ser avaliados
> (Aprovado/Revisão/Reprovado). Os **agendados** aparecem como "aguardando
> realização"; os **em aberto** ganham um botão **"Solicitar agendamento"** por
> procedimento (avisa a recepção). O RPC também bloqueia avaliar procedimento não
> finalizado. _(Entrega 1 de 5 do lote de ajustes do checklist ↔ Sessões &
> Procedimentos.)_

> **Checklist de qualidade — resolução de Revisão/Reprovação ✅ (v0.91.0, migração
> 0138):** ao marcar um procedimento como **Revisão** ou **Reprovado**, o motivo é
> **obrigatório**. **Revisão** → volta ao **dentista que executou** (sugerido pelas
> sessões, o Coordenador confirma), que recebe **aviso**; a recepção é chamada para
> agendar. **Reprovado** abre um **popup com 3 opções**: (1) o mesmo dentista refaz,
> (2) indicar outro dentista para refazer, (3) incluir no próximo plano (o Planner
> troca o procedimento). Cada opção dispara os **avisos** certos (executor e/ou
> indicado). No fim do checklist, o botão **"Solicitar agendamento à recepção"**
> avisa a recepção (uma vez). _Falta: levar o item marcado p/ replanejar + dados ao
> Planner no envio ao planejamento._

> **Cockpit do Coordenador — Bloco D: checklist de qualidade ✅ (v0.90.0, migração
> 0137):** na **reavaliação**, o passo 3 (Controle de qualidade) mostra o **último
> plano concluído** procedimento a procedimento; o Coordenador marca cada um como
> **Aprovado / Revisão / Reprovado** (com motivo). Quando o plano fica **100%
> aprovado**, ele é **travado** e não pede mais revisão (fica registrado no plano).
> As revisões/reprovações ficam registradas. _Próximo: painel de status do cliente
> (Bloco A)._

> **Cockpit do Coordenador — anamnese + gravação + Orientações (Admin) ✅ (v0.89.0,
> sem migração):** (1) a **anamnese** agora fica **embutida no passo 2** do roteiro,
> sem sair do cockpit. (2) a **gravação da consulta** virou a **primeira ação**: um
> card no topo ("inicie antes de começar"), logo após o consentimento. (3) nova tela
> **Admin › Orientações** (`/admin/orientacoes`) onde o Admin escreve, **com
> formatação**, as orientações de cada função — começando pelo Coordenador Clínico
> (Avaliação/Reavaliação); o texto aparece para o coordenador no cockpit (botão
> "Orientações", só leitura) e vale para **todas** as avaliações da rede. _Próximo:
> checklist de qualidade da reavaliação (Bloco D) e painel de status (Bloco A)._

> **Cockpit do Coordenador — ferramentas embutidas por passo ✅ (v0.88.0, sem
> migração):** cada passo do roteiro agora abre com a **ferramenta daquele momento
> embutida** — passo 2 = considerações, passo 3 = coleta de fotos/exames/link +
> galeria, passo 7 = gravação, passo 8 = enviar ao planejamento; os demais passos
> são só orientação. No topo da coluna ficam o **consentimento (LGPD)** e, na
> reavaliação, a **rodada atual + "Iniciar reavaliação"**. As peças foram extraídas
> em componentes reutilizáveis (`clinical-tools.tsx` + `clinical-upload.ts`), **sem
> alterar a área Clínico da ficha** (que segue usando a ClinicalSection). _Pendente:
> embutir a anamnese no passo 2 e o checklist de qualidade na reavaliação._

> **Cockpit do Coordenador — reformulação, Bloco B ✅ (v0.86.0→0.87.0, migração
> 0136):** **roteiro guiado** da avaliação/reavaliação. O cockpit detecta se o
> cliente está na **Fase 2 (Avaliação)** ou **Fase 6 (Reavaliação)** e mostra a
> **sequência de 8 passos** correspondente, em blocos **encolhe/expande**, com um
> botão **"Ir para as ferramentas"** que rola até a área de coleta. O roteiro é a
> **estrutura informativa** do fluxo — o coordenador **não preenche nada** nele
> (alguns passos, como o quebra-gelo, só orientam). Há uma **"Orientação da rede"**
> sobre a avaliação/reavaliação, **editável pelo Admin Master** (migração 0136,
> `clinical_guidance`), para o coordenador consultar rápido. Os próximos blocos
> (painel de status, gravação+roteiro, checklist de qualidade) penduram nesta
> espinha. _Adiados por dependência: situação financeira/inadimplência (aguarda
> módulo financeiro) e resumo automático por IA._

> **LOTE Avaliações & Planos — Entrega 4 (parte 4B) ✅ (v0.85.0, sem migração):**
> nova aba **"Desenvolvimento Clínico"** no prontuário, para o **dentista
> executor**: mostra o **plano aprovado** (referência da execução) + a **evolução
> clínica** (anotações do dentista), agora **separada** da aba Clínico (que passa
> a ser só a avaliação do Coordenador). Também: cockpit de avaliação com **rolagem
> independente** das colunas, editor de plano sem repetição de "Diagnóstico", e
> blocos do plano **recolhidos por padrão** na visualização (v0.84.1). _A pedido
> do dono, o refino visual de 4A+4B vem em seguida._

> **LOTE Avaliações & Planos — Entrega 4 (parte 4A) ✅ (v0.84.0, sem migração):**
> **Cockpit do Coordenador Clínico** — tela dedicada `/avaliacao/[cliente]` nos
> moldes do cockpit do Planner, em **2 colunas**: à esquerda o **espaço de
> avaliação** (consentimento, rodadas de avaliação com filtro, galeria de mídia,
> considerações, "Iniciar reavaliação", "Enviar ao Centro de Planejamento"); à
> direita os **planos** para **revisão/aprovação** (aprovar/reprovar por opção),
> em leitura. O Coordenador abre pelo **banner na aba Clínico** e pelo link
> **"Cockpit de avaliação"** no **cartão da Jornada** (Fases Conversão Clínica /
> Reavaliação). _Falta a parte 4B: aba "Desenvolvimento Clínico" do dentista
> executor (execução do plano aprovado)._

> **LOTE Avaliações & Planos — Entrega 3 ✅ (v0.83.0, migração 0135):**
> **avaliações/reavaliações versionadas** (rodadas). Antes, a coleta clínica
> (considerações + fotos/exames) se empilhava no cliente sem separar "quando".
> Agora cada avaliação é uma **rodada datada**: **Avaliação 1**, depois
> **Reavaliação 2**, **3**… Cada consideração e cada mídia entra na **rodada
> aberta**. Um botão **"Iniciar reavaliação"** (Coordenador) fecha a rodada atual
> — que fica **congelada e intacta** — e abre a próxima. Na aba **Clínico** há um
> cabeçalho "Rodada atual", **chips de filtro** por rodada (Todas · Aval. 1 ·
> Reaval. 2…) e uma **etiqueta** da rodada em cada consideração. **Backfill
> seguro:** tudo que já existe virou automaticamente a "Avaliação 1" — nada se
> perde. **Consentimento e anamnese continuam contínuos** (não repetem por
> rodada). _Adiado: agrupar a galeria de mídia por rodada (hoje é filtro) e a
> decisão "reavaliação × novo planejamento" ao fim da Fase 5._

> **LOTE Avaliações & Planos — Entrega 2 ✅ (v0.82.0, migração 0134):** o plano
> agora tem uma **linha do tempo única** (situação). Os 4 status internos
> (planejamento / aguardando aprovação / em revisão / aprovado pelo Coordenador)
> são os **primeiros passos** e um campo novo (`lifecycle`) **continua** depois de
> aprovado: **Aguardando apresentação → Apresentado → Aceito/Reprovado pelo cliente
> → Em tratamento → Concluído** (Cancelado/Suspenso ficam **reservados** — telas nas
> Fases 6/7). O `status` antigo **não muda** (segue guiando a fila e a trava 3→4).
> Cada plano mostra **etiqueta colorida** da situação (na ficha, no cockpit e nos
> chips de seleção); há **botões para avançar** a situação, liberados por papel
> (Planner → apresentação; Comercial → apresentado/aceito/reprovado; Dentista/
> Coordenador/Recepção/Gerente → em tratamento/concluído). Ao **enviar ao Comercial
> (3→4)**, os planos aprovados viram "Aguardando apresentação" **automaticamente**.
> Todo movimento fica registrado (`treatment_plan_status_events`) e o Planner é
> avisado quando o cliente aceita/reprova. _Adiado p/ Fase 5: refletir a nova
> situação também na tela `/planos` (hoje ela deriva da jornada)._

> **LOTE Avaliações & Planos — Entrega 1 ✅ (v0.81.0, sem migração):** fim do bug
> destrutivo + base de vários planos. (1) O prontuário/cockpit **listam TODOS os
> planos** do cliente (`loadClientPlans` + `PlanEditorSwitcher`); nenhum é
> escondido. (2) **Editar plano aprovado deixou de destruir**: saiu o "Reabrir"
> (que rebaixava pra rascunho); no lugar, **"Criar cópia para revisar"** gera um
> plano NOVO copiando o aprovado, que continua intacto. (3) **"Novo plano"** cria
> um plano adicional em branco. (4) `createTreatmentPlan(clientId, copyFromId?)`
> sempre cria novo (com duplicação opcional de opções/itens/etapas). O editor
> **remonta por `key`** ao trocar de plano (sem arrastar texto/auto-save entre
> planos). Próximas fases: status ricos, cockpit do coordenador, avaliações
> versionadas, cancelar/suspender, histórico e KPI.

> **Prontuário — aba Cadastro ✅ (v0.80.10, sem migração):** **Dados do cliente**
> reorganizados em seções (Identificação / Contato / Endereço / Observações) com
> ícone dourado + rótulo pequeno e valor em destaque; **ordem dos blocos** com os
> Dados do cliente **primeiro** e os complementos abaixo (Compartilhamento,
> Empresarial, Responsáveis, Dependentes); **Responsáveis** com avatar de iniciais
> e linha mais limpa; cabeçalhos com ícone. Só visual. (1ª aba da rodada do
> prontuário — vamos aba a aba.)

> **Chat Hub — painel de bloqueados ✅ (v0.80.9, sem migração):** o Admin tem um
> botão **"Bloqueados (N)"** no topo da coluna que abre um diálogo com **todos os
> usuários bloqueados** (nome + data) e **Desbloquear** por linha (action
> `listBlockedChatDetails`).

> **Chat Hub — coluna + grupo/individual ✅ (v0.80.8, sem migração):** a **coluna
> de conversas** ganhou fundo `bg-muted` (nítido, não confunde mais com o fundo da
> tela) e a área de leitura ficou `bg-card` (contraste claro). Na lista, **grupo ×
> individual** ficou evidente: equipe = **avatar navy sólido** + **faixa lateral +
> leve tinta azul** na linha + selo "EQUIPE"; individual = **iniciais em círculo
> branco com borda**.

> **Chat Hub — ajustes ✅ (v0.80.7, migração 0133):** (1) **reação única** por
> usuário/mensagem (clicar em outro emoji troca, não soma). (2) **citação clicável**
> — clicar na mensagem citada rola até a original e a destaca. (3) **Bloqueio no
> chat** (migração 0133 `chat_blocked_users`): só o **Admin Master** bloqueia/
> desbloqueia (no popup de membros); o bloqueado **perde o acesso à tela de Chat**.
> (4) **popup de membros** com botão **"Conversar"** por membro (abre conversa
> direta). (5) **coluna de conversas** com fundo distinto da área de leitura. (6)
> **conversa de equipe** com cor/selo "EQUIPE" (lista, cabeçalho e aviso acima do
> campo "vai para TODA a equipe") — reduz risco de mandar no grupo por engano.

> **Refino visual — Chat Hub ✅ (v0.80.6, sem migração):** cabeçalho com ícone de
> balão; **lista de conversas** repaginada estilo WhatsApp — **avatar em círculo**
> (equipe = ícone de grupo; direta = iniciais), **hora da última mensagem** à
> direita (fuso de São Paulo), prévia + selos de não lidas/importante numa 2ª
> linha; **estado vazio** com ícone e texto amigável. Só camada visual — tempo
> real, envio, anexos, reações e recibos intocados.

> **Refino visual — Notificações ✅ (v0.80.5, sem migração):** cabeçalho com
> **sino** + selo de **não lidas**; chips de categoria com **bolinha de cor** (as
> sem itens ficam escondidas) + chip **"Não lidas"** (filtra o que falta ler, via
> `?naolidas=1`); lista com **ícone da categoria em círculo colorido**, não lidos
> com **bolinha dourada**, e **agrupada por data** (Hoje / Ontem / Esta semana /
> Mais antigas) com hora no fuso de São Paulo (determinístico, sem divergência de
> hidratação). Novo mapa `NOTIFICATION_CATEGORY_DOT` em `src/lib/notifications.ts`.

> **Editor — nova opção por botão + carência ✅ (v0.80.4, sem migração):** o
> formulário de **nova opção de tratamento** virou um **botão "Adicionar opção"**
> (abre só ao clicar). O selo **★ Risarte Empresarial** passou a aparecer na
> **identificação do cliente** (cabeçalho do cockpit). Para o Planner: cada
> procedimento com benefício **em carência** (ou bloqueado) mostra um aviso âmbar
> ("Em carência até DD/MM") e a opção recolhida mostra **"N em carência"**.

> **Editor — opções recolhíveis + Resumo navegável ✅ (v0.80.3, sem migração):**
> cada **opção de tratamento recolhe/expande** (seta no cabeçalho; principal abre,
> alternativas recolhem por padrão). Recolhida, mostra um **resumo**: "Plano
> principal" (se for), **prioridade média**, nº de **procedimentos**, **etapas**,
> **sessões**, **tempo de cadeira**, **valor total** e **economia** (Risarte
> Empresarial). O **Resumo do tratamento** virou **navegável entre todos os planos**
> (setas ‹ ›) e ganhou **nº de procedimentos** + **prioridade média** por plano.

> **Editor — cartões de procedimento + etapas ✅ (v0.80.2, sem migração):** cada
> procedimento virou um **cartão nítido** (borda + fundo) com **faixa lateral
> colorida pela prioridade** (vermelho/âmbar/verde) e layout em linhas (nome+valor /
> prioridade / etapa+profissional). A **criação de etapas** virou uma seção
> **recolhível própria** ("Etapas do tratamento (opcional)"), separada do orçamento;
> os cabeçalhos de etapa nos grupos ficaram em **maiúsculas com ícone dourado**.

> **Cockpit + Editor — reformulação ✅ (v0.80.1, sem nova migração):** (1) **Editor
> de plano vira a área principal** em largura total; Resumo, Atendimentos,
> Evidências, Anamnese e Considerações viram uma **barra de botões que abrem
> pop-up** (`PopupCard`). Anamnese marca alerta no botão. (2) **Diagnóstico e
> objetivos** ficam num bloco **recolher/expandir**. (3) **Adicionar procedimento**
> some atrás de um botão **"+ Procedimento"**. (4) **Confirmação antes de excluir**
> opção/procedimento/etapa (`ConfirmDialog`). (5) **Selo Empresarial** virou linha
> discreta. (6) **GUT**: procedimentos **reordenam por prioridade** (maior no topo);
> cada opção mostra a **prioridade média** (`GutAverageBadge` — soma÷qtd →
> Alta/Média/Baixa + média); o selo aparece também em **Atendimentos e sequência**.
> (7) **Arquivos** (foto/raio-x/PDF/vídeo) **ampliam em tela cheia** (lightbox
> estendido + botão "Ampliar"). Prioridades são só para a equipe (nunca ao cliente).

> **Editor de Plano — GUT + auto-save + hierarquia ✅ (v0.80.0, migração 0132):**
> (A) **Hierarquia visual**: cada seção (Diagnóstico, Objetivos, Considerações,
> Opções) com título de ícone dourado; em leitura o texto do Planner vai num
> **painel próprio** (rótulo em cima), separando "campo" de "conteúdo escrito".
> (B) **Auto-salvamento**: Diagnóstico, Objetivos e Considerações **salvam sozinhos**
> (~1s após parar de digitar) com aviso "Salvando…/Salvo ✓"; sumiram os botões de
> salvar. (C) **Prioridade GUT por procedimento** (migração 0132: colunas
> `gut_gravity/urgency/tendency` em `treatment_plan_option_items`, 1..5, opcionais):
> o Planner define G/U/T por item; o sistema calcula **G×U×T** e mostra um **selo
> Alta/Média/Baixa + número** (cortes Alta≥45, Média 18–44, Baixa 1–17 em
> `src/lib/gut.ts`); selo aparece no editor, no resumo do Coordenador e no Resumo do
> tratamento. Ajuda o Comercial a priorizar numa negociação. (D) **Selo Risarte
> Empresarial no cockpit** (antes só na ficha): mostra o selo do programa + economia
> por opção também para o Planner. Apresentação do Comercial recebe o GUT numa
> rodada futura.

> **Cockpit — blocos recolher/expandir ✅ (v0.79.3, sem migração):** para a tela
> não ficar tão longa, cada bloco vira **recolhível** (clique no cabeçalho: seta
> gira, corpo some). Componente reutilizável `CollapsibleBlock`
> (`src/components/collapsible-block.tsx`). Aplicado em **Resumo do tratamento**,
> **Atendimentos**, **Evidências**, **Anamnese** e **Considerações**. Defaults que
> encurtam a tela: Evidências e Considerações **começam recolhidas** (com contador
> ao lado do título); a **Anamnese abre sozinha só quando há alerta de risco**
> (mostra o nº de alertas); Resumo/Atendimentos/Informações do Coordenador abrem
> normalmente. O **Editor do plano** fica sempre visível (é o trabalho principal).

> **Refino visual — Cockpit de Planejamento ✅ (v0.79.2, sem migração):**
> cabeçalho virou **cartão de identidade** (avatar com iniciais + faixa fina na
> **cor da fase** no topo + código/unidade/Fase/Situação/Pilar em uma linha e ações
> à direita), o alerta de **apresentação marcada** virou cartão de urgência (ícone
> em bolha + data por extenso + cronômetro), o **Resumo do tratamento** trocou as
> tags cinzas por **mini-cards com ícone** (sessões / cadeira / etapas), e as seções
> **Evidências / Anamnese / Considerações** ganharam ícone dourado no título; os
> **alertas da anamnese** ficaram com ícone de atenção. Só camada visual.

> **Cor da fase em todo o sistema ✅ (v0.79.1, sem migração):** componente
> reutilizável **`PhaseBadge`** + helper `phaseTintStyle` (`src/components/
> phase-badge.tsx`) que mostram a fase na **cor oficial suavizada** (fundo levinho
> + texto escurecido da própria cor — menos vivo). Aplicado onde a fase aparece:
> **Ficha** (pílula do cabeçalho + seção Jornada), **Agenda** (card + popup de
> informações), **Retornos**, **Prontuários** (lista), **Planejamento** (cockpit),
> **Planos**, e **Relatórios** (selos numerados + mapa de calor por cor da fase).
> O **kanban** ficou como estava (pedido do dono).

> **Refino visual — Jornada/Kanban ✅ (v0.79.0, sem migração):** cada coluna
> (fase) ganhou o **acento de cor oficial da fase** (definido pelo dono): faixa no
> topo + número tingido na cor. Cores em `PHASE_COLORS` (`src/lib/journey.ts`,
> reutilizável): Aquisição #ff5050, Conversão Clínica #ff914d, Centro de
> Planejamento #ffde59, Conversão Comercial #74cc00, Início de Tratamento #00bf63,
> Reavaliação #0cc0df, Acompanhamento #e2a9f1. O **contador da coluna** fica
> **vermelho com N ⚠** quando há SLA estourado. Filtros (unidade/pilar/status) num
> **bloco compacto**. Cards mantidos.

> **Relatórios — ajustes do feedback ✅ (v0.78.1, sem migração):** (1)
> **Agendamentos** menos "tudo igual": situação vira **barra segmentada** colorida
> (total grande + faixa proporcional por situação + legenda) e tipo/profissional/
> unidade em 3 colunas de barras. (2) **Rede por fase**: virou **mapa de calor**
> (intensidade da célula pela quantidade, via `color-mix` sobre `--primary`) +
> coluna **Total** por unidade + grande total. (3) **Produtividade**: números bem
> **maiores** (text-3xl, ícone ao lado) — corrige "dado pequeno em card grande".

> **Refino visual — Relatórios ✅ (v0.78.0, sem migração):** (1) filtros num
> **bloco compacto** e página em `max-w-6xl`. (2) **Agendamentos**: "por situação"
> com **pontinhos de cor** (paleta da Agenda) e "por tipo/profissional/unidade"
> com **barra de proporção** (`BarRow`) + número. (3) **Rede por fase**: cabeçalho
> com **selo numerado** da fase, zebra, célula 0 esmaecida e **linha Total
> destacada**. (4) **Produtividade**: os 5 números viram **cartões com ícone e cor**
> (aprovados=verde, devolvidos=âmbar, tempo médio=navy; `METRIC_TONE`). Só visual.

> **Atendimento — seletor de unidade + indicadores consolidados (H4.16) ✅
> (v0.77.0, sem migração):** (#4) **Admin** (e quem acessa >1 unidade) escolhe a
> unidade **na própria tela** (seletor `?unidade` no cabeçalho e na tela de
> "selecione uma unidade"), sem depender do menu lateral. (#5) opção **"Todas as
> unidades"** → mostra os **indicadores consolidados** de todas as unidades (o
> painel/sala de espera continua por unidade, com aviso para escolher uma).
> Helper `computeAttendanceMetrics(clinicIds[], scopeProvider, período)` reaproveitado
> para 1 unidade ou o consolidado. Quem tem só 1 unidade (recepção/gerente) segue
> exatamente igual (sem seletor).

> **Indicadores — filtro de profissional + rótulo de escopo (feedback) ✅
> (v0.76.3, sem migração):** (1) o filtro **por profissional** do cabeçalho agora
> também **filtra os indicadores** (antes só filtrava o painel): comparecimento,
> conclusão, tempos, produtividade e as ocorrências/trocas passam a respeitar o
> profissional escolhido (`scopeProviderId`). (2) o popup mostra o **escopo**: "Todos
> os profissionais da unidade" / "Profissional: Fulano" / "Somente os seus
> atendimentos" (dentista). Confirmado: dentista "puro" vê só os **seus**
> atendimentos (por `provider_user_id`); gestão vê todos.

> **Indicadores — visual do popup (feedback) ✅ (v0.76.2, sem migração):** cards
> eram muito parecidos e sobrava um sozinho. Reorganizado em **3 seções**: (1)
> **métricas principais** — Comparecimento (verde) e Taxa de conclusão (navy) com
> **barra de progresso** na cor; (2) **indicadores rápidos** — Espera média /
> Atendimento médio / Produtividade em 3 colunas com ícone; (3) **Ocorrências no
> período** num bloco 2×2 (Faltas/Cancelamentos/Desistências/Trocas) — preenche
> sem card órfão. Diálogo um pouco mais largo (`sm:max-w-xl`). `RateCard` +
> `MiniStat` no lugar do `StatCard`.

> **Indicadores — tirar repetição + 2 métricas (feedback) ✅ (v0.76.1, sem
> migração):** o card "Comparecimento" (% de concluídos) e "Concluídos" (nº)
> diziam o mesmo. Agora: **Comparecimento** = quem **apareceu** (check-in) ÷
> agendados, e **Taxa de conclusão** = **concluídos** ÷ agendados — a diferença
> mostra quem veio mas não concluiu. Adicionado **Tempo médio de atendimento**
> (do "chamar" ao "concluir"), fazendo par com o tempo médio de espera. Removido
> o card "Concluídos" repetido.

> **Atendimento — Indicadores (H4.15) ✅ (v0.76.0, sem migração):** botão
> **"Indicadores"** no cabeçalho abre um popup com os números do **período** (dia/
> semana/mês). **Permissão**: dentista vê só os **seus** atendimentos; Recepção/
> Coordenador/Gerente/Admin veem **todos** (aviso de escopo no popup). Cartões:
> **Comparecimento** (concluídos ÷ agendados), **Produtividade** (sessões
> finalizadas — `treatment_sessions` done no período), **Tempo médio de espera**
> (`called_at − checked_in_at`), **Concluídos/agendados**, e **Faltas /
> Cancelamentos / Desistiu de esperar / Troca de profissional** com **lista de
> clientes ao clicar** (troca mostra de→para, da tabela `appointment_provider_swaps`).
> Componente `attendance-indicators.tsx`; cálculo no `page.tsx`.

> **Atendimento — correções do teste (feedback) ✅ (v0.75.1, sem migração):**
> (1) **card na vertical**: dados em cima, botões numa faixa embaixo (o botão não
> fica mais em cima do texto; texto deixa de ficar amontoado nas colunas estreitas).
> (2) **cada coluna rola sozinha** (`max-h` + `overflow-y-auto` no conteúdo), não
> rola a tela toda. (3) **alerta** dos pendentes bem mais curto. (4) **bug do
> concluir**: ao concluir um atendimento de **dia anterior** (pendente), o card
> sumia — o filtro dos pendentes só pegava `scheduled/confirmed`; agora também
> puxa os **concluídos hoje** (`done_at` de hoje), então ficam na coluna
> Concluídos. O aviso "X pendências" conta só as ainda em aberto.
> **Adiado (recurso novo, a planejar):** botão **Indicadores** (popup com taxa de
> comparecimento, produtividade, tempo médio de espera, faltas/cancelamentos/
> desistências/trocas com lista ao clicar; dentista vê só os seus, recepção/
> coordenador/gerente veem todos).

> **Refino visual — Atendimento (sala de espera) ✅ (v0.75.0, sem migração):**
> (1) as 4 etapas viraram um **quadro de fluxo em 4 colunas** (chegar → espera →
> atendimento → concluídos), lendo da esquerda pra direita (`lg:grid-cols-4`,
> empilha em telas menores). (2) cada coluna com a **cor da etapa**: azul (chegar),
> âmbar (espera), violeta (atendimento), verde (concluídos) — acento no topo do
> cartão, ícone e contador coloridos (`ColumnCard` + config `STAGE`). (3) cartões
> dos clientes ganham **acento lateral** na cor da etapa (pendentes seguem em
> vermelho). (4) filtros num **bloco compacto** e página em `max-w-6xl`.

> **Fix — "pulo" da tela ao trocar de aba (de verdade) ✅ (v0.74.3, sem migração):**
> o `scrollbar-gutter: stable` estava no `html`, mas quem rola é o **`<main>`**
> (o `overflow-x-auto` do main força `overflow-y: auto`, então o main é o
> container de rolagem). Movido o `scrollbar-gutter: stable` para o `<main>` no
> layout — a barra vertical passa a ter espaço reservado sempre e o conteúdo não
> desloca ao trocar de aba (altura diferente entre abas fazia a barra aparecer/
> sumir e empurrar o cartão centralizado). Vale para todas as telas.

> **Ficha + largura geral (feedback do dono) ✅ (v0.74.2, sem migração):**
> (1) **pílulas diferenciadas**: Fase (navy) e **Pilar da metodologia** (dourado,
> NOVO) em destaque; unidade/nascimento/idade neutras mas com **ícone colorido**
> (evita ficarem "todas iguais"). (2) **"pulo" da tela ao trocar de aba/tela**
> resolvido com `scrollbar-gutter: stable` no `html` (reserva sempre o espaço da
> barra). (3) **largura padronizada**: telas de conteúdo/lista que estavam
> estreitas (3xl/4xl) foram para **`max-w-6xl`** (a dimensão da ficha) — admin/
> documentos, admin/sla, agenda/planejamento-anual, agenda/retornos, atendimento,
> meu-dia, minha-agenda, notificacoes. **Formulários focados** (2xl: cadastro,
> usuário, perfil, config da agenda, especialidades) e telas já largas (5xl+)
> ficam como estão; arquivos do **Empresarial** não foram tocados (projeto à parte).

> **Ficha — ajustes do cabeçalho (feedback do dono) ✅ (v0.74.1, sem migração):**
> (1) **barra de rolagem das abas escondida** (continua rolável). (2) ficha **bem
> mais larga** (`max-w-6xl`). (3) **cabeçalho reequilibrado**: identidade + selos
> à esquerda, **ações no topo-direito**, e as **pílulas numa faixa própria** de
> largura total (antes tudo empilhava de um lado). (4) pílulas de **nascimento**
> (`Nasc. dd/mm/aaaa`) e **idade** (`64 anos`, idade detalhada no title). (5)
> **tempo de cliente** entre parênteses na data (ex.: "Cliente desde 10/07/2026
> (há 6 dias)"). Helpers `shortAge` + `clientDuration`.

> **Refino visual — Ficha do cliente/prontuário ✅ (v0.74.0, sem migração):**
> (1) **Cabeçalho vira cartão de identidade**: avatar com iniciais (navy + inicial
> dourada; anel dourado no aniversário), nome + **código** em chip dourado, e
> **unidade / idade / fase da jornada** como **pílulas com ícone** (antes eram
> linhas soltas); selos e botões agrupados (Novo agendamento em destaque);
> **símbolo Risarte** como marca d'água discreta. (2) **Abas com acento dourado**:
> aba ativa com sublinhado dourado + ícone por aba (`prontuario-tabs.tsx`), em vez
> do bloco navy cheio. (3) Ficha **um pouco mais larga** (`max-w-3xl`). Helpers
> `initialsOf` + `PHASE_LABELS` no cabeçalho.

> **Agenda — arrastar: aviso de fim fora do horário ✅ (v0.73.1, sem migração):**
> ao arrastar para um horário que **começa dentro do expediente mas termina no
> almoço ou após o fechamento**, o diálogo de confirmação agora mostra um **aviso
> âmbar** (ex.: "termina após o fechamento (18:00)") — antes o `warn` do servidor
> era descartado no arrastar. Confirmar continua liberado (é aviso, não bloqueio);
> após gravar, o mesmo aviso vai num toast e o profissional é notificado (igual ao
> formulário). Helper `overrunWarning` em `agenda-drag.tsx`.

> **Agenda — arrastar o card p/ reagendar (H4.14) ✅ (v0.73.0, sem migração):**
> arrastar-para-remarcar **suave** (baseado em ponteiro: mouse E toque) nas grades
> **Semana por hora** (arrasta p/ outro dia/horário — antes não tinha) e **Dia por
> sala** (substitui o drag nativo, antes duro e sem confirmação). Um clique curto
> continua abrindo a ficha/informações (só vira arrasto após mover ~5px); o card
> segue o cursor com uma **prévia** e o alvo (dia/sala + horário, encaixe de 15 min)
> aparece com uma linha. Ao soltar, **confirmação rápida** (decisão do dono): mostra
> "de → para" e só grava no **Confirmar** — reusa `updateAppointment`, que valida
> fora do horário / dia fechado / cadeira lotada / conflito e recusa com o motivo.
> Módulo novo `agenda-drag.tsx` (`useCardDrag` + `DragPreview` +
> `RescheduleConfirmDialog`). Só card **futuro** arrasta.

> **Agenda — refino visual Bloco 3 ✅ (v0.72.1, sem migração):** (1) **feriado na
> régua de dias** (DayStrip) agora marca "Feriado" com ícone (antes só mudava de
> cor quando a unidade atendia). (2) ícone do feriado: emoji 🎌 trocado por **ícone
> Flag** (semana + dia). (3) filtros **Salas + Profissional** juntos num **bloco
> compacto** (menos espaço). ~~Adiado: arrastar o card p/ reagendar~~ → **feito na
> v0.73.0** (ver nota do H4.14 acima).

> **Agenda — refino visual Bloco 2 ✅ (v0.72.0, sem migração):** (1) **filtro por
> profissional** (`ProviderFilter`, `?profissional=userId`; filtra por profissional
> responsável; opções = staff com papel clínico/consultor/dentista). (2) botões
> secundários agrupados no menu **"Mais ações"** (`AgendaActionsMenu`: Configurar
> agenda / Planejamento anual / Retornos), deixando **Novo agendamento** em destaque
> e Fechar agenda à parte. (3) **nome do feriado** mais visível na semana (chip
> vermelho no cabeçalho do dia, sem truncar).

> **Agenda — refino visual Bloco 1 ✅ (v0.71.0, sem migração):** (1) **atendimento
> conjunto** agora mostra os **nomes** dos profissionais no bloco (era só "Conjunto
> +N"); `JointBadge` compartilhado. (2) **Situações com cor** no popup do
> agendamento (botões + selo da situação atual: azul/verde/cinza/vermelho/laranja).
> (3) **Barras de rolagem** ainda mais discretas (8px, mais transparentes). (4)
> **Cabeçalho da Agenda** redesenhado: cada info numa "pílula" com ícone (unidade ·
> período · **Semana X/total** · nº salas). **Bloco 2 pendente:** nome do feriado na
> linha do tempo (aguardando print do ponto exato), **filtro por profissional**, e
> agrupar/diferenciar os botões (dropdown "Mais ações").

> **Barras de rolagem refinadas ✅ (v0.70.1, sem migração):** em `globals.css`,
> scrollbars finas, arredondadas e discretas em **todas as telas** (Firefox via
> `scrollbar-width/color`; Chromium/Safari via `::-webkit-scrollbar`), com a cor
> derivada de `--muted-foreground`. **Agenda (cores dos blocos, legibilidade,
> cabeçalho):** pendente — feito com o dono olhando ao vivo (grade densa que não
> renderiza na prévia).

> **Sidebar minimizar/expandir ✅ (v0.70.0, sem migração):** botão de alternar no
> topo da sidebar; minimizada = só ícones (`w-16`), rótulos escondidos com tooltip
> (`title`), badges viram pontinho, trocador de clínica/versão ocultos, avatar/Sair
> compactos. Estado salvo em **cookie** (`risarte_sidebar_collapsed`), lido no layout
> (server) para não "piscar". `ChatNavItem`/`NotificationNavItem` ganharam prop
> `collapsed`.

> **Correção ativo/inativo + refino visual da Jornada ✅ (v0.69.0 · migração 0131):**
> **Bug:** o status ativo/inativo (regra da 0020) só era recalculado pelo cron diário
> (3h) — que pode não estar ligado; mover fase/agendar não atualizava na hora.
> **Fix (0131):** `recompute_client_activity_one(client)` + **gatilhos** — recalcula o
> cliente ao **mudar de fase** (trigger em `clients` OF journey_phase/phase_entered_at)
> e ao **criar/alterar/remover atendimento** (trigger em `appointments`); recálculo
> geral uma vez ao aplicar. **Visual da Jornada:** nº da fase na coluna; cartões com
> cantos suaves + hover + fundo vermelho suave no SLA estourado; **sub-status da
> Fase 5** em badge colorida (âmbar = aguardando iniciar, verde = em tratamento);
> **inativo** com borda tracejada + fundo acinzentado; **quadro com altura fixa** e
> colunas que rolam por dentro (barra horizontal sempre visível). Migração a rodar: **0131**.

> **Ajuste (v0.68.1):** a logomarca completa (texto grande branco) ficou "escrita
> demais"; login e sidebar voltaram ao formato **compacto** — **símbolo em dourado**
> (`RisarteMark` com `text-gold`) + "Risarte Odontologia" ao lado. `RisarteWordmark`
> segue disponível para uso futuro.

> **Rodada de refinamento visual (em andamento, guiada pelo dono):** (5) **Menu
> lateral + Logomarca Risarte** ✅ (v0.68.0) — a **logomarca/símbolo reais** da
> Risarte entraram (arquivos brancos em `public/`: `risarte-logo-branca.png` e
> `risarte-simbolo-branco.png`). Componente `RisarteWordmark`/`RisarteMark` usa a
> arte como **máscara** e pinta na cor atual (`bg-current` ← `text-*`), então a mesma
> arte vira branca (fundo navy), navy ou dourada (fundo claro) sem novo arquivo.
> Aplicado: **login** (logomarca branca no painel; navy no cabeçalho do celular),
> **sidebar** (logomarca branca no topo) e **hero da página inicial** (símbolo como
> marca d'água). Sidebar também ganhou **barra dourada** no item ativo + **avatar**
> do usuário no rodapé. Ver [[risarte-logo-usage]].
> (3) **Página
> inicial** ✅ (v0.67.0) — cabeçalho de boas-vindas (faixa navy + dourado): saudação
> pela hora (fuso SP), data por extenso, monograma do usuário, unidade ativa e selo
> Admin Master; cartões com ícones. Login: rodapé passou de "Sistema Risarte" para
> **"riSZon"**.
> (1) **Login**
> ✅ (v0.66.0) — painel de marca navy + dourado à esquerda (monograma R + tagline),
> cartão de acesso à direita, rodapé com versão; no celular vira coluna única.
> (2) **Base — fonte Geist** ✅ (v0.66.1) — corrigido o mapeamento em `globals.css`
> (`--font-sans`/`--font-heading` apontavam para si mesmos → app usava a fonte padrão
> do navegador); agora usa a **Geist** em todas as telas. Próximas telas a combinar
> com o dono.

> **H4.13 — Excluir especialidade ✅ (v0.65.1 · migração 0130):** na tela de
> Especialidades, além de editar/desativar, agora dá para **excluir**. Ao excluir,
> escolhe-se **mover os procedimentos/Risartanos para outra especialidade** OU
> deixá-los **sem especialidade** (RPC `delete_specialty` cascateia com segurança;
> dedup no array do staff). Migração a rodar: **0130**.

> **H4.13 — Bloco 2: Comissionamento em massa + regra ✅ (v0.65.0, sem migração) —
> H4.13 COMPLETO.** Novo painel **"Comissão em massa"** nos Procedimentos (Admin/
> Planner, modo rede): define **% e/ou R$ fixo** por **Todos / Especialidade / Pilar /
> Selecionados** (campo em branco não altera). Cada mudança fica no histórico do
> procedimento (`setCommissionBulk`). **Regra documentada na tela**: a comissão só é
> contabilizada com o procedimento **finalizado**; o **pagamento** é do **módulo
> financeiro (Fase 2)** — aqui é só o cadastro da regra.

> **H4.13 — Bloco 1: Especialidades gerenciáveis ✅ (v0.64.0 · migração 0129):**
> a especialidade deixou de ser texto livre e virou uma **lista padrão gerenciável**
> (tabela `specialties`, nível da rede, já populada + backfill do que existia). Tela
> nova **"Especialidades"** (a partir de *Procedimentos*, `/procedimentos/especialidades`,
> Admin Master + Dentista Planner): **adicionar · renomear · ativar/desativar ·
> reordenar**. **Renomear cascateia** (RPC `rename_specialty`) para os procedimentos
> e Risartanos que usavam o nome antigo. No **procedimento** a especialidade virou
> **lista suspensa** (mantém valor antigo se houver); no **Risartano** as opções vêm
> da lista ativa; **filtros** usam a lista. **Falta o Bloco 2** (comissionamento em
> massa + regra "comissão só com procedimento finalizado"). Migração a rodar: **0129**.

> **H4.11 — Ajustes do Modo apresentação ✅ (v0.63.1, sem migração):** (1) **tela
> cheia de verdade** (Fullscreen do navegador; sai no Esc/botão, e sair da tela
> cheia fecha o modo); (2) **não corta mais** — cada bloco rola dentro do slide
> (altura fixa + rolagem interna) e **cada foto vira um slide** só dela (imagem
> grande, sem cortar); (3) **seletor de fotos antes de apresentar** (todas/algumas,
> com atalhos "Todas"/"Nenhuma"). `buildSlides("scroll"|"present")` +
> `PhotoPicker` reaproveitado (Gamma e apresentação).

> **H4.11 Apresentação 2.0 — Bloco 2: layout 2.0 + Modo apresentação ✅ (v0.63.0,
> sem migração) — H4.11 COMPLETO.** A apresentação (`/apresentacao/[clientId]`) virou
> um **deck de verdade**: **capa 2.0** (marca Risarte + faixa dourada, nome grande,
> código · unidade · data, pilar em selo); cada bloco vira **slide com moldura**
> (título com acento dourado + **rodapé** com marca, paciente e numeração — também
> no PDF); **proposta com o total num cartão** navy em destaque; **fotos com
> legenda** em grade responsiva (lightbox mantido). **PDF** agora sai **um slide por
> página** + numeração. **Modo apresentação** (botão **"Apresentar"**): tela cheia,
> **um slide por vez**, navega pelas **setas do teclado** (→/espaço avança, ← volta,
> **Esc** sai) e por botões, com contador. Tudo em `presentation-view.tsx`
> (`CoverSlide`/`SlideShell` + array `slides`); **sem migração e sem mexer no Gamma**.

> **H4.11 Apresentação 2.0 — Bloco 1: Fotos no Gamma ✅ (v0.62.0, sem migração):**
> as **fotos/exames do paciente agora vão automáticas pro deck do Gamma**. Antes o
> app enviava `imageOptions: noImages`, que **apagava** as imagens embutidas —
> confirmado em teste real na API do Gamma. Agora, quando há fotos, usa
> `webAllImages` + instrução "usar só as imagens fornecidas": o Gamma **preserva só
> as nossas fotos** (sem imagem genérica) e **copia cada uma pro CDN dele** no
> momento da geração — por isso o link assinado (1h) basta e nada de paciente fica
> exposto depois (LGPD ok). Card **"Imagens e exames"** embutido em `buildInputText`.
> Na tela, ao clicar **"Gerar no Gamma"** aparece um **seletor de fotos** (todas
> marcadas por padrão; dá pra desmarcar) e depois **"Gerar deck (N fotos)"**.
> `generateGammaDeck(clientId, photoIds?)`. **Falta o Bloco 2** (layout 2.0 mais
> rico/responsivo da tela + PDF). Requer a `GAMMA_API_KEY` na Vercel pra usar o botão.

> **H4.9 Chat Hub — Lote 3 ✅ (v0.61.0 · migração 0128) — H4.9 COMPLETO.**
> **Insistência até visualizar:** quem envia pode marcar a mensagem como
> **importante** (botão ⚠️ no compositor → a bolha ganha o selo "Importante").
> Enquanto o destinatário não abrir a conversa: (1) **faixa fixa** no topo do
> Chat ("Você tem N importantes não lidas — Ver" pula pra conversa) + **marcador
> âmbar** no canal na lista; (2) **reaviso insistente** em qualquer tela — som
> duplo + pop-up **a cada 60s** (fora do /chat, onde a faixa avisa). Para na hora
> que ele abre a conversa (marca como lida). Coluna `chat_messages.important` +
> RPCs `chat_important_unread()` / `chat_important_unread_total()`. Migração a
> rodar: **0128**. **H4.9 fechado (Lote 1 + R1–R4 + Lote 2 + Lote 3; 0120–0128).**

> **H4.9 Chat Hub — Lote 2 ✅ (v0.60.0 · migração 0127):** **anexos** no chat —
> **arquivo** (clipe → escolhe o arquivo) e **gravar áudio** (microfone). Bucket
> privado `chat-media` (caminho `<channel_id>/<uuid>-nome`, link assinado 1h,
> policies por acesso ao canal); coluna de anexo em `chat_messages` (path/name/
> type/kind); `body` deixou de ser obrigatório (mensagem só com anexo). Render por
> tipo: **imagem** (miniatura clicável), **áudio** (player) e **arquivo** (link com
> baixar). `sendAttachment` + `getMessages` assina os links. Máx. 25 MB. **Falta o
> Lote 3** (insistência até visualizar) — e o H4.9 fecha. Migração a rodar: **0127**.

> **H4.9 Chat Hub — R4b ✅ (v0.59.0 · migração 0126) — H4.9 COMPLETO até o Lote 1.**
> **Configurar quem conversa com quem** (unidade ↔ franqueadora) por função:
> tabela `chat_contact_rules` (par franqueadora×unidade, ausência = permitido);
> tela do Admin **`/admin/chat`** (matriz de funções, salva automático). A trava
> entra em `ensure_direct_chat_channel` (via `chat_can_dm`) e o seletor "Nova"
> respeita a config (`chat_contacts` — inclui contatos cross-nível permitidos;
> mesma unidade sempre; Admin fala com todos). **H4.9 restante:** **Lote 2**
> (áudio/arquivos) e **Lote 3** (insistência até visualizar). Migração a rodar:
> **0126** (todas do Chat Hub: 0120–0126).

> **H4.9 Chat Hub — R4a ✅ (v0.58.0, sem migração nova):** **Admin/franqueadora →
> unidade específica.** No painel "Nova", quem tem escopo de rede vê a seção
> **"Enviar para uma unidade"** (Admin = todas as unidades; franqueadora = as do
> seu escopo — `listReachableUnits`). Por unidade: **"Chat da equipe"** (abre o
> canal da equipe — `openUnitChannel`) ou **"Individual"** (a mesma mensagem vai
> como conversa direta para **cada membro** — `broadcastToUnitMembers`, via
> `chat_channel_people` + `ensure_direct_chat_channel`). **Falta o R4b:** configurar
> **quem conversa com quem** entre unidade ↔ franqueadora (por função). Depois:
> **Lote 2** (áudio/arquivos) e **Lote 3** (insistência até visualizar).

> **H4.9 Chat Hub — R3 ✅ (v0.57.0 · migração 0125):** **reagir** a uma mensagem
> (emoji — `chat_reactions`, chips com contagem, tempo real) e **responder** uma
> mensagem específica (`chat_messages.reply_to` — citação com autor + trecho acima
> da resposta). Ações no hover de cada balão (reagir/responder); prévia de
> "respondendo" no compositor. `getMessages` agora traz reações + citação + nomes
> por RPC. **Correções pós-R2 (0124 + código):** RLS de `chat_reads` liberada p/
> ler a marca do outro (recibo **Lida** azul funciona) + realtime; `touch_presence`
> passou a disparar (`.then`) → "visto por último" funciona; unread conta a MINHA
> marca (fim do "2" fantasma). **Faltam:** R4 (Admin → unidade específica + config
> de contato unidade↔franqueadora), depois **Lote 2** (áudio/arquivos) e **Lote 3**
> (insistência até visualizar). Migrações a rodar: **0121–0125**.

> **H4.9 Chat Hub — Correções R2 ✅ (v0.56.0 · migração 0123):** (1) **recibos**
> agora comparam **por data** (timestamp banco `+00:00` × JS `Z` quebrava a
> comparação por texto) → **Lida** fica azul e **Entregue** não volta pra Enviada;
> (2) **nomes**: mensagens de quem é da franqueadora (Admin/Planner) apareciam
> como "colega"/sem nome porque a RLS de `profiles` barra → agora via RPC
> `chat_channel_people`/`chat_display_names` (SECURITY DEFINER, só p/ membros do
> canal); (3) **presença 3 estados**: online (verde) / **ausente** (âmbar, após 5
> min parado) / offline (**"visto por último"**, `getLastSeen` atualiza a cada 12s);
> (4) **carregamento mais rápido** (consultas por canal em paralelo); (5) dot de
> presença **na lista de contatos**; (6) **"Ver membros"** da equipe; (7) **busca**
> de pessoa/unidade e **filtro** de conversas; (8) **contagem online/ausente/offline
> para o Admin**. **Faltam:** R3 (reagir + responder mensagem), R4 (Admin → unidade
> específica + config de contato unidade↔franqueadora), depois **Lote 2** e **3**.
> Migração a rodar: **0123**.

> **H4.9 Chat Hub — Refinamentos R2 ✅ (v0.55.0 · migração 0122):** **presença** —
> **online agora** (bolinha verde) via Supabase Realtime Presence (canal
> "online-users"; o item do menu marca o usuário e faz ping) + **"visto por
> último"** persistido em `user_presence` (`touch_presence` a cada 60s). **Recibos**
> nas minhas mensagens: **✓ Enviada** → **✓✓ Entregue** (o outro está online ou foi
> visto após) → **✓✓ Lida** (azul, leu após). Cabeçalho da conversa direta mostra
> "online agora"/"visto por último…". `getChannelPeople` traz `lastSeenAt`. **Faltam:**
> R3 (reagir + responder mensagem), R4 (Admin → unidade específica + config de
> contato unidade↔franqueadora), depois **Lote 2** (áudio/arquivos) e **Lote 3**.
> Migração a rodar: **0122**.

> **H4.9 Chat Hub — Refinamentos R1 ✅ (v0.54.0 · migração 0121):** corrigido o
> **contador fantasma** (Admin/franqueadora mostravam dezenas de "não lidas" sem
> mensagens) — badge e lista agora usam o MESMO conjunto (`chat_my_channel_ids`):
> minhas equipes (todas as unidades onde tenho função) + escopo da franqueadora
> (exceto Admin) + diretos + já abertos. **Todas as equipes aparecem** mesmo logado
> em outra unidade. Cada mensagem/cabeçalho mostra **nome** (**"Você"** nas minhas),
> **função + unidade** e **foto** (bucket staff-photos; leitura liberada a
> autenticados). `getChannelPeople` (nome/função/unidade/foto assinada). **Faltam:**
> R2 (presença online + "visto por último" + entregue/lida), R3 (reagir + responder
> mensagem), R4 (Admin → unidade específica + config de contato unidade↔
> franqueadora). Migração a rodar: **0121**.

> **H4.9 Chat interno ("Chat Hub") — Lote 1 (texto) ✅ (v0.53.0 · migração 0120):**
> conversas internas da equipe em **/chat**. **Canal da unidade** (todos com acesso
> à unidade ativa) + **mensagens diretas 1:1**; a franqueadora fica conectada às
> unidades (vê/participa dos canais das unidades pelo escopo pleno). **Tempo real**
> via Supabase Realtime (a publicação é ligada na própria migração). **Badge de não
> lidas** no menu + **pop-up + som** quando chega mensagem (na tela do chat, o
> próprio Chat Hub cuida; fora dela, o item do menu). **Recibo de leitura** (visto)
> e **histórico**. Tabelas `chat_channels`/`chat_channel_members`/`chat_messages`/
> `chat_reads`; RLS por `can_access_chat_channel`; criação por RPC
> (`ensure_unit_chat_channel`/`ensure_direct_chat_channel`); badge por
> `chat_unread_total`. **Falta Lote 2** (áudio/arquivos) e **Lote 3** (insistência
> até visualizar). Migração a rodar: **0120**.

> **H4.8 Planejamento anual da REDE — COMPLETO (Blocos 1 e 2).** **Bloco 1
> (v0.51.0 · migração 0118):** a franqueadora define um calendário que vale para
> **todas** as unidades. Itens da rede = `agenda_plan_items` com `clinic_id NULL` +
> coluna `locked` (trava) + novo tipo `campaign` (informativo, não fecha). Em
> `/agenda/planejamento-anual` a franqueadora cria/edita (RPCs
> `create/update/delete_network_plan_item`, guarda `can_manage_network_plan` =
> Admin ou gestor da franqueadora). Cada item desce para a agenda de todas as
> unidades e bloqueia conforme a trava: **travado** = a unidade não abre por cima;
> **decisão da unidade** = pode liberar um dia avulso; **campanha** = só aviso. A
> tela de planejamento da unidade mostra o calendário da rede em leitura;
> `checkAgendaRules`/`day-strip`/agenda incluem os itens da rede. **Bloco 2
> (v0.52.0 · migração 0119):** **almoço padrão da rede** — a franqueadora define em
> `/agenda/configuracao` (linha `clinic_id NULL` de `clinic_agenda_settings`,
> `saveNetworkLunch`; a policy de escrita foi ampliada para permitir a linha NULL a
> quem gerencia a rede); a unidade herda por cascata e pode personalizar o próprio
> (o editor da unidade mostra o padrão da rede como referência). Migrações a rodar:
> **0118 e 0119**.

> **H4.7 Atendimento conjunto — COMPLETO (Blocos 1 e 2).** Um atendimento pode
> ter 2+ profissionais (cirurgia com auxiliar, 2 especialistas). **Bloco 1 (v0.49.0
> · migração 0116):** continua o **responsável principal** (pelo tipo); no
> agendamento há o campo **"Outros profissionais neste atendimento"**
> (dentistas/coordenadores da unidade, menos o principal); uma sala só; o **limite**
> de profissionais = **nº de cadeiras** da unidade; cada incluído recebe **aviso**
> (`notify_appointment_participants`); o detalhe do agendamento mostra o
> "Atendimento conjunto". Tabela `appointment_participants` + RLS. **Bloco 2 (v0.50.0
> · migração 0117):** o conjunto aparece na agenda de **TODOS** os participantes —
> na **Minha Agenda** do dentista (`provider_multi_unit_agenda` reescrita: traz
> também onde ele é adicional, com selo e papel) e nos **cards da agenda** (selo
> "Conjunto +N"); **aviso suave** se um profissional adicional já estiver ocupado no
> horário (`checkParticipantsBusy`, mesma unidade). Migrações a rodar: **0116 e 0117**.

> **H4.6 Bloco E — agenda multi-unidade (em andamento):** **E1 ✅ (v0.45.0,
> migração 0112)** — dias de atendimento do dentista por unidade (dias da semana
> + datas), no cadastro do Risartano (`staff_clinic_schedule`). **E2 ✅ (0113):**
> aviso de conflito entre unidades no agendamento (Recepção vê aviso vermelho;
> dentista é notificado). **E3 ✅ (0114):** agenda consolidada multi-unidade do
> dentista (`/minha-agenda`, cor por unidade). **E4 ✅ (0115):** aviso da próxima
> semana no fim de semana (aponta p/ Minha Agenda). **Bloco E e o H4.6 (Módulo do
> Dentista) COMPLETOS.**

> **H4.10 / H4.12 / H4.14 ✅ (paralelos ao teste do H4.6):** H4.14 (0110) status
> "Em Tratamento" automático na 1ª baixa; H4.10 (0.43.0) ficha em abas + barra
> lateral fixa; H4.12 (0111) câmera intraoral (captura → prontuário, Coordenador
> e Dentista). Migrações a rodar: **0110 e 0111**.

> **MÓDULO RISARTE EMPRESARIAL — CONSTRUÍDO (Fases 0–8, aguardando teste do dono).**
> Camada B2B (empresas parceiras → colaboradores viram clientes da Jornada), schema
> próprio `empresarial`. Plano aprovado 10/07/2026 (`docs/risarte-empresarial/`).
> Migrações **0096–0103**. Roteiro de teste: `docs/risarte-empresarial/ROTEIRO-TESTE.md`.
>
> - **Fase 0** — fundação: schema + 11 tabelas + RLS + papel `rislife_consultant` (0096–0097).
> - **Fase 1** — cadastros: menu Empresarial; empresas (KPIs/filtros); tela em abas;
>   colaboradores + dependentes; **ponte colaborador→cliente** por CPF (`complete_employee`/
>   `link_dependent`, copia `clinic_id`); **selo** na ficha (0098); import Excel; saída.
> - **Fase 2** — benefícios/preços: config da rede (`/empresarial/configuracoes`) +
>   override por empresa (aba Plano); **motor de benefícios** (cobertura/desconto/
>   frequência/limite/carência/parcelamento); mensalidade + simulador.
> - **Fase 3** — orçamento com benefício: `benefits.ts` (carência/frequência/limite);
>   valor cheio × com programa na ficha; registro de uso ao concluir sessão (0099).
> - **Fase 6** — comercial: funil kanban (`/empresarial/funil`) + linha do tempo +
>   "Hoje do consultor" + fechar→cria empresa; papel RisLife com RLS (0100).
> - **Fase 7** — dashboards: painel do cliente (uso/economia) na ficha; painel
>   consolidado (`/empresarial/painel`); economia por empresa na aba Financeiro.
> - **Fase 8** — Riso+ Social (aba, gatilhos, regra integral/parcial/nenhum) +
>   retenção 5 anos/anonimização (`run_retention`, cron) (0101).
> - **Fase 4** — financeiro/ASAAS: cobrança + split (`settle_billing`) + inadimplência
>   (`mark_overdue_and_suspend`, suspende + bloqueia benefícios); webhook idempotente
>   + Edge Function `asaas-webhook`; **pronto para plugar** `ASAAS_API_KEY` (0102).
> - **Fase 5** — contratos/ZapSign + proposta Gamma: aba Contratos; `zapsign.ts` +
>   Edge Function `zapsign-webhook`; proposta via Gamma (reusa a integração) (0103).
>
> **Pendências do dono:** aplicar **0096→0103** em ordem no SQL Editor + **Settings →
> API → Exposed schemas → `empresarial`**. Para ligar ASAAS/ZapSign/Gamma: cadastrar
> as chaves (`ASAAS_API_KEY`, `ZAPSIGN_API_TOKEN`, `GAMMA_API_KEY`) e fazer deploy das
> Edge Functions. Detalhe do motor de benefícios em `ADENDO-01-motor-de-beneficios.md`.

> **H4.5 Cockpit 2.0 — COMPLETO (Grupo 4).** Lotes 1–5: etapas; linha do tempo +
> resumo (previsto×realizado); sugerir profissional por sessão; juntar sessões
> (na Fase 5 e no planejamento, sessão a sessão, com tempo/sequência/profissional
> editáveis no cockpit); alertas/lembretes (selos + notificações à Recepção).
> Migrações 0087–0095. **Falta só o Pedido 3 do dono** (baixa parcial das sessões
> pelo dentista executor), combinado para o **H4.6**. Detalhe em `docs/ROADMAP.md`
> (fonte da verdade). Próximo: **H4.6 (Módulo do Dentista)**.

> **H4.6 Módulo do Dentista — EM ANDAMENTO.** Plano detalhado aprovado (10/07):
> a "casa" do dentista em blocos **A1 → A2 → A3 → B1/B2 → B3 → C → D → E** (E =
> agenda multi-unidade, item próprio depois). **A1 — Baixa parcial das sessões
> ✅ (v0.35.0, migração 0105):** ao concluir um atendimento COM sessões, abre "O
> que foi feito hoje?"; só o Dentista/Admin confirma o que foi feito; as
> confirmadas são liquidadas (tempo real rateado só entre elas), as não feitas
> voltam para "a agendar" (motivo opcional) e a Recepção é avisada
> (`conclude_attendance_partial`). **A2 — Desenvolvimento Clínico ✅ (v0.36.0,
> migração 0106):** no prontuário, o Dentista escreve as anotações do atendimento
> com salvamento automático ("Salvo às HH:MM"); as anotações viram uma linha do
> tempo (autor + unidade + data) visível a dentistas/Coordenador/Planner
> (`clinical_progress_notes`, append-only). **A3 — Procedimentos do cliente ✅
> (v0.37.0, migração 0107):** seção "Procedimentos" agrupando as sessões em Em
> aberto / Agendados / Finalizados; o Dentista tem o botão "Solicitar agendamento
> à Recepção" (`request_session_scheduling`, notifica a Recepção). **B1/B2 ✅
> (v0.38.0, sem migração):** rota `/meu-dia` (Hoje / Próximos / procedimentos em
> aberto do dentista); prontuário do dentista restrito aos seus pacientes (RLS +
> mensagem amigável `isDentistRestricted`); plano resumido SEM valores
> (`plan-summary-section`). **B3 ✅ (v0.39.0, sem migração):** bloco "Minha
> produção" na tela Meu Dia (filtro de período): concluídos, sessões finalizadas,
> tempo em cadeira realizado × previsto, espera média, em aberto, futuros, NPS
> ("ainda não disponível"). **Bloco B completo.** **Bloco C — Documentos ✅
> (v0.40.0, migração 0108):** o Dentista/Coordenador emite prescrição, atestado,
> declaração e orientações no prontuário (com modelos), e imprime/salva em PDF
> (`/documentos/[id]/imprimir`); modelos da rede geridos em `/admin/documentos`
> (franqueadora). Sem assinatura digital/envio (adiado). **Bloco D — Falar com
> quem planeja ✅ (v0.41.0, migração 0109):** seção "Pedidos ao coordenador"
> (sugerir reavaliação / pedir revisão do plano com alerta insistente + anexos);
> o Coordenador resolve (`clinical_requests`/`clinical_request_media` + RPCs).
> **H4.6 (Módulo do Dentista) COMPLETO** nos blocos A–D. **Falta:** o Bloco E
> (agenda multi-unidade, item próprio depois) e o **teste geral detalhado do
> H4.6** pedido pelo dono.

> Documento de continuidade entre sessões. Regras de negócio detalhadas ficam em
> `CLAUDE.md`; regras de código em `docs/ARQUITETURA-TECNICA.md`; jornada em
> `docs/JORNADA.md`; fila de pendências em `docs/BACKLOG.md`.

## 1. Fase atual e o que já foi concluído

Fase do plano: **MVP — núcleo clínico (completo)**. A espinha dorsal (Jornada do
Cliente em 7 fases + Centro de Planejamento) está pronta.

**Concluído e validado pelo dono:**
- Etapa 1 — Fundação (Next 16, login, RLS).
- Etapa 2 — Cadastros (clínicas, usuários, clientes, SLAs, máscaras).
- Etapa 3 — Base da Jornada (kanban, agenda, notificações, check-in, atendimento,
  decisões da Fase 5, ativo/inativo).
- LOTE D — ajustes do teste geral.
- Etapa 4 (4.1+4.2) — Coordenador Clínico (consentimento, fotos/exames/vídeo/áudio,
  considerações).
- LOTE E — correções pré-Etapa 5 (modelo SDR, jornada, conflitos de agenda,
  edição/transferência, compartilhamento entre unidades).

**Entregue (aguardando teste final do dono):**
- **Etapa 5 — Centro de Planejamento (completa):** 5.1 fila + estrutura do plano;
  5.2 orçamento por tabela de preços; 5.3/4.3 aprovação por opção + envio ao Comercial.
- **LOTE F (F1–F7):** filtros automáticos; ficha em leitura + botão Editar;
  autopreenchimento no cadastro; compartilhamento (notifica as 2 unidades +
  histórico + encerramento sem 404); **Procedimentos** (campos completos,
  busca/filtros, importação Excel, reajuste em massa, histórico, exclusão =
  desativar); aprovação por opção; fila por situação; central de notificações
  categorizada; **cockpit do Planner**.
- **LOTE B (B1–B6):** agenda **Dia/Semana/Mês**; **config de agenda por unidade**
  (horário + cadeiras); **Relatórios** (resumo de agendamentos, rede por fase sem
  nomes, contadores do Planner).

Migrações **0001–0045** escritas; **0001–0043 aplicadas**; **0044–0045 pendentes**.

## 2. O que está em andamento agora

**LOTE G — Agenda (em curso).** Entregue e aguardando teste do dono:
- **G1 — Salas + configuração na unidade:** nova tabela `clinic_rooms` (salas com
  nome por unidade), sala do Coordenador Clínico em `clinic_agenda_settings`,
  configuração da agenda liberada para a **Gerente de Unidade** (RLS + tela em
  `/agenda/configuracao`), e contagem de salas exibida na agenda. Migração 0044.
- **G2 — Agendar com sala:** agendamento passa a ter **sala** (`appointments.room_id`)
  e marca **ONLINE** (`is_online`) para apresentação comercial; regra de ocupação
  **por sala** (uma sala = um cliente por vez); o horário só oferece os **slots
  configurados** (15 min, dentro do funcionamento e dias abertos); encaixe
  (urgência/emergência) livre; sala/ONLINE aparece no **card**; sala padrão do
  Coordenador em avaliação/reavaliação. Migração 0045.

- **G3.1 — Grade de tempo + salas:** visão **Dia** vira grade com **colunas por
  sala** (+ coluna ONLINE / "Sem sala" quando houver) e **régua de tempo** lateral
  (hora + tiques de 15 min); **filtro de salas** por chips (`?salas=id,id,online`,
  vazio = todas) que vale para Dia/Semana/Mês (`day-room-grid.tsx`,
  `room-filter.tsx`). Sem nova migração.
- **G3.2 — Agendamento rápido:** clicar num espaço vazio de uma sala (visão Dia)
  abre o formulário já com **sala + data + horário** preenchidos; o formulário
  ganhou abertura controlada + valores iniciais. Sem nova migração.
- **G3.3 — Arrastar para remarcar:** card **futuro** pode ser arrastado para
  outro horário/sala na visão Dia (chama `updateAppointment`, mantendo duração).
  Filtro de salas agora **preservado** ao trocar de visão/navegar (`agendaHref`
  leva `salas`); mensagem da grade orienta quando não há apresentação ONLINE no
  dia. Sem nova migração.

- **G4 — Fechar agenda:** tabela `agenda_closures` (+ salas/profissionais) e
  `appointments.needs_reschedule`. Botão "Fechar agenda" (Recepção/Gerente/Admin)
  bloqueia período por **unidade / salas / profissionais** (motivo: pessoal,
  evento, manutenção, treinamento) via RPCs SECURITY DEFINER `create_agenda_closure`
  / `delete_agenda_closure`. Bloqueia novos agendamentos **inclusive encaixe**;
  agendamentos existentes no período são **sinalizados** (ícone de alerta no card)
  e geram **notificação** (categoria "Agenda") para a recepção remarcar; remarcar
  com sucesso limpa o alerta. Faixas de fechamento aparecem na visão Dia + banner
  com remover. Migração 0046.

Decisões do dono na G4: Recepção+Gerente+Admin fecham; fechamento bloqueia todos
(inclusive encaixe); afetados são sinalizados (sem cancelamento automático).

- **G5 — Dias de atendimento, feriados e dia avulso:** a agenda mostra **só os
  dias configurados** (Semana esconde dias sem atendimento; Dia mostra aviso
  "não atende"). **Liberar dia avulso** na Configurar agenda (uma ou várias
  datas + escalar quem atende, que recebe notificação) — tabela `agenda_open_days`
  (+ staff). **Feriados nacionais** (fixos + móveis via Páscoa, `lib/holidays.ts`)
  marcados na agenda; a Gerente **confirma** (haverá atendimento? Sim/Não →
  `clinic_holiday_decisions`) e recebe **notificação** de feriados próximos
  pendentes (`notify_pending_holidays`, idempotente). Feriado "não atende"
  bloqueia novos agendamentos; pendente apenas avisa (decisão do dono). RPCs
  `open_special_days`/`remove_special_day`/`decide_holiday`. Migração 0047.

- **G6 — Retornos e controles:** rota `/agenda/retornos` (botão na agenda, para
  Recepção/Gerente/Admin) — lista os **retornos e controles agendados** (tipos
  Retorno/Reavaliação no futuro) e os clientes em **Acompanhamento/Reavaliação
  sem agendamento futuro** ("a lembrar de reagendar", com última visita e botão
  Agendar). Sem nova migração.

**LOTE G (Agenda) COMPLETO (G1–G6).** Migrações do Lote G: **0044–0047**.

**Refinamentos da Agenda — GR1+GR2+GR5 entregues (sem migração, v0.8.0):**
- **GR1 — Agendamento inteligente:** duração mín. 15 min; **próximos horários
  disponíveis** (`getNextAvailableSlots`, 3 + "ver mais", clique confirma) por
  tipo/duração/profissional/sala respeitando dias/horários/feriados/fechamentos/
  ocupação; **"Ver agenda"** virou pop-up de mês com contagem por dia
  (`agenda-peek-dialog`, `getMonthDayCounts`) — clicar no dia preenche a data.
- **GR2 — Cards e arrastar:** ícone **i** no card abre detalhes em leitura
  (`appointment-info-dialog`); ao **arrastar** mostra o horário-alvo; visão
  **Semana** virou **grade de tempo** com régua hora/15min (`week-time-grid`,
  dias em colunas, só dias de atendimento).
- **GR5 — Retornos:** "a lembrar" mostra **dias sem atendimento** com cores/ícones
  pela inatividade do SLA (`resolveInactivity`), **ordenação** (padrão maior
  tempo primeiro) e **quem atendeu por último**.

- **GR3 — Fechamento de agenda (refino, migração 0048):** seletor de data+hora
  igual ao agendamento; **não permite período passado**; **editar** fechamento
  (`update_agenda_closure` com confirmação + histórico antes/depois em
  `agenda_closure_history` + recalcula afetados + notifica); **confirmar** antes
  de remover (`closure-controls`); clicar em área fechada **não abre** agendamento
  — só **aviso** (toast) com motivo e até quando; **ícones de fechamento** na
  Semana (`week-time-grid`) e no Mês (`month-grid`); feriados/dias avulsos também
  marcados no Mês.

- **GR4 — Dia avulso + almoço (migração 0049):** dia avulso ganha **horário de
  início/fim** (selects); **carimbo** (quem/quando liberou + antecedência do
  aviso); **editar** dias futuros (`update_special_day` com histórico
  `agenda_open_day_history` + notifica envolvidos), passados viram **histórico**
  (não edita/remove — bloqueado no RPC); botão **"Ver"** o dia na agenda;
  **horário de almoço** na config (`saveLunchBreak` + colunas em
  `clinic_agenda_settings`) bloqueia agendamento normal no almoço (encaixe livre)
  e aparece como **faixa "Almoço"** no Dia e na Semana; dia avulso em **destaque**
  no Dia/Semana/Mês. Admin Master também faz tudo (RPCs e telas liberadas).

- **GR6 — Planejamento Anual de Atendimento (migração 0050):** tela
  `/agenda/planejamento-anual` (Gerente/Admin) com seletor de ano, **resumo**
  (dias trabalháveis, horas estimadas, contadores por tipo, feriados
  trabalha/fecha/a-decidir), **visão dos 12 meses**, **confirmar feriados** ali,
  e **itens** (`agenda_plan_items`): Recesso, Férias coletivas, Férias
  individuais, Evento, Treinamento, Manutenção — com período, pessoas (férias
  individuais), histórico (`agenda_plan_item_history`) e notificação. Itens
  **fecham a agenda** no período (individuais = só as pessoas), inclusive
  encaixe; um **dia avulso** liberado passa por cima. Só edita/remove futuro.
  Marcação na agenda Dia (banner)/Semana/Mês. RPCs create/update/delete_plan_item.

**Refinamentos GR1–GR6 COMPLETOS.**

- **LOTE H — Cronômetros do Atendimento (sem migração, v0.8.4):** o painel
  `/atendimento` agora tem cronômetros **em tempo real** (tick a cada segundo,
  `attendance-panel.tsx`): **A chegar** liga cronômetro de **atraso** a partir do
  horário se não houve check-in; **Em espera** mostra **há quanto tempo** espera
  (desde o check-in) + se **chegou adiantado/atrasado** e a hora do check-in;
  **Em atendimento** mostra **há quanto tempo** está em atendimento (desde a
  chamada); **Concluído** mostra só o **horário de conclusão** + durações. Usa os
  carimbos já existentes (`checked_in_at`/`called_at`/`done_at`).

**LOTE PRONTUÁRIOS — em curso.**
- **P1 — Renomear + abas (sem migração, v0.8.5):** "Clientes" virou **Prontuários**
  no menu e nos títulos; a **rota** mudou de `/clientes` para `/prontuarios`
  (pasta renomeada + redirecionamento no `next.config.ts` para os links antigos
  não darem 404). A lista virou **abas** (usuário de unidade): **Ativos** (lista +
  filtros + aviso de início de tratamento), **Aniversariantes** (Hoje / Esta
  semana = próximos 7 dias / Este mês, com idade e telefone — `src/lib/birthdays.ts`),
  **Transferidos** e **Compartilhados** (antes eram blocos soltos no rodapé). O
  aviso automático de aniversário para a Recepção é a P2. Franqueadora segue com
  a visão de rede (sem abas de unidade). Sem nova migração.

- **P2 — Aniversariantes + aviso da Recepção (migração 0051, v0.8.6):** ao abrir
  o sistema (página **Início** e aba **Prontuários**), a **Recepção** da unidade
  recebe — **uma vez por dia** — uma notificação com os aniversariantes a
  parabenizar. **Antecipa fim de semana/feriado:** cobre hoje + a sequência de
  dias fechados imediatamente à frente, até o próximo dia de atendimento (usa a
  config da agenda + feriados + dias avulsos). RPC SECURITY DEFINER
  `notify_birthday_clients` (idempotente: dedupe pelo `link` com a data do dia).
  Nova categoria **"Aniversários"** na central de notificações.

- **P3 — Anamnese (migração 0052, v0.8.7):** nova seção **Anamnese** na ficha
  (logo abaixo da Avaliação clínica), preenchida pelo **Coordenador Clínico**
  (ou Admin) com 4 campos livres — **queixa principal, histórico de saúde,
  histórico odontológico, estilo de vida**. Atrás do **consentimento** (LGPD);
  **leitura** para Planner/Gerente/Admin (mesma RLS das considerações). Abre em
  **leitura** com botão **Editar**; guarda **versões anteriores**
  (`clinical_anamnesis_revisions`, "Histórico de versões"). Uma anamnese por
  cliente **por unidade** (a unidade compartilhada mantém a sua). Tabelas
  `clinical_anamnesis` (+ revisões) + RLS.

**LOTE PRONTUÁRIOS COMPLETO (P1–P3).** Migrações: **0051–0052**.

**LOTE ANAMNESE configurável (em curso) — feedback do dono + PDF da ficha.**
Decisões: Admin Master cria as **fichas-padrão da rede**; o Coordenador pode
**acrescentar perguntas** da sua unidade às fichas existentes (sem excluir as da
rede, sem criar fichas próprias). A anamnese de 4 campos (P3) será **substituída**.
- **A1 — Bug do consentimento (v0.8.8, sem migração):** botão **"Preencher
  anamnese"** libera o formulário ao registrar o consentimento, sem recarregar.
- **A2 — Configurador de fichas + ficha "Geral" (migração 0053, v0.8.9):** tabelas
  `anamnesis_templates` + `anamnesis_questions` (clinic_id NULL = pergunta da
  rede; preenchido = acréscimo da unidade) + RLS (Admin escreve a rede;
  Coordenador só acréscimos da sua unidade). Tela **Administração → Fichas de
  Anamnese** (`/admin/anamnese`) para criar/editar fichas e perguntas (tipos:
  Sim/Não, Sim/Não/Não sei, escolha única, lista de marcar, texto curto/longo),
  marcar **campo de detalhe ao "Sim"**, **obrigatória** e **alerta** (com
  mensagem/condição). Ficha **"Geral"** já semeada com as perguntas do PDF.
- **A3 — Preenchimento no prontuário (migração 0054, v0.9.0):** tabelas
  `anamnesis_fills` (versão imutável por preenchimento) + `anamnesis_answers`
  (respostas com a pergunta carimbada) + RLS — **Dentista** entra como
  visualizador (além de Planner/Gerente/Admin); Coordenador preenche. Na ficha,
  o componente `anamnesis-fill.tsx` substitui a anamnese de 4 campos: o
  Coordenador **escolhe a ficha**, responde **clicando** (Sim/Não, listas,
  texto), e pode **adicionar pergunta** (só para o cliente ou salvando na ficha
  da unidade via checkbox → vira pergunta `clinic_id` da unidade). **Alertas**
  das respostas aparecem numa **faixa no topo do prontuário** (`evaluateAlerts`).
  Cada save cria uma **nova versão** (histórico). A anamnese antiga (P3) saiu.
- **A4 — Obrigatoriedade + reavaliação + "sem alterações" (sem migração,
  v0.9.1):** envio ao **Centro de Planejamento** **bloqueado** (botão desabilitado
  + aviso na Avaliação clínica) enquanto a anamnese não estiver preenchida
  (1ª consulta) ou estiver vencida na **reavaliação** (Fase 6, >12 meses). Aviso
  no topo do prontuário cobrando o preenchimento/atualização. "Atualizar" abre a
  ficha **pré-preenchida** (já vinha da A3). Ao salvar sem mudar nada, registra a
  versão como **"sem alterações"** (`no_changes`, comparando a assinatura das
  respostas) — aparece no histórico e no aviso.

**LOTE ANAMNESE COMPLETO (A1–A4).** Migrações: **0053–0054**.

**LOTE PROCEDIMENTOS (em curso) — tempo estimado.**
- **PR1 — Tempo estimado no cadastro (migração 0055, v0.9.2):** coluna
  `procedures.estimated_minutes`; campo **"Tempo estimado (min)"** no cadastro/
  edição, exibição na lista, e na **importação Excel** (nova coluna "Tempo
  Estimado (min)" + larguras de coluna + aba "Instruções" no modelo). Tipo
  `Procedure.estimatedMinutes` propagado (ficha + cockpit do plano).
  Obs.: cabeçalho em negrito/cor no Excel exigiria trocar a lib (exceljs).

**Ampliação (feedback do dono) — "Protocolo de sessões".** Decisões: protocolo
**padrão da Rede** (Admin/Planner) + **personalização por unidade** (Coordenador
Clínico **e** Planner); o dentista **só marca finalizado** e o sistema **calcula
o tempo real** pelo atendimento (Lote H), **rateando por procedimento** quando o
agendamento tem vários. Etapas: **E1** protocolo da Rede; **E2** override por
unidade; **E3** planejamento com sugestões + médias reais (Rede/Unidade/dentista);
**E4** agendamento por sessão; **E5** execução/auditoria + médias derivadas.
- **E1 — Protocolo de sessões da Rede (migração 0056, v0.9.3):** tabela
  `procedure_sessions` (clinic_id NULL = Rede; preenchido = unidade) + RLS
  (Rede=Admin/Planner; unidade=Admin/Planner/Coordenador). No cadastro, botão
  **relógio** abre o **protocolo**: "sessão única" ou "várias sessões", cada
  sessão com **nome** + **tempo (seletor 15/15 min)**, com **soma automática** e
  contagem; salvar recalcula `procedures.estimated_minutes` (total da Rede). O
  campo solto de tempo do PR1 saiu do formulário (o total vem do protocolo; a
  importação ainda define um tempo de sessão única). Lista mostra "N sessões · Xh".
- **E2 + ajustes (sem migração, v0.9.4):** **protocolo por unidade** — no modo
  unidade, o relógio abre o protocolo da unidade (base = padrão da Rede; salvar
  cria a personalização; "Remover personalização" volta ao padrão). RLS já cobria
  (Admin/Planner/Coordenador). O **Coordenador Clínico** agora acessa
  `/procedimentos` **só no modo unidade** (sem catálogo/preços), restrito às suas
  unidades. Ajustes: o **relógio do protocolo** e o **histórico** ficam acessíveis
  também ao **editar** o procedimento; o **histórico** vira um painel reutilizável
  mostrado **só ao clicar** (`ChangeHistory`). Action `clearProcedureSessions`.
  Mais 2 ajustes (v0.9.5): concordância "1 sessão/2 sessões" e linha
  **Rede/Unidade** abaixo do nome do procedimento.
- **E3 — Planejamento com sugestões (migração 0057, v0.9.6):** o item do plano
  (`treatment_plan_option_items`) ganhou **planned_sessions** + **planned_total_minutes**.
  No editor do plano (ficha + cockpit), ao escolher um procedimento o sistema
  **sugere** sessões/tempo da **Unidade** (ou da **Rede**); o Planner **ajusta**
  por procedimento. Mostra a **base sugerida (Rede/Unidade)** e as **médias reais
  (unidade/dentista)** como "sem histórico ainda" (serão preenchidas na E5). Os
  valores planejados seguem para o agendamento por sessão (E4). `protocolByProcedure`
  carregado nas duas páginas; `BudgetItem` ganhou plannedSessions/plannedMinutes.
  Próximas: **E4** (agendamento por sessão), **E5** (execução/auditoria + médias).
- **Ajustes do planejamento (sem migração, v0.9.7):** **botão "Abrir cockpit"**
  na ficha (Planner); **Pilar da Metodologia** no editor do plano com **sugestão
  automática** (maior soma de valor por pilar, entre Saúde/Função/Estética/
  Prevenção) e **confirmação do pilar no envio** ao Coordenador (o Planner pode
  alterar; decisão final é dele) — `suggestTreatmentPillar` + `setTreatmentPillar`;
  ao colocar **2× o mesmo procedimento**, a sugestão de sessões/tempo **reescala
  (base × qtd)** e pede confirmação. (A visualização das sessões pelo Coordenador
  já veio na E3.)
- **E4a — Sessões a agendar na ficha (migração 0058, v0.9.8):** decisões do dono:
  agendar **nos dois lugares** (ficha + agenda) e **gerar na Fase 5**. Tabela
  `treatment_sessions` + `appointments.treatment_session_id` + RPC idempotente
  `ensure_treatment_sessions` (gera uma linha por sessão planejada da **opção
  principal aprovada** quando o cliente entra em Início de Tratamento, com o
  tempo de cada sessão). Painel **"Sessões do tratamento a agendar"** na ficha
  (`treatment-sessions-panel.tsx`): lista por procedimento + status; **"Agendar"**
  abre o formulário já com a **duração** da sessão (`AppointmentFormDialog` ganhou
  `initialDuration`). **E4b** (vínculo sessão↔agendamento + status + sugestão na
  agenda) e **E5** (execução + médias) a seguir.
- **E4b — Vínculo + sugestão na agenda (sem migração, v0.9.9):** ao agendar uma
  sessão, o `createAppointment` grava `appointments.treatment_session_id` e marca
  a sessão como **agendada** (`status='scheduled'`, `appointment_id`). No
  formulário da **Agenda**, ao escolher um cliente, aparecem **chips das sessões
  pendentes do plano** (`getClientPendingSessions`) — clicar preenche a duração e
  vincula o agendamento à sessão. `AppointmentFormDialog` ganhou
  `treatmentSessionId`. **E5** (execução + médias reais) a seguir.
- **E5 — Execução das sessões + médias reais (migração 0059, v0.10.0):** quando o
  dentista **conclui o atendimento** (painel `/atendimento` → `update_attendance`),
  as sessões ligadas ao agendamento viram **"Concluído"** com o **tempo real** de
  atendimento (chamada→conclusão). Quando o agendamento executou **mais de uma
  sessão/procedimento**, o tempo é **rateado** proporcionalmente ao tempo
  planejado de cada um (rateio igual quando não há tempo planejado) — helper
  `settle_treatment_sessions` chamado de dentro do `update_attendance`; colunas
  novas `treatment_sessions.actual_minutes` + `executed_by`. As médias reais
  alimentam: (a) o **editor do plano** — placeholder "sem histórico ainda" agora
  mostra a **média realizada na unidade** (`procedure_real_stats`, considera só
  tratamentos totalmente concluídos); (b) a **agenda** — ao marcar sessões + um
  dentista, mostra a **média real daquele dentista** por procedimento
  (`provider_procedure_minutes` / `getProviderProcedureStats`). O formulário da
  agenda passou a permitir **marcar mais de uma sessão** no mesmo horário (chips
  multi-seleção, duração soma sozinha → cria o caso do rateio;
  `createAppointment` lê `treatment_session_ids`). O painel da ficha mostra
  **"Concluído · durou X min"**. **Lote Procedimentos completo.**
- **Apresentação do plano — Camada 1 (interna) (sem migração, v0.10.1):** decisão
  do dono — **gerar pode ser interno OU externo (Gamma)**; **focar agora na
  Camada 1 (interna)**, deixando a integração com o Gamma para a Camada 2.
  Tela **"Modo Apresentação"** (`/apresentacao/[clientId]` + `presentation-view.tsx`)
  montada da **opção principal aprovada**: capa (cliente/unidade/data/**pilar do
  tratamento**), queixa/condição (diagnóstico + considerações clínicas), imagens
  (URLs assinadas, só dentro do sistema — LGPD), proposta (procedimentos,
  sessões, tempo, valor total) e próximas etapas. Botão **Baixar PDF** (impressão
  isolada via `@media print`). Entrada: botão **"Apresentação"** na ficha
  (Planner/Coordenador/Gerente/**Comercial**, quando o plano está aprovado) e no
  cabeçalho do **cockpit**. Acesso na página: Planner, Comercial, Coordenador,
  Gerente, Admin.
- **Apresentação — Camada 1.1 (mais detalhe) (migração 0060, v0.10.2):** o
  Planner passa a registrar **Objetivos do tratamento** e **Considerações do
  planejamento** no editor do plano (`treatment_plans.objectives` +
  `planning_notes`, action `savePlanNarrative`). A apresentação ganhou as seções
  **Objetivos**, **Considerações do planejamento** e **"Plano de tratamento —
  sessão por sessão"** (lista numerada de todas as sessões, com o nome/o que será
  feito + tempo, puxada do **protocolo** de cada procedimento — unidade > Rede;
  sem protocolo, cai na contagem planejada). Linguagem voltada ao cliente +
  **aviso de fluxo** (só na tela): "plano montado pelo Planner; o Consultor
  Comercial apresenta".
- **Apresentação — Camada 2 (Gamma) (sem migração, v0.10.3):** botão **"Gerar no
  Gamma"** na tela de apresentação. Integração com a **Generate API do Gamma**
  (`https://public-api.gamma.app/**v1.0**/generations`, header `X-API-KEY`,
  `GAMMA_API_KEY` em env): POST devolve `generationId`; o navegador faz **polling**
  de `getGammaStatus` até `completed`, que traz o **gammaUrl** (deck editável).
  Carregamento dos dados extraído para `presentation-data.ts` (compartilhado
  page+action); `actions.ts` monta o texto (markdown, 1 card por bloco com
  `---`), `imageOptions.source=noImages`, `textOptions.language=pt-br`. **Decisão
  do dono (achado técnico):** a API do Gamma **não insere as fotos específicas do
  paciente** — o deck é gerado **sem imagens**; o usuário **abre o gammaUrl,
  adiciona as fotos e exporta PPTX/PDF lá** (as fotos com qualidade seguem no PDF
  interno da Camada 1). Cada geração consome ~**3 créditos** da conta Gamma.
  `logAudit` action `export` entityType `presentation`. **Apresentação do plano
  (lote original) COMPLETA.** Pendência operacional: o dono deve cadastrar
  `GAMMA_API_KEY` nas **Environment Variables da Vercel** para funcionar no ar
  (no local já está no `.env.local`, fora do git).

**TESTE GERAL DO MVP (04/07/2026):** o dono rodou o roteiro completo
(`docs/ROTEIRO-TESTE-GERAL.md`) e devolveu ~60 pontos, todos registrados no
**LOTE H** do `docs/BACKLOG.md` em 4 grupos: **H1** bugs/segurança (10),
**H2** ajustes rápidos (12), **H3** melhorias médias (15), **H4** módulos novos
(14). Ordem combinada: H1 → H2 → priorizar H3/H4 com o dono.

**LOTE H1 — bugs do teste geral (em curso).**
- **H1a — Permissão/acesso (sem migração, v0.10.4):** corrige os 2 itens de
  acesso. **H1.1 Relatórios:** a tela `/relatorios` avaliava o papel de gestão
  em QUALQUER unidade do usuário e confiava só na RLS — uma recepcionista que é
  gerente em outra unidade via a rede toda. Agora o papel vale na **clínica
  ativa** (Admin = tudo; Franqueadora staff/planner/consultor = escopo de
  unidades via `user_full_access_clinic_ids`; Gerente = a unidade ativa;
  Franqueado = as suas) e TODAS as consultas (agendamentos, clientes, planos,
  seletor de unidade) filtram por `clinic_id` dentro do escopo; o item de menu
  (layout) segue a mesma regra. **H1.2 Apresentação p/ o Comercial:** o papel do
  Consultor fica na **Franqueadora** (com escopo de unidades), nunca na clínica
  do cliente — a checagem `hasRoleInClinic(clínica do cliente)` sempre falhava.
  Novo helper `hasRoleWithScopeForClinic` (`src/lib/auth.ts`, usa a RPC
  `user_full_access_clinic_ids`) aplicado em `presentation-data.ts` (acesso à
  tela/Gamma) e no `canPresent` da ficha (botão "Apresentação").
- **H1b — Regras de chamada no atendimento (migração 0061, v0.10.5):**
  **H1.3** um cliente não pode estar em **dois atendimentos ao mesmo tempo** —
  chamar quem já está "Em atendimento" em outro agendamento é bloqueado no
  banco (`CLIENT_BUSY`) e o card em espera troca o botão por "Em atendimento
  com outro profissional". **H1.4** quem chama o cliente é o **profissional do
  agendamento** (ou Admin); o Coordenador vê a sala de espera mas não chama
  cliente de outro profissional (`NOT_PROVIDER`; sem profissional definido vale
  a regra antiga por função). `update_attendance` reescrita (corpo da 0059 +
  travas); botão "Chamar" por linha no painel (`canCallRow`); mensagens pt-BR
  na action `updateAttendance`.
- **H1c — Sessões no agendamento + dia avulso (sem migração, v0.10.6):**
  **H1.5** as sessões do tratamento não "somem" mais: o pop-up **"i"** do card
  mostra as sessões vinculadas (`getAppointmentSessionOptions`); a **edição** do
  agendamento carrega os chips com as sessões vinculadas pré-marcadas + as
  pendentes do cliente (desmarcar devolve a sessão para "a agendar");
  `updateAppointment` sincroniza os vínculos (link/unlink + referência
  principal em `appointments.treatment_session_id`), só quando o formulário
  enviou o campo (arrastar para remarcar não mexe) e registra a mudança no
  audit. **H1.6** o seletor de horário do formulário passou a conhecer o **dia
  avulso** (oferece a janela própria do dia mesmo em dia da semana fechado) e o
  **feriado sem atendimento** (`getDaySchedule`), com aviso na hora de escolher
  a data ("Dia avulso liberado — atendimento das X às Y" / "Feriado sem
  atendimento nesta unidade", adiantando parte do H2.9). A grade do Dia passa
  `activeClinicId` ao editar.
- **H1d — Troca de unidade + autopreenchimento (sem migração, v0.10.7):**
  **H1.7** trocar de unidade no seletor agora **fecha a tela da unidade
  anterior** (`router.push("/")`, para uma ficha da unidade A não continuar
  aberta na B); e o usuário com **mais de uma unidade** (sem Franqueadora, que
  entra direto) **escolhe a unidade no login** numa tela de boas-vindas
  (`ChooseClinicWelcome`, mostrada pelo layout quando não há escolha explícita
  ainda) — `SessionContext.activeClinicExplicit` distingue a escolha real do
  padrão, e o padrão passou a priorizar a **Franqueadora**. **H1.9** o
  autopreenchimento por CPF agora traz **todos os dados** do cliente já
  existente (e-mail, endereço completo, etc.), não só nome/telefone/nascimento
  — `lookupCpfForRegistration` devolve um `ClientAutofill` (respeitando a RLS:
  sem acesso, campos vazios) e o formulário virou controlado nesses campos.

- **H1e — Teto de cadeiras pelo Admin (migração 0062, v0.10.8):** **H1.10** quem
  define quantas salas/cadeiras a unidade tem é o **Admin Master**, no cadastro
  da clínica (`clinics.max_rooms`, campo "Salas de atendimento (cadeiras)" só
  para unidades). A **Gerente** continua nomeando/ativando/desativando e
  escolhendo a sala do Coordenador em "Configurar agenda", mas o botão
  **"Adicionar sala"** some ao atingir o teto e a action `addRoom` bloqueia no
  servidor; o editor mostra "N de M cadeiras". Editar a clínica não deixa
  **reduzir** o teto abaixo das salas já criadas. Backfill: unidades existentes
  recebem `greatest(salas atuais, 4)`.
- **H1f — Encerrar compartilhamento na lista (sem migração, v0.10.9):** **H1.8**
  a aba **Compartilhados** dos Prontuários agora lista os compartilhamentos
  ativos da unidade nos **dois sentidos** (recebidos da outra unidade + enviados
  para outra) com **detalhes** (cliente, clínica dona, unidade compartilhada,
  motivo, desde quando, quem compartilhou) e um botão **Encerrar** por linha
  (`shared-clients-list.tsx` + `endClientShare`). Quem encerra: Recepção,
  Coordenador, Gerente ou Admin (o banco já permitia ambos os lados e já
  **notifica as duas unidades** ao iniciar/encerrar — migração 0038, nada novo
  no banco). O card da ficha (`ClientShares`) já tinha o Encerrar; o problema era
  achá-lo na lista. **LOTE H1 (Grupo 1 — bugs/segurança) COMPLETO (H1.1–H1.10).**

**LOTE H2 — ajustes rápidos do teste geral COMPLETO (sem migração, v0.11.0):**
**H2.1** aba "Ativos" → **"Clientes"** (a contagem soma ativos+inativos).
**H2.2** "Usuários" → **"Risartanos"** (menu + título; rota mantida). **H2.3**
envio do plano **sem etapa de confirmação** do pilar — só exige o pilar definido
(botão desabilitado + dica). **H2.4** depois de ir ao Comercial o **"Reabrir
para edição" some** (`canReopen` exige Fase 3; nota explicativa no lugar).
**H2.5/H2.6** trocar de visão na agenda parte de **HOJE** (Dia abre o dia de
hoje; Mês abre o mês atual) — `AgendaToolbar` usa `todayIso`. **H2.7** na visão
Semana, **clicar no dia** (cabeçalho) abre a visão Dia. **H2.8** card de **15
min** virou compacto de uma linha com o **nome do cliente** visível (Dia +
Semana; `compact` quando altura < 40px). **H2.9** encaixe em dia fechado mostra
**alerta âmbar na escolha da data** (complementa o aviso de feriado/dia avulso
do H1c). **H2.10** clicar em **dia/horário passado** não abre o pop-up — só um
aviso (Dia + Semana). **H2.11** o pop-up **"i"** ganhou **"Alterar situação"**
(cancelar/faltou etc.) para Recepção/Gerente/Admin em qualquer visão — e
cancelamento/falta **devolve as sessões do tratamento** para "a agendar"
(`updateAppointmentStatus`). **H2.12** já saíra no H1c (sessões no "i").

**H4.4 — Tela de Planos de Tratamento (sem migração, v0.11.1):** nova central
**"Planos de Tratamento"** no menu (`/planos`), para gestão/planner/comercial
(escopo por papel na clínica ativa, como /relatorios: Admin = tudo;
Franqueadora = escopo; Coordenador/Gerente = a unidade; Franqueado = as dele).
**Chips coloridos com contadores** por situação — Em planejamento / Aguardando
aprovação / Aprovado—no Centro / Fase comercial / Aguardando iniciar / Em
tratamento / Finalizado — clicáveis para filtrar (situação = status do plano +
fase/sub-status da jornada, `classify()`); **busca por cliente** + filtro de
unidade; tabela com selo colorido, fase, datas e ações (Ficha / Cockpit p/
Planner-Admin); bloco **"Relatório dos planos"**: totais (aprovados, chegaram
ao tratamento Fase 5+, ainda em negociação Fases 3–4) + quadro unidade ×
situação. Decisão do dono: H4.4 primeiro; depois seguir a ordem numérica do
backlog (H3.1 em diante).

## 3. Próximos passos (ordem de prioridade)

> **Roadmap completo com o "como construir" de cada item: `docs/ROADMAP.md`**
> (criado em 04/07/2026 a pedido do dono — ler antes de iniciar cada lote).

1. **H3 em ordem numérica** (decisão do dono, 04/07): ~~H3.1~~ ✅ (v0.11.2,
   formulário reordenado); ~~H3.2~~ ✅ (v0.11.3, "Ver agenda" rica — por dia:
   agendamentos, horários livres p/ o contexto do formulário, feriados,
   fechados, dias avulsos, bloqueios do planejamento anual, com legenda;
   `getMonthAgendaPeek`); ~~H3.3~~ ✅ (v0.11.4, seletor de dias — régua rolável
   `day-strip.tsx` no topo da agenda com disponibilidade verde/vermelho por
   dia, feriados/fechados/avulsos/bloqueios evidentes; clicar abre a visão
   Dia); ~~H3.4~~ ✅ (v0.11.5, migração 0063 — Faltou/Cancelou no "A chegar",
   Desistiu na espera com estado `gave_up`, limite de espera configurável +
   alerta vermelho + notificações repetidas a cada 15 min via
   `notify_attendance_alerts`, aviso diário + banner p/ pendências de dias
   anteriores); ~~H3.5~~ ✅ (v0.11.6, check-in com confirmação — pop-up mostra
   cliente, horário/tipo, profissional e sala antes de registrar a chegada);
   ~~H3.6~~ ✅ (v0.11.7, migração 0064 — troca de profissional de última hora
   no A chegar/Em espera via `swap_appointment_provider`, registro +
   notificações + alerta de frequência); **H3.4b** ✅ (v0.11.8, migração 0065 —
   pendências de dias anteriores carregam para o painel de hoje com "Pendente
   desde DD/MM"; "em atendimento" não concluído bloqueia cadeira+profissional
   via PROVIDER_BUSY/ROOM_BUSY); ~~H3.7~~ ✅ (v0.11.9, migração 0066 —
   visibilidade da SDR: `sdr_accessible_client_ids`; Prontuários/Jornada da SDR
   "pura" só os clientes que ela tocou; ficha bloqueia os demais; agenda
   completa mas nome sem link p/ não-permitidos); ~~H3.8~~ ✅ (v0.12.0, WhatsApp
   manual p/ aniversariantes — painel na aba Aniversariantes com mensagem
   editável {nome} + botão por cliente, e botão no prontuário no dia do
   aniversário; `src/lib/whatsapp.ts`); ~~H3.9~~ ✅ (v0.12.1, migração 0067 — transferência
   notifica sempre o destino, recepção/gerente/coordenador; compartilhamento
   já cobria os 3 papéis das 2 unidades); ~~H3.10~~ ✅ (v0.12.2, migração 0068 —
   enviar ao Planejamento conclui o atendimento automaticamente + avisa a
   recepção + pop-up para agendar a apresentação comercial); ~~H3.11~~ ✅ (v0.12.3, migração 0069 — informações
   complementares ao Centro de Planejamento: card na ficha + notifica o Planner
   + selo "nova info" na fila até abrir o cockpit); ~~H3.12~~ ✅ (v0.12.4, migração
   0070 — mídias: renomear + anotar por foto/arquivo na galeria, excluir com
   confirmação); ~~H3.13~~ ✅ (v0.12.7, cockpit — anamnese em leitura + filtros
   unidade/pilar na fila + rolagem independente das colunas); ~~H3.14~~ ✅
   (v0.12.8, sem migração — sessão agendada na ficha mostra quando/com quem e é
   clicável → abre os detalhes do agendamento); ~~H3.15~~ ✅ (v0.12.9, migração
   0071 — Conversão Comercial verifica apresentação agendada: avisa
   consultor/assistente; sem agendamento → aviso forte à recepção + gerente +
   coordenador; banner/selo no `/planos`; categoria Comercial nas notificações).
   **GRUPO 3 (H3.1–H3.15) COMPLETO**. Em andamento: **AJUSTES PRÉ-GRUPO 4**
   (5 itens do dono) — ~~AJ1~~ ✅ (v0.12.10, migração 0072 — Admin exclui
   cadeira por soft delete; some do futuro, passado marca "(excluída)"); ~~AJ1b~~
   ✅ (v0.12.11, sem migração — cadeiras numa casa só: removido o número de
   `/admin/agenda` e o campo do cadastro da clínica; limite virou campo só do
   Admin em "Configurar agenda"); ~~AJ2~~ ✅ (v0.12.12, migração 0073 —
   agendamento fora do horário permitido: início dentro do horário, fim pode
   passar; alerta a quem agenda + notifica o profissional); ~~AJ3~~ ✅ (v0.12.13,
   sem migração — apresentação marcada + plano não pronto: cronômetro regressivo
   na fila/cockpit/planos, destaque vermelho); ~~AJ4~~ ✅ (v0.12.14, migração 0074
   — banner de /planos clicável filtra; botão "Pedir agendamento" avisa a
   recepção; pop-up na recepção verifica a cada 45s); ~~AJ5~~ ✅ (v0.12.15, sem
   migração — vitrine "Prontos para apresentar" no topo de /planos com selo
   "novo" + acesso rápido). **AJUSTES PRÉ-GRUPO 4 COMPLETOS (AJ1–AJ5).** Em
   andamento: **AJUSTES 2** — ~~AJ6~~ ✅ (v0.12.16, pop-up da recepção
   organizado); ~~AJ11~~ ✅ (v0.12.17, migração 0075 — Consultor recebe
   notificação de plano pronto, incl. franqueadora com escopo, + aviso de
   apresentação agendada); ~~AJ8~~+~~AJ9~~ ✅ (v0.12.18, sem migração — faixas
   cinza dos horários fora do expediente + respiro no topo da grade, Dia e
   Semana); ~~AJ10~~ ✅ (v0.12.19, sem migração — faixa de dias passado/1 ano,
   scroll do mouse, dia fechado mostra motivo + fechamento parcial = alerta);
   ~~AJ7~~ ✅ (v0.12.21, sem migração — "liberar dia avulso" também estende o
   horário de um dia normal: une com o normal, fim opcional, bloqueia o que já é
   normal; helper `effectiveDayHours` no servidor/seletor/faixa/visão Dia).
   **AJUSTES 2 COMPLETOS (AJ6–AJ11).** Iniciado o **GRUPO 4**: **H4.1 Risartanos
   Lote 1** ✅ (v0.13.0, migração 0076 — módulo base `/risartanos`: tabela
   `staff_members`, código automático, cadastro completo, histórico, ativar/
   inativar; acesso Admin+Gerente+Franqueadora); ~~Lote 1b~~ ✅ (v0.13.1,
   migração 0077 — foto do colaborador: bucket privado staff-photos + upload +
   URL assinada + avatar na lista, também no cadastro/v0.13.2); ~~Lote 2~~ ✅
   (v0.14.0, migração 0078 — vínculo Risartano↔cliente por CPF: colunas
   `staff_member_id`/`risartano_active` + gatilhos automáticos; cadastro
   autopreenche do RH (`lookup_risartano_by_cpf`); ficha destaca "★ É um
   Risartano"/"★ Ex-Risartano (inativo)"; inativação registrada no histórico do
   prontuário); ~~Lote 2b~~ ✅ (v0.14.1, migração 0079 — vínculo Risartano↔
   usuário de acesso por e-mail: `staff_members.user_id` + gatilhos + nome
   sincronizado; coluna Acesso em Risartanos, "Criar acesso" pré-preenchido,
   vincular/desvincular manual; `/admin/usuarios` renomeado "Usuários (acesso)"
   com coluna Risartano). Próximo: H4.1 Lote 3 (auditoria); depois H4.2+
   (módulos novos), um a um com o dono (`docs/ROADMAP.md`).
2. Depois, **H4 restantes** (módulos novos) na ordem numérica (H4.4 já feito).
3. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
2. **LOTE H2 (ajustes rápidos)** — 12 itens no `docs/BACKLOG.md`.
3. **H3/H4** — priorizar com o dono (melhorias médias + módulos novos).
4. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
5. **Fase 2 — módulo comercial e além:** apresentação gravada; assinatura digital
   (**ZapSign**) + pagamento (**ASAAS**) com a regra de ouro; **NPS**; WhatsApp
   manual; transcrição/resumo por **IA**; **dashboards com metas**.

## 4. Decisões de arquitetura importantes (com justificativa)

- **Stack fixa:** Next.js 16 (App Router) + Supabase + Vercel, região São Paulo.
  → integração simples, custo previsível, dado de saúde no Brasil (LGPD).
- **Banco único multi-tenant** (`clinic_id` + RLS em toda tabela de negócio).
  → pensado para 200 unidades sem refazer.
- **Segurança em 2 camadas, só o banco é confiável:** RLS do Postgres (barreira
  real) + guardas no app (esconder botões / erros amigáveis).
- **Config por unidade em cascata:** padrão da rede (clinic_id nulo) → override
  por unidade. Usado em SLA, prazos, tabela de preços e agenda.
- **Dinheiro em centavos (inteiro).** → evita erro de arredondamento.
- **LGPD:** consentimento antes de coletar; exclusão = anonimização (nunca apagar);
  mídia com URL assinada; relatórios da rede sem nomes; nunca dado pessoal em
  log/URL.
- **Sem migração de dados** (entrada dupla no início); **migrações aplicadas à
  mão** (SQL numerado, copiado em UTF-8, o dono cola no SQL Editor do Supabase).

## 5. Pendências, dúvidas em aberto e pontos de atenção

- **Migrações 0001–0060 aplicadas** (confirmado no teste geral de 04/07/2026).
- **Decisões tomadas pelo assistente no LOTE B (o dono confirma no teste):**
  cadeira lotada **bloqueia** o agendamento (exceto urgência/emergência) — se
  preferir só *avisar*, dá para mudar; tempo médio do Planner = criação→aprovação.
- **Fuso horário:** horários são guardados como digitados; pode haver pequena
  diferença em filtros de "hoje/semana" (servidor roda em UTC). Atenção na Fase 2.
- **Infra:** `gh` não funciona nesta rede; push por SSH
  (`git@github.com:Riszon/risarte.git`); operações de repositório o dono faz na web.

## 6. Como retomar numa próxima sessão

1. Pasta do projeto: `C:\Users\Jeferson\MVP RIZON\risarte` (git, branch `main`).
2. Ler `CLAUDE.md` (regras de negócio) e este `ESTADO_DO_PROJETO.md` (onde paramos).
3. Conferir, no rodapé da barra lateral, **versão** e **última migração**; se não
   baterem com este arquivo, aplicar as migrações pendentes.
4. Rodar o app: duplo-clique em **"Iniciar Risarte.bat"** (servidor independente
   do assistente).
5. Banco: o assistente escreve a migração e copia em UTF-8; o dono cola no SQL
   Editor do Supabase, **em ordem**.
6. Fluxo de trabalho: o assistente apresenta um plano curto → espera o OK →
   codifica → dá o roteiro de teste. **Backup definitivo = commit no Git.**

## 7. Protocolo de continuidade (combinado em 22/06/2026)

- **No início de cada sessão:** ler `CLAUDE.md` + este arquivo e dizer, em uma
  frase, onde paramos.
- **Ao final de cada etapa relevante:** atualizar este arquivo (o que foi feito +
  próximos passos).
- **Ao final da sessão:** lembrar o dono de **salvar no Git (commit)** — é o backup
  definitivo.
- **Idioma:** interface e textos em **pt-BR**; código em **inglês**.
