-- =============================================================================
-- 0299 — O GRUPO DO TESTE COLETIVO VOLTA A SALVAR PELA TELA (AP48)
--
-- Achado varrendo o banco no OC-00103 (16/10/2026). Mesmo defeito da 0298: a
-- API do Supabase carrega o `safeupdate`, que recusa DELETE sem WHERE, e
-- `save_training_cohort` (Administração → Certificação, grupo do teste
-- coletivo) esvaziava as duas listas com `delete from ...;`. Provado pela API,
-- no treino, sem gravar nada: salvar parava em "DELETE requires a WHERE
-- clause" — e o erro desfazia tudo, inclusive a troca de modo.
--
-- O QUE MUDA: só aquelas duas linhas, que viram `where true` (a intenção é
-- mesmo trocar a lista inteira — ver o comentário "NULO = NÃO MEXER" abaixo).
-- O resto da função é a 0272, copiado por script. Mesma assinatura e mesmo
-- retorno. As permissões passam ao padrão de hoje (AP15): só quem está logado
-- executa — a guarda já recusava quem não é Admin Master.
--
-- Nada apaga dado ao rodar. Idempotente.
-- =============================================================================

create or replace function public.save_training_cohort(
  p_mode text,
  p_roles text[],
  p_members uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_mode is null or p_mode not in ('papeis', 'pessoas') then
    raise exception 'INVALID_MODE';
  end if;

  update public.training_settings
     set cohort_mode = p_mode, updated_at = now(), updated_by = auth.uid()
   where id = true;

  -- ⚠️ NULO = NÃO MEXER; LISTA (mesmo VAZIA) = TROCAR POR ESTA.
  --
  -- A distinção é o que mantém a promessa do cabeçalho: as duas listas ficam
  -- guardadas, e trocar de modo para conferir não apaga o que já foi montado.
  -- A tela só mostra as caixas do modo ativo, então ela manda NULO para o
  -- outro — "não estou editando isto agora". Se nulo fosse tratado como lista
  -- vazia, abrir a tela no modo `pessoas` e salvar apagaria em silêncio a
  -- seleção de cargos, e o Admin só descobriria ao voltar.
  --
  -- Esvaziar de propósito continua possível: basta estar NAQUELE modo e
  -- desmarcar tudo — aí chega uma lista vazia, que é uma decisão, não um
  -- efeito colateral.
  if p_roles is not null then
    delete from public.training_cohort_roles where true;  -- AP48: ver o cabeçalho
    insert into public.training_cohort_roles (role, added_by)
    select distinct r::public.user_role, auth.uid()
      from unnest(p_roles) as r
     where r is not null and r <> '';
  end if;

  if p_members is not null then
    delete from public.training_cohort_members where true;  -- AP48: ver o cabeçalho
    -- Só entra quem EXISTE e está ativo: id solto viraria uma trava que
    -- ninguém consegue satisfazer, porque não há pessoa para cumprir a missão.
    insert into public.training_cohort_members (user_id, added_by)
    select distinct m, auth.uid()
      from unnest(p_members) as m
      join public.profiles p on p.id = m and p.is_active;
  end if;
end;
$$;

revoke execute on function public.save_training_cohort(text, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.save_training_cohort(text, text[], uuid[]) to authenticated;
