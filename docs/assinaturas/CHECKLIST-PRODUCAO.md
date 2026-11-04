# Assinatura digital — checklist para ligar na produção (ZS8)

> Escrito depois do **teste real no sandbox da ZapSign** (03 e 04/11/2026, pelo
> site do treino): contrato de prestação ao paciente (ASS-000049), contrato de
> adesão com o Consultor RisLife assinando (ASS-000051), envio em dobro
> (ASS-000050), cancelamento, reenvio como novo (ASS-000052), recusa e
> vencimento. Cada item abaixo diz **quem faz** e **por quê**.

Legenda: ☐ a fazer · ✅ feito

---

## 1. Na conta ZapSign de VERDADE (o dono)

- ☐ **Plano API contratado.** Sem ele não há token para o sistema enviar.
- ☐ **Ligar "Bloquear assinatura fora da ordem definida"** (Configurações →
  Organização → Preferências da conta). **Provado no sandbox:** com ela
  desligada, a testemunha conseguiu assinar ANTES do paciente (ASS-000049). A
  ordem que o sistema manda (paciente → testemunhas → Risarte) vira só
  sugestão. **Ligar também na conta do sandbox** (é a do treino).
- ☐ **Cadastrar o retorno (webhook)** para a produção:
  URL `https://risarte.vercel.app/api/webhooks/zapsign`, eventos
  `doc_signed`, `doc_refused`, `doc_expired`, `doc_deleted`, com o cabeçalho
  `x-riszon-webhook-secret` = o mesmo valor de `ZAPSIGN_WEBHOOK_SECRET` da
  Vercel da produção. **O painel da ZapSign não tem campo de cabeçalho:** o
  cadastro é pela API (como foi feito no sandbox em 02/11; ver
  `docs/PRODUCAO-ONLINE.md`). Sem o retorno, o pacote nunca sai de "Enviado".

## 2. Na Vercel do projeto de PRODUÇÃO (o dono)

| Variável | Tipo | Valor |
|---|---|---|
| `ZAPSIGN_API_TOKEN` | Secret | o token da conta de verdade |
| `ZAPSIGN_ENV` | Config | `production` |
| `ZAPSIGN_WEBHOOK_SECRET` | Secret | um texto longo e aleatório (o mesmo do cabeçalho do webhook) |
| `CRON_SECRET` | Secret | ✅ já cadastrado (31/10) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Secret / Config | ver o item 3 |

Depois de salvar: **republicar sem o cache** (variável é lida na montagem).

## 3. E-mail (o dono)

- ☐ Conta na Resend, domínio de envio verificado (registros DNS que ela pedir),
  `RESEND_API_KEY` e `EMAIL_FROM` na Vercel.
- **Sem isso, três coisas ficam na fila e não saem:** a cópia assinada ao
  paciente (vista no teste: ASS-000049 entrou na fila, "pendente"), o alerta de
  consumo do plano e o relatório mensal. Nada se perde: sai quando o e-mail for
  ligado.

## 4. No sistema da produção, pela tela (o dono)

- ☐ **Razão social de cada unidade** (Administração → Clínicas → Editar). Hoje
  0 de 3: **nenhum documento de paciente sai** até cadastrar.
- ☐ **RG (e nacionalidade) na ficha de Risartano de quem assina o contrato de
  adesão pela Risarte** — o Consultor RisLife responsável; sem consultor
  responsável, quem envia (hoje, o titular). Sem o RG o envio para e diz o que
  falta.
- ☐ **CPF válido e WhatsApp dos Risartanos que serão testemunhas.** Na produção
  2 têm CPF inválido (RIS-000009, RIS-000016). **Visto no sandbox:** quem não tem
  celular no cadastro tem de digitar um na tela da ZapSign antes de assinar.
- ☐ **Assinaturas → Configurações:** limite mensal do plano (para o alerta de
  80%/100%), destinatários do relatório mensal, prazos.
- ☐ **Textos provisórios:** TCLE, Orçamento aprovado e Autorização de imagem
  saem com a marca d'água "TEXTO PROVISÓRIO" até o texto final ser aprovado e o
  modelo desmarcado (Assinaturas → Configurações → Modelos). Falta também o
  termo específico de uso de imagem (decisão B2).

## 5. Migrações

- ✅ **0361** (aplicada na produção em 04/11/2026; o mesmo documento não é assinado duas vezes — AP108).
- ✅ **0359** (aplicada na produção em 04/11/2026; o aviso da ZapSign não desfaz o envio — a corrida achada no teste;
  ver o item 7). Rodar na produção antes do primeiro envio de verdade.

## 6. O primeiro envio de verdade (roteiro curto)

1. Escolher um documento curto (o TCLE) e um paciente que concorde em testar
   (ou o próprio dono como paciente, com o CPF dele).
2. Enviar pela ficha → aba Documentos → "Enviar para assinatura".
3. Abrir o link, assinar ("Desenhar" não pede código; "Digitar" pede um código
   por e-mail).
4. Conferir na ficha que o pacote mudou sozinho para "Parcialmente assinado" e,
   no fim, "Assinado" — é a prova de que o retorno (webhook) está chegando.
5. Abrir o pacote e baixar o PDF assinado (fica guardado no sistema).

## 7. O que o teste real mostrou (e o que foi feito)

| Achado | Situação |
|---|---|
| **Corrida no envio:** o aviso "documento criado" da ZapSign chegou 14 ms depois de o envio gravar "enviado" e gravou "rascunho" por cima (ASS-000050). O pacote some de "aguardando" e não deixa cancelar nem reenviar. | ✅ corrigido na **0359** (a leitura trava o pacote) + o envio deixa no rastro quando a gravação não pega. Provado nas duas ordens. |
| **Ordem não obrigatória** na ZapSign (testemunha assinou antes do paciente). | ☐ preferência da conta (item 1). |
| **O mesmo contrato pode ser enviado duas vezes** ao mesmo paciente, sem aviso (ASS-000049 e ASS-000050 abertos juntos). Os dois poderiam ser assinados. | ✅ resolvido na **0361** (0.394.0, AP108): aberto bloqueia com "Cancelar o anterior e enviar este"; já assinado avisa e pede confirmação. |
| **Cancelar** pelo sistema aparece ao paciente, na ZapSign, como "Esse documento foi **recusado**! O emissor foi notificado sobre sua recusa". | ⚠️ é o texto da ZapSign (o cancelamento é feito pela recusa da API). Avisar o paciente por WhatsApp ao cancelar. |
| Depois do cancelamento a ZapSign mandou um aviso do tipo `doc_signed` com a situação "recusado". | ✅ o sistema ignorou (pacote já fechado). Fica registrado. |
| Marcar como assinado sem assinar | O **pacote** não: só o retorno da ZapSign marca "assinado". A **venda** e o **selo do Empresarial** têm o marcador manual de propósito (contrato assinado no papel). |
| Avisos aos Risartanos que assinam | ✅ cada um recebeu "É a sua vez de assinar" na sua vez (testemunhas, representante), e quem enviou recebeu "Pacote assinado por todos" / "Link de assinatura venceu". |
| O PDF na tela da ZapSign | ✅ legível, com as fontes certas (o "não visto" do AP89). |
