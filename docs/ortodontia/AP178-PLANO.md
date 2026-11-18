# AP178 — A tela barra quem é da Franqueadora numa unidade (prioridade alta)

**Situação:** plano para o dono aprovar. Nada foi mudado ainda.

## O problema, em uma frase

O banco deixa a equipe da Franqueadora agir nas unidades do escopo dela, mas
algumas telas conferem a permissão só pela função **dentro da unidade**, e quem
mora na Franqueadora não tem função lá.

## O que foi visto no treino (17-18/11/2026)

| Quem | Onde | O que aconteceu | O banco deixa? |
|---|---|---|---|
| Consultor de teste (Franqueadora, com acesso à Unidade Teste) | Cockpit → Fechamento | Sem "Enviar para assinatura": "A situação da assinatura digital não aparece para a sua função" | Sim (`signature_can`) |
| Financeiro de teste (Financeiro da Franqueadora) | Ortodontia → Mensalidades, com a Unidade Teste ativa | Mandado para "Atenção" | Sim (`ortho_can_see_money`) |
| Financeiro de teste | Mensalidades pela "Rede toda" → Dar baixa | "Você não pode dar baixa nesta mensalidade." | Sim (`ortho_can_settle`) |

## A causa

`pode(session, capacidade, clinicId)` (`src/lib/auth.ts`) monta a lista de
funções só com `rolesByClinic[clinicId]`. O banco faz diferente:

- **Assinaturas:** `signature_can` soma as funções da Franqueadora quando a
  unidade está no escopo da pessoa (`user_full_access_clinic_ids`).
- **Ortodontia:** `ortho_can_settle` e `ortho_can_see_money` aceitam o
  Financeiro da Franqueadora e a equipe da rede em **qualquer** unidade.

A AP158 já resolveu isso no detalhe e na lista dos pacotes, perguntando ao
banco (`src/lib/signatures/acesso-no-banco.ts`). O Fechamento, a ficha e o
envio ficaram de fora.

## A correção proposta (sem migração)

1. **Assinaturas: a tela pergunta ao banco**, pelo mesmo `podeNoBanco` da AP158:
   - o Fechamento do cockpit (`/comercial/[cliente]`) e o da apresentação
     (`/apresentacao/[cliente]`): mostrar "Enviar para assinatura" e a situação
     do contrato;
   - a aba Documentos da ficha (`canSendSignature`, `canSeeSignatures`);
   - a conferência de quem envia, no servidor (`envio-dados.ts`,
     `send-empresa.ts`, `send.ts`).
2. **Ortodontia: espelho do banco** em `src/lib/ortodontia/access.ts`:
   - `canSettleOrtho`: o Financeiro da Franqueadora e a equipe da rede passam
     em qualquer unidade, conferindo a permissão pela função que eles têm
     (como o banco faz);
   - `canViewOrthoMoney`: o mesmo, para a tela não os mandar para "Atenção".
3. **Uma régua nova** (teste automático) que monta uma sessão de Consultor e
   de Financeiro da Franqueadora e exige: envio liberado na unidade do escopo,
   baixa da ortodontia liberada. A régua tem de reprovar primeiro, com o código
   de hoje, para valer.
4. **Varredura dos outros 25 pontos** que chamam `pode(…, unidade)`: cobrança
   (emitir, cancelar), financeiro (lançar), estoque, compras, metas e a
   Central. Para cada um, comparo com a regra do banco e listo numa tabela.
   **Nesta entrega não mudo nenhum deles**: os que estiverem divergentes viram
   uma lista para você decidir, porque ali pode ser de propósito.

## O que a equipe percebe (manual)

- O Consultor e o Assistente Comercial da Franqueadora passam a enviar o
  contrato pelo Fechamento do cockpit.
- O Financeiro da Franqueadora passa a dar baixa nas mensalidades da
  ortodontia, também com uma unidade escolhida no seletor.
- Atualizo as seções do manual de Assinaturas e de Ortodontia, a novidade no
  changelog e o Word.

## Antes de começar: uma consulta na produção (só leitura)

Para saber se o problema acontece lá hoje. Rodar no SQL Editor:

```sql
select r.role, c.type as onde, count(*) as pessoas
from public.user_clinic_roles_all r
join public.clinics c on c.id = r.clinic_id
where r.role in ('commercial_consultant', 'commercial_assistant', 'finance_franchisor')
group by 1, 2
order by 1, 2;
```

Se aparecer `franchisor` para o Consultor, a produção está com o defeito.

## Como provo

- A régua do item 3, reprovando antes e passando depois.
- No treino, pela tela: o Consultor de teste envia o contrato pelo Fechamento;
  o Financeiro de teste dá baixa numa mensalidade com a unidade escolhida. Isso
  exige dar de novo, só no treino, o acesso do Consultor de teste à Unidade
  Teste, e tirar no fim, como da outra vez.
- `npm run verificar`, `npm test`, `npm run lint`.

## Decisão sua

- **D1:** posso dar e tirar de novo o acesso do Consultor de teste à Unidade
  Teste, só no treino, para provar na tela? Recomendo que sim.

## Tamanho

Médio. Só código e teste, sem migração. Publica sem esperar o banco.
