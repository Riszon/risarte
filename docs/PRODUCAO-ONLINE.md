# riSZon no ar — produção e treino

Como o sistema está publicado e as armadilhas que já custaram tempo. Substitui a
memória local `risarte-producao-online` do Claude: memória local só existe num
PC, e este projeto é trabalhado em dois (ver `CLAUDE.md` §0e).

**Nenhum segredo neste arquivo.** Chaves e senhas ficam na Vercel, no Supabase e
nos `.env*.local` (fora do Git).

## Os dois endereços

| | Produção | Treino |
|---|---|---|
| Endereço | `https://risarte.vercel.app` | `https://risarte-treino.vercel.app` |
| Banco Supabase | `hvhbijctanrrkxhemlza` | `bsnptybalszjjbhxeejo` |
| Aparência | normal | faixa amarela + aba "TREINO" |
| `NEXT_PUBLIC_AMBIENTE` | **não definir** | `treino` |

- Vercel: equipe `ri-sz-on`. Os dois projetos publicam o **mesmo `main`**,
  automaticamente a cada push.
- Plano: estava em **Pro Trial** em 31/08/2026 — precisa virar Pro antes do fim
  do teste (o gratuito proíbe uso comercial).
- O que viaja entre os dois (código sim; migração por banco; dados e
  configuração nunca): `CLAUDE.md` §0b.

## Variáveis de ambiente (nomes, nunca valores)

| Variável | Tipo na Vercel | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Config | Só o **Project URL** (`https://<id>.supabase.co`), **sem** `/rest/v1/` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | Vai ao navegador por natureza; quem protege o dado é a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Só servidor; a única marcada como Secret |
| `NEXT_PUBLIC_AMBIENTE` | Config | Só no treino, valor `treino` |

## Armadilhas da Vercel

- **`NEXT_PUBLIC_*` é embutida na MONTAGEM.** Mudar o valor não muda o site:
  exige republicar **com "Use existing Build Cache" desmarcado**, senão a Vercel
  reaproveita o pacote antigo com o valor velho.
- **Variável `Secret` não pode ser lida depois**, nem pelo dono. Por isso as
  duas `NEXT_PUBLIC_` são **Config**.
- **O `/rest/v1/` no fim da URL do Supabase** custou horas na publicação
  (31/08/2026): o login batia em `…/rest/v1/auth/v1/token` e recebia 404. A
  tela de login dizia "e-mail ou senha incorretos" para qualquer falha;
  corrigido na v0.224.0 — hoje ela mostra a causa real.
- **Região da função = São Paulo (`gru1`)**, em *Settings → Functions →
  Function Regions*. É configuração de painel (não há `vercel.json`), exige
  deploy novo depois de salvar e tem de ser conferida **nos dois projetos**.
  Em `iad1` o sistema ficava 6,5× mais lento. Como medir: `CLAUDE.md` §0d.
- **Fluid Compute ligado.** Ao criar estado no nível do módulo em código de
  servidor, conferir que não guarda dado de pessoa (`CLAUDE.md` §0d).

## Conferido antes de publicar (31/08/2026)

Contra o banco de verdade: com a chave pública não se lê nenhuma tabela;
auto-cadastro **fechado** (`Signups not allowed for this instance`); todos os
baldes de arquivo privados.

## Pendente antes de abrir para a equipe

Efetivar o plano Pro (Vercel e Supabase), backups diários, *leaked password
protection* e verificação em duas etapas na conta do Supabase.

## Guias clique a clique (artefatos)

- *Publicar o riSZon* — https://claude.ai/artifact/HVuycChie2sTrcxYduUJUL
- *Lançamento do riSZon* — https://claude.ai/artifact/6ay3hP8g3S9Pd78tZm6mhY

## A completar

Montado em 18/09/2026 no PC Administrador **a partir do que o repositório já
registrava** (`ESTADO_DO_PROJETO.md`, "O SISTEMA ESTÁ PUBLICADO", e `CLAUDE.md`
§0b/§0d). A memória `risarte-producao-online` original está só no outro PC: na
próxima sessão lá, comparar com este arquivo, trazer para cá o que faltar e
então apagar a memória local.
