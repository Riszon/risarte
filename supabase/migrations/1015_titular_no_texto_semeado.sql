-- =============================================================================
-- 1015 — TITULAR no texto que as migrações SEMEARAM (OC-00083, H1)
--
-- A troca de "colaborador" por "titular" no código pegou 166 pontos em 39
-- arquivos. A conferência NA TELA achou o que faltava, e o achado é o de
-- sempre nesta casa: **código viaja sozinho, dado não** (CLAUDE.md §0b).
--
-- O texto da apresentação (1010) e o da proposta (1014) não moram no código —
-- moram numa TABELA, semeados por aquelas migrações. Trocar o arquivo .sql
-- antigo não mudaria banco nenhum: migração já aplicada não roda de novo, e
-- editá-la é proibido. Por isso a correção é esta migração nova.
--
-- ⚠️ SÓ MEXE NO PADRÃO DA REDE, E SÓ SE O TEXTO AINDA FOR O ORIGINAL.
-- Quem personalizou a apresentação ou a proposta de uma empresa escreveu
-- aquilo com as palavras dele; reescrever por cima seria o sistema editando
-- texto de gente. As linhas com `lead_id` não nulo não são tocadas, e a da
-- rede só muda se ninguém tiver mexido nela.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A apresentação do programa (semeada pela 1010)
-- -----------------------------------------------------------------------------
update empresarial.presentation_templates
set sections = '[
    {"titulo":"O que é o Risarte Empresarial",
     "corpo":"Um programa de saúde bucal para os titulares da sua empresa e seus dependentes, atendido na rede Risarte Odontologia. Não é um plano de reembolso: o atendimento acontece nas nossas unidades, com a nossa equipe."},
    {"titulo":"O que o titular ganha",
     "corpo":"Avaliação completa sem custo, procedimentos preventivos cobertos e desconto em todo o tratamento. O dependente entra nas mesmas condições."},
    {"titulo":"O que a empresa ganha",
     "corpo":"Um benefício de custo previsível, que a equipe usa de verdade. Dor de dente é uma das maiores causas de falta não planejada — e é a mais fácil de prevenir."},
    {"titulo":"Responsabilidade social",
     "corpo":"Parte do programa se converte em atendimento social. A empresa participa disso junto com a Risarte, e recebe o relatório do que foi gerado."},
    {"titulo":"Como funciona na prática",
     "corpo":"A empresa envia a lista de titulares, nós fazemos o pré-cadastro e a nossa equipe entra em contato com cada pessoa para agendar a primeira consulta. A empresa não precisa administrar nada."},
    {"titulo":"Investimento",
     "corpo":"Mensalidade por titular, com a empresa podendo pagar integral, parcial ou deixar por conta do titular. Há também a opção de valor fixo por empresa, usada por sindicatos e associações."}
  ]'::jsonb
where lead_id is null
  -- A prova de que ninguém mexeu: o texto ainda é o da semente.
  and sections::text like '%colaboradores da sua empresa%';

-- -----------------------------------------------------------------------------
-- 2) O texto da proposta (semeado pela 1014, hoje mesmo)
-- -----------------------------------------------------------------------------
update empresarial.proposal_templates
set sections = '[
    {"titulo":"O que está incluído",
     "corpo":"Avaliação clínica completa e plano de tratamento para cada titular e dependente, procedimentos preventivos cobertos pelo programa e desconto em todo o tratamento realizado na rede Risarte Odontologia."},
    {"titulo":"Como o titular é atendido",
     "corpo":"O atendimento acontece nas unidades Risarte, com a nossa equipe. Não é reembolso: a pessoa agenda, é atendida e o programa já está aplicado no orçamento dela."},
    {"titulo":"Como começa",
     "corpo":"A empresa envia a lista de titulares, nós fazemos o pré-cadastro e entramos em contato com cada pessoa para agendar a primeira consulta. A empresa não precisa administrar nada."},
    {"titulo":"Acompanhamento",
     "corpo":"A empresa recebe relatórios de uso do programa e da economia gerada para a equipe, além do relatório do atendimento social do qual participa."}
  ]'::jsonb
where lead_id is null
  and sections::text like '%para cada colaborador e dependente%';

-- -----------------------------------------------------------------------------
-- 3) Os passos da implantação, se guardarem a palavra em alguma nota
-- -----------------------------------------------------------------------------
-- Nota escrita por gente NÃO é tocada: só o que o sistema semeou. Se nenhuma
-- linha casar, não há o que corrigir — e isso é resposta, não silêncio.
comment on table empresarial.proposal_templates is
  'Texto da proposta comercial. lead_id NULL = modelo da rede. A 1015 trocou '
  '"colaborador" por "titular" no modelo da rede, sem tocar no que cada '
  'empresa tiver personalizado.';
