-- CORREÇÃO DA PRODUÇÃO (achada no roteiro do dono, 16/11/2026) — espera o "pode".
--
-- O defeito: quatro regras de acesso chamam funções fechadas para o usuário
-- logado e caem com "permission denied":
--   * a pasta dos termos da renegociação (`renegociacoes`, 4017): o "Anexar termo
--     assinado" falha SEMPRE, e a tela diz "Só o Gerente da unidade ou o Admin
--     Master anexa o termo assinado." até para o Admin Master;
--   * a lista dos pedidos de exceção (`sale_cancel_exceptions`, 4017a), na leitura
--     direta da tela da venda direta;
--   * as listas da forma 2 (`boleto_lists` e `boleto_list_accesses`, 4015), na
--     leitura direta.
--
-- A correção: liberar a execução das duas funções. Elas só respondem "sim ou
-- não" sobre a PRÓPRIA pessoa logada (é Admin Master, Financeiro, Gerente da
-- unidade ou quem fechou a venda?). Nenhum dado sai por elas.
--
-- Risco: nenhum dado novo fica visível; as regras passam a funcionar como foram
-- escritas. Desfazer: as duas linhas `revoke` no fim (comentadas).
--
-- Esta correção também está dentro da 4020; rodar esta antes não atrapalha a 4020.

grant execute on function public._is_manager_or_admin(uuid) to authenticated;
grant execute on function public._boleto_mode_can(uuid, uuid) to authenticated;

-- Conferência: as duas devem vir "true", e "regras_quebradas" deve vir 0.
select
  has_function_privilege('authenticated', 'public._is_manager_or_admin(uuid)', 'execute') as gerente_ou_admin_liberada,
  has_function_privilege('authenticated', 'public._boleto_mode_can(uuid, uuid)', 'execute') as forma2_liberada,
  (select count(*) from (
     select distinct p.tablename, f.proname
       from pg_policies p
       join pg_proc f on strpos(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), f.proname || '(') > 0
       join pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
      where not has_function_privilege('authenticated', f.oid, 'execute')) x) as regras_quebradas;

-- Para desfazer:
-- revoke execute on function public._is_manager_or_admin(uuid) from authenticated;
-- revoke execute on function public._boleto_mode_can(uuid, uuid) from authenticated;
