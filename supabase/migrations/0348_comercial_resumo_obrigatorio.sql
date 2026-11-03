-- =============================================================================
-- 0348 — O RESUMO DA APRESENTAÇÃO PASSA A SER OBRIGATÓRIO (OC-00158)
--
-- Relato do Admin Master (03/11/2026): "Deve ser obrigatório o comercial
-- colocar um resumo da apresentação comercial." Conferido no treino: nada
-- exigia o resumo — 4 negociações aceitas sem ele. E a tela prometia que o
-- resumo "será inserido no contrato", mas nenhum modelo tinha o campo.
--
-- Decisões do dono (03/11/2026):
--   * o resumo é exigido para MARCAR O ACEITE ("Aceita pelo cliente");
--   * ele vai NO CONTRATO, como campo do modelo (`{{apresentacao_resumo}}`);
--   * quem já foi aceito sem resumo fica travado no ENVIO do contrato (isso é
--     do app: `prepararPacote` recusa modelo com o campo e resumo vazio).
--
-- O que muda:
--   1) `accept_negotiation` recusa com SUMMARY_REQUIRED quando o cliente não
--      tem resumo escrito em `commercial_presentations`. O resto da função é
--      a da 0152, igual. As permissões são as da 0295 (sem login não executa).
--   2) O contrato provisório (`contrato_prestacao`, `is_provisional_text`)
--      ganha o campo no fim da Cláusula 1ª — SÓ se ainda for o texto
--      provisório e ainda não tiver o campo. Texto aprovado pelo jurídico
--      (`is_provisional_text = false`) não é tocado: o Admin acrescenta o campo
--      pela tela de Modelos.
--
-- Nada apaga. Idempotente: rodar de novo não acrescenta o campo duas vezes.
-- =============================================================================

-- 1) O aceite exige o resumo ----------------------------------------------------
create or replace function public.accept_negotiation(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_phase public.journey_phase;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  select journey_phase into v_client_phase
  from public.clients where id = v_neg.client_id;
  if v_client_phase <> 'commercial_conversion' then
    raise exception 'WRONG_PHASE';
  end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Rodada devolvida: o plano pode ter mudado no replanejamento — o Consultor
  -- precisa revisar e SALVAR a nova rodada antes de registrar o aceite.
  if v_neg.status = 'devolvida' then raise exception 'ROUND_CLOSED'; end if;
  if v_neg.status = 'aguardando_autorizacao' then raise exception 'AWAITING_AUTHORIZATION'; end if;
  if v_neg.rule_violations is not null and not v_neg.rule_authorized then
    raise exception 'NEEDS_AUTHORIZATION';
  end if;
  if v_neg.is_partial and coalesce(btrim(v_neg.partial_reason), '') = '' then
    raise exception 'PARTIAL_REASON_REQUIRED';
  end if;
  if v_neg.payment_method is null then raise exception 'PAYMENT_REQUIRED'; end if;

  -- 0348 (OC-00158): sem o resumo da apresentação, não há aceite. Ele é o
  -- registro do que o cliente ouviu e aceitou, e vai no contrato.
  if not exists (
    select 1 from public.commercial_presentations cp
    where cp.client_id = v_neg.client_id
      and coalesce(btrim(cp.summary), '') <> ''
  ) then
    raise exception 'SUMMARY_REQUIRED';
  end if;

  update public.plan_negotiations set
    status = 'aceita',
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_neg.clinic_id,
    'Negociação aceita — preparar fechamento',
    coalesce(v_client_name, 'Cliente')
      || ' aceitou as condições. Prepare o contrato e o pagamento (fechamento).',
    '/apresentacao/' || v_neg.client_id
  from public.providers_with_access(v_neg.clinic_id, 'commercial_assistant') pwa
  where pwa.user_id <> v_user;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation_accept', p_negotiation_id::text, null);
end;
$$;

revoke execute on function public.accept_negotiation(uuid) from public, anon, authenticated;
grant execute on function public.accept_negotiation(uuid) to authenticated;

-- 2) O contrato provisório ganha o campo do resumo -------------------------------
update public.signature_templates t
set
  body = jsonb_set(
    t.body,
    '{sections,0,body}',
    to_jsonb(
      (t.body->'sections'->0->>'body')
      || E'\n\n'
      || 'O resumo da apresentação do plano ao(à) CONTRATANTE, registrado pelo Consultor Comercial, integra este contrato:'
      || E'\n'
      || '{{apresentacao_resumo}}'
    )
  ),
  variables = case
    when 'apresentacao_resumo' = any (t.variables) then t.variables
    else t.variables || array['apresentacao_resumo']::text[]
  end,
  updated_at = now()
where t.code = 'contrato_prestacao'
  and t.is_provisional_text
  and t.body is not null
  and jsonb_typeof(t.body->'sections') = 'array'
  and jsonb_array_length(t.body->'sections') > 0
  and position('apresentacao_resumo' in t.body::text) = 0;
