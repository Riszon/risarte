-- =============================================================================
-- 0261 — NO TREINO, O NÍVEL DE CARREIRA DO DENTISTA CONTINUA EDITÁVEL
-- =============================================================================
--
-- A 0260 trancou `user_clinic_roles` no treino (as funções vêm da produção).
-- Só que o nível do plano de carreira do dentista (`career_level_id`, 0209)
-- mora no MESMO registro — e ele não é acesso, é configuração financeira: o
-- Financeiro → Repasses do treino precisa dele para calcular o repasse, do
-- mesmo jeito que usa as tabelas de repasse de lá.
--
-- Decisão do dono (18/09/2026): no treino, a trava deixa passar a mudança que
-- mexe SÓ no nível de carreira. Trocar função, unidade ou escopo continua
-- recusado. (E a cópia passou a preservar o nível que já estiver no treino —
-- `espelho-treino.ts`.)
--
-- Na PRODUÇÃO nada muda: lá a trava nunca dispara.
-- =============================================================================

create or replace function public.block_mirror_role_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_mirror_db()
     and public.mirror_writer_role() in ('authenticated', 'anon') then
    -- Mudou só o nível de carreira? Passa.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'career_level_id') = (to_jsonb(old) - 'career_level_id') then
      return new;
    end if;
    raise exception 'MIRROR_READ_ONLY'
      using hint = 'No treino as funções vêm do sistema real. Só o nível de carreira do dentista se altera aqui.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists mirror_read_only on public.user_clinic_roles;
create trigger mirror_read_only
  before insert or update or delete on public.user_clinic_roles
  for each row execute function public.block_mirror_role_writes();
