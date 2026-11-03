-- =============================================================================
-- 0350 — A RAZÃO SOCIAL DA UNIDADE NOS DOCUMENTOS ASSINADOS PELO CLIENTE
--
-- Decisão do dono (03/11/2026): "nenhum contrato de prestação de serviço deve
-- ir a logomarca da Risarte. O nome da empresa que vai no contrato é a razão
-- social da unidade. Isso serve para todos os contratos emitidos e que devem
-- ser assinados pelos clientes (B2B ou B2C)."
--
-- Antes, a unidade não tinha razão social: o campo `{{unidade_razao_social}}`
-- saía com o NOME da unidade ("Risarte Cambé"), e a capa e o rodapé do PDF
-- também (AP96).
--
-- O que muda:
--   1) `clinics.legal_name` — a razão social, preenchida pelo Admin Master em
--      Administração → Clínicas. Vazia: o app RECUSA enviar documento para
--      assinatura (decisão do dono). A tabela já está na auditoria (0288).
--   2) Os modelos de paciente que ainda são TEXTO PROVISÓRIO e usam
--      `{{unidade_nome}}` (TCLE e orçamento aprovado) passam a usar
--      `{{unidade_razao_social}}`. Texto aprovado pela tela não é tocado — o
--      aviso no fim diz qual ainda usa o nome.
--
-- O logotipo saiu da capa do pacote no app (cover.ts), sem migração.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) A coluna -------------------------------------------------------------------
alter table public.clinics add column if not exists legal_name text;

comment on column public.clinics.legal_name is
  'Razão social da unidade: o nome da CONTRATADA nos documentos assinados pelo cliente (0350). Sem ela o envio para assinatura é recusado.';

-- 2) Os modelos provisórios trocam o nome pela razão social ----------------------
update public.signature_templates t
set
  body = replace(t.body::text, '{{unidade_nome}}', '{{unidade_razao_social}}')::jsonb,
  variables = (
    select coalesce(array_agg(distinct v order by v), array[]::text[])
    from unnest(array_replace(t.variables, 'unidade_nome', 'unidade_razao_social')) as v
  ),
  updated_at = now()
where t.audience = 'patient'
  and t.is_provisional_text
  and t.body is not null
  and position('{{unidade_nome}}' in t.body::text) > 0;

do $$
declare
  v_nomes text;
begin
  select string_agg(name, ', ' order by name) into v_nomes
  from public.signature_templates
  where audience = 'patient'
    and body is not null
    and position('{{unidade_nome}}' in body::text) > 0;
  if v_nomes is not null then
    raise notice 'Ainda usam o nome da unidade (texto aprovado pela tela, não alterado): %. Troque {{unidade_nome}} por {{unidade_razao_social}} em Assinaturas → Configurações → Modelos.', v_nomes;
  end if;
end $$;
