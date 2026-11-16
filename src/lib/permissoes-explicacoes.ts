/**
 * O QUE CADA PERMISSÃO FAZ, EM PORTUGUÊS DE GENTE (pedido do dono, 16/11/2026).
 *
 * "Todos os itens da permissão devem ter uma explicação que qualquer um possa
 * entender, e como impacta se tiver liberado e se não tiver." A tela
 * /admin/permissoes mostra os três textos em cada item.
 *
 * ⚠️ OS TEXTOS SAÍRAM DO CÓDIGO, não de suposição: cada um foi escrito lendo
 * onde a permissão é conferida (o menu, a tela, o botão, a ação, a regra do
 * banco). O que não deu para confirmar está escrito como "não identificado no
 * código analisado". Mudou o que a permissão faz? Mude o texto JUNTO — a
 * régua `permissoes-explicacoes.test.ts` reprova permissão sem os três textos.
 *
 * ⚠️ "Pelo endereço ainda abre": vários itens de MENU só escondem o atalho; a
 * tela em si confere o papel da pessoa, não esta permissão. Está dito em cada
 * um — esconder o atalho não é o mesmo que trancar a tela.
 */

export type Explicacao = {
  /** O que é (uma frase). */
  descricao: string;
  /** O que a pessoa vê e consegue fazer com a permissão LIGADA. */
  seLigado: string;
  /** O que some ou é recusado com a permissão DESLIGADA. */
  seDesligado: string;
};

export const EXPLICACOES: Record<string, Explicacao> = {
  // ---------------------------------------------------------------- Navegação
  "menu.jornada": {
    descricao: "Mostra o item Jornada no menu lateral, com o quadro dos pacientes por fase.",
    seLigado: "Aparece o item “Jornada” no menu lateral. Quem tem só o papel de Dentista continua sem ver o item e sem a tela, mesmo com a permissão ligada.",
    seDesligado: "Some o item “Jornada” do menu. A tela em si não confere esta permissão: quem tem o endereço ainda abre (só o Dentista é mandado ao Início).",
  },
  "menu.agenda": {
    descricao: "Mostra o item Agenda no menu lateral, para marcar e acompanhar horários.",
    seLigado: "Aparece o item “Agenda” no menu lateral (vale para a unidade ativa).",
    seDesligado: "Some o item “Agenda” do menu. A tela em si não confere esta permissão: pelo endereço ela ainda abre.",
  },
  "menu.atendimento": {
    descricao: "Mostra o item Atendimento no menu lateral (chegada, chamada e conclusão do dia).",
    seLigado: "Aparece o item “Atendimento” no menu lateral (vale para a unidade ativa).",
    seDesligado: "Some o item “Atendimento” do menu. A tela em si não confere esta permissão: pelo endereço ela ainda abre.",
  },
  "menu.prontuarios": {
    descricao: "Dá acesso à lista de fichas dos pacientes e à busca rápida da barra de cima.",
    seLigado: "Aparecem o item “Prontuários” no menu lateral e a busca rápida de pacientes na barra de cima.",
    seDesligado: "Somem o item “Prontuários” e a busca rápida (a busca não devolve nada). A lista em si não confere esta permissão: pelo endereço ela ainda abre.",
  },
  "menu.planejamento": {
    descricao: "Mostra o item Centro de Planejamento no menu lateral (a fila dos casos a planejar).",
    seLigado: "Aparece o item no menu, exceto para quem é só Dentista. A tela só abre para o Dentista Planner (e o Admin): para os outros papéis, o item aparece mas leva de volta ao Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: o Planner ainda entra pelo endereço.",
  },
  "menu.procedimentos": {
    descricao: "Mostra o item Procedimentos no menu lateral (catálogo com preços, protocolos e repasse).",
    seLigado: "Aparece o item no menu, exceto para quem é só Dentista. A tela só abre para o Planner, o Coordenador Clínico e o Admin: para os outros papéis, ela leva de volta ao Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: o Planner e o Coordenador ainda entram pelo endereço.",
  },
  "menu.manual": {
    descricao: "Dá acesso ao manual de treinamento dentro do sistema.",
    seLigado: "Aparece o atalho “Manual de treinamento” na barra de cima e a tela do manual abre.",
    seDesligado: "Some o atalho do manual e quem abre a tela do manual é levado ao Início.",
  },
  "menu.sistema": {
    descricao: "Dá acesso aos alertas do sistema e ao canal para relatar um problema.",
    seLigado: "Aparecem na barra de cima o triângulo “Alertas do sistema” e a boia de relatar problema, e as telas de Alertas e de Problemas abrem.",
    seDesligado: "Somem os alertas e a boia da barra de cima, e as duas telas levam ao Início (no modo portal a boia continua e Problemas ainda abre).",
  },
  // ------------------------------------------------------------------ Módulos
  "modulo.planos": {
    descricao: "Mostra o item Planos de Tratamento no menu (visão gerencial dos planos da unidade).",
    seLigado: "Aparece o item no menu, conferido na unidade ativa e nunca para quem é só Dentista. A tela só mostra dados para Gerente, Coordenador, Franqueado e papéis da Franqueadora; os outros vão para o Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: quem tem um dos papéis acima ainda abre pelo endereço.",
  },
  "modulo.comercial": {
    descricao: "Mostra o item Comercial no menu (o funil de negociação e fechamento).",
    seLigado: "Aparece o item no menu, nunca para quem é só Dentista. A tela só abre para Consultor e Assistente Comercial, Gerente, Franqueado e o Admin; os outros vão para o Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: quem tem um dos papéis acima ainda abre pelo endereço.",
  },
  "modulo.relatorios": {
    descricao: "Mostra o item Relatórios no menu (indicadores de agenda, rede e produtividade).",
    seLigado: "Aparece o item no menu, conferido na unidade ativa e nunca para quem é só Dentista. A tela só mostra dados para Gerente, Franqueado e papéis da Franqueadora; os outros vão para o Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: quem tem um dos papéis acima ainda abre pelo endereço.",
  },
  "modulo.risartanos": {
    descricao: "Mostra o item Risartanos no menu (cadastro da equipe, unidades e acesso ao sistema).",
    seLigado: "Aparece o item no menu, nunca para quem é só Dentista. A tela só abre para Gerente, Franqueado, Franqueadora e o Admin; os outros vão para o Início.",
    seDesligado: "Some o item do menu. A tela em si não confere esta permissão: quem tem um dos papéis acima ainda abre pelo endereço.",
  },
  "modulo.ppr": {
    descricao: "Dá acesso ao programa de prevenção PPR+.",
    seLigado: "Aparece o item “PPR+ (Prevenção)” no menu e abrem as telas do PPR+: início, painel, adesões, novos, mensalidades e validar.",
    seDesligado: "Some o item do menu, e quem abre qualquer tela do PPR+ é levado ao Início.",
  },
  "modulo.empresarial": {
    descricao: "Dá acesso ao módulo Empresarial (convênio com empresas parceiras): ver as empresas, os titulares e os relatórios.",
    seLigado: "Aparece o item “Empresarial” no menu (nunca para quem é só Dentista) e abrem as telas do módulo. O que cada pessoa pode FAZER lá dentro vem das permissões do grupo “Ações — Empresarial”.",
    seDesligado: "Some o item e as telas do Empresarial levam ao Início. Quem tem “Gerir o programa” ou “Cobranças das empresas” continua entrando, porque essas duas também abrem o módulo.",
  },
  "modulo.indica": {
    descricao: "Dá acesso ao programa de indicação Indica +Risos.",
    seLigado: "Aparece o item no menu e abrem as telas do módulo (indicações, embaixadores, campanhas, resgates); na ficha, o selo do Embaixador vira link. Ligar além do padrão pode abrir a tela com os dados ainda barrados pelo banco.",
    seDesligado: "Some o item e o módulo leva ao Início; as ações são recusadas. Na ficha, o selo aparece sem link e o guia abre a versão simples.",
  },
  "modulo.rita": {
    descricao: "Dá acesso à tela da assistente virtual (Rita): o que ela sabe de cada unidade e o que falta para ligar.",
    seLigado: "Aparece o item “Assistente virtual” no menu e abrem a tela da Rita e a de cada unidade. Ligar a Rita é só do Admin; desligar, também do Gerente da unidade. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Some o item do menu; as telas da Rita levam ao Início e o botão de ligar/desligar é recusado.",
  },
  "modulo.central": {
    descricao: "Dá acesso à Central de Configuração e à aba da conta Asaas e tarifas das unidades.",
    seLigado: "Aparecem o item “Central de Configuração” e a aba “Conta e tarifas” (o Gerente vê só a unidade dele). Ligar além do padrão pode abrir a tela com os dados ainda barrados pelo banco.",
    seDesligado: "Some a aba da conta Asaas. Quem também não tem o Financeiro perde o item e vai ao Início; quem tem o Financeiro ainda entra na Central pelas outras abas.",
  },
  "modulo.metas": {
    descricao: "Dá acesso ao módulo de Metas da rede e da unidade.",
    seLigado: "Aparecem o item “Metas” no menu e o bloco “Minhas metas” no Início, e abrem o painel e a ficha de cada meta. Criar meta exige outra permissão. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Somem o item e o bloco do Início; as telas de Metas levam ao Início e as ações são recusadas.",
  },
  "modulo.ortodontia": {
    descricao: "Dá acesso ao módulo de Ortodontia (casos, cronograma de manutenções e quem precisa de atenção).",
    seLigado: "Aparece o item no menu e abrem Atenção, Casos, ficha do caso, termo e mensalidades. O Dentista vê só os casos em que é o ortodontista. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Some o item do menu; as telas da Ortodontia levam ao Início e as ações são recusadas (“Sem acesso à ortodontia”).",
  },
  "modulo.ortodontia.painel": {
    descricao: "Dá acesso ao Painel da Ortodontia, com os números da especialidade.",
    seLigado: "Quem também tem a Ortodontia abre o Painel na entrada do módulo, e as outras telas mostram o botão “Painel”. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Quem abre a Ortodontia cai direto na tela “Atenção”, e o botão de voltar aponta para Atenção em vez do Painel.",
  },
  "modulo.financeiro": {
    descricao: "Dá acesso ao módulo Financeiro (contas, DRE, fluxo de caixa, taxas e repasses).",
    seLigado: "Aparece o item “Financeiro” no menu (nunca para quem é só Dentista) e abrem as telas do Financeiro; também abre a aba Financeiro da Central. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Some o item do menu; todas as telas do Financeiro levam ao Início e as ações de DRE, fluxo e inadimplentes são recusadas.",
  },
  "modulo.estoque": {
    descricao: "Dá acesso ao módulo de Estoque (itens, kits, saldo e inventário).",
    seLigado: "Aparece o item “Estoque” no menu, a tela abre e os Alertas passam a mostrar os avisos de estoque da unidade. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Somem o item e os avisos de estoque nos Alertas, e a tela leva ao Início. O Financeiro da Franqueadora continua vendo sempre.",
  },
  "modulo.compras": {
    descricao: "Dá acesso ao módulo de Compras (requisição, cotação, pedido e recebimento).",
    seLigado: "Aparece o item “Compras” no menu e abrem as telas: lista, aprovar, painel e receber. Ligar além do padrão pode abrir a tela com dados barrados pelo banco.",
    seDesligado: "Some o item e as telas levam ao Início — a não ser que a pessoa tenha “Criar requisição” ou “Negociar compras”, que também abrem o módulo.",
  },
  // ---------------------------------------------------------------- Estoque
  "acao.estoque.catalogo": {
    descricao: "Permite cadastrar, editar e inativar itens no catálogo de insumos, que vale para toda a rede.",
    seLigado: "Em Estoque aparecem “Novo item” e as opções de editar e excluir item. A tela só libera isso para o Financeiro da Franqueadora e o Admin, mesmo que outro papel seja ligado aqui.",
    seDesligado: "Somem “Novo item” e a edição do catálogo; aparece o aviso “O cadastro de itens é da rede” e salvar é recusado.",
  },
  // ---------------------------------------------------------------- Compras
  "acao.compras.requisitar": {
    descricao: "Permite montar e enviar a lista de compras da unidade e receber o pedido quando ele chega.",
    seLigado: "Mostra o menu Compras e a opção de gerar, editar e enviar a lista. Receber pedido só funciona para Gerente, Financeiro da Franqueadora e Admin; para outros papéis a tela pode abrir só para consulta, porque o banco não aceita a gravação.",
    seDesligado: "Sem esta nem outra permissão de Compras, o menu some e a tela volta ao Início. Com acesso por outra permissão, aparece “Só consulta” e gerar, enviar ou receber é recusado.",
  },
  "acao.compras.aprovar": {
    descricao: "Permite aprovar ou recusar o que a rede negociou para a unidade e gerar o pedido de compra.",
    seLigado: "Em Compras → Aprovar aparecem aprovar e recusar cada item e gerar o pedido. Só funciona para o Gerente da unidade e para o Financeiro na compra da própria Franqueadora; outros papéis veem a tela sem os botões.",
    seDesligado: "Os botões de aprovar, recusar e gerar pedido somem, e a ação é recusada.",
  },
  "acao.compras.negociar": {
    descricao: "É a função de Comprador da Franqueadora: ver as cotações dos fornecedores e escolher o vencedor.",
    seLigado: "Abre o menu Compras e a Mesa de negociação (Rodadas), além da visão da rede no painel de Compras. A gravação continua decidida pelo banco, que pode bloquear quem não for Comprador.",
    seDesligado: "A Mesa de negociação manda de volta para Compras (a não ser para quem configura o financeiro da rede), e o painel deixa de mostrar a visão da rede.",
  },
  // ------------------------------------------------------------- Programas
  "acao.ortodontia.gerir": {
    descricao: "Permite abrir, editar, iniciar, finalizar, suspender e interromper o caso de ortodontia.",
    seLigado: "Mostra “Novo caso”, “Caso legado”, Configuração, Editar caso, mudar situação, Termo e cancelar mensalidade. A tela só libera para Gerente e Coordenador da unidade; outros papéis continuam sem os botões e o banco também recusa.",
    seDesligado: "Somem esses botões; a tela de novo caso volta para a lista e as ações são recusadas (“Você não pode editar este caso”).",
  },
  "acao.ortodontia.evoluir": {
    descricao: "Permite registrar a manutenção feita e a evolução do caso: fio, observações e próximo passo.",
    seLigado: "Na ficha do caso aparece o botão de evolução em cada manutenção. Vale para o Coordenador e para o dentista que é o ortodontista do caso; ligar para outros papéis não faz o botão aparecer, e o banco também decide.",
    seDesligado: "O botão de evolução some da ficha do caso. Se o banco lê esta permissão: não identificado no código analisado.",
  },
  "acao.ortodontia.financeiro": {
    descricao: "Permite gerar as mensalidades do mês da ortodontia e dar baixa nos pagamentos.",
    seLigado: "Aparecem “Gerar mensalidades do mês”, a baixa de cada mensalidade e as ações do lote na ficha do caso. Vale para o Gerente da unidade e para a Franqueadora/Financeiro; para outros papéis a tela pode mostrar e o banco ainda recusar.",
    seDesligado: "Somem a geração e a baixa, aparece o aviso “a baixa é do Gerente e do Financeiro” e as ações são recusadas. Recepção, Franqueado e Coordenador continuam vendo os valores.",
  },
  "acao.ppr.configurar": {
    descricao: "Permite configurar o PPR+: planos, valores, vantagens e regras do programa de prevenção.",
    seLigado: "Na tela do PPR+ aparece o botão “Configurar programa”, que abre a configuração e a edição de cada plano.",
    seDesligado: "O botão some e quem tentar abrir a configuração volta para o PPR+. Por padrão, só o Admin Master tem esta permissão.",
  },
  "acao.indica.indicar": {
    descricao: "Permite pedir e registrar indicações na ficha do cliente sem ver o módulo Indica +Risos inteiro.",
    seLigado: "Na ficha do cliente aparecem “Pedi indicação” e “Nova indicação”, e o Guia do Indica abre. Quem já vê o módulo Indica tem isso de qualquer jeito; o banco também confere cada indicação gravada.",
    seDesligado: "Para quem não vê o módulo Indica, os botões somem da ficha, o Guia volta ao Início e as ações são recusadas.",
  },
  // ------------------------------------------------------------------ Metas
  "acao.metas.criar_rede": {
    descricao: "Permite criar, editar, duplicar, pausar e cancelar metas da rede toda ou de várias unidades.",
    seLigado: "Em Metas aparecem “Nova meta” com a opção de rede ou várias unidades, “Modelos” e editar em qualquer meta. Só vale para a Franqueadora/Rede; para outros papéis nada aparece e o banco também recusa.",
    seDesligado: "Somem “Modelos” e a criação de meta da rede; a tela de modelos volta para Metas e a edição de metas da rede fica bloqueada.",
  },
  "acao.metas.criar_unidade": {
    descricao: "Permite criar, editar, duplicar, pausar e cancelar metas da própria unidade.",
    seLigado: "Aparece “Nova meta”, com as unidades onde a pessoa é Gerente ou Franqueado, e editar nas metas dessa unidade. Outros papéis não ganham o botão, e o banco aceita só Gerente e Franqueado.",
    seDesligado: "Somem “Nova meta” e editar nas metas da unidade (salvo para quem tem a permissão de criar meta da rede).",
  },
  // ------------------------------------------------------------ Assinaturas
  "modulo.assinaturas": {
    descricao: "Mostra o módulo Assinaturas: documentos enviados para assinatura digital pela ZapSign.",
    seLigado: "Aparece o menu Assinaturas, com o Painel, a lista de Pacotes, o detalhe do pacote, Minhas pendentes e Relatórios. O banco lê esta mesma permissão: ligar aqui vale por completo.",
    seDesligado: "O menu some, e as telas de Assinaturas (painel, pacotes, detalhe e relatórios) voltam para o Início.",
  },
  "acao.assinaturas.enviar": {
    descricao: "Permite montar o pacote de documentos (contrato, TCLE, orçamento, autorização, adesão) e enviar para assinatura.",
    seLigado: "Aparece o envio para assinatura na ficha do cliente, no Comercial, na Apresentação e na empresa; no pacote aparecem reenviar e “reenviar como novo”. O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "Somem os botões de envio e reenvio, e as ações são recusadas (“Você não tem permissão para enviar/reenviar documentos”).",
  },
  "acao.assinaturas.cancelar": {
    descricao: "Permite cancelar, com motivo, um pacote que ainda não foi assinado.",
    seLigado: "No detalhe do pacote e na aba Documentos da ficha aparece o botão Cancelar nos pacotes aguardando (no já assinado ele aparece apagado, explicando o porquê). O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "O botão Cancelar some e a ação é recusada (“Você não tem permissão para cancelar documentos”).",
  },
  "acao.assinaturas.visualizar": {
    descricao: "Permite abrir os pacotes da unidade, ver quem já assinou e ler o PDF na tela, sem baixar.",
    seLigado: "Aparecem os pacotes na aba Documentos da ficha, no Comercial e na lista de Pacotes, com o botão de ver o PDF. O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "Os pacotes deixam de aparecer e o botão de ver o PDF some; a ação é recusada. Quem tem o Painel da rede continua vendo.",
  },
  "acao.assinaturas.baixar": {
    descricao: "Permite baixar o PDF assinado e as cópias do pacote; cada download fica registrado na auditoria.",
    seLigado: "No detalhe do pacote e na ficha aparecem os botões de baixar o assinado e baixar a cópia. O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "Os botões de baixar somem e a ação é recusada (“Você não tem permissão para baixar documentos”).",
  },
  "acao.assinaturas.painel_unidade": {
    descricao: "Mostra os números de assinatura das próprias unidades: enviados, assinados, aguardando e tempo de resposta.",
    seLigado: "Em Assinaturas aparecem os cartões de números, os gráficos, as listas de cada número e o botão Relatórios (PDF e planilha), só das unidades onde a pessoa tem esta permissão. O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "Sem esta e sem o Painel da rede, a tela mostra só um aviso e os botões Pacotes e Minhas pendentes; Relatórios volta para Assinaturas.",
  },
  "acao.assinaturas.painel_rede": {
    descricao: "Mostra os números de assinatura de todas as unidades e libera ver os pacotes da rede inteira.",
    seLigado: "O painel e os relatórios passam a mostrar a rede toda, com filtro por unidade e a tabela “Por unidade”; a pessoa pode ver pacotes de qualquer unidade. O banco lê esta mesma permissão: vale por completo.",
    seDesligado: "Somem a visão da rede, o filtro de unidade e a tabela por unidade; a pessoa fica só com o painel e os pacotes das próprias unidades.",
  },
  "acao.assinaturas.configurar": {
    descricao: "Permite configurar as assinaturas: parâmetros da rede, modelos, kits, plano ZapSign e quem recebe o relatório mensal.",
    seLigado: "Em Assinaturas aparece o botão Configurações, que abre a tela de configurações e a de modelos e permite salvar. O banco lê esta mesma permissão: vale por completo. Por padrão, só o Admin Master tem.",
    seDesligado: "O botão Configurações some, as telas de configurações e modelos voltam para Assinaturas e salvar é recusado.",
  },
  // ----------------------------------------------- Central e cobrança (Asaas)
  "acao.central.vincular_conta": {
    descricao: "Permite ao Gerente colar na Central a chave de API da conta Asaas da própria unidade.",
    seLigado: "O Gerente vê o campo da chave em Central → Conta e tarifas e pode gravá-la. Só vale para o Gerente da unidade, e o banco só aceita depois do termo do franqueado registrado.",
    seDesligado: "O campo de gravar a chave some para o Gerente e a ação é recusada. O Admin Master continua podendo sempre.",
  },
  "acao.cobranca.ver": {
    descricao: "Permite ver as cobranças do Asaas nas parcelas do paciente, na ficha.",
    seLigado: "Na ficha (parcelas) aparecem a situação da cobrança, o link da fatura, o Pix, a linha digitável, o comprovante e o “Recebeu no balcão” (para quem dá baixa). Também é preciso ter esta para ver os botões de emitir e cancelar.",
    seDesligado: "O bloco da cobrança some da parcela, junto com os botões de emitir e cancelar, e o “Recebeu no balcão” é recusado.",
  },
  "acao.cobranca.emitir": {
    descricao: "Permite gerar no Asaas a cobrança de uma parcela (boleto, Pix ou cartão) e o link para o paciente.",
    seLigado: "Aparecem “Gerar cobrança no Asaas” e “Tentar de novo” na parcela (com “ver” ligado) e, no Comercial, tentar de novo o parcelamento. O banco só aceita Admin, Financeiro da Franqueadora, Gerente e Recepcionista.",
    seDesligado: "Os botões somem e a prévia, a emissão e a nova tentativa são recusadas.",
  },
  "acao.cobranca.cancelar": {
    descricao: "Permite cancelar a cobrança no Asaas e marcar a parcela como cobrada fora do riSZon.",
    seLigado: "Aparecem “Cancelar cobrança”, “Já cobrada fora do riSZon” e “Desfazer” na parcela (com “ver” ligado), e o cancelamento do parcelamento. O banco só aceita Admin, Financeiro da Franqueadora e Gerente.",
    seDesligado: "Esses botões somem e as ações são recusadas.",
  },
  "acao.cobranca.selo_atraso": {
    descricao: "Mostra o selo “Em atraso há N dias” do paciente, sem valores.",
    seLigado: "O selo aparece na ficha, na agenda e no cockpit da avaliação. O banco lê esta permissão (vale por completo), mas só para Gerente, Franqueado, Recepcionista, Consultor, Assistente Comercial e Financeiro.",
    seDesligado: "O selo some dessas telas. Dentista, Planner, TSB, ASB e SDR nunca veem, mesmo com a permissão ligada.",
  },
  "modulo.painel_cobrancas": {
    descricao: "Dá acesso ao Painel de cobranças: o que o Asaas ainda vai creditar e a lista das cobranças emitidas.",
    seLigado: "Aparece o item Cobranças no menu do Financeiro, com a página e a planilha. O banco lê esta permissão (vale por completo), mas só para Gerente, Franqueado e Financeiro da Franqueadora.",
    seDesligado: "O item some do menu, quem abre o endereço volta para o Financeiro e a planilha é recusada. A Recepcionista nunca vê.",
  },
  "acao.cobranca.estorno": {
    descricao: "Permite pedir ao Asaas, pela ficha, o estorno total de uma cobrança já paga.",
    seLigado: "Aparece “Pedir estorno” na cobrança paga. O banco lê esta permissão (vale por completo), mas só para Franqueado e Gerente, e só se a unidade indicou esse papel na Central como titular do acesso do Asaas.",
    seDesligado: "O botão “Pedir estorno” some e o pedido é recusado. O Admin Master sempre pode.",
  },
  // ---------------------------------------------------------------- Financeiro
  "modulo.repasses_franquia": {
    descricao: "Dá acesso à tela Repasses da franquia: as taxas da rede que a unidade paga pelo split do Asaas (não é o repasse dos dentistas).",
    seLigado: "Aparece o item Repasses da franquia no menu do Financeiro, com a página e os dados. O banco lê esta permissão (vale por completo), mas só para Gerente e Franqueado (a própria unidade) e Financeiro da Franqueadora.",
    seDesligado: "O item some do menu, quem abre o endereço volta para o Financeiro e a leitura dos dados é recusada.",
  },
  "acao.financeiro.lancar": {
    descricao: "Permite mexer em dinheiro e cadastros financeiros da unidade.",
    seLigado: "Permite editar bens e depreciação, orçamento, alertas, os repasses do mês e fechar o mês. Ligar além do padrão pode abrir a tela com a gravação ainda barrada pelo banco.",
    seDesligado: "Essas telas ficam só para consulta e as ações são recusadas. O Admin e o Financeiro da Franqueadora sempre podem; o Contas a pagar segue a função da pessoa, não esta permissão.",
  },
  "acao.financeiro.repasse.relatorio": {
    descricao: "Permite montar o relatório de repasse dos dentistas: gerar, excluir procedimento com motivo, cancelar, enviar e pagar.",
    seLigado: "Aparecem os botões de gerir os relatórios em Financeiro → Repasses → Relatórios. Só funciona para o Admin e o Financeiro da Franqueadora; para outra função, ligar não muda nada (a tela e o banco recusam).",
    seDesligado: "Os botões de gerir somem e as ações são recusadas. Ler os relatórios não depende desta permissão.",
  },
  "acao.financeiro.configurar_rede": {
    descricao: "Dá acesso às configurações e visões financeiras da REDE, que valem para todas as unidades.",
    seLigado: "Abre o Consolidado, o Painel da rede, as Taxas da rede, a reabertura de mês, a Mesa de compras e as abas Financeiro/Taxas da Central. Só o Admin e o Financeiro da Franqueadora gravam; os outros só consultam.",
    seDesligado: "O Consolidado e o Painel da rede mandam para a DRE da unidade; a edição da rede, a reabertura de mês e a Mesa de compras ficam fechadas.",
  },
  // ------------------------------------------------------------------ Dívidas
  "modulo.dividas": {
    descricao: "Dá acesso ao Levantamento de Dívidas: o que a rede deve a bancos, fornecedores e tributos.",
    seLigado: "Aparece Levantamento de Dívidas no menu do Financeiro, com a lista, a ficha e a exportação. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora.",
    seDesligado: "O item some do menu e as páginas voltam para o Financeiro; todas as outras permissões de dívidas param de valer. O Admin Master sempre vê.",
  },
  "acao.dividas.lancar": {
    descricao: "Permite cadastrar e editar dívidas, credores e contatos de cobrança.",
    seLigado: "Libera editar na lista de dívidas, na ficha da dívida, na aba Credores e no “gerar pendentes”. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora, e exige também o módulo Dívidas.",
    seDesligado: "Os controles de cadastrar e editar somem e o banco recusa a gravação.",
  },
  "acao.dividas.excluir": {
    descricao: "Permite excluir uma dívida, com motivo obrigatório (ela continua no histórico).",
    seLigado: "Aparece a opção de excluir na ficha da dívida. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora, e exige também o módulo Dívidas.",
    seDesligado: "A opção de excluir some da ficha e o banco recusa a exclusão.",
  },
  "acao.dividas.importar": {
    descricao: "Permite importar dívidas de uma planilha e desfazer a importação enquanto nada foi pago.",
    seLigado: "Aparece o botão de importar planilha, e a tela de importação permite gravar e desfazer. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora.",
    seDesligado: "O botão de importar some e a tela de importação fica só para consulta; gravar e desfazer são recusados.",
  },
  "acao.dividas.renegociar": {
    descricao: "Permite registrar acordos de dívida (as parcelas viram contas a pagar), desfazê-los e registrar que o credor restabeleceu a dívida.",
    seLigado: "Libera as ações de acordo na ficha da dívida. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora; acordo acima do valor de aprovação espera o Admin Master.",
    seDesligado: "As ações de acordo somem da ficha e o banco recusa.",
  },
  "acao.dividas.ver_unidade": {
    descricao: "Mostra no Painel do Financeiro da unidade o card “Dívidas da unidade”, só com números.",
    seLigado: "O Gerente ou o Franqueado vê o card no Painel do Financeiro da própria unidade, sem credor, contato ou anexo. O banco lê esta permissão (vale por completo), mas só para esses dois papéis.",
    seDesligado: "O card some do Painel. Quem já tem o módulo Dívidas continua vendo.",
  },
  "acao.dividas.configurar": {
    descricao: "Permite configurar o Levantamento de Dívidas: categorias, naturezas, etiquetas, regra de inadimplência e data de implantação.",
    seLigado: "Libera editar a aba Configurações do Levantamento de Dívidas. O banco lê esta permissão (vale por completo), mas só para o Financeiro da Franqueadora.",
    seDesligado: "A aba Configurações fica só para consulta e o banco recusa a gravação.",
  },
  // ------------------------------------------------------------------ Estoque
  "acao.estoque.gerir": {
    descricao: "Permite dar entrada em mercadoria e fazer o inventário (contagem) do estoque.",
    seLigado: "ASB e TSB fazem entrada e inventário; o Gerente também importa nota fiscal, registra compra, define o mínimo e monta kits. Para outras funções não muda nada, e o banco não lê esta permissão.",
    seDesligado: "O inventário, a importação de nota e as opções de entrada somem, e as ações são recusadas. O Admin e o Financeiro da Franqueadora sempre podem.",
  },
  "acao.estoque.consumir": {
    descricao: "Permite registrar material usado fora do kit do procedimento (consumo avulso).",
    seLigado: "Aparecem o quadro “Lançar movimento” (consumo e perda) e o “abrir embalagem”. Ligar além do padrão pode abrir a tela com a gravação ainda barrada pelo banco, que não lê esta permissão.",
    seDesligado: "O quadro “Lançar movimento” e o abrir embalagem somem, e o lançamento é recusado. O Gerente com “Entrada e inventário” continua podendo.",
  },
  // --------------------------------------------- Empresarial (1048, 16/11/2026)
  "acao.empresarial.gerir": {
    descricao: "É o gestor do Empresarial: cuida de todas as empresas e de todo o funil comercial da rede.",
    seLigado: "Cadastra e importa empresas; edita os dados de QUALQUER empresa (dados gerais, documentos, unidades, preços, benefícios, vantagens, contratos), suspende e encerra; trabalha no funil e na agenda de todos os consultores e vê o Painel do programa. O banco lê esta permissão: vale por completo.",
    seDesligado: "A pessoa deixa de ver as empresas e os leads da rede inteira: fica só com o que outra permissão der (a própria carteira, os titulares da unidade, as cobranças). Cadastrar, importar, editar e mudar a situação somem, e o banco recusa.",
  },
  "acao.empresarial.carteira": {
    descricao: "Para o Consultor RisLife: cuidar só das empresas e dos leads em que ele é o responsável.",
    seLigado: "Trabalha no funil, na agenda, nas propostas e nos contratos dos leads DELE e edita as empresas em que é o consultor responsável. As empresas e os leads dos outros ficam fora do alcance (regra fixa do banco). O banco lê esta permissão: vale por completo.",
    seDesligado: "Mesmo sendo o responsável, a pessoa não vê nem edita aqueles leads e empresas, e o funil fica fechado para ela (a não ser que tenha “Gerir o programa”).",
  },
  "acao.empresarial.cobrancas": {
    descricao: "Cuidar do financeiro do programa: as mensalidades e a implantação cobradas das empresas.",
    seLigado: "Gera mensalidades e implantação (também em lote), dá baixa, edita, cancela e estorna cobranças, confere a inadimplência e edita o Acordo de cobrança, em todas as empresas. Também abre o módulo Empresarial. O banco lê esta permissão: vale por completo.",
    seDesligado: "Somem os botões de cobrança, baixa, estorno e o Acordo de cobrança, e o banco recusa. A pessoa só vê as cobranças das empresas que ela enxerga por outro caminho.",
  },
  "acao.empresarial.titulares": {
    descricao: "Incluir, importar, editar, inativar e reativar os colaboradores (titulares) das empresas e os dependentes deles.",
    seLigado: "Na ficha da empresa (aba Titulares) aparecem Novo titular, Importar Excel, editar, inativar, excluir e os dependentes. Vale nas empresas que a pessoa alcança: toda a rede (gestor e SDR), as da carteira (Consultor) ou as com titulares na unidade dela. O banco lê esta permissão: vale por completo.",
    seDesligado: "A aba Titulares fica só para consulta: os botões somem e o banco recusa cadastrar, importar, inativar ou reativar.",
  },
  "acao.empresarial.configurar": {
    descricao: "Mexer nas regras do Empresarial que valem para todas as empresas da rede.",
    seLigado: "Abre Empresarial → Configurações: preços de adesão e divisão (split) padrão da rede, benefícios e grupos, outras vantagens, modelos de proposta e de contrato e os dados da Risarte no contrato. O banco lê esta permissão: vale por completo.",
    seDesligado: "O botão Configurações some, a tela volta para o Empresarial e gravar as regras da rede é recusado.",
  },
};
