-- Levantamento (SÓ LEITURA): acordo de taxa gravado na clínica da FRANQUEADORA.
-- O defeito (achado no teste do dono em 17/11/2026): em Financeiro › Taxas da rede,
-- entrando pela franqueadora, a caixa mostrava a 1ª unidade, mas o acordo era
-- gravado na clínica da franqueadora. A franqueadora não paga taxa a si mesma:
-- qualquer linha aqui é um acordo que devia estar numa unidade.
-- "No rows returned" = nenhum acordo no lugar errado.
select c.name as clinica, n.fee as taxa, n.kind as tipo, n.percent, n.amount_cents, n.active,
       n.updated_at, p.full_name as gravado_por
  from public.network_fees n
  join public.clinics c on c.id = n.clinic_id
  left join public.profiles p on p.id = n.updated_by
 where c.type = 'franchisor'
 order by n.updated_at;
