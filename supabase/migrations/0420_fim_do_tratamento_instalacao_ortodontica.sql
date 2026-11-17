-- =============================================================================
-- 0420 — FIM DO TRATAMENTO: A INSTALAÇÃO ORTODÔNTICA NÃO TERMINA O PLANO
--
-- Correção da 0418, combinada com a sessão "Módulo de Ortodontia" (17/11/2026).
-- Com a 0417 (AP175), a instalação do aparelho é SÓ uma sessão do plano. Um
-- plano que tem apenas o procedimento de Ortodontia terminava na instalação, e
-- o gatilho da 0418 abria a pergunta "necessita de reavaliação?" logo depois
-- de instalar. Para a Jornada, o fim da ortodontia é a ENTREGA DAS CONTENÇÕES
-- (C2/C3 do plano docs/jornada/FIM-DO-TRATAMENTO-PLANO.md), que já tem gatilho
-- próprio (`treatment_closure_on_ortho`).
--
-- A regra: o fim de um plano IGNORA as sessões de procedimento de
-- especialidade Ortodontia — o mesmo critério que a 0417 usa para reconhecer a
-- instalação (`procedures.specialty ilike '%ortod%'`).
--   * plano só com a instalação → não abre pergunta;
--   * plano misto (instalação + restauração) → abre quando o resto termina,
--     esteja a instalação feita ou não;
--   * a regra "sobra tratamento?" não muda: a ortodontia aguardando início ou
--     em tratamento continua segurando a Fase 5.
--
-- Recria só `treatment_closure_on_session` (a definição da 0418 com o filtro)
-- e cria a interna `_sessao_ortodontica`. Nada apaga. Idempotente.
-- =============================================================================

create or replace function public._sessao_ortodontica(p_procedure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.specialty ilike '%ortod%'
      from public.procedures p where p.id = p_procedure_id
  ), false);
$$;
revoke execute on function public._sessao_ortodontica(uuid) from public, anon, authenticated;

-- A definição em vigor (0418) com o filtro da Ortodontia.
create or replace function public.treatment_closure_on_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_last public.treatment_sessions;
  v_provider uuid;
  v_asked uuid;
  v_owner boolean;
  v_auto boolean;
  v_scope text;
  v_vendida boolean;
begin
  begin
    -- (a) Reabertura: sessão volta a pendente/agendada (revisão, refação,
    --     sessão nova). O cliente volta a "Em Tratamento"; a pergunta ainda
    --     sem resposta daquele plano é retirada.
    if new.status in ('pending', 'scheduled')
       and (tg_op = 'INSERT' or old.status in ('done', 'cancelled')) then
      update public.clients set journey_status = 'in_treatment'
       where id = new.client_id
         and journey_phase = 'treatment_start'
         and journey_status = 'treatment_finished';
      update public.treatment_closures
         set status = 'encerrado', outcome = 'reaberto', closed_at = now(),
             closed_by = v_user, updated_at = now()
       where status in ('pergunta', 'coordenador')
         and not public._sessao_ortodontica(new.procedure_id)
         and ((new.plan_id is not null and plan_id = new.plan_id)
              or (new.direct_sale_id is not null and direct_sale_id = new.direct_sale_id));
      return null;
    end if;

    if tg_op <> 'UPDATE' or new.status <> 'done' or old.status = 'done' then
      return null;
    end if;

    -- (b) 1ª sessão feita: o plano passa a "Em tratamento".
    if new.plan_id is not null then
      update public.treatment_plans
         set lifecycle = 'em_tratamento', lifecycle_at = now(), updated_at = now()
       where id = new.plan_id
         and (lifecycle is null or lifecycle in ('aguardando_apresentacao', 'apresentado', 'aceito'));
    end if;

    -- Revisão e refação não refazem a pergunta: voltam ao Coordenador pelo
    -- aviso de sempre (`notify_qc_after_redo_finish`).
    if new.redo_kind is not null then return null; end if;

    -- 0420: a sessão de Ortodontia (a instalação) nunca termina o plano. O
    -- fim da ortodontia, para a Jornada, é a entrega das contenções
    -- (`treatment_closure_on_ortho`).
    if public._sessao_ortodontica(new.procedure_id) then return null; end if;

    -- (c) Ainda sobra sessão deste plano/venda? Então não terminou.
    if new.plan_id is not null then
      v_scope := 'plano';
      if exists (select 1 from public.treatment_sessions s
                  where s.plan_id = new.plan_id and s.status in ('pending', 'scheduled')
                    and not public._sessao_ortodontica(s.procedure_id)) then
        return null;
      end if;
      -- Só plano VENDIDO e não cancelado (o cancelamento tem fluxo próprio).
      select exists (
        select 1 from public.plan_negotiations n
        join public.commercial_sales s on s.negotiation_id = n.id
        where n.plan_id = new.plan_id and s.closed_at is not null and s.cancelled_at is null
      ) into v_vendida;
      if not v_vendida then return null; end if;
      -- Já houve fechamento deste plano (que não foi retirado por reabertura)?
      if exists (select 1 from public.treatment_closures f
                  where f.plan_id = new.plan_id and f.outcome is distinct from 'reaberto') then
        return null;
      end if;
    elsif new.direct_sale_id is not null then
      v_scope := 'venda_direta';
      if exists (select 1 from public.treatment_sessions s
                  where s.direct_sale_id = new.direct_sale_id and s.status in ('pending', 'scheduled')
                    and not public._sessao_ortodontica(s.procedure_id)) then
        return null;
      end if;
      if exists (select 1 from public.direct_sales d
                  where d.id = new.direct_sale_id and d.status = 'cancelada') then
        return null;
      end if;
      if exists (select 1 from public.treatment_closures f
                  where f.direct_sale_id = new.direct_sale_id and f.outcome is distinct from 'reaberto') then
        return null;
      end if;
    else
      return null;
    end if;

    -- (d) O plano terminou: "Concluído".
    if new.plan_id is not null then
      update public.treatment_plans
         set lifecycle = 'concluido', lifecycle_at = now(), updated_at = now()
       where id = new.plan_id
         and coalesce(lifecycle::text, '') not in ('concluido', 'cancelado', 'reprovado');
    end if;

    -- (e) Quem responde: quem executou a última sessão; se foi o titular
    --     concluindo por outro profissional, o profissional do agendamento.
    select * into v_last from public.treatment_sessions s
     where s.status = 'done'
       and not public._sessao_ortodontica(s.procedure_id)
       and ((new.plan_id is not null and s.plan_id = new.plan_id)
            or (new.plan_id is null and s.direct_sale_id = new.direct_sale_id))
     order by s.done_at desc nulls last
     limit 1;
    select a.provider_user_id into v_provider
      from public.appointments a where a.id = v_last.appointment_id;
    select coalesce(p.is_owner, false) into v_owner
      from public.profiles p where p.id = v_last.executed_by;
    v_asked := case
      when v_last.executed_by is null then v_provider
      when coalesce(v_owner, false) and v_provider is not null
           and v_provider <> v_last.executed_by then v_provider
      else v_last.executed_by end;

    -- (f) D17: procedimento com reavaliação obrigatória no plano/venda.
    select exists (
      select 1 from public.treatment_sessions s
      join public.procedures p on p.id = s.procedure_id
      where p.requires_reevaluation
        and ((new.plan_id is not null and s.plan_id = new.plan_id)
             or (new.plan_id is null and s.direct_sale_id = new.direct_sale_id))
    ) into v_auto;

    perform public._abrir_fechamento(
      v_scope, new.client_id, new.clinic_id,
      new.plan_id, case when new.plan_id is null then new.direct_sale_id end, null,
      v_asked, coalesce(v_auto, false), v_user);
  exception when others then
    -- Nunca derruba a baixa da sessão: o fechamento que faltar aparece na
    -- lista de "sem próximo passo" (Etapa 4).
    raise warning 'treatment_closure_on_session (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_session() from public, anon, authenticated;
