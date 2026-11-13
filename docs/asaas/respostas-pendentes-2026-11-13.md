# Respostas ao Jeferson — 13/11/2026

## 1. Prova da entrega 1 (ASA3) no sandbox

Conta de teste de Londrina; pagador sem e-mail e sem celular (nada enviado).
Split para a **franqueadora (14,72%)** e para a conta de teste **"Fundo de
Propaganda Teste" (1,83%)** — este segundo caso só prova o fundo em carteira
própria, no futuro (hoje o fundo vai para a franqueadora, D6). Pix e boleto
pagos pela simulação do sandbox; cartão pela API com o cartão de teste do Asaas.

| Meio | Pago (R$) | Tarifa (R$) | Carteira | Devido (R$) | Liquidado (R$) | Diferença (R$) |
|---|---|---|---|---|---|---|
| Pix | 8,17 | 0,99 | franqueadora | 1,20 | 1,19 | 0,01 |
| Pix | 8,17 | 0,99 | fundo | 0,15 | 0,14 | 0,01 |
| Pix | 500,00 | 0,99 | franqueadora | 73,60 | 73,59 | 0,01 |
| Pix | 500,00 | 0,99 | fundo | 9,15 | 9,14 | 0,01 |
| Pix | 1.234,56 | 0,99 | franqueadora | 181,73 | 181,72 | 0,01 |
| Pix | 1.234,56 | 0,99 | fundo | 22,59 | 22,58 | 0,01 |
| Boleto | 500,00 | 0,99 | franqueadora | 73,60 | 73,59 | 0,01 |
| Boleto | 500,00 | 0,99 | fundo | 9,15 | 9,14 | 0,01 |
| Boleto | 987,65 | 0,99 | franqueadora | 145,38 | 145,37 | 0,01 |
| Boleto | 987,65 | 0,99 | fundo | 18,07 | 18,06 | 0,01 |
| Cartão | 500,00 | 10,44 | franqueadora | 73,60 | 73,59 | 0,01 |
| Cartão | 500,00 | 10,44 | fundo | 9,15 | 9,14 | 0,01 |
| Cartão | 1.234,56 | 25,05 | franqueadora | 181,73 | 181,72 | 0,01 |
| Cartão | 1.234,56 | 25,05 | fundo | 22,59 | 22,58 | 0,01 |

- **Como o Asaas arredonda: PARA BAIXO** (trunca no centavo). Nos casos que
  separam os dois modos: 1,19690 → 1,19; 145,37635 → 145,37; 18,06588 → 18,06;
  73,59604 → 73,59.
- **O repasse nunca passou do devido.** A diferença foi sempre de 1 centavo por
  carteira, a favor da unidade, dentro da tolerância de R$ 0,10.
- **De ponta a ponta no projeto de teste** (LDN-00069, Pix de R$ 6,00, 17% para
  a franqueadora): liquidado R$ 1,01 × devido R$ 1,02; taxa retida inteira, sem
  conta a pagar em dobro, razão liquidado.
- Detalhe completo: `docs/integracao-asaas.md`, seção 18.5.1.

## 2. Migração 0403 (parcelas lidas pela API)

**O que ASB, TSB e SDR conseguem ler hoje na produção:** pela API (fora da
tela), **o cadastro do paciente e as parcelas dele — vencimento, situação e
valor.** Medi no TREINO com a sessão de cada conta de teste (no LDN-00066: as 5
parcelas). Na produção eu não meço (o riSZon não deixa script tocar a
produção), mas as regras de leitura são as MESMAS, porque as mesmas migrações
rodaram nos dois bancos e a 0403 ainda não rodou na produção. Para conferir
você mesmo, rode no SQL Editor da produção (só leitura):

```sql
select policyname, qual from pg_policies
 where schemaname = 'public' and tablename = 'payment_installments';
```

Se aparecer `user_full_access_clinic_ids()` sem a 0403, ASB, TSB e SDR leem.

**A regra "nunca veem o atraso" da 4006 depende da 0403 para valer pela API?**
- **O selo, não:** a fonte de todo selo (`client_overdue_badges`) não devolve
  nada a esses papéis, nem pela API (provado no teste do projeto publicado).
- **Mas o atraso, sim:** lendo as parcelas (vencimento + situação), dá para
  deduzir que o paciente está em atraso. Então a regra só vale **por inteiro,
  também pela API, depois que a 0403 rodar na produção.**
- A 0403 está pronta (commit `7851f1d3`, só na main da pasta principal, sem
  push). Ao ser publicada, ela vira a **0.441.0** (a 0.440.0 ficou com a ASA3).
