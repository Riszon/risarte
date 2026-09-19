-- =============================================================================
-- 0263 — BOAS-VINDAS NO PRIMEIRO LOGIN
-- =============================================================================
--
-- Pedido do dono (19/09/2026): uma mensagem de boas-vindas ao riSZon para o
-- Risartano que entra pela primeira vez. Ela aparece UMA vez, na tela de
-- Início do sistema real; `welcomed_at` guarda quando a pessoa a fechou.
--
-- Quem JÁ tinha entrado no sistema antes desta migração não é recém-chegado:
-- recebe a marca agora, para não ser recebido como novo na próxima vez que
-- abrir o Início. O critério é o próprio registro de login do Supabase
-- (`auth.users.last_sign_in_at`) — perguntado ao banco, não suposto.
--
-- Cada pessoa grava só a PRÓPRIA marca, pela política de perfil que já existe
-- (a pessoa atualiza o próprio perfil). Nenhuma trava da 0260/0262 alcança esta
-- coluna: ela não vem da produção para o treino nem é acesso.
-- =============================================================================

alter table public.profiles
  add column if not exists welcomed_at timestamptz;

update public.profiles p
   set welcomed_at = now()
 where p.welcomed_at is null
   and exists (
     select 1 from auth.users u
      where u.id = p.id
        and u.last_sign_in_at is not null
   );
