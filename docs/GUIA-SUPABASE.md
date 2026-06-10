# Guia: criar as contas Supabase e GitHub (passo a passo)

Este guia é para o proprietário. Leva cerca de 10 minutos. Crie as duas contas
com o **seu e-mail principal da empresa** — elas serão as donas do código e dos
dados de pacientes.

## Parte 1 — Supabase (banco de dados, logins e arquivos)

1. Acesse **https://supabase.com** e clique em **Start your project** / **Sign up**.
2. Cadastre-se com seu e-mail (ou "Continue with GitHub", se já tiver feito a Parte 2).
3. Confirme o e-mail de verificação que chegar na sua caixa de entrada.
4. Dentro do painel, clique em **New project**:
   - **Name:** `risarte`
   - **Database password:** clique em **Generate a password** e **guarde essa senha
     em local seguro** (gerenciador de senhas). Ela é a chave-mestra do banco.
   - **Region:** **South America (São Paulo)** — importante para a LGPD.
   - Plano: **Free**.
5. Aguarde 1–2 minutos até o projeto ficar pronto.
6. Vá em **Project Settings (engrenagem) → API** e copie dois valores:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`)
   - **anon public key** (um código longo)
7. Envie esses dois valores para o Claude no chat (eles não são secretos — são as
   chaves "públicas" do projeto; a segurança real é feita pelas regras RLS no banco).

## Parte 2 — GitHub (cópia de segurança do código)

1. Acesse **https://github.com** e clique em **Sign up**.
2. Use o mesmo e-mail da empresa. Escolha um nome de usuário (ex.: `risarte-odontologia`).
3. Confirme o e-mail de verificação.
4. Pronto — o Claude cuidará de criar o repositório e enviar o código.

## O que NUNCA compartilhar

- A **Database password** do Supabase (do passo 4).
- A chave **service_role** do Supabase (aparece na mesma tela da anon key —
  esta é secreta e dá acesso total ao banco).
- Sua senha do GitHub.

O Claude nunca vai pedir esses três itens no chat.
