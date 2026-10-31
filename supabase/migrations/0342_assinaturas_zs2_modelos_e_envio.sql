-- =============================================================================
-- 0342 — ASSINATURA DIGITAL (ZapSign) — FASE ZS2: modelos, kits e o envio
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §5.3, §7 e §11, fase ZS2). A 0340
-- criou as tabelas sem nenhuma policy de escrita: aqui entram as PORTAS pelas
-- quais a tela grava, cada uma guardada por `signature_can`:
--
--   * `signature_create_package`  — cria o pacote em rascunho com os
--                                   documentos e os signatários (quem envia);
--   * `signature_save_template`   — edita o texto e as regras de um modelo
--                                   (quem configura; Admin Master sempre);
--
-- O resto do envio (gerar o PDF, criar o documento na ZapSign, gravar tokens
-- e links, marcar `sent`) acontece no servidor, pela chave de serviço, depois
-- de a porta ter aceitado o rascunho — a guarda já passou nela.
--
-- E os 5 MODELOS INICIAIS, com TEXTO PROVISÓRIO (`is_provisional_text`): o PDF
-- sai com a marca d'água "TEXTO PROVISÓRIO" até o dono trocar o texto pelo
-- do jurídico em Assinaturas → Configurações → Modelos. Os campos `{{…}}`
-- usados aqui estão todos em `CAMPOS_DO_PACIENTE` (`src/lib/signatures/
-- variables.ts`); o teste `assinaturas-modelos.test.ts` lê este arquivo e
-- confere um a um.
--
-- Idempotente (`on conflict do nothing` nos modelos e kits: rodar de novo não
-- desfaz edição do dono). Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PORTA DE CRIAÇÃO DO PACOTE (rascunho + documentos + signatários)
-- -----------------------------------------------------------------------------
-- Entrada em JSON para a assinatura não mudar a cada coluna nova:
--   p_items   [{ template_id, title, rendered_data, sort_order, origin_type, origin_id }]
--   p_signers [{ sort_order, order_group, signer_type, name, cpf, email, phone,
--                user_id, staff_member_id, auth_mode_applied }]
-- Devolve { id, number }.
create or replace function public.signature_create_package(
  p_clinic_id uuid,
  p_audience text,
  p_origin_type text,
  p_origin_id uuid,
  p_client_id uuid,
  p_linked_amount_cents integer,
  p_auth_level text,
  p_auth_reason text,
  p_expires_at timestamptz,
  p_items jsonb,
  p_signers jsonb,
  p_cover_data jsonb,
  p_issuer_cnpj text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_number text;
  v_item jsonb;
  v_signer jsonb;
  v_company_id uuid;
  v_lead_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if not public.signature_can('acao.assinaturas.enviar', p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_audience not in ('patient', 'company') then
    raise exception 'AUDIENCE_INVALID';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) = 0 then
    raise exception 'SIGNERS_REQUIRED';
  end if;
  if p_audience = 'patient' then
    if p_client_id is null or not exists (
      select 1 from public.clients c
       where c.id = p_client_id
         and (c.clinic_id = p_clinic_id or c.preferred_clinic_id = p_clinic_id)
         and c.anonymized_at is null
    ) then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
  else
    -- Empresarial (ZS5): a empresa ou o lead vêm na origem.
    if p_origin_type = 'company' or p_origin_type = 'company_document' then
      v_company_id := p_origin_id;
    elsif p_origin_type = 'commercial_lead' then
      v_lead_id := p_origin_id;
    end if;
  end if;

  insert into public.signature_packages (
    clinic_id, issuer_cnpj, audience, origin_type, origin_id, client_id,
    company_id, lead_id, status, current_stage, linked_amount_cents,
    auth_level_applied, auth_reason, expires_at, cover_data, created_by
  ) values (
    p_clinic_id, nullif(btrim(coalesce(p_issuer_cnpj, '')), ''), p_audience, p_origin_type, p_origin_id, p_client_id,
    v_company_id, v_lead_id, 'draft', 'client', p_linked_amount_cents,
    p_auth_level, p_auth_reason, p_expires_at, p_cover_data, v_uid
  )
  returning id, number into v_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.signature_package_items (
      package_id, sort_order, template_id, title, rendered_data, origin_type, origin_id
    ) values (
      v_id,
      coalesce((v_item->>'sort_order')::integer, 0),
      nullif(v_item->>'template_id', '')::uuid,
      v_item->>'title',
      v_item->'rendered_data',
      nullif(v_item->>'origin_type', ''),
      nullif(v_item->>'origin_id', '')::uuid
    );
  end loop;

  for v_signer in select * from jsonb_array_elements(p_signers) loop
    insert into public.signature_signers (
      package_id, sort_order, order_group, signer_type, name, cpf, email, phone,
      user_id, staff_member_id, auth_mode_applied
    ) values (
      v_id,
      coalesce((v_signer->>'sort_order')::integer, 0),
      coalesce((v_signer->>'order_group')::integer, 1),
      v_signer->>'signer_type',
      v_signer->>'name',
      nullif(v_signer->>'cpf', ''),
      nullif(v_signer->>'email', ''),
      nullif(v_signer->>'phone', ''),
      nullif(v_signer->>'user_id', '')::uuid,
      nullif(v_signer->>'staff_member_id', '')::uuid,
      nullif(v_signer->>'auth_mode_applied', '')
    );
  end loop;

  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (v_id, 'package_created', v_uid, jsonb_build_object('items', jsonb_array_length(p_items), 'signers', jsonb_array_length(p_signers)));

  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

revoke execute on function public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A PORTA DE EDIÇÃO DO MODELO
-- -----------------------------------------------------------------------------
-- O texto (`p_body`) é { preamble, sections: [{ title, body }], closing }. Os
-- campos permitidos quem confere é o aplicativo (`camposDesconhecidos`), antes
-- de chamar; aqui só a forma. `p_variables` = os campos usados, para a tela
-- listar sem abrir o texto. Modelo que vem de fora (`source`) não tem texto
-- aqui: o body é ignorado.
create or replace function public.signature_save_template(
  p_id uuid,
  p_name text,
  p_body jsonb,
  p_variables text[],
  p_auth_level text,
  p_witness_count integer,
  p_witness_mode text,
  p_risarte_signer_mode text,
  p_risarte_signer_role public.user_role,
  p_risarte_signer_user_id uuid,
  p_is_active boolean,
  p_is_provisional_text boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_source text;
begin
  if v_uid is null or not public.signature_can('acao.assinaturas.configurar', null) then
    raise exception 'NOT_ALLOWED';
  end if;
  select source into v_source from public.signature_templates where id = p_id;
  if not found then
    raise exception 'TEMPLATE_NOT_FOUND';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED';
  end if;
  if v_source is null then
    -- `coalesce`: campo ausente dá tipo NULO, e NULO <> 'array' não é
    -- verdadeiro — a guarda deixaria passar (lição da 0308).
    if p_body is null or jsonb_typeof(p_body) <> 'object'
       or coalesce(jsonb_typeof(p_body->'sections'), '') <> 'array'
       or coalesce(jsonb_typeof(p_body->'preamble'), '') <> 'string'
       or coalesce(jsonb_typeof(p_body->'closing'), '') <> 'string' then
      raise exception 'BODY_INVALID';
    end if;
  end if;

  update public.signature_templates set
    name = btrim(p_name),
    body = case when v_source is null then p_body else body end,
    variables = coalesce(p_variables, '{}'::text[]),
    auth_level = coalesce(p_auth_level, auth_level),
    witness_count = coalesce(p_witness_count, witness_count),
    witness_mode = coalesce(p_witness_mode, witness_mode),
    risarte_signer_mode = coalesce(p_risarte_signer_mode, risarte_signer_mode),
    risarte_signer_role = p_risarte_signer_role,
    risarte_signer_user_id = p_risarte_signer_user_id,
    is_active = coalesce(p_is_active, is_active),
    is_provisional_text = coalesce(p_is_provisional_text, is_provisional_text),
    updated_by = v_uid
  where id = p_id;
end;
$$;

revoke execute on function public.signature_save_template(uuid, text, jsonb, text[], text, integer, text, text, public.user_role, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.signature_save_template(uuid, text, jsonb, text[], text, integer, text, text, public.user_role, uuid, boolean, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) OS 5 MODELOS INICIAIS (texto provisório) — plano §4.1 para quem assina
-- -----------------------------------------------------------------------------
-- Quem assina pela Risarte: `role` + papel = alguém com aquele papel na
-- unidade emissora; `role` + papel NULO = o titular (Admin Principal,
-- `profiles.is_owner`) — o enum `user_role` não tem "owner"; `sender` = quem
-- envia; `none` = o modelo não leva assinatura da Risarte.

insert into public.signature_templates
  (code, name, audience, kind, body, variables, auth_level, witness_count, witness_mode, risarte_signer_mode, risarte_signer_role, is_provisional_text, sort_order)
values
(
  'contrato_prestacao',
  'Contrato de prestação de serviços odontológicos',
  'patient', 'contract',
  jsonb_build_object(
    'preamble',
    'Pelo presente instrumento particular, de um lado {{unidade_razao_social}}, inscrita no CNPJ sob o nº {{unidade_cnpj}}, com sede em {{unidade_endereco}}, doravante denominada CONTRATADA; e, de outro lado, {{contratante_nome}}, inscrito(a) no CPF sob o nº {{contratante_cpf}}, doravante denominado(a) CONTRATANTE, na condição de paciente ou de responsável legal pelo(a) paciente {{paciente_nome}}, têm entre si justo e contratado o que segue.',
    'sections', jsonb_build_array(
      jsonb_build_object('title', 'Cláusula 1ª — Do objeto',
        'body', 'O presente contrato tem por objeto a prestação, pela CONTRATADA, dos serviços odontológicos descritos no plano de tratamento aprovado pelo(a) CONTRATANTE, a saber:' || E'\n' || '{{tratamento_procedimentos}}'),
      jsonb_build_object('title', 'Cláusula 2ª — Do valor e da forma de pagamento',
        'body', 'Pelos serviços contratados, o(a) CONTRATANTE pagará à CONTRATADA o valor total de {{tratamento_valor_total}} ({{tratamento_valor_extenso}}), nas seguintes condições: {{tratamento_condicoes}}. O atraso no pagamento sujeita o(a) CONTRATANTE aos encargos previstos na política financeira da unidade, informada no ato da contratação.'),
      jsonb_build_object('title', 'Cláusula 3ª — Das obrigações da CONTRATADA',
        'body', 'A CONTRATADA obriga-se a executar os serviços com zelo e técnica adequada, por profissionais habilitados e regularmente inscritos no Conselho Regional de Odontologia, em ambiente apropriado e com materiais de qualidade, prestando ao(à) CONTRATANTE as informações necessárias sobre o tratamento, seus riscos, benefícios e alternativas.'),
      jsonb_build_object('title', 'Cláusula 4ª — Das obrigações do(a) CONTRATANTE',
        'body', 'O(A) CONTRATANTE obriga-se a comparecer às consultas agendadas, a seguir as orientações recebidas, a informar com veracidade o seu estado de saúde e o uso de medicamentos, e a efetuar os pagamentos nos prazos ajustados.'),
      jsonb_build_object('title', 'Cláusula 5ª — Das faltas e remarcações',
        'body', 'As consultas deverão ser desmarcadas com antecedência mínima de 24 (vinte e quatro) horas. A falta sem aviso poderá acarretar a cobrança da sessão ou a reorganização da sequência do tratamento, a critério da CONTRATADA, sem prejuízo das demais condições deste contrato.'),
      jsonb_build_object('title', 'Cláusula 6ª — Das intercorrências',
        'body', 'Tratando-se de atividade de meio, e não de resultado, a CONTRATADA não garante resultado estético ou funcional específico. Intercorrências decorrentes de condições biológicas do(a) paciente, do não cumprimento das orientações ou de fatores alheios à técnica empregada não configuram inadimplemento da CONTRATADA.'),
      jsonb_build_object('title', 'Cláusula 7ª — Da rescisão',
        'body', 'Qualquer das partes poderá rescindir o presente contrato mediante comunicação por escrito, respondendo o(a) CONTRATANTE pelos serviços já executados e pelos materiais já adquiridos ou confeccionados especificamente para o seu tratamento.'),
      jsonb_build_object('title', 'Cláusula 8ª — Da proteção de dados',
        'body', 'Os dados pessoais e de saúde do(a) paciente serão tratados pela CONTRATADA exclusivamente para a prestação dos serviços e o cumprimento de obrigações legais, nos termos da Lei nº 13.709/2018 (LGPD), ficando garantidos ao(à) titular os direitos de acesso, correção e demais previstos em lei.'),
      jsonb_build_object('title', 'Cláusula 9ª — Do foro',
        'body', 'Fica eleito o foro da comarca de {{unidade_cidade}} para dirimir quaisquer questões decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.')
    ),
    'closing',
    'E, por estarem assim justas e contratadas, as partes assinam o presente instrumento por meio de assinatura eletrônica, na presença das testemunhas abaixo, para que produza seus efeitos legais.' || E'\n\n' || '{{documento_data_extenso}}'
  ),
  array['unidade_razao_social','unidade_cnpj','unidade_endereco','contratante_nome','contratante_cpf','paciente_nome','tratamento_procedimentos','tratamento_valor_total','tratamento_valor_extenso','tratamento_condicoes','unidade_cidade','documento_data_extenso'],
  'by_amount', 2, 'choose_at_send', 'role', 'unit_manager', true, 10
),
(
  'tcle',
  'Termo de consentimento livre e esclarecido',
  'patient', 'consent',
  jsonb_build_object(
    'preamble',
    'Eu, {{contratante_nome}}, CPF {{contratante_cpf}}, na condição de paciente ou de responsável legal pelo(a) paciente {{paciente_nome}}, nascido(a) em {{paciente_nascimento}}, declaro para os devidos fins o que segue.',
    'sections', jsonb_build_array(
      jsonb_build_object('title', '1. Do esclarecimento',
        'body', 'Fui informado(a), em linguagem clara e acessível, pela equipe da {{unidade_nome}} sobre o diagnóstico, a natureza e o objetivo do tratamento proposto, os procedimentos a serem realizados, a saber:' || E'\n' || '{{tratamento_procedimentos}}'),
      jsonb_build_object('title', '2. Dos riscos, benefícios e alternativas',
        'body', 'Fui esclarecido(a) sobre os benefícios esperados, os riscos e desconfortos possíveis (como dor, sensibilidade, edema, sangramento e, em casos raros, reações a medicamentos ou materiais), as alternativas de tratamento existentes, inclusive a de não tratar, e as consequências de cada escolha. Tive a oportunidade de fazer perguntas e todas foram respondidas de forma satisfatória.'),
      jsonb_build_object('title', '3. Das informações prestadas',
        'body', 'Declaro que as informações que prestei sobre o meu estado de saúde, doenças, alergias e medicamentos em uso são verdadeiras e completas, e comprometo-me a informar qualquer alteração durante o tratamento.'),
      jsonb_build_object('title', '4. Da colaboração',
        'body', 'Estou ciente de que o sucesso do tratamento depende também da minha colaboração: comparecimento às consultas, higiene adequada e cumprimento das orientações pós-operatórias.'),
      jsonb_build_object('title', '5. Do consentimento',
        'body', 'Assim, de forma livre, consciente e esclarecida, CONSINTO com a realização do tratamento proposto, podendo revogar este consentimento a qualquer tempo, por escrito, sem prejuízo do que já tiver sido realizado.')
    ),
    'closing',
    '{{documento_data_extenso}}'
  ),
  array['contratante_nome','contratante_cpf','paciente_nome','paciente_nascimento','unidade_nome','tratamento_procedimentos','documento_data_extenso'],
  'simple', 0, 'choose_at_send', 'role', 'unit_manager', true, 20
),
(
  'orcamento_aprovado',
  'Orçamento aprovado',
  'patient', 'budget',
  jsonb_build_object(
    'preamble',
    'A {{unidade_nome}} ({{unidade_cnpj}}) apresenta a {{contratante_nome}}, CPF {{contratante_cpf}}, para o(a) paciente {{paciente_nome}}, o orçamento abaixo, aprovado pelas partes.',
    'sections', jsonb_build_array(
      jsonb_build_object('title', 'Procedimentos',
        'body', '{{tratamento_procedimentos}}'),
      jsonb_build_object('title', 'Valor',
        'body', 'Valor total: {{tratamento_valor_total}} ({{tratamento_valor_extenso}}).' || E'\n' || 'Condições de pagamento: {{tratamento_condicoes}}.'),
      jsonb_build_object('title', 'Validade',
        'body', 'Este orçamento é válido até {{tratamento_validade}}. Após essa data, os valores poderão ser atualizados conforme a tabela vigente da unidade.'),
      jsonb_build_object('title', 'Aprovação',
        'body', 'Ao assinar, o(a) contratante declara que leu o orçamento, que os procedimentos e valores correspondem ao que foi combinado e que aprova a sua execução.')
    ),
    'closing',
    '{{documento_data_extenso}}'
  ),
  array['unidade_nome','unidade_cnpj','contratante_nome','contratante_cpf','paciente_nome','tratamento_procedimentos','tratamento_valor_total','tratamento_valor_extenso','tratamento_condicoes','tratamento_validade','documento_data_extenso'],
  'by_amount', 0, 'choose_at_send', 'sender', null, true, 30
),
(
  'autorizacao_imagem',
  'Autorização de uso de imagem',
  'patient', 'image_release',
  jsonb_build_object(
    'preamble',
    'Eu, {{contratante_nome}}, CPF {{contratante_cpf}}, na condição de paciente ou de responsável legal pelo(a) paciente {{paciente_nome}}, AUTORIZO a {{unidade_razao_social}}, CNPJ {{unidade_cnpj}}, nos termos abaixo.',
    'sections', jsonb_build_array(
      jsonb_build_object('title', '1. Do objeto',
        'body', 'A presente autorização abrange a captação e o uso de fotografias e vídeos da região bucofacial do(a) paciente, antes, durante e depois do tratamento, com finalidade de documentação clínica e, se marcado abaixo, de divulgação científica e institucional.'),
      jsonb_build_object('title', '2. Da documentação clínica',
        'body', 'As imagens de documentação clínica integram o prontuário e são tratadas como dado de saúde, com acesso restrito à equipe assistencial, pelo prazo legal de guarda.'),
      jsonb_build_object('title', '3. Da divulgação',
        'body', 'A divulgação científica (aulas, congressos, publicações) e institucional (site e redes sociais da Risarte) somente ocorrerá com a preservação da identidade do(a) paciente, salvo autorização expressa em contrário, e sem qualquer remuneração.'),
      jsonb_build_object('title', '4. Da revogação',
        'body', 'Esta autorização pode ser revogada a qualquer tempo, por escrito, sem efeito sobre os usos já realizados até a data da revogação.')
    ),
    'closing',
    '{{documento_data_extenso}}'
  ),
  array['contratante_nome','contratante_cpf','paciente_nome','unidade_razao_social','unidade_cnpj','documento_data_extenso'],
  'simple', 0, 'choose_at_send', 'role', 'unit_manager', true, 40
),
(
  'adesao_empresarial',
  'Contrato de adesão empresarial',
  'company', 'adhesion',
  null,
  '{}'::text[],
  'simple', 2, 'choose_at_send', 'role', null, false, 50
)
on conflict (code) do nothing;

-- O modelo de adesão lê o texto do Empresarial (`contract_templates`, 1027):
-- marcar a origem mesmo se a linha já existia de uma versão anterior.
update public.signature_templates
   set source = 'empresarial_contract_templates'
 where code = 'adesao_empresarial' and source is null;

-- -----------------------------------------------------------------------------
-- 4) OS KITS INICIAIS
-- -----------------------------------------------------------------------------
insert into public.signature_kits (id, name, audience, sort_order)
values
  ('6b1a4c0e-0000-4000-8000-000000000001', 'Início de tratamento (contrato + consentimento)', 'patient', 10),
  ('6b1a4c0e-0000-4000-8000-000000000002', 'Orçamento aprovado', 'patient', 20)
on conflict (id) do nothing;

insert into public.signature_kit_items (kit_id, template_id, sort_order)
select k.id, t.id, x.sort_order
  from (values
    ('6b1a4c0e-0000-4000-8000-000000000001'::uuid, 'contrato_prestacao', 0),
    ('6b1a4c0e-0000-4000-8000-000000000001'::uuid, 'tcle', 1),
    ('6b1a4c0e-0000-4000-8000-000000000002'::uuid, 'orcamento_aprovado', 0)
  ) as x(kit_id, code, sort_order)
  join public.signature_kits k on k.id = x.kit_id
  join public.signature_templates t on t.code = x.code
on conflict (kit_id, template_id) do nothing;

-- -----------------------------------------------------------------------------
-- 5) AUDITORIA (0288): nenhuma tabela nova; reprende por segurança
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.signature_templates) as modelos,
  (select count(*) from public.signature_templates where is_provisional_text) as modelos_provisorios,
  (select count(*) from public.signature_kits) as kits,
  (select count(*) from public.signature_kit_items) as itens_de_kit,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('signature_create_package', 'signature_save_template')) as portas,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'signature\_%' and cmd <> 'SELECT') as policies_fora_de_select;
