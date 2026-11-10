-- =============================================================================
-- 0380 — O FINANCEIRO DA FRANQUEADORA SÓ COM O ESCOPO "TODAS" (AP67)
--
-- DECISÃO DO DONO (10/11/2026): proibir o escopo restrito ("Específicas" ou
-- "Nenhuma") para a função Financeiro da Franqueadora.
--
-- POR QUÊ: o banco dá a essa função o financeiro de TODAS as unidades
-- (`is_finance_franchisor()`, 0185 — usada em mais de 130 regras de tabela),
-- seja qual for o escopo gravado. A tela deixava escolher "Específicas" e o
-- banco ignorava: um limite prometido e não cumprido. Reescrever as 130
-- regras é obra grande e arriscada; o dono preferiu não oferecer o limite.
--
-- O QUE MUDA: uma trava na tabela das funções. A tela (0.414.0) não oferece
-- mais a escolha e a ação recusa; esta é a terceira trava, para o que chegar
-- por outro caminho.
--
-- ⚠️ A trava é conferida nas linhas que JÁ EXISTEM: se houver um Financeiro
-- da Franqueadora com escopo restrito, a migração PARA com erro e NADA muda
-- (medido no treino em 10/11/2026: 0 linhas; na produção o único tem "Todas").
-- Nesse caso, mude o escopo da pessoa para "Todas" em Risartanos e rode de novo.
--
-- Nada é apagado nem alterado.
-- =============================================================================

alter table public.user_clinic_roles_all
  drop constraint if exists user_clinic_roles_finance_scope_all;

alter table public.user_clinic_roles_all
  add constraint user_clinic_roles_finance_scope_all
  check (role <> 'finance_franchisor' or unit_scope is null or unit_scope = 'all');

comment on constraint user_clinic_roles_finance_scope_all on public.user_clinic_roles_all is
  'AP67: o Financeiro da Franqueadora aceita só o escopo "Todas" — o banco dá a ele o financeiro de todas as unidades (is_finance_franchisor), então um escopo restrito seria promessa não cumprida.';

-- CONFERÊNCIA (só leitura). Esperado: trava_existe = true, fora_da_regra = 0.
select
  exists (
    select 1 from pg_constraint
    where conname = 'user_clinic_roles_finance_scope_all'
  ) as trava_existe,
  (select count(*) from public.user_clinic_roles_all
    where role = 'finance_franchisor' and unit_scope is not null and unit_scope <> 'all') as fora_da_regra,
  (select count(*) from public.user_clinic_roles_all where role = 'finance_franchisor') as financeiros_da_franqueadora;
