-- =============================================================================
-- 0130 — H4.13 ajuste: EXCLUIR especialidade (além de editar/desativar)
-- -----------------------------------------------------------------------------
-- Ao excluir, os procedimentos/Risartanos que usavam o nome são REALOCADOS para
-- outra especialidade (p_reassign_to) OU ficam SEM especialidade (p_reassign_to
-- vazio/nulo). SECURITY DEFINER: cascateia com segurança e checa a permissão.
-- Idempotente.
-- =============================================================================

create or replace function public.delete_specialty(p_id uuid, p_reassign_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text := nullif(btrim(coalesce(p_reassign_to, '')), '');
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  select name into v_old from public.specialties where id = p_id;
  if v_old is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_new is not null then
    if v_new = v_old then
      raise exception 'SAME_NAME';
    end if;
    if not exists (select 1 from public.specialties where name = v_new) then
      raise exception 'TARGET_NOT_FOUND';
    end if;
    -- Realoca os procedimentos e os Risartanos (dedup no array do staff).
    update public.procedures
      set specialty = v_new, updated_at = now()
      where specialty = v_old;
    update public.staff_members
      set specialties = (
        select array(
          select distinct x
          from unnest(array_replace(specialties, v_old, v_new)) as x
        )
      )
      where v_old = any(specialties);
  else
    -- Sem destino: procedimentos ficam sem especialidade; remove do staff.
    update public.procedures
      set specialty = null, updated_at = now()
      where specialty = v_old;
    update public.staff_members
      set specialties = array_remove(specialties, v_old)
      where v_old = any(specialties);
  end if;

  delete from public.specialties where id = p_id;
end;
$$;
grant execute on function public.delete_specialty(uuid, text) to authenticated;
