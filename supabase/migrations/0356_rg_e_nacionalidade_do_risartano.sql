-- 0356 — RG E NACIONALIDADE NA FICHA DO RISARTANO (AP95, decisão do dono, 03/11/2026)
--
-- O contrato de adesão do Empresarial passou a ser assinado pela Risarte pelo
-- CONSULTOR RISLIFE responsável pela empresa (sem consultor responsável, por
-- quem envia). O texto do contrato cita o representante da Risarte com nome,
-- CPF, RG, cargo e nacionalidade: até aqui vinham de Configurações → Contrato
-- (o titular). Agora vêm da ficha do Risartano de quem assina — e a ficha não
-- tinha RG nem nacionalidade.
--
-- Colunas opcionais: ninguém é obrigado a preencher para existir na equipe.
-- Sem o RG, o envio do contrato para e diz o que falta. Sem a nacionalidade,
-- o contrato avisa (não bloqueia).
--
-- A tabela já está na auditoria (gatilho por tabela): as colunas novas entram
-- sozinhas. No treino a ficha é cópia da produção (0260): a cópia leva as
-- colunas junto (`select *`).
--
-- Idempotente: `add column if not exists`.

alter table public.staff_members
  add column if not exists rg text,
  add column if not exists nationality text;

comment on column public.staff_members.rg is
  'RG do Risartano (0356). Entra no contrato de adesão quando é ele quem assina pela Risarte.';
comment on column public.staff_members.nationality is
  'Nacionalidade do Risartano (0356), como vai no contrato ("brasileira", "brasileiro"…).';

-- Conferência (rodar e olhar): 2
select count(*) as colunas_novas
  from information_schema.columns
 where table_schema = 'public' and table_name = 'staff_members'
   and column_name in ('rg', 'nationality');
