# Roteiro da homologação do Asaas (ASA7, spec 21.2 item 6 e 21.7 item 5)

Versão de 18/11/2026. Este roteiro reúne **o que só a produção prova** e **o passo a passo de ligar a primeira unidade**. Nada aqui é feito sem o "pode" do dono na hora, item por item.

**Regras para todos os itens:**
- **Sempre a menor quantia** e um pagador da casa: o próprio dono ou um funcionário que topou, com o celular e o e-mail dele. Nunca um paciente.
- **Uma prova por vez.** Cada uma é anotada na seção E (data, valor, resultado e o identificador da cobrança no Asaas).
- **O dinheiro de prova volta pelo estorno**, e a tarifa do Asaas é o custo da prova. Antes de começar, a tela de tarifas da Central mostra quanto cada meio custa.
- **Se algo sair diferente do esperado, para tudo:** a unidade volta para "não ligada" (passo 8 da seção B), e nada mais é provado até a causa estar entendida.

---

## A. Antes da homologação (tudo isto já tem de estar pronto)

| # | O que | Quem | Onde se confere |
|---|---|---|---|
| A1 | A 4022 e todas as migrações do Asaas na produção | o dono roda; o riSZon confere de fora | Central › Rede › Produção do Asaas: a lista das migrações, todas "neste banco" |
| A2 | A confirmação do Asaas, por escrito, sobre o uso da chave da unidade pela franqueadora | o dono pede ao Asaas e anexa | o item "confirmação do Asaas" com o documento |
| A3 | O saldo mínimo da franqueadora | o dono | Central › Rede › Taxas da franquia |
| A4 | As cinco marcas de cobrança na matriz: ver, emitir e cancelar para o Gerente; ver e emitir para a Recepção | o dono, em Admin › Permissões | o item "permissões de cobrança" |
| A5 | O termo de privacidade publicado | o dono | Central › Rede › Cobrança e comunicação |
| A6 | A lista de IPs autorizados **desligada** no Asaas (não há IP fixo) | — | spec, ASA7: **nunca** ligar a lista sem IP fixo |

---

## B. Ligar a primeira unidade, passo a passo

Cada passo tem o risco e como desfazer. Se um passo falhar, os seguintes não começam.

| # | Passo | Quem | Risco | Como desfazer |
|---|---|---|---|---|
| B1 | **Ligar o interruptor da rede** (só com A1 a A5 completos), com o motivo | o dono (Admin Master) | Baixo: só permite **cadastrar** conta de produção; nenhuma unidade cobra | Desligar o interruptor, com motivo. O banco volta a recusar conta de produção |
| B1a | **Liberar a produção no servidor:** `ASAAS_ALLOW_PRODUCTION=sim` nas variáveis de **Production** da Vercel (projeto da produção) e uma nova publicação. Sem ela, o riSZon recusa a chave de produção ("ainda não estão liberadas") | com o "pode" do dono | Baixo: o banco e o interruptor continuam travando | Apagar a variável e publicar de novo |
| B2 | **Criar a chave de produção da unidade só com as permissões mínimas** (21.7: clientes, notificações, cobranças, estornos, parcelamentos e webhooks com "ler e escrever"; chargeback, chaves Pix, antecipação, extrato e dados da conta com "só ler"; o resto sem nenhuma permissão) | o franqueado, no painel do Asaas dele | Médio: se nascer com tudo liberado, a chave pode transferir dinheiro | Apagar a chave no painel do Asaas e criar outra |
| B3 | **Cadastrar a conta de produção na Central** (com o interruptor ligado, "Abrir o cadastro da conta" já cria a conta real, desde a 0.487.1; se a unidade tiver a conta de teste, desativá-la antes), **registrar o termo nela**, colar a chave e validar | o Gerente (depois do termo) ou o dono | Baixo: só lê os dados da conta | Desativar a conta na Central |
| B4 | **Desabilitar o débito** no painel do Asaas da unidade e marcar na Central | o franqueado; o dono marca | Baixo | Reabilitar no painel; a marca cai na prontidão |
| B5 | **Marcar a chave com as permissões mínimas**: o riSZon confere na hora (as três leituras proibidas têm de ser recusadas) | o dono | Se alguma for aceita, o item cai e o dono é avisado: **voltar ao B2** | — |
| B6 | **O levantamento** do que já existe no Asaas da unidade | o dono | Nenhum: só lê | — |
| B7 | **A prontidão completa** (os 11 itens) e **"Pronta para cobrar"** | o dono | Médio: a partir daqui, a unidade pode emitir | Desligar a unidade (B8) |
| B8 | **Desligar a unidade, se preciso.** As cobranças já emitidas e os boletos na mão dos pacientes **continuam pagáveis e dando baixa** (prova C10) | o dono | — | Ligar de novo pela prontidão |
| B9 | Ligar a criação automática de cobranças da unidade, **só depois das provas C1 a C4** | o dono | Médio: as cobranças passam a nascer sozinhas | Desligar a criação automática na Central |

---

## C. As provas que só a produção faz

| # | O que provar | Valor mínimo | Quem faz | O que se espera | Como desfazer |
|---|---|---|---|---|---|
| C1 | **O split real**: uma cobrança Pix e uma boleto, com as taxas da rede | R$ 10,00 cada | o Gerente emite, o dono paga | O Asaas reparte como o riSZon previu (a diferença máxima por meio, spec 18); o razão e o Painel de repasses batem | Estorno total pelo riSZon (o split volta junto) |
| C2 | **O cartão à vista e o parcelado**, com o split | R$ 10,00 à vista; 2× de R$ 10,00 | o dono, com o cartão dele | A baixa de cada parcela e o split rateado | Estorno total pelo riSZon |
| C3 | **A recusa do cartão pelo banco emissor** no parcelado (o sandbox só recusa dado inválido) | 2× de R$ 10,00 | o dono, com um cartão sem limite ou bloqueado | A recusa aparece; o paciente tenta de novo **no mesmo link**, sem parcelamento novo | Nada a desfazer (nada foi cobrado) |
| C4 | **O envio por WhatsApp** (o sandbox não dispara) e a mensageria do parcelado | a cobrança do C1 | o dono, com o próprio celular | A mensagem chega; a tarifa da mensageria aparece no extrato | Desligar o canal na régua |
| C5 | **O PDF do boleto sem login** (`bankSlipUrl`; no sandbox deu 504) | o boleto do C1 | o riSZon abre o link | Se abrir, a lista da forma 2 ganha "Baixar todos em PDF" (19.26.6) | — |
| C6 | **O estorno parcial do cartão no dia seguinte** (o sandbox recusou em 17/11 **e de novo em 18/11**, dois dias depois da aprovação) | R$ 5,00 de uma parcela do C2 | o Gerente pede, o dono confirma | O Asaas aceita a partir do dia seguinte; o pedido sai "Estornado" | — (é o próprio estorno) |
| C7 | **O token de ações críticas** no estorno do cartão, e **a repartição do estorno do parcelado** (o sandbox repartiu a parte de uma parcela; o "PENDING" de R$ 20,00 da parcela 2 continuava assim na releitura de 18/11) | o parcelado do C2 | o dono | Se o Asaas pedir o token, o riSZon mostra o pedido; a repartição bate com a previsão da tela | — |
| C8 | **O estorno recusado por falta de saldo** da franqueadora | R$ 10,00 | o dono, com o saldo abaixo do valor | A recusa clara, sem nada estornado pela metade | Repor o saldo e pedir de novo |
| C9 | **O boleto cancelado e pago mesmo assim** | R$ 10,00 | o Gerente cancela, o dono paga o código guardado | O alerta do boleto cancelado pago (4015) e a divergência na conciliação | Estorno total pelo riSZon |
| C10 | **Desligar a unidade no meio do piloto** | o boleto do C9 ou outro de R$ 10,00 emitido antes | o dono | A cobrança emitida antes continua pagável e dá baixa | Ligar a unidade de novo |
| C11 | **A conciliação na produção**: uma cobrança paga sem o aviso (recebida em dinheiro no painel do Asaas) | R$ 10,00 | o dono, no painel | Na noite seguinte, "Paga no Asaas, aberta no riSZon"; reprocessado o aviso, ela fecha sozinha (provado no sandbox em 18/11, spec 21.8) | Estorno total |
| C12 | **A sonda da chave** na produção | — | o riSZon, no domingo | As três leituras proibidas recusadas | Se alguma passar: B2 |
| C13 | **O limite diário de criação de cobranças**: confirmar com o Asaas o número da conta da unidade, antes de ligar a criação automática | — | o dono pergunta ao Asaas | O número anotado; a criação automática cabe nele com folga | — |
| C14 | **A tokenização do cartão** (para a ASA4B) | — | o dono, com o comercial do Asaas | A tokenização habilitada na conta | — |

---

## D. Depois da homologação

- O relatório com cada prova (seção E), assinado pelo dono.
- Só então, B9 (a criação automática) e a próxima unidade, uma por vez.

## E. Registro das provas

| # | Data | Valor | Identificador no Asaas | Resultado | Desfeito em |
|---|---|---|---|---|---|
| | | | | | |
