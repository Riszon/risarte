-- =============================================================================
-- 1027 — O CONTRATO GERADO DENTRO DO SISTEMA (relato OC-00083, 13/10/2026)
--
-- O dono, no relato: "Toda a apresentação, proposta, contratos devem ser
-- elaborados dentro do próprio sistema." A apresentação e a proposta já eram;
-- o contrato era um Word preenchido à mão a cada empresa — razão social, CNPJ,
-- valores e data redigitados. Redigitar é como o contrato passa a dizer
-- R$ 39,90 quando a proposta fechou outro valor.
--
-- O TEXTO é do dono (modelo "Contrato PRE+ 2026", enviado em 13/10/2026).
-- Quatro decisões dele, do mesmo dia, estão nesta migração:
--
--   1) além dos dados da empresa, saem da PROPOSTA: os valores da cláusula
--      quarta, o dia de vencimento e as cidades de abrangência;
--   2) o Anexo I (rol de procedimentos e carências) é montado com os
--      benefícios da proposta — não há texto de anexo aqui;
--   3) os erros de digitação e as referências entre cláusulas foram
--      corrigidos (ver "O QUE FOI CORRIGIDO NO TEXTO", abaixo);
--   4) o nome, o RG e o CPF do representante da Risarte NÃO entram neste
--      arquivo: ele os digita uma vez em Configurações → Contrato.
--
-- ⚠️ NENHUM DADO DE CLIENTE ENTRA AQUI. O modelo veio preenchido com uma
-- empresa de verdade; só o texto foi aproveitado. Há teste que lê este
-- arquivo e reprova CPF, CNPJ de terceiro ou nome próprio no texto semeado.
--
-- O QUE FOI CORRIGIDO NO TEXTO (o dono confere antes de usar):
--   - "PROGRAMA RISARTE EMPRESARIA (PRE)"  → "EMPRESARIAL";
--   - título "CLÁUSULA DÉCIMA SE PRIMEIRA GUNDA" → "CLÁUSULA DÉCIMA PRIMEIRA";
--   - cláusula primeira: "previstos na cláusula nona" → "cláusula oitava" (é
--     a oitava que traz o rol de procedimentos; a nona fala de carência);
--   - cláusula primeira: "previstos na cláusula décima primeira" → "cláusula
--     décima" (é a décima que trata da coparticipação; a décima primeira
--     lista o que NÃO é coberto).
--   Nada mais foi alterado. Divergências de CONTEÚDO que continuam no texto e
--   são assunto do jurídico: a cláusula primeira fala em coparticipação de
--   20% a 50%, a décima fala só em 50%, e o Anexo I passa a mostrar o
--   percentual de cada procedimento da proposta.
--
-- Tudo idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O que o contrato pede da empresa e a proposta não guardava
-- -----------------------------------------------------------------------------
--
-- O endereço da sede já tinha coluna (`address`, desde a 1009) e nenhuma tela.
-- RG e nacionalidade de quem assina são OPCIONAIS — no modelo do dono eles
-- saem em branco, para preencher à mão.
--
-- `due_day` ANULÁVEL de propósito (lição da 0230): nulo = "não foi combinado
-- outro dia", e aí vale o dia 5 do programa. Mesmo intervalo do cadastro da
-- empresa (1 a 28: dia que existe em todo mês).
alter table empresarial.lead_qualification
  add column if not exists responsible_rg varchar(20),
  add column if not exists responsible_nationality varchar(60),
  add column if not exists due_day int;

comment on column empresarial.lead_qualification.responsible_rg is
  'RG de quem assina o contrato pela empresa. Opcional: em branco, o contrato '
  'imprime a linha para preencher à mão.';
comment on column empresarial.lead_qualification.responsible_nationality is
  'Nacionalidade de quem assina pela empresa (ex.: "brasileiro"). Opcional.';
comment on column empresarial.lead_qualification.due_day is
  'Dia de vencimento combinado na proposta (1 a 28). NULO = o padrão do '
  'programa, dia 5. Vai para o contrato e para companies.due_day no fechamento.';

do $$
begin
  alter table empresarial.lead_qualification
    add constraint lead_qualification_dia_de_vencimento
    check (due_day is null or due_day between 1 and 28);
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) A parte da RISARTE no contrato — uma linha só, da rede
-- -----------------------------------------------------------------------------
--
-- ⚠️ SÓ A RAZÃO SOCIAL, O CNPJ E O ENDEREÇO SÃO SEMEADOS: são dados públicos
-- de cadastro de empresa, e vieram do próprio modelo. O NOME, o RG e o CPF do
-- representante são dado pessoal — entram pela tela, e ficam só no banco.
create table if not exists empresarial.contract_settings (
  -- Linha única: a chave é sempre `true`.
  id boolean primary key default true check (id),
  legal_name varchar(255),
  cnpj varchar(18),
  address text,
  rep_name varchar(255),
  rep_role varchar(120),
  rep_nationality varchar(60),
  rep_rg varchar(20),
  rep_cpf varchar(14),
  -- A cidade que abre a linha da data ("Cambé/PR, 25 de agosto de 2026").
  signing_city varchar(120),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table empresarial.contract_settings is
  '1027: a qualificação da CONTRATADA (Risarte) no contrato do programa. Uma '
  'linha. O representante (nome, RG, CPF) é digitado em Configurações → '
  'Contrato; nunca é semeado por migração.';

drop trigger if exists contract_settings_set_updated_at
  on empresarial.contract_settings;
create trigger contract_settings_set_updated_at
  before update on empresarial.contract_settings
  for each row execute function public.set_updated_at();

insert into empresarial.contract_settings
  (id, legal_name, cnpj, address, rep_role, signing_city)
values (
  true,
  'RISARTE ADMINISTRAÇÃO E GERENCIAMENTO COMERCIAL LTDA',
  '46.232.307/0001-19',
  'Rua França, n°. 169-B – Centro, CEP n°. 86.181-040 em Cambé/PR',
  'sócio administrador',
  'Cambé/PR'
)
on conflict (id) do nothing;

alter table empresarial.contract_settings enable row level security;

-- Quem LÊ: quem monta contrato — o gestor do programa e o consultor que tem
-- ao menos uma empresa no funil. O contrato imprime estes dados; quem não
-- gera contrato não tem por que vê-los.
drop policy if exists contract_settings_select on empresarial.contract_settings;
create policy contract_settings_select
  on empresarial.contract_settings
  for select to authenticated
  using (
    empresarial.is_program_manager()
    or exists (
      select 1
      from empresarial.commercial_leads l
      where l.consultant_id = (select auth.uid())
    )
  );

-- Quem ESCREVE: só o gestor do programa. Mudar aqui muda todo contrato.
drop policy if exists contract_settings_write on empresarial.contract_settings;
create policy contract_settings_write
  on empresarial.contract_settings
  for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update on empresarial.contract_settings to authenticated;
grant all on empresarial.contract_settings to service_role;

-- -----------------------------------------------------------------------------
-- 3) O texto do contrato — modelo da rede, ajustável por empresa
-- -----------------------------------------------------------------------------
--
-- Mesma cascata da apresentação (1010) e da proposta (1014): a linha com
-- `lead_id` nulo é o modelo da REDE; a linha de uma empresa existe só quando
-- alguém personalizou o texto dela.
--
-- Os campos entre chaves duplas — {{contratante_razao_social}}, {{valor_titular}}
-- — são preenchidos pelo sistema. A lista do que existe está em
-- `src/lib/empresarial/contrato.ts`, e há teste que confere cada campo usado
-- aqui contra ela. **negrito** é a única marcação.
create table if not exists empresarial.contract_templates (
  id uuid primary key default gen_random_uuid(),
  -- NULL = modelo da REDE.
  lead_id uuid references empresarial.commercial_leads (id) on delete cascade,
  title text not null,
  -- A qualificação das partes ("De um lado…").
  preamble text not null,
  -- [{ "titulo": "CLÁUSULA PRIMEIRA", "corpo": "…\nParágrafo primeiro: …" }]
  sections jsonb not null default '[]'::jsonb,
  -- O fecho, antes da data e das assinaturas.
  closing text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (lead_id)
);

comment on table empresarial.contract_templates is
  '1027: o TEXTO do contrato do Programa Risarte Empresarial. lead_id nulo = '
  'modelo da rede; preenchido = texto personalizado daquela empresa.';

drop trigger if exists contract_templates_set_updated_at
  on empresarial.contract_templates;
create trigger contract_templates_set_updated_at
  before update on empresarial.contract_templates
  for each row execute function public.set_updated_at();

-- O modelo da rede. `on conflict do nothing`: rodar de novo não sobrescreve o
-- que o gestor já tiver ajustado na tela.
insert into empresarial.contract_templates (lead_id, title, preamble, sections, closing)
values (
  null,
  $titulo$INSTRUMENTO PARTICULAR DE PARCERIA PARA PRESTAÇÃO DE SERVIÇOS DE ASSISTÊNCIA ODONTOLÓGICA EMPRESARIAL – COLETIVO POR ADESÃO$titulo$,
  $preambulo$De um lado, perfazendo como CONTRATANTE, **{{contratante_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ/CAEPF sob o n°. **{{contratante_documento}}**, com sede na **{{contratante_endereco}}** neste ato representado por seu {{contratante_cargo}}, **{{contratante_representante}}**, {{contratante_nacionalidade}}, portador do RG n°. {{contratante_rg}}, inscrito no CPF sob o nº. **{{contratante_cpf}}** e, de outro lado, perfazendo como CONTRATADO, **{{contratada_razao_social}}**, pessoa jurídica de direito privado inscrita no CNPJ sob o n°. {{contratada_cnpj}}, com sede na {{contratada_endereco}}, neste ato representado por seu {{contratada_cargo}}, **{{contratada_representante}}**, {{contratada_nacionalidade}}, portador do RG n°. {{contratada_rg}}, inscrito no CPF sob o n°. {{contratada_cpf}}, firmam o presente Instrumento Particular, a reger-se pelas seguintes cláusulas e condições:$preambulo$,
  jsonb_build_array(
    jsonb_build_object('titulo', 'CLÁUSULA PRIMEIRA', 'corpo',
$c01$o presente contrato tem como objetivo a prestação continuada de tratamentos no âmbito odontológico pelo CONTRATADO, **PROGRAMA RISARTE EMPRESARIAL (PRE)**, com abrangência {{abrangencia}}, nas clínicas que a RISARTE possui, compreendendo a cobertura total dos atos odontológicos previstos na cláusula oitava do presente instrumento e a cobertura em modalidade de co-participação (20% (vinte por cento) à 50% (cinquenta por cento)) dos atos odontológicos previstos na cláusula décima do presente instrumento, cujo pagamento será acordado no momento do fechamento do tratamento;
Parágrafo primeiro: o regime de contratação do convênio é coletivo por adesão, tornando-se beneficiários os empregados ou funcionários da CONTRATANTE, bem como os seus dependentes que aderirem o plano;
Parágrafo segundo: o colaborador terá direito, sem custos extras, à cada 6 (seis) meses, 1 (uma) profilaxia, 1 (uma) escova dental, radiografias interproximais e periapicais, isenção das consultas e aparelho ortodôntico convencional;
Parágrafo terceiro: não será aplicado o desconto mencionado no caput deste artigo para os custos de laboratório de próteses, aparelho ortopédicos e ortodônticos (exceto para aparelhos ortodônticos tradicionais), invisalign e/ou produtos/medicações para harmonização orofacial;
Parágrafo quarto: para os custos de laboratório de próteses e/ou produtos de harmonização orofacial, poderá ser dividido em 6 (seis) pagamentos, através de boleto bancário;$c01$),
    jsonb_build_object('titulo', 'CLÁUSULA SEGUNDA', 'corpo',
$c02$as empresas associadas disponibilizarão a adesão ao plano aos seus sócios, empregados e dependentes;
Parágrafo primeiro: poderão ser inscritos como dependentes do usuário titular, todos aqueles que fizer parte do grupo familiar (ex.: genitores, cônjuge, filhos e netos) ou que tenham, devidamente comprovado, a dependência econômica do funcionário da CONTRATANTE;
Parágrafo segundo: para inclusão de usuários, titulares ou dependentes, deverão ser apresentados para a RISARTE, no ato da adesão, os seguintes documentos: cópia do RG e do CPF (poderá ser substituído pela CNH), e comprovante de residência; para dependentes menores de idade, cópia da certidão de nascimento e dos documento dos genitores, ou do genitor que possuir a tutela e; para pessoas com deficiência que possuem curatela, cópia do RG e do CPF da pessoa de ambos, bem como o termo de curatela;$c02$),
    jsonb_build_object('titulo', 'CLÁUSULA TERCEIRA', 'corpo',
$c03$as inclusões e exclusões de cada usuário deverão ser comunicadas à RISARTE até o dia 10 (dez) de cada mês;
Parágrafo primeiro: para a inclusão de usuários, a CONTRATANTE fornecerá a relação escrita, com assinatura gerencial, com o nome e os dados exigidos pela norma em vigor da Agência Nacional de Saúde Suplementar, dos usuários, titulares e/ou dependentes, assumindo a responsabilidade pelas declarações prestadas, ficando assegurada à RISARTE a faculdade de solicitar a comprovação quanto julgar necessário;
Parágrafo segundo: após a exclusão do usuário, não será mais liberado qualquer tratamento, sendo concluídos somente os tratamentos já autorizados;
Parágrafo terceiro: a parte CONTRATANTE poderá solicitar a suspensão do atendimento de algum usuário, quando por motivo de afastamento temporário da empresa, ficando, também, interrompido a ele a cobrança relativa; para que seja possível, a CONTRATANTE deverá informar à RISARTE e deverá comprovar documentalmente o fato, na forma da legislação previdenciária;
Parágrafo quarto: a suspensão mencionada acima atinge, também, seus dependentes;$c03$),
    jsonb_build_object('titulo', 'CLÁUSULA QUARTA', 'corpo',
$c04$o valor das mensalidades do presente convênio, iniciando a partir da assinatura do presente instrumento, é de {{valor_titular}} por cada colaborador, com o acréscimo de {{valor_dependente}} para cada dependente, caso optar pela adesão familiar, que poderá incluir até {{familia_tamanho}} pessoas dependentes, terá um acréscimo de {{valor_familia}}, caso queira fazer adesão de dependentes extras (acima de {{familia_tamanho}} dependentes), terá um custo de {{valor_dependente_extra}};
Parágrafo primeiro: é solicitado um primeiro pagamento com o valor total das adesões no ato da assinatura do contrato e as próximas mensalidades vencem todo dia {{dia_vencimento}} de cada mês e quitam os serviços do mês seguinte;
Parágrafo segundo: o atraso de 15 (quinze) dias no pagamento da parcela, dá direito a RISARTE de suspender os serviços prestados ao usuário aderente em atraso, imediatamente após a comunicação da inadimplência, até a efetiva regularização, bem como, de tomar as providências que forem necessárias para a cobrança do débito e, em caso do vencimento da segunda parcela, o cancelamento automático do contrato;
Parágrafo terceiro: na hipótese de regularização de pagamento após a suspensão dos serviços por atraso no pagamento das mensalidades, a RISARTE terá o prazo de 10 (dez) dias para atualizar no sistema a regularização da situação do usuário;
Parágrafo quarto: o valor poderá ser descontado da folha de pagamento de cada colaborador, tanto o valor mensal referente a adesão do próprio colaborador quanto a adesão de seus dependentes, de acordo a política interna da própria empresa CONTRATANTE, cujo a CONTRATANTE repassará tais valores diretamente à CONTRATADA;$c04$),
    jsonb_build_object('titulo', 'CLÁUSULA QUINTA', 'corpo',
$c05$a permanência de cada usuário de cada empresa associada no convênio será de, no mínimo, 12 (doze) meses, salvo em caso de desligamento do colaborador na empresa;
Parágrafo primeiro: caso a empresa associada possua usuários que sejam excluídos do convênio antes de completar o mínimo estipulado no caput, a CONTRATANTE poderá realizar a substituição do BENEFICIÁRIO por outro usuário que demonstre interesse na contratação, caso contrário ficará o funcionário excluído;
Parágrafo segundo: o usuário será excluído do convênio, por comunicação escrita, com 30 (trinta) dias de antecedência, por requerimento da CONTRATANTE ou perder o vínculo empregatício;
Parágrafo terceiro: a exclusão do usuário titular, exclui seus dependentes;
Parágrafo quarto: em caso de cancelamento após o prazo de carência, não possuirá multa;$c05$),
    jsonb_build_object('titulo', 'CLÁUSULA SEXTA', 'corpo',
$c06$as mensalidades do convênio serão corrigidas anualmente pela variação positiva da inflação, como base inicial a assinatura do presente instrumento;$c06$),
    jsonb_build_object('titulo', 'CLÁUSULA SÉTIMA', 'corpo',
$c07$a RISARTE poderá emitir documento individualizado para cada usuário e respectivos beneficiários cadastrados, servindo para a identificação para o uso dos serviços;
Parágrafo primeiro: o documento é um documento pessoal de identificação dos beneficiários, cujo é intransferível a terceiros;
Parágrafo segundo: a utilização do documento por terceiros, tornará o usuário cadastrado responsável pelas despesas individualizada, cujo deverá custear pelo atendimento particular, sem nenhum benefício do plano;$c07$),
    jsonb_build_object('titulo', 'CLÁUSULA OITAVA', 'corpo',
$c08$são assegurados aos beneficiários deste convênio, de abrangência nas cidades elencadas na cláusula primeira do presente instrumento, os procedimentos odontológicos, cujo rol encontra-se anexo à Resolução do Conselho Nacional de Saúde Suplementar nº. 10 (dez), de 03/11/1998, reproduzida no anexo I do presente instrumento;
Parágrafo único: os usuários com mais de 60 (sessenta) anos de idade, as gestantes, lactantes e crianças de até 8 (oito) anos, possuem privilégios na marcação de consultas, exame e qualquer outros procedimentos;$c08$),
    jsonb_build_object('titulo', 'CLÁUSULA NONA', 'corpo',
$c09$a CONTRATANTE e seus beneficiários passarão a ter direito de usufruir os serviços prestados pela RISARTE após cumprir o prazo de carência, indicados no anexo I;$c09$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA', 'corpo',
$c10$o usuário, quando for utilizar os serviços não cobertos integralmente pelo presente convênio, possuirá a co-participação de 50% (cinquenta por cento) no pagamento dos procedimentos descritos no anexo I, cujo pagamento será acordado no momento do fechamento do tratamento;$c10$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA PRIMEIRA', 'corpo',
$c11$alguns serviços não estão incluídos no plano desta parceria, quais sejam: cirurgias buco-maxilo-facial, que necessitem de ambiente hospitalar; tratamento clínico experimental; procedimentos clínicos para fins estéticos; aparelho ortodônticos, implantes e próteses; tratamentos ilícitos ou antiéticos, assim definidos sob aspecto odontológico ou não reconhecido pelas autoridades competentes; casos de cataclismos, guerras e comoções internas, quando declarados pela autoridade competente; consultas domiciliares; radiografias – não constante no rol de procedimentos cobertos descritos no anexo I e; cirurgia periodontal;
Parágrafo único: a contratação de qualquer destes serviços não cobertos entre o usuário e outro profissional competente, não obriga a RISARTE a cobrir o seu pagamento, sendo que os acertos relativos a custos e forma de pagamento, devem ser feitos diretamente entre o profissional escolhido e o usuário;$c11$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA SEGUNDA', 'corpo',
$c12$o presente instrumento vigorará pelo prazo de 12 (doze) meses, com renovação automática;
Parágrafo primeiro: o usuário que desistir do convênio antes de completar o prazo descrito na cláusula quinta do presente instrumento, deverá pagar o valor equivalente às mensalidades que faltaria para completar aquele mínimo;
Parágrafo segundo: na hipótese de rescisão por parte da CONTRATANTE, a mesma estará isenta e não terá que pagar o valor equivalente às mensalidades que faltar para completar o mínimo de prazo disposto na cláusula quinta do presente instrumento;
Parágrafo terceiro: constituem causas para rescisão, as hipóteses de omissão, inexatidão ou erro que tenham influído na aceitação deste contrato, bem como a fraude ou o dolo por qualquer das partes, independentemente de sua consumação ou obtenção de vantagem ilícita a terceiros;$c12$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA TERCEIRA', 'corpo',
$c13$no caso de atraso no repasse das mensalidades superior a 30 (trinta) dias, dar-se-á, de pleno direito, a rescisão do contrato, ou seja, cláusula resolutiva expressa, sem prejuízo da cobrança judicial do débito;$c13$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA QUARTA', 'corpo',
$c14$o presente instrumento é reconhecido como título executivo extrajudicial, visto a sua certeza de exigibilidade e liquidez, conforme o art. 784, III do Código de Processo Civil;$c14$),
    jsonb_build_object('titulo', 'CLÁUSULA DÉCIMA QUINTA', 'corpo',
$c15$para dirimir quaisquer dúvidas oriundas do presente contrato, é eleito o foro da comarca de Cambé/PR, com renúncia de qualquer outro;$c15$)
  ),
  $fecho$Assim, justas e contratadas, as partes assinam o presente instrumento de forma eletrônica, juntamente com a presença de 2 (duas) testemunhas.$fecho$
)
on conflict (lead_id) do nothing;

alter table empresarial.contract_templates enable row level security;

-- O modelo da REDE é visível para quem enxerga o programa; o personalizado
-- segue o acesso ao lead. Mesma regra da proposta (1014).
drop policy if exists contract_templates_select on empresarial.contract_templates;
create policy contract_templates_select
  on empresarial.contract_templates
  for select to authenticated
  using (
    lead_id is null
    or empresarial.can_access_lead(lead_id)
  );

drop policy if exists contract_templates_write on empresarial.contract_templates;
create policy contract_templates_write
  on empresarial.contract_templates
  for all to authenticated
  using (
    case
      -- Mexer no MODELO DA REDE muda o contrato de todo mundo: é ato de
      -- gestor do programa, não de qualquer consultor.
      when lead_id is null then empresarial.is_program_manager()
      else empresarial.can_access_lead(lead_id)
    end
  )
  with check (
    case
      when lead_id is null then empresarial.is_program_manager()
      else empresarial.can_access_lead(lead_id)
    end
  );

grant select, insert, update, delete
  on empresarial.contract_templates to authenticated;
grant all on empresarial.contract_templates to service_role;

-- -----------------------------------------------------------------------------
-- 4) As duas tabelas novas entram na auditoria (regra 7 do CLAUDE.md §0)
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';
