-- 0244 — A TRAVA DE CPF REPETIDO PASSA A ENXERGAR O CPF SEM PONTUAÇÃO
--
-- Achado pelo teste ponta a ponta (item 1 de docs/CORRECOES-TESTES.md).
--
-- O CPF é guardado com máscara (`123.456.789-09`) e a trava contra cliente
-- repetido era um índice único sobre esse TEXTO. Para o banco,
-- `123.456.789-09` e `12345678909` eram duas pessoas diferentes — provado no
-- banco de teste: o mesmo CPF sem pontuação foi ACEITO como cliente novo.
--
-- Hoje isso não quebra nada porque todo cadastro passa pela tela, e a tela
-- sempre aplica a máscara. Ou seja: a regra funcionava por HÁBITO DO CAMINHO,
-- não por garantia. Qualquer porta nova — importação de planilha, ASAAS,
-- ZapSign, integração futura — que grave o número puro cria um paciente
-- duplicado na rede, que é exatamente o que "cliente é único na rede" existe
-- para impedir. Duplicado desses parte histórico clínico e financeiro em dois,
-- e ninguém descobre até alguém procurar o paciente e achar dois.
--
-- Conferido na PRODUÇÃO antes de escrever: 40 clientes com CPF, todos com
-- pontuação, ZERO que ficariam duplicados ao ignorar a máscara. O índice entra
-- sem conflito. (Se algum dia esta migração falhar aqui, a falha É a
-- informação: existe duplicado escondido, e ele precisa ser resolvido por
-- gente antes.)
--
-- REUSA `public.cpf_digits`, que já existe desde a 0078 e faz exatamente esta
-- normalização. Criar uma segunda função igual seria manter duas réguas para a
-- mesma regra — e é assim que elas passam a divergir. (A primeira versão desta
-- migração tentou recriá-la e o `check-migrations.mjs` barrou: mudar o nome do
-- parâmetro sem `drop function` viraria sobrecarga silenciosa.)

-- Fora o antigo, entra o novo. Trocar em vez de somar: manter os dois deixaria
-- a régua velha decidindo em paralelo.
drop index if exists public.clients_cpf_unique;

create unique index if not exists clients_cpf_digits_unique
  on public.clients (public.cpf_digits(cpf))
  where cpf is not null;

comment on index public.clients_cpf_digits_unique is
  'Cliente é único na rede pelo CPF — ignorando a pontuação. A máscara é '
  'formato de tela; a identidade é o número.';
