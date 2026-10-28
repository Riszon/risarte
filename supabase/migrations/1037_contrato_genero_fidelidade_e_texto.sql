-- =============================================================================
-- 1037 — CONTRATO: QUEM ASSINA (SR./SRA.), FIDELIDADE DA EMPRESA E TEXTO NOVO
-- -----------------------------------------------------------------------------
-- Pedido do dono (28/10/2026):
--   * "adequar o texto para feminino e masculino. por exemplo: por seu
--     presidente ou sua presidente; portador ou portadora";
--   * "trocar o termo colaborador ou Funcionário por Titular" e "convênio"
--     por "Programa Risarte Empresarial";
--   * reajuste acima da inflação (escolha dele: IPCA + 3% ao ano);
--   * cláusula décima: não é co-participação de 50% — vale a lista de
--     benefícios do Anexo I;
--   * cláusula décima primeira: documentações e exames (tomografia,
--     panorâmica, documentação ortodôntica) são feitos fora e pagos pelo
--     Titular ou Dependente;
--   * "na proposta deve ter como configurar se terá prazo mínimo de
--     fidelidade no programa, se sim quanto tempo. E esta informação deve ir
--     para o contrato." Multa FIXA em R$ (escolha dele). A regra de 12 meses
--     de cada Titular SAI (escolha dele).
--
-- 1. As colunas: Sr./Sra. de quem assina (proposta e Risarte), meses de
--    fidelidade e multa.
-- 2. O texto do modelo DA REDE — só se ele ainda for o original de 13/10
--    (1027). Se alguém o editou na tela, a migração NÃO sobrescreve e avisa.
--    Os textos personalizados por empresa nunca são tocados.
--
-- Só acrescenta colunas. Idempotente.
-- =============================================================================

-- ---- 1) As colunas -------------------------------------------------------------
alter table empresarial.lead_qualification
  add column if not exists responsible_gender varchar(1),
  add column if not exists min_term_months int,
  add column if not exists early_exit_fee_cents int;

alter table empresarial.lead_qualification
  drop constraint if exists lead_qualification_responsible_gender_check;
alter table empresarial.lead_qualification
  add constraint lead_qualification_responsible_gender_check
    check (responsible_gender is null or responsible_gender in ('F', 'M'));
alter table empresarial.lead_qualification
  drop constraint if exists lead_qualification_min_term_months_check;
alter table empresarial.lead_qualification
  add constraint lead_qualification_min_term_months_check
    check (min_term_months is null or min_term_months between 1 and 120);
alter table empresarial.lead_qualification
  drop constraint if exists lead_qualification_early_exit_fee_check;
alter table empresarial.lead_qualification
  add constraint lead_qualification_early_exit_fee_check
    check (early_exit_fee_cents is null or early_exit_fee_cents >= 0);

comment on column empresarial.lead_qualification.responsible_gender is
  'Quem assina pela empresa: F (Sra.) ou M (Sr.). O contrato concorda: '
  '"sua/seu", "portadora/portador" (1037). Nulo = forma dupla.';
comment on column empresarial.lead_qualification.min_term_months is
  'Fidelidade da EMPRESA no programa, em meses (1037). Nulo = sem fidelidade.';
comment on column empresarial.lead_qualification.early_exit_fee_cents is
  'Multa fixa, em centavos, se a empresa sair antes da fidelidade (1037). '
  'Nulo = sem multa.';

alter table empresarial.contract_settings
  add column if not exists rep_gender varchar(1);
alter table empresarial.contract_settings
  drop constraint if exists contract_settings_rep_gender_check;
alter table empresarial.contract_settings
  add constraint contract_settings_rep_gender_check
    check (rep_gender is null or rep_gender in ('F', 'M'));
comment on column empresarial.contract_settings.rep_gender is
  'Representante da Risarte: F (Sra.) ou M (Sr.) — 1037.';

-- ---- 2) O texto do modelo da rede ----------------------------------------------
do $migracao$
declare
  trocados int;
begin
  update empresarial.contract_templates
     set preamble = $pre$De um lado, perfazendo como CONTRATANTE, **{{contratante_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ/CAEPF sob o n°. **{{contratante_documento}}**, com sede na **{{contratante_endereco}}**, neste ato representada por {{contratante_seu}} {{contratante_cargo}}, **{{contratante_representante}}**, {{contratante_nacionalidade}}, {{contratante_portador}} do RG n°. {{contratante_rg}}, {{contratante_inscrito}} no CPF sob o nº. **{{contratante_cpf}}** e, de outro lado, perfazendo como CONTRATADO, **{{contratada_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ sob o n°. {{contratada_cnpj}}, com sede na {{contratada_endereco}}, neste ato representada por {{contratada_seu}} {{contratada_cargo}}, **{{contratada_representante}}**, {{contratada_nacionalidade}}, {{contratada_portador}} do RG n°. {{contratada_rg}}, {{contratada_inscrito}} no CPF sob o n°. {{contratada_cpf}}, firmam o presente Instrumento Particular, a reger-se pelas seguintes cláusulas e condições:$pre$,
         sections = jsonb_build_array(
    jsonb_build_object('titulo', $t$CLÁUSULA PRIMEIRA$t$, 'corpo',
      $c$o presente contrato tem como objeto a prestação continuada de tratamentos no âmbito odontológico pelo CONTRATADO, por meio do **PROGRAMA RISARTE EMPRESARIAL (PRE)**, com abrangência {{abrangencia}}, nas clínicas da rede RISARTE, compreendendo os procedimentos sem custo e os procedimentos com desconto relacionados no Anexo I do presente instrumento, conforme a proposta comercial aceita pela CONTRATANTE;
Parágrafo primeiro: o regime de contratação do Programa Risarte Empresarial é coletivo por adesão, tornando-se beneficiários os Titulares indicados pela CONTRATANTE, bem como os seus dependentes que aderirem ao Programa;
Parágrafo segundo: o benefício de cada procedimento (sem custo ou com desconto), para quem ele vale (Titular e/ou Dependente), o limite de uso e a carência são os definidos no Anexo I;
Parágrafo terceiro: não será aplicado desconto sobre os custos de laboratório de próteses, aparelhos ortopédicos e ortodônticos (exceto aparelhos ortodônticos tradicionais), alinhadores invisíveis (Invisalign) e/ou produtos e medicações para harmonização orofacial;
Parágrafo quarto: os custos de laboratório de próteses e/ou de produtos de harmonização orofacial poderão ser divididos em até 6 (seis) pagamentos, por boleto bancário;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA SEGUNDA$t$, 'corpo',
      $c$a CONTRATANTE disponibilizará a adesão ao Programa Risarte Empresarial aos seus sócios e Titulares, e aos respectivos dependentes;
Parágrafo primeiro: poderão ser inscritos como dependentes do Titular todos aqueles que fizerem parte do seu grupo familiar (ex.: genitores, cônjuge, filhos e netos) ou que tenham, devidamente comprovada, dependência econômica do Titular;
Parágrafo segundo: para a inclusão de Titulares ou dependentes, deverão ser apresentados à RISARTE, no ato da adesão, os seguintes documentos: cópia do RG e do CPF (que poderão ser substituídos pela CNH) e comprovante de residência; para dependentes menores de idade, cópia da certidão de nascimento e dos documentos dos genitores, ou do genitor que detiver a guarda; e, para pessoas com deficiência sob curatela, cópia do RG e do CPF da pessoa curatelada e do curador, bem como o termo de curatela;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA TERCEIRA$t$, 'corpo',
      $c$as inclusões e exclusões de Titulares e dependentes deverão ser comunicadas à RISARTE até o dia 10 (dez) de cada mês;
Parágrafo primeiro: para a inclusão, a CONTRATANTE fornecerá a relação escrita, com assinatura gerencial, contendo o nome e os dados exigidos pela norma em vigor da Agência Nacional de Saúde Suplementar dos Titulares e/ou dependentes, assumindo a responsabilidade pelas declarações prestadas, ficando assegurada à RISARTE a faculdade de solicitar a comprovação quando julgar necessário;
Parágrafo segundo: após a exclusão do Titular ou do dependente, não será liberado novo tratamento, sendo concluídos somente os tratamentos já autorizados;
Parágrafo terceiro: a CONTRATANTE poderá solicitar a suspensão do atendimento de um Titular afastado temporariamente da empresa, ficando também interrompida a cobrança relativa a ele; para tanto, deverá informar a RISARTE e comprovar documentalmente o afastamento, na forma da legislação previdenciária;
Parágrafo quarto: a suspensão mencionada acima atinge, também, os dependentes do Titular;
Parágrafo quinto: mensalmente, a RISARTE enviará à CONTRATANTE o relatório dos Titulares e dependentes vinculados a ela, junto com a cobrança da mensalidade; havendo divergência, cabe à CONTRATANTE solicitar a correção à RISARTE;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA QUARTA$t$, 'corpo',
      $c$o valor das mensalidades do Programa Risarte Empresarial, a partir da assinatura do presente instrumento, é de {{valor_titular}} por Titular, com o acréscimo de {{valor_dependente}} para cada dependente; optando pela adesão familiar, que poderá incluir até {{familia_tamanho}} dependentes, o acréscimo será de {{valor_familia}}; cada dependente acima de {{familia_tamanho}} terá o custo adicional de {{valor_dependente_extra}};
Parágrafo primeiro: é devido um primeiro pagamento, no valor total das adesões, no ato da assinatura do contrato, e as mensalidades seguintes vencem todo dia {{dia_vencimento}} de cada mês e quitam os serviços do mês seguinte;
Parágrafo segundo: o atraso de 15 (quinze) dias no pagamento da parcela dá à RISARTE o direito de suspender os serviços prestados ao beneficiário em atraso, imediatamente após a comunicação da inadimplência, até a efetiva regularização, bem como de tomar as providências necessárias para a cobrança do débito e, no vencimento da segunda parcela em aberto, o cancelamento automático do contrato;
Parágrafo terceiro: na hipótese de regularização do pagamento após a suspensão dos serviços por atraso nas mensalidades, a RISARTE terá o prazo de 10 (dez) dias para atualizar no sistema a situação do beneficiário;
Parágrafo quarto: o valor poderá ser descontado da folha de pagamento de cada Titular, tanto a mensalidade do próprio Titular quanto a de seus dependentes, de acordo com a política interna da CONTRATANTE, que repassará tais valores diretamente ao CONTRATADO;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA QUINTA$t$, 'corpo',
      $c${{fidelidade}};
Parágrafo primeiro: a exclusão de Titulares, por requerimento da CONTRATANTE ou pela perda do vínculo com ela, será feita mediante comunicação por escrito com 30 (trinta) dias de antecedência, sem multa e sem prazo mínimo de permanência do Titular;
Parágrafo segundo: a exclusão do Titular exclui, também, os seus dependentes;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA SEXTA$t$, 'corpo',
      $c$as mensalidades do Programa Risarte Empresarial serão reajustadas anualmente, na data de aniversário da assinatura do presente instrumento, pela variação acumulada do Índice Nacional de Preços ao Consumidor Amplo (IPCA/IBGE) nos 12 (doze) meses anteriores, acrescida de 3% (três por cento);
Parágrafo primeiro: se a variação acumulada do IPCA no período for negativa, ela será considerada igual a zero, aplicando-se somente o acréscimo de 3% (três por cento);
Parágrafo segundo: na extinção do IPCA, será adotado o índice oficial que vier a substituí-lo;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA SÉTIMA$t$, 'corpo',
      $c$a RISARTE poderá emitir documento individualizado para cada Titular e dependente cadastrados, servindo para a identificação no uso dos serviços;
Parágrafo primeiro: o documento é pessoal e intransferível a terceiros;
Parágrafo segundo: a utilização do documento por terceiros tornará o Titular responsável pelas despesas, que deverão ser custeadas como atendimento particular, sem nenhum benefício do Programa Risarte Empresarial;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA OITAVA$t$, 'corpo',
      $c$são assegurados aos beneficiários do Programa Risarte Empresarial, na abrangência indicada na cláusula primeira do presente instrumento, os procedimentos odontológicos relacionados no Anexo I, nas condições ali descritas;
Parágrafo único: os beneficiários com mais de 60 (sessenta) anos de idade, as gestantes, as lactantes e as crianças de até 8 (oito) anos têm prioridade na marcação de consultas, exames e quaisquer outros procedimentos;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA NONA$t$, 'corpo',
      $c$a CONTRATANTE e seus beneficiários passarão a usufruir os serviços prestados pela RISARTE após o cumprimento dos prazos de carência indicados no Anexo I;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA$t$, 'corpo',
      $c$os benefícios do Programa Risarte Empresarial, sejam procedimentos sem custo ou procedimentos com desconto, para o Titular e/ou para o Dependente, são exclusivamente os relacionados no Anexo I do presente instrumento, que reproduz a lista de benefícios da proposta comercial aceita pela CONTRATANTE;
Parágrafo primeiro: nos procedimentos com desconto, o beneficiário paga o valor da tabela da unidade com o desconto indicado no Anexo I, e a forma de pagamento é acordada no momento do fechamento do tratamento;
Parágrafo segundo: o desconto vale para as parcelas pagas em dia; a parcela paga com atraso perde o desconto do Programa naquela parcela, permanecendo o desconto nas demais;
Parágrafo terceiro: os procedimentos não relacionados no Anexo I não fazem parte do Programa e, se realizados na RISARTE, serão pagos integralmente pelo beneficiário, pelo valor da tabela da unidade;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA PRIMEIRA$t$, 'corpo',
      $c$as documentações e os exames complementares, tais como tomografias, radiografias panorâmicas, documentações ortodônticas e exames laboratoriais, são realizados fora da RISARTE, em clínicas de radiologia e laboratórios, e os seus custos são de responsabilidade do Titular ou do Dependente, ainda que a RISARTE mantenha condições especiais com parceiros para esses serviços;
Parágrafo primeiro: também não fazem parte do Programa Risarte Empresarial: cirurgias buco-maxilo-faciais que necessitem de ambiente hospitalar; tratamentos clínicos experimentais; tratamentos ilícitos ou antiéticos, assim definidos sob o aspecto odontológico ou não reconhecidos pelas autoridades competentes; atendimentos em casos de cataclismos, guerras e comoções internas, quando declarados pela autoridade competente; e consultas domiciliares;
Parágrafo segundo: a contratação de qualquer destes serviços entre o beneficiário e outro profissional ou prestador não obriga a RISARTE ao seu pagamento, devendo os custos e a forma de pagamento ser acertados diretamente entre eles;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA SEGUNDA$t$, 'corpo',
      $c$o presente instrumento vigorará pelo prazo de 12 (doze) meses, com renovação automática por iguais períodos;
Parágrafo primeiro: a rescisão por iniciativa da CONTRATANTE observará o disposto na cláusula quinta do presente instrumento;
Parágrafo segundo: constituem causas de rescisão as hipóteses de omissão, inexatidão ou erro que tenham influído na aceitação deste contrato, bem como a fraude ou o dolo de qualquer das partes, independentemente de sua consumação ou da obtenção de vantagem ilícita por terceiros;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA TERCEIRA$t$, 'corpo',
      $c$no caso de atraso no repasse das mensalidades superior a 30 (trinta) dias, dar-se-á, de pleno direito, a rescisão do contrato, ou seja, cláusula resolutiva expressa, sem prejuízo da cobrança judicial do débito;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA QUARTA$t$, 'corpo',
      $c$o presente instrumento é reconhecido como título executivo extrajudicial, visto a sua certeza de exigibilidade e liquidez, conforme o art. 784, III do Código de Processo Civil;$c$),
    jsonb_build_object('titulo', $t$CLÁUSULA DÉCIMA QUINTA$t$, 'corpo',
      $c$para dirimir quaisquer dúvidas oriundas do presente contrato, é eleito o foro da comarca de Cambé/PR, com renúncia de qualquer outro;$c$)
         )
   where lead_id is null
     and preamble = $antigo_pre$De um lado, perfazendo como CONTRATANTE, **{{contratante_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ/CAEPF sob o n°. **{{contratante_documento}}**, com sede na **{{contratante_endereco}}** neste ato representado por seu {{contratante_cargo}}, **{{contratante_representante}}**, {{contratante_nacionalidade}}, portador do RG n°. {{contratante_rg}}, inscrito no CPF sob o nº. **{{contratante_cpf}}** e, de outro lado, perfazendo como CONTRATADO, **{{contratada_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ sob o n°. {{contratada_cnpj}}, com sede na {{contratada_endereco}}, neste ato representado por seu {{contratada_cargo}}, **{{contratada_representante}}**, {{contratada_nacionalidade}}, portador do RG n°. {{contratada_rg}}, inscrito no CPF sob o n°. {{contratada_cpf}}, firmam o presente Instrumento Particular, a reger-se pelas seguintes cláusulas e condições:$antigo_pre$
     -- A quebra de linha não conta: salvo pela tela, o texto da produção ganhou
     -- quebras do Windows onde a semente tinha as comuns. O resto tem de ser
     -- idêntico. (No texto do jsonb, a quebra do Windows aparece como "\r".)
     and replace(sections::text, '\r', '')
         = replace($antigo_sec$[{"corpo":"o presente contrato tem como objetivo a prestação continuada de tratamentos no âmbito odontológico pelo CONTRATADO, **PROGRAMA RISARTE EMPRESARIAL (PRE)**, com abrangência {{abrangencia}}, nas clínicas que a RISARTE possui, compreendendo a cobertura total dos atos odontológicos previstos na cláusula oitava do presente instrumento e a cobertura em modalidade de co-participação (20% (vinte por cento) à 50% (cinquenta por cento)) dos atos odontológicos previstos na cláusula décima do presente instrumento, cujo pagamento será acordado no momento do fechamento do tratamento;\nParágrafo primeiro: o regime de contratação do convênio é coletivo por adesão, tornando-se beneficiários os empregados ou funcionários da CONTRATANTE, bem como os seus dependentes que aderirem o plano;\nParágrafo segundo: o colaborador terá direito, sem custos extras, à cada 6 (seis) meses, 1 (uma) profilaxia, 1 (uma) escova dental, radiografias interproximais e periapicais, isenção das consultas e aparelho ortodôntico convencional;\nParágrafo terceiro: não será aplicado o desconto mencionado no caput deste artigo para os custos de laboratório de próteses, aparelho ortopédicos e ortodônticos (exceto para aparelhos ortodônticos tradicionais), invisalign e/ou produtos/medicações para harmonização orofacial;\nParágrafo quarto: para os custos de laboratório de próteses e/ou produtos de harmonização orofacial, poderá ser dividido em 6 (seis) pagamentos, através de boleto bancário;","titulo":"CLÁUSULA PRIMEIRA"},{"corpo":"as empresas associadas disponibilizarão a adesão ao plano aos seus sócios, empregados e dependentes;\nParágrafo primeiro: poderão ser inscritos como dependentes do usuário titular, todos aqueles que fizer parte do grupo familiar (ex.: genitores, cônjuge, filhos e netos) ou que tenham, devidamente comprovado, a dependência econômica do funcionário da CONTRATANTE;\nParágrafo segundo: para inclusão de usuários, titulares ou dependentes, deverão ser apresentados para a RISARTE, no ato da adesão, os seguintes documentos: cópia do RG e do CPF (poderá ser substituído pela CNH), e comprovante de residência; para dependentes menores de idade, cópia da certidão de nascimento e dos documento dos genitores, ou do genitor que possuir a tutela e; para pessoas com deficiência que possuem curatela, cópia do RG e do CPF da pessoa de ambos, bem como o termo de curatela;","titulo":"CLÁUSULA SEGUNDA"},{"corpo":"as inclusões e exclusões de cada usuário deverão ser comunicadas à RISARTE até o dia 10 (dez) de cada mês;\nParágrafo primeiro: para a inclusão de usuários, a CONTRATANTE fornecerá a relação escrita, com assinatura gerencial, com o nome e os dados exigidos pela norma em vigor da Agência Nacional de Saúde Suplementar, dos usuários, titulares e/ou dependentes, assumindo a responsabilidade pelas declarações prestadas, ficando assegurada à RISARTE a faculdade de solicitar a comprovação quanto julgar necessário;\nParágrafo segundo: após a exclusão do usuário, não será mais liberado qualquer tratamento, sendo concluídos somente os tratamentos já autorizados;\nParágrafo terceiro: a parte CONTRATANTE poderá solicitar a suspensão do atendimento de algum usuário, quando por motivo de afastamento temporário da empresa, ficando, também, interrompido a ele a cobrança relativa; para que seja possível, a CONTRATANTE deverá informar à RISARTE e deverá comprovar documentalmente o fato, na forma da legislação previdenciária;\nParágrafo quarto: a suspensão mencionada acima atinge, também, seus dependentes;","titulo":"CLÁUSULA TERCEIRA"},{"corpo":"o valor das mensalidades do presente convênio, iniciando a partir da assinatura do presente instrumento, é de {{valor_titular}} por cada colaborador, com o acréscimo de {{valor_dependente}} para cada dependente, caso optar pela adesão familiar, que poderá incluir até {{familia_tamanho}} pessoas dependentes, terá um acréscimo de {{valor_familia}}, caso queira fazer adesão de dependentes extras (acima de {{familia_tamanho}} dependentes), terá um custo de {{valor_dependente_extra}};\nParágrafo primeiro: é solicitado um primeiro pagamento com o valor total das adesões no ato da assinatura do contrato e as próximas mensalidades vencem todo dia {{dia_vencimento}} de cada mês e quitam os serviços do mês seguinte;\nParágrafo segundo: o atraso de 15 (quinze) dias no pagamento da parcela, dá direito a RISARTE de suspender os serviços prestados ao usuário aderente em atraso, imediatamente após a comunicação da inadimplência, até a efetiva regularização, bem como, de tomar as providências que forem necessárias para a cobrança do débito e, em caso do vencimento da segunda parcela, o cancelamento automático do contrato;\nParágrafo terceiro: na hipótese de regularização de pagamento após a suspensão dos serviços por atraso no pagamento das mensalidades, a RISARTE terá o prazo de 10 (dez) dias para atualizar no sistema a regularização da situação do usuário;\nParágrafo quarto: o valor poderá ser descontado da folha de pagamento de cada colaborador, tanto o valor mensal referente a adesão do próprio colaborador quanto a adesão de seus dependentes, de acordo a política interna da própria empresa CONTRATANTE, cujo a CONTRATANTE repassará tais valores diretamente à CONTRATADA;","titulo":"CLÁUSULA QUARTA"},{"corpo":"a permanência de cada usuário de cada empresa associada no convênio será de, no mínimo, 12 (doze) meses, salvo em caso de desligamento do colaborador na empresa;\nParágrafo primeiro: caso a empresa associada possua usuários que sejam excluídos do convênio antes de completar o mínimo estipulado no caput, a CONTRATANTE poderá realizar a substituição do BENEFICIÁRIO por outro usuário que demonstre interesse na contratação, caso contrário ficará o funcionário excluído;\nParágrafo segundo: o usuário será excluído do convênio, por comunicação escrita, com 30 (trinta) dias de antecedência, por requerimento da CONTRATANTE ou perder o vínculo empregatício;\nParágrafo terceiro: a exclusão do usuário titular, exclui seus dependentes;\nParágrafo quarto: em caso de cancelamento após o prazo de carência, não possuirá multa;","titulo":"CLÁUSULA QUINTA"},{"corpo":"as mensalidades do convênio serão corrigidas anualmente pela variação positiva da inflação, como base inicial a assinatura do presente instrumento;","titulo":"CLÁUSULA SEXTA"},{"corpo":"a RISARTE poderá emitir documento individualizado para cada usuário e respectivos beneficiários cadastrados, servindo para a identificação para o uso dos serviços;\nParágrafo primeiro: o documento é um documento pessoal de identificação dos beneficiários, cujo é intransferível a terceiros;\nParágrafo segundo: a utilização do documento por terceiros, tornará o usuário cadastrado responsável pelas despesas individualizada, cujo deverá custear pelo atendimento particular, sem nenhum benefício do plano;","titulo":"CLÁUSULA SÉTIMA"},{"corpo":"são assegurados aos beneficiários deste convênio, de abrangência nas cidades elencadas na cláusula primeira do presente instrumento, os procedimentos odontológicos, cujo rol encontra-se anexo à Resolução do Conselho Nacional de Saúde Suplementar nº. 10 (dez), de 03/11/1998, reproduzida no anexo I do presente instrumento;\nParágrafo único: os usuários com mais de 60 (sessenta) anos de idade, as gestantes, lactantes e crianças de até 8 (oito) anos, possuem privilégios na marcação de consultas, exame e qualquer outros procedimentos;","titulo":"CLÁUSULA OITAVA"},{"corpo":"a CONTRATANTE e seus beneficiários passarão a ter direito de usufruir os serviços prestados pela RISARTE após cumprir o prazo de carência, indicados no anexo I;","titulo":"CLÁUSULA NONA"},{"corpo":"o usuário, quando for utilizar os serviços não cobertos integralmente pelo presente convênio, possuirá a co-participação de 50% (cinquenta por cento) no pagamento dos procedimentos descritos no anexo I, cujo pagamento será acordado no momento do fechamento do tratamento;","titulo":"CLÁUSULA DÉCIMA"},{"corpo":"alguns serviços não estão incluídos no plano desta parceria, quais sejam: cirurgias buco-maxilo-facial, que necessitem de ambiente hospitalar; tratamento clínico experimental; procedimentos clínicos para fins estéticos; aparelho ortodônticos, implantes e próteses; tratamentos ilícitos ou antiéticos, assim definidos sob aspecto odontológico ou não reconhecido pelas autoridades competentes; casos de cataclismos, guerras e comoções internas, quando declarados pela autoridade competente; consultas domiciliares; radiografias – não constante no rol de procedimentos cobertos descritos no anexo I e; cirurgia periodontal;\nParágrafo único: a contratação de qualquer destes serviços não cobertos entre o usuário e outro profissional competente, não obriga a RISARTE a cobrir o seu pagamento, sendo que os acertos relativos a custos e forma de pagamento, devem ser feitos diretamente entre o profissional escolhido e o usuário;","titulo":"CLÁUSULA DÉCIMA PRIMEIRA"},{"corpo":"o presente instrumento vigorará pelo prazo de 12 (doze) meses, com renovação automática;\nParágrafo primeiro: o usuário que desistir do convênio antes de completar o prazo descrito na cláusula quinta do presente instrumento, deverá pagar o valor equivalente às mensalidades que faltaria para completar aquele mínimo;\nParágrafo segundo: na hipótese de rescisão por parte da CONTRATANTE, a mesma estará isenta e não terá que pagar o valor equivalente às mensalidades que faltar para completar o mínimo de prazo disposto na cláusula quinta do presente instrumento;\nParágrafo terceiro: constituem causas para rescisão, as hipóteses de omissão, inexatidão ou erro que tenham influído na aceitação deste contrato, bem como a fraude ou o dolo por qualquer das partes, independentemente de sua consumação ou obtenção de vantagem ilícita a terceiros;","titulo":"CLÁUSULA DÉCIMA SEGUNDA"},{"corpo":"no caso de atraso no repasse das mensalidades superior a 30 (trinta) dias, dar-se-á, de pleno direito, a rescisão do contrato, ou seja, cláusula resolutiva expressa, sem prejuízo da cobrança judicial do débito;","titulo":"CLÁUSULA DÉCIMA TERCEIRA"},{"corpo":"o presente instrumento é reconhecido como título executivo extrajudicial, visto a sua certeza de exigibilidade e liquidez, conforme o art. 784, III do Código de Processo Civil;","titulo":"CLÁUSULA DÉCIMA QUARTA"},{"corpo":"para dirimir quaisquer dúvidas oriundas do presente contrato, é eleito o foro da comarca de Cambé/PR, com renúncia de qualquer outro;","titulo":"CLÁUSULA DÉCIMA QUINTA"}]$antigo_sec$::jsonb::text, '\r', '');
  get diagnostics trocados = row_count;
  if trocados = 0 then
    raise notice '1037: o modelo de contrato da rede NÃO foi trocado — ele já tinha sido editado (ou já é o novo). Confira em Configurações → Contrato.';
  else
    raise notice '1037: modelo de contrato da rede atualizado.';
  end if;
end
$migracao$;

-- Conferência: o que está valendo agora.
select (preamble like '%{{contratante_portador}}%') as modelo_novo,
       jsonb_array_length(sections) as clausulas
  from empresarial.contract_templates
 where lead_id is null;
