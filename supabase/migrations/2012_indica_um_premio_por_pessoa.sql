-- =============================================================================
-- 2012 — INDICA: UM PRÊMIO POR PESSOA (funções de apoio, core 0413)
--
-- O prêmio da equipe saía uma vez por LINHA de função na unidade. Com as
-- funções de apoio (mais de uma função por pessoa na mesma unidade), a pessoa
-- receberia dois prêmios. Agora: um por pessoa, pelo grupo da função PRINCIPAL
-- (decisão D8 do dono, 16/11/2026; docs/equipe/FUNCOES-DE-APOIO-PLANO.md).
--
-- Exige a 0413 (coluna assignment_kind). Idempotente.
-- =============================================================================

create or replace function indica.aprovar_apuracao(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  a indica.apuracoes;
  m indica.metas_equipe;
  v_faixa jsonb;
  v_premios jsonb := '[]'::jsonb;
begin
  select * into a from indica.apuracoes where id = p_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: apuração não encontrada.';
  end if;
  select * into m from indica.metas_equipe where id = a.meta_id;
  if v_uid is not null and not indica.eh_gestor(m.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: aprovar é do gestor da unidade.';
  end if;
  if a.tipo <> 'final' or a.status <> 'aguardando_aprovacao' then
    raise exception 'INDICA_TRANSICAO_INVALIDA: só a apuração FINAL aguardando aprovação.';
  end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo da reprovação.';
  end if;

  if p_aprovar and a.faixa_atingida is not null then
    select f into v_faixa from jsonb_array_elements(m.faixas) f where f ->> 'nome' = a.faixa_atingida limit 1;
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', r.user_id,
             'nome', p.full_name,
             'funcao', r.role,
             'grupo', case when r.role::text in ('receptionist', 'sdr') then 'recepcao_crc' else 'demais' end,
             'premio', v_faixa #> array['premios', case when r.role::text in ('receptionist', 'sdr') then 'recepcao_crc' else 'demais' end]
           ) order by p.full_name), '[]'::jsonb)
      into v_premios
      from public.user_clinic_roles_all r
      join public.profiles p on p.id = r.user_id and p.is_active and not p.is_admin_master
     where r.clinic_id = m.unidade_id
       -- 2012: um prêmio por pessoa, pelo grupo da função PRINCIPAL (D8 das
       -- funções de apoio, core 0413).
       and r.assignment_kind = 'principal';
  end if;

  perform set_config('indica.motor', 'sim', true);
  update indica.apuracoes
     set status = case when p_aprovar then 'aprovada' else 'reprovada' end,
         aprovado_por = v_uid, aprovado_em = now(),
         premios = v_premios,
         motivo = nullif(btrim(p_motivo), '')
   where id = p_id;
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, m.unidade_id, 'update', 'indica_apuracao', p_id::text,
            jsonb_build_object('aprovada', p_aprovar, 'faixa', a.faixa_atingida));
  end if;
  return case when p_aprovar then 'aprovada' else 'reprovada' end;
end;
$$;
