# WhatsApp pelo riSZon — passo a passo da integração (WhatsApp Cloud API)

*Escrito em 03/11/2026, a pedido do dono, como parte do AP94 (o pedido de
"enviar o link pelo próprio riSZon", "automatizar envios" e "auxiliar no
follow-up"). Plano geral: `docs/comercial/AP94-PLANO.md`. **Decisões W1–W4
(§6) aguardando o dono.** Nada foi programado ainda.*

---

## 1. O que muda, em uma frase

**Hoje o riSZon abre o WhatsApp da pessoa com a mensagem pronta** (link
`wa.me`, em ~15 telas: aniversariantes, Comercial, assinaturas, Empresarial,
inadimplentes, Indica, Ortodontia — `src/lib/whatsapp.ts`); quem aperta
"enviar" é a pessoa, no celular ou no WhatsApp Web dela. **Com a integração, o
próprio riSZon envia** pelo número oficial da Risarte, guarda se a mensagem
foi entregue e lida, e recebe o "SAIR" de quem não quer mais mensagens.

Analogia: hoje o sistema **escreve a carta e entrega na mão do funcionário
para ele pôr no correio**; depois, o sistema **tem a própria caixa de
correio**, com aviso de recebimento.

> ⚠️ Não confundir com o WhatsApp da **ZapSign**: o envio do link de
> assinatura por WhatsApp é da ZapSign, cobrado no plano dela, e continua
> como está.

---

## 2. As regras do WhatsApp que valem para nós (política da Meta + LGPD)

1. **A empresa só começa a conversa com MODELO APROVADO.** Mensagem que a
   Risarte manda por iniciativa própria (convite, lembrete, follow-up) tem de
   ser um *modelo* (texto fixo com lacunas, ex.: "Olá {{1}}, sua apresentação
   é {{2}}: {{3}}"), aprovado pela Meta antes — leva de minutos a 24 h.
2. **Texto livre só nas 24 h depois que o cliente escreve.** Se o cliente
   responde, abre-se uma janela de 24 h em que dá para mandar qualquer texto;
   cada nova mensagem dele renova a janela.
3. **Consentimento (opt-in) antes.** A política diz que a empresa só pode
   mandar mensagem a quem deu o número **e autorizou** receber. A Risarte
   decide como coleta (ficha do cliente, termo) — e tem de **guardar a prova**.
4. **"Parar" é obedecido na hora.** Quem pede para não receber mais tem de
   sair da lista, sem insistência.
5. **Nada de dado de saúde no WhatsApp.** A política proíbe enviar
   informação de saúde onde a lei exige proteção especial — e a LGPD trata
   dado de saúde como sensível. **Regra deste projeto:** a mensagem leva
   **nome, data, hora, link**; diagnóstico, plano, valores e resumo **nunca**.
   O que for sensível fica numa página do riSZon com link de acesso (o mesmo
   padrão dos links de assinatura).

---

## 3. Quanto custa (Meta, cobrança por mensagem desde 01/07/2025)

| Tipo de mensagem | Exemplo nosso | Preço no Brasil (aprox.) |
|---|---|---|
| **Utilidade** (modelo) | convite da apresentação, lembrete da véspera, "seu contrato chegou" | ≈ **US$ 0,0068** (≈ R$ 0,04) |
| **Marketing** (modelo) | follow-up "ficou alguma dúvida sobre o plano?", aniversário, campanha | ≈ **US$ 0,0625** (≈ R$ 0,35) |
| **Autenticação** (modelo) | código de acesso | ≈ US$ 0,0068 |
| **Atendimento** (texto livre na janela de 24 h) | resposta ao que o cliente perguntou | **1.000 por mês grátis** por número; depois, cobrado (desde 01/10/2026) |
| Mensagem que o cliente manda | — | grátis |

*Desde 01/10/2026, modelo de utilidade dentro da janela de 24 h também é
cobrado. Desde 01/07/2026 a cobrança pode ser em **reais** para empresa com
cadastro no Brasil. Os valores acima são da tabela da Meta citada em páginas
de terceiros; **conferir na tabela oficial (CSV/PDF na página de preços da
Meta) antes de ligar**. Quem decide se um modelo é "utilidade" ou "marketing"
é a Meta, na aprovação — follow-up de venda tende a cair em marketing.*

**Ordem de grandeza:** 300 convites + 300 lembretes + 300 follow-ups por mês
≈ US$ 4 + US$ 19 ≈ **R$ 130/mês**. Sem mensalidade, se for direto com a Meta
(W1).

---

## 4. O PASSO A PASSO — o que o dono faz (na Meta), e o que eu faço (no riSZon)

> 🔒 **Nenhuma senha, token ou chave passa por mim.** O que é segredo o dono
> cadastra direto na Vercel; o que eu preciso são só os **números de
> identificação** (ID do número, ID da conta), que não são segredo.

### Parte A — preparar (dono, uma vez; ~1 h de cliques + espera da Meta)

**A1. Escolher o número** (decisão W2).
- **Número novo** (chip só para isso): nunca usado no WhatsApp, ou apagado
  dele; precisa receber SMS ou ligação para o código. É o mais simples.
- **Ou o número que a Risarte já usa no WhatsApp Business** (o aplicativo do
  celular): a Meta permite **coexistência** — o número continua no celular
  E passa a enviar pelo riSZon. As respostas dos clientes continuam chegando
  no aplicativo. Exige o aplicativo atualizado e o celular em mãos no
  cadastro (parte do processo é no celular).

**A2. Portfólio empresarial da Risarte no Meta** —
[business.facebook.com](https://business.facebook.com). Se a Risarte já
anuncia no Instagram/Facebook, **já existe**: usar o mesmo. Conferir que tem
razão social, CNPJ, site e e-mail do domínio.

**A3. Verificar a empresa** — *Configurações do negócio → Central de
segurança → Verificação da empresa*. Pede cartão CNPJ, comprovante de
endereço e o domínio do site. **Leva dias.** Sem ela dá para começar, mas: o
nome "Risarte" não aparece para o cliente (aparece só o número) e o envio
fica limitado (na ordem de **250 pessoas por dia** iniciadas pela empresa —
conferir no painel). Comece por aqui, porque é o passo que mais demora.

**A4. Conta de desenvolvedor e o aplicativo** —
[developers.facebook.com](https://developers.facebook.com) com o login de
quem administra o portfólio → *Meus aplicativos → Criar aplicativo* → caso de
uso **WhatsApp** → escolher o portfólio da Risarte. Nome sugerido:
**"riSZon"**. (W3: um segundo aplicativo, **"riSZon Treino"**, só com o
número de teste que a Meta dá — ver A10.)

**A5. Pôr o número real** — no aplicativo: *WhatsApp → Configuração da API →
Adicionar número de telefone*:
- **Nome de exibição:** "Risarte Odontologia" (precisa bater com a marca; a
  Meta aprova; pode trocar até 10 vezes em 30 dias).
- **Código** por SMS ou ligação no número.
- **PIN de verificação em duas etapas** (6 dígitos) — **obrigatório**; anotar
  num lugar seguro (sem ele, não se registra o número de novo).

**A6. Forma de pagamento** — *WhatsApp Manager → Faturamento*: cartão da
Risarte, moeda **BRL**. Ligar o **alerta de gasto** (sugestão: R$ 300/mês).

**A7. Usuário do sistema + token permanente** — *Configurações do negócio →
Usuários → Usuários do sistema → Adicionar*: nome **"riszon"**, função
Administrador. Depois *Atribuir ativos*: o aplicativo "riSZon" e a conta do
WhatsApp, com **controle total**. *Gerar token* com as permissões
`whatsapp_business_messaging`, `whatsapp_business_management` e
`business_management`, **sem validade**. **Não me mande o token.**

**A8. Anotar e me mandar (não são segredo):**
- **ID do número de telefone** (*WhatsApp → Configuração da API*);
- **ID da conta do WhatsApp Business** (mesma tela).

**A9. Cadastrar na Vercel** (projeto de **produção**; Secret onde indicado):

| Variável | O que é | Tipo |
|---|---|---|
| `WHATSAPP_TOKEN` | o token permanente do A7 | **Secret** |
| `WHATSAPP_APP_SECRET` | *Aplicativo → Configurações → Básico → Chave secreta* (o riSZon usa para conferir que o aviso veio mesmo da Meta) | **Secret** |
| `WHATSAPP_PHONE_NUMBER_ID` | o ID do A8 | normal |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | o ID do A8 | normal |
| `WHATSAPP_VERIFY_TOKEN` | uma frase qualquer inventada por você (vai igual no A11) | **Secret** |

Depois: **republicar** (com "Use existing Build Cache" desmarcado).

**A10. Treino** — no projeto **risarte-treino**: as mesmas variáveis, mas do
aplicativo "riSZon Treino", com o **número de teste da Meta** e só o **seu
celular** cadastrado como destinatário de teste (a Meta aceita até 5).
Assim o treino **nunca manda mensagem a paciente de verdade**. Até isso
existir, o treino roda com `WHATSAPP_ENV=fake` (um WhatsApp de mentira, como
a ZapSign falsa).

### Parte B — eu programo (fase WA1; depois do OK nas decisões W1–W4)

- **Migração** (próximo número livre): consentimento no cliente
  (`whatsapp_opt_in_at`, quem registrou, `whatsapp_opt_out_at`); tabela das
  mensagens enviadas (cliente, modelo, situação **enviada → entregue → lida /
  falhou e por quê**, quem mandou, quando) — **sem o texto com dado de
  saúde**, porque não haverá; auditoria.
- **`src/lib/whatsapp/`**: enviar modelo, enviar texto na janela, ler a
  situação; modo `fake` para o treino; nenhum envio sem consentimento ou com
  "SAIR" registrado (regra no banco, não só na tela).
- **Rota `/api/webhooks/whatsapp`**: recebe da Meta "entregue", "lida",
  "falhou" e as respostas; **confere a assinatura** (`X-Hub-Signature-256` com
  o `WHATSAPP_APP_SECRET`); "SAIR"/"PARAR" registra a recusa na hora.
- **Tela Administração → WhatsApp**: mostra se está configurado, o número, o
  nome aprovado, os modelos e a situação de cada um.
- **O botão de sempre fica esperto**: onde hoje há "Enviar no WhatsApp"
  (`wa.me`), se a integração está ligada e o cliente autorizou, o riSZon
  envia sozinho e mostra ✓✓; se não, abre o `wa.me` como hoje.
- Réguas, manual, changelog, versão — como em toda entrega.

### Parte C — os modelos de mensagem (eu escrevo, o dono submete)

Eu entrego os textos prontos; o dono cola em *WhatsApp Manager → Modelos de
mensagem → Criar* (categoria, idioma **Português (BR)**, texto). Primeiros
três:

| Nome | Categoria | Texto |
|---|---|---|
| `apresentacao_convite` | Utilidade | Olá, {{1}}! Sua apresentação do plano de tratamento na Risarte está marcada para {{2}}, às {{3}}. Para entrar na chamada: {{4}} |
| `apresentacao_lembrete` | Utilidade | Olá, {{1}}! Lembrete: sua apresentação na Risarte é amanhã, {{2}}, às {{3}}. Link: {{4}}. Precisa remarcar? Responda esta mensagem. |
| `followup_plano` | Marketing (provável) | Olá, {{1}}! Aqui é {{2}}, da Risarte. Ficou alguma dúvida sobre o seu plano de tratamento? Estou à disposição por aqui. Para não receber mais mensagens, responda SAIR. |

### Parte D — ligar (dono + eu)

**D1.** Webhook: no aplicativo, *WhatsApp → Configuração → Webhook*: URL
`https://risarte.vercel.app/api/webhooks/whatsapp`, token de verificação =
o `WHATSAPP_VERIFY_TOKEN`; assinar o campo **`messages`**. (Só depois de a
rota estar publicada — eu aviso.) No treino, o mesmo com
`risarte-treino.vercel.app` no aplicativo de treino.
**D2.** Eu confiro de fora: a rota responde à verificação da Meta e recusa
aviso sem assinatura.
**D3.** Teste no treino com o **seu** celular: convite → chega → ✓✓ →
responder "SAIR" → o riSZon registra e para de enviar.
**D4.** Produção: primeiro envio real a um cliente que autorizou.

---

## 5. As fases

| Fase | Entrega | Depende de |
|---|---|---|
| **WA1** | Base: consentimento, envio, situação, webhook, "SAIR", tela de Administração, botões espertos (com volta ao `wa.me`) | A1–A10, W1–W4 |
| **WA2** | Convite e lembrete da apresentação do Meet (junto da fase IA3 do AP94: o convite sai na hora de marcar; o lembrete, na véspera, por rotina) | WA1, IA3 |
| **WA3** | Follow-up assistido: a IA sugere o texto (fase IA4); dentro da janela de 24 h vai como texto livre; fora, pelo modelo `followup_plano` — **quem aperta enviar é a pessoa** | WA1, IA4 |
| depois | Respostas dos clientes **dentro do riSZon** (caixa de entrada) — só se o W4 pedir | WA1 |

---

## 6. Decisões do dono

| # | Pergunta | Recomendação |
|---|---|---|
| **W1** | Direto com a Meta ou por um provedor (Blip, Zenvia, Take etc.)? | **Direto com a Meta (Cloud API).** Sem mensalidade, o riSZon já tem o desenho pronto (igual ao webhook da ZapSign). Provedor faz sentido se a Risarte quiser a caixa de entrada pronta deles e suporte em português — com mensalidade. |
| **W2** | Qual número? Um central da Risarte ou um por unidade? Novo ou o atual (coexistência)? | **Um número central, o que a Risarte já usa no WhatsApp Business, em coexistência** — o cliente já conhece o número e as respostas continuam chegando no celular. Um por unidade multiplica cadastro, verificação e modelos. |
| **W3** | Treino com número de teste da Meta (só o seu celular recebe)? | **Sim**, e `WHATSAPP_ENV=fake` até ele existir — o treino nunca fala com paciente real. |
| **W4** | As respostas dos clientes ficam onde? | **No celular/WhatsApp Business, como hoje** (coexistência). O riSZon só envia, mostra ✓✓ e registra o "SAIR". Caixa de entrada no riSZon é outra obra, para depois. |

**Uma regra antiga que esta integração NÃO muda sem você dizer:** na
assinatura digital (ZS6) você decidiu que **lembrete nunca vai ao cliente**.
O lembrete da apresentação (WA2) é outra coisa e precisa do seu OK próprio.

---

## 7. Fontes (lidas em 03/11/2026)

- Meta — primeiros passos da Cloud API:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- Meta — preços por mensagem (e as mudanças de 2026):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta — nome de exibição:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
- Política do WhatsApp Business (consentimento, saúde, "parar"):
  https://whatsappbusiness.com/pt-br/policy/
- Coexistência (mesmo número no aplicativo e na API):
  https://developers.telnyx.com/docs/messaging/whatsapp/coexistence
