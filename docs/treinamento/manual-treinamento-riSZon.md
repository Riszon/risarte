# Manual de Treinamento — riSZon

> **Como este material foi produzido.** Tudo aqui saiu do código deste
> repositório, por extração automática (rotas, itens de menu, condições de
> acesso, mensagens de tela, ações de servidor) e leitura dos arquivos citados.
> Onde não foi possível confirmar, está escrito **"Não identificado no código
> analisado"** — e não substituído por descrição genérica.
>
> Números desta análise: **82 rotas**, **28 itens de menu**, **179 mensagens de
> tela**, **384 ações de servidor**, **16 papéis**. Ver
> [`evidencias-riSZon.md`](evidencias-riSZon.md).
>
> **Limitação declarada:** a análise é do código, não da aplicação em execução.
> Posições visuais (onde cada botão fica na tela) **não foram confirmadas** e
> precisam de validação na interface. Ver [`lacunas-riSZon.md`](lacunas-riSZon.md).

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Início rápido](#2-início-rápido)
3. [Visão geral do riSZon](#3-visão-geral-do-riszon)
4. [Perfis, papéis e funções](#4-perfis-papéis-e-funções)
5. [Matriz de permissões](#5-matriz-de-permissões)
6. [Scripts de treinamento por função](#6-scripts-de-treinamento-por-função)
7. [Mapeamento da interface](#7-mapeamento-da-interface)
8. [Fluxos principais de uso](#8-fluxos-principais-de-uso)
9. [Erros, falhas e mau funcionamento](#9-erros-falhas-e-mau-funcionamento)
10. [Mensagens do sistema](#10-mensagens-do-sistema)
11. [Segurança e boas práticas](#11-segurança-e-boas-práticas)
12. [Glossário](#12-glossário)
13. [Perguntas frequentes](#13-perguntas-frequentes)
14. [Checklists](#14-checklists)

---

## 1. Resumo executivo

*Uma página, para gestores e responsáveis pelo treinamento.*

**O que é.** O riSZon é o sistema de gestão da rede Risarte Odontologia. Ele
acompanha cada paciente por uma sequência de **7 fases** — da primeira conversa
até o acompanhamento depois do tratamento — e, ao redor dessa sequência, reúne
agenda, prontuário, orçamento, negociação, financeiro, estoque e compras.

**O problema que resolve.** Hoje cada etapa vive numa planilha ou na cabeça de
alguém. No riSZon, cada paciente está sempre **em uma fase, com um responsável
e um prazo**, e a passagem de uma fase para outra **avisa automaticamente quem
faz o próximo passo**. Quando o prazo estoura, o caso fica marcado em vermelho
nas listas.

**Para quem.** Hoje: 1 franqueadora + unidades, com **16 funções** diferentes
(da recepção ao financeiro da rede). O sistema foi desenhado para crescer até
200 unidades.

**O que ele NÃO faz** (limites declarados no próprio código): não envia
mensagem de WhatsApp automaticamente; não assina contrato digitalmente ainda
(ZapSign previsto, não conectado); não cobra por meio de gateway ainda (ASAAS
previsto, não conectado); não funciona sem internet; não tem portal para o
paciente.

**O que muda na prática.** A recepção deixa de anotar em papel quem precisa ser
chamado; o coordenador vê a fila de avaliações com prazo; o planner recebe o
caso já com fotos e anamnese; o consultor sabe qual plano foi aprovado; o
gerente vê o resultado da unidade sem pedir relatório para ninguém.

**Riscos para quem está começando.** Dois, e ambos estão tratados neste manual:
(a) o menu mostra mais itens do que a pessoa realmente consegue usar — a
proteção de verdade está no banco de dados, não no menu; (b) muitas ações do
financeiro e do clínico **não podem ser desfeitas** — geram um lançamento de
correção em vez de apagar.

**Tempo estimado de treinamento por função:** 40 a 90 minutos, conforme a
função (ver [seção 6](#6-scripts-de-treinamento-por-função)).

---

## 2. Início rápido

*As cinco primeiras coisas que um usuário novo deve fazer.*

1. **Entrar.** Abra o endereço do sistema, informe o e-mail e a senha que o
   administrador cadastrou. **Não existe "criar conta"** — todo acesso é criado
   por um administrador (evidência: `src/app/login/login-form.tsx`,
   `src/app/(app)/admin/usuarios/actions.ts` → `createUser`).
2. **Confira em que unidade você está.** No alto da barra lateral esquerda
   aparece o nome da clínica ativa e, logo abaixo, *"Sua função aqui: …"*. Se
   você atende em mais de uma unidade, é por ali que se troca.
3. **Olhe o menu da esquerda.** Ele é a lista do que você pode abrir.
4. **Comece pelo "Início".** É a primeira tela e a que resume o seu dia.
5. **Ache a versão do sistema** no rodapé da barra lateral (ex.: *"Versão
   0.224.0 · migração 0245"*). É essa informação que o suporte pede quando algo
   dá errado.

**Se algo não aparecer para você**, não é defeito: é permissão. Ver
[seção 13](#13-perguntas-frequentes).

---

## 3. Visão geral do riSZon

### 3.1. O que o sistema faz

O riSZon organiza o caminho do paciente em **7 fases**. Cada paciente está
sempre em **uma fase** e com um **sub-status** dentro dela, e o tempo em cada
fase fica registrado.

| # | Fase | O que acontece | Quem costuma agir |
|---|---|---|---|
| 1 | **Aquisição** | Entrada do cadastro | Recepção, SDR |
| 2 | **Conversão Clínica** | Avaliação, fotos, exames, anamnese | Coordenador Clínico |
| 3 | **Centro de Planejamento** | Diagnóstico, plano, orçamento, aprovação | Dentista Planner + Coordenador |
| 4 | **Conversão Comercial** | Apresentação, negociação, fechamento | Consultor Comercial |
| 5 | **Início de Tratamento** | Agendamento do início | Recepção |
| 6 | **Reavaliação** | Controle de qualidade | Coordenador |
| 7 | **Acompanhamento** | Prevenção, retorno, resgate | Recepção, SDR |

**Evidência:** `CLAUDE.md` seção 3; a fase fica em `clients.journey_phase` e o
histórico em `journey_phase_history`; a movimentação é validada pela função
`move_client_phase` no banco.

**Regra que atravessa tudo:** *só é venda com documento assinado **e** pagamento
confirmado*. Essa regra não está apenas na tela — está imposta pelo banco de
dados, que recusa registrar recebimento de uma venda não fechada com o erro
`SALE_NOT_CLOSED` (evidência: `CLAUDE.md` §8b; migração 0203).

### 3.2. Os módulos

Além da jornada, o sistema tem módulos que aparecem no menu conforme a função:

| Módulo | Rota | O que resolve |
|---|---|---|
| Agenda | `/agenda` | Marcar e acompanhar horários, por dia/semana/mês |
| Atendimento | `/atendimento` | Chegada, chamada e conclusão do atendimento do dia |
| Prontuários | `/prontuarios` | A ficha completa do paciente |
| Centro de Planejamento | `/planejamento` | Fila de casos a planejar, com prazo |
| Procedimentos | `/procedimentos` | Catálogo: preço, protocolo de sessões, comissionamento |
| Planos de Tratamento | `/planos` | Visão gerencial dos planos |
| Comercial | `/comercial` | Funil de negociação e fechamento |
| Financeiro | `/financeiro` | Contas, DRE, fluxo de caixa, taxas, repasses |
| Estoque | `/estoque` | Itens, kits, saldo, inventário |
| Compras | `/compras` | Requisição, cotação, pedido, recebimento |
| PPR+ | `/ppr` | Programa de prevenção |
| Empresarial | `/empresarial` | Convênio com empresas parceiras |
| Risartanos | `/risartanos` | Cadastro de colaboradores (RH) |
| Relatórios | `/relatorios` | Indicadores de agenda, rede e produtividade |
| Administração | `/admin/*` | Clínicas, usuários, prazos, regras, modelos |

### 3.3. O que **não** faz parte do escopo

Confirmado no código como **previsto mas não conectado**:

- **Assinatura digital (ZapSign)** — variáveis `ZAPSIGN_API_TOKEN` e
  `ZAPSIGN_BASE_URL` existem, sem integração ativa.
- **Pagamento online (ASAAS)** — variáveis `ASAAS_API_KEY` e `ASAAS_BASE_URL`
  existem, sem integração ativa.
- **WhatsApp automático** — o envio é manual, com mensagem pronta para copiar
  (`src/lib/whatsapp.ts`).
- **Funcionamento sem internet** — o sistema é online.
- **Portal do paciente** — não existe.

### Evidências analisadas

| Arquivo | Elemento | Conclusão |
|---|---|---|
| `CLAUDE.md` | §3 Jornada | As 7 fases e quem move cada uma [EV-001] |
| `src/app/(app)/**/page.tsx` | 82 rotas | Lista completa de telas [EV-002] |
| `src/components/app-sidebar.tsx` | 28 itens | Menu e condições [EV-003] |
| `.env.example`, código | `ZAPSIGN_*`, `ASAAS_*` | Variáveis existem, integração não [EV-011] |

---

## 4. Perfis, papéis e funções

O sistema tem **15 papéis** guardados por clínica (`user_clinic_roles`), mais
o **Admin Master**, que não é um papel e sim uma marca no perfil da pessoa
(`profiles.is_admin_master`). Evidência: `src/lib/roles.ts`.

**Uma pessoa pode ter funções diferentes em unidades diferentes.** O que ela vê
depende da **unidade ativa** no momento.

### 4.1. Regra estrutural: função pertence a um ambiente

Cada papel só pode ser atribuído a uma clínica do tipo certo — e isso é
**imposto pelo banco**, não só escondido na tela (evidência: `src/lib/roles.ts`,
`FRANCHISOR_ROLES` / `UNIT_ROLES`, e a função `isRoleAllowedForClinicType`).

| Ambiente | Papéis |
|---|---|
| **Franqueadora** | SDR, Dentista Planner, Consultor Comercial, Assistente Comercial, Franqueadora/Rede, Consultor RisLife, Financeiro da Franqueadora, Comprador da Franqueadora |
| **Unidade** | Recepcionista, Coordenador Clínico, Dentista, Gerente de Unidade, TSB, ASB, Franqueado |

Se alguém tentar dar a função "Recepcionista" a uma pessoa na Franqueadora, o
sistema recusa com o erro `ROLE_NOT_ALLOWED_FOR_CLINIC_TYPE`.

### 4.2. As duas camadas de proteção — e por que isso importa para você

Este é o conceito mais importante deste manual, e o que mais gera confusão:

> **O menu esconde. O banco de dados barra.**

O menu da esquerda mostra ou esconde itens conforme a sua função — isso é
conforto, para você não se perder. **A proteção de verdade está no banco**, com
uma regra por linha (chamada RLS) que decide o que cada pessoa consegue ler e
escrever, mesmo que tente por fora da tela.

**Consequência prática, confirmada na análise:** os itens **Início, Jornada,
Agenda, Atendimento, Prontuários, Centro de Planejamento e Procedimentos
aparecem no menu para todas as funções** — não há filtro por papel neles no
menu. O que muda é **o que você encontra lá dentro**. Um TSB abre
`/planejamento` e vê a tela, mas os dados e os botões de ação seguem as regras
do banco.

Evidência: `src/components/app-sidebar.tsx` (a lista `NAV_ITEMS` não tem
condição por papel); `docs/ARQUITETURA-TECNICA.md` §"Autenticação e RBAC".

**Única exceção encontrada no menu:** quem tem **apenas** o papel *Dentista* na
unidade ativa **não vê "Jornada"**, e ganha dois itens próprios, *Meu Dia* e
*Minha Agenda* (evidência: `app-sidebar.tsx`, variável `dentistOnly`).

### 4.3. Ficha de cada papel

> **Legenda de confiança:** ✅ confirmado no código · ⚠️ parcialmente confirmado
> (a regra existe, mas o comportamento de tela precisa de validação) ·
> ❔ não identificado.

#### Admin Master

- **O que é:** marca global no perfil, não um papel de clínica.
- **Usa quem:** o responsável pelo sistema (hoje, o proprietário).
- **Vê:** todos os itens do menu, incluindo o bloco **Administração** — que é
  exclusivo dele (✅ `app-sidebar.tsx`: `{isAdminMaster && (…)}`).
- **Pode:** criar clínicas, criar usuários, redefinir senha, configurar prazos,
  regras comerciais, agenda, fichas de anamnese, modelos de documento e ver a
  auditoria.
- **Riscos:** é o único que pode apagar configuração da rede inteira. Um engano
  aqui atinge todas as unidades.
- **Depende de:** ninguém.

#### Recepcionista *(unidade)*

- **Objetivo:** porta de entrada e organização do dia.
- **Pode:** cadastrar paciente, agendar, registrar chegada, chamar, solicitar
  anamnese, receber o aviso de fechamento para agendar o início do tratamento.
- **Não vê:** Financeiro, Compras (✅ `canViewFinance` não inclui
  `receptionist`; `canViewPurchases` também não).
- **Não vê no menu, mas o item aparece:** Centro de Planejamento e Procedimentos
  (⚠️ ver [4.2](#42-as-duas-camadas-de-proteção--e-por-que-isso-importa-para-você)).
- **Riscos:** cadastrar paciente duplicado — mitigado pelo sistema, que
  reconhece o CPF já existente e autopreenche.
- **Depende de:** Coordenador (avaliação) e Consultor (fechamento).

#### Coordenador Clínico *(unidade)*

- **Objetivo:** avaliar o paciente e preparar o caso para o planejamento.
- **Pode:** registrar consentimento (obrigatório antes de qualquer coleta),
  subir fotos/exames, gravar áudio, enviar ao Centro de Planejamento, e
  **aprovar ou reprovar** cada opção do plano.
- **Vê também:** Planos de Tratamento (✅ `planRoles` inclui
  `clinical_coordinator` na unidade), Estoque (✅ é papel clínico).
- **Não vê:** Financeiro, Compras, Comercial.
- **Riscos:** aprovar plano sem ler o orçamento. Ele vê **o total** de cada
  opção, não o preço item a item (✅ regra do LOTE F4).
- **Depende de:** Dentista Planner (que monta o plano).

#### Dentista Planner *(franqueadora)*

- **Objetivo:** transformar o caso em diagnóstico, plano e orçamento.
- **Pode:** criar plano com opções, lançar procedimentos, classificar o pilar,
  pedir aprovação, enviar ao Comercial.
- **Vê também:** Procedimentos (catálogo), Relatórios, Planos de Tratamento,
  Estoque (papel clínico).
- **Não pode:** avaliar paciente, agendar, negociar.
- **Riscos:** enviar ao Comercial sem aprovação — o sistema barra.
- **Depende de:** Coordenador (aprovação).

#### Dentista (executor) *(unidade)*

- **Objetivo:** executar o plano aprovado.
- **Menu diferente dos outros:** ✅ **não tem "Jornada"**, e ganha **Meu Dia** e
  **Minha Agenda**.
- **Pode:** ver a agenda dele, chamar o paciente, escrever o Desenvolvimento
  Clínico e concluir o atendimento; consumo avulso de estoque.
- **Não vê:** Financeiro, Comercial, Compras, Relatórios.
- **Riscos:** concluir atendimento sem escrever o Desenvolvimento Clínico — o
  sistema **não deixa** (✅ regra I7b).
- **Depende de:** Recepção (que registra a chegada).

#### Consultor Comercial *(franqueadora)*

- **Objetivo:** apresentar o plano e fechar a venda.
- **Pode:** negociar, aplicar desconto dentro do teto, definir forma de
  pagamento, marcar contrato assinado e pagamento confirmado.
- **Vê também:** Comercial, Relatórios, Planos de Tratamento.
- **Não vê:** Financeiro, Estoque, Compras.
- **Riscos:** desconto acima do teto — o sistema avisa e, acima do limite,
  exige autorização.
- **Depende de:** Planner (plano aprovado).

#### Gerente de Unidade *(unidade)*

- **Objetivo:** enxergar e responder pela unidade.
- **Vê praticamente tudo da unidade:** Financeiro ✅, Estoque ✅, Compras ✅,
  Comercial ✅, Relatórios ✅, Planos ✅, Risartanos ✅, Empresarial ✅.
- **Pode:** lançar dinheiro (`canPostFinance`), dar entrada e fazer inventário
  de estoque (`canManageStock`), criar requisição de compra
  (`canManagePurchaseRequests`), autorizar contas dentro da alçada.
- **Não pode:** configurar o que vale para a rede inteira
  (`canConfigureFinanceNetwork` exclui o gerente) nem cadastrar item no catálogo
  de estoque (`canManageStockCatalog`).
- **Riscos:** é quem mais executa ação irreversível no financeiro.

#### Franqueado *(unidade)*

- **Objetivo:** acompanhar a unidade que possui.
- **Vê:** Financeiro ✅, Estoque ✅, Compras ✅, Comercial ✅, Relatórios ✅.
- **Não pode lançar dinheiro:** ⚠️ `canPostFinance` **não** inclui `franchisee`
  — o comentário no código diz *"franqueado é somente leitura"*.

#### Financeiro da Franqueadora *(franqueadora)*

- **Pode:** tudo do financeiro, inclusive **configurar a rede**
  (`canConfigureFinanceNetwork` ✅), o catálogo de estoque
  (`canManageStockCatalog` ✅) e ver Compras.
- **Não pode:** aprovar a própria conta lançada (regra de alçada, FIN3).

#### Comprador da Franqueadora *(franqueadora)*

- **Objetivo:** negociar compras pela rede.
- **Vê:** Compras ✅ (é o único, além do Admin, que entra na mesa de
  negociação — `isPurchaser`).
- **Regra estrutural:** *quem compra não é quem paga*. Ele **não** tem acesso
  ao Financeiro (✅ `canViewFinance` não o inclui).

#### SDR (Encantador) *(franqueadora)*

- **Pode:** cadastrar clientes e agendar, inclusive em outra unidade; vê os
  clientes que cadastrou.
- **Não pode:** mover fases (botões removidos), atos clínicos ou comerciais.
- **Vê:** Empresarial ✅ (`canViewEmpresarial` inclui `sdr`).

#### Assistente Comercial *(franqueadora)*

- **Pode:** enviar documentos e link de pagamento, acompanhar status.
- **Vê:** Comercial ✅. **Não vê** Relatórios nem Planos (⚠️ não está em
  `reportRoles` nem em `planRoles`).

#### Franqueadora/Rede *(franqueadora)*

- **Vê:** Relatórios ✅, Planos ✅, Risartanos ✅, Empresarial ✅.
- **Não vê:** Financeiro ⚠️ — `canViewFinance` **não** inclui
  `franchisor_staff`. **Ponto que merece validação** (ver lacunas).

#### Consultor RisLife *(franqueadora)*

- **Objetivo:** gerir o programa Empresarial (B2B).
- **Vê:** Empresarial ✅ (é gestor do programa).

#### TSB e ASB *(unidade)*

- **Pode:** consumo avulso de estoque ✅ (são papéis clínicos).
- **Não vê:** Financeiro, Comercial, Compras, Relatórios, Planos.

### Evidências analisadas

| Arquivo | Elemento | Conclusão |
|---|---|---|
| `src/lib/roles.ts` | `USER_ROLES`, `ROLE_LABELS` | 15 papéis + rótulos [EV-004] |
| `src/lib/roles.ts` | `FRANCHISOR_ROLES`/`UNIT_ROLES` | Papel pertence a um ambiente [EV-005] |
| `src/app/(app)/layout.tsx` | `canViewReports`, `canViewPlans`, `canViewComercial`, `canViewStaff` | Condições de menu [EV-006] |
| `src/lib/finance/access.ts` | `canViewFinance`, `canPostFinance`, `canConfigureFinanceNetwork` | Três níveis distintos [EV-007] |
| `src/lib/stock-access.ts` | `CLINICAL_ROLES`, `canManageStock`, `canConsumeStock` | Gestão × atendimento [EV-008] |
| `src/lib/purchases-access.ts` | `isPurchaser`, `canManagePurchaseRequests` | Comprar ≠ pagar [EV-009] |
| `src/components/app-sidebar.tsx` | `dentistOnly` | Única exceção de menu por papel [EV-010] |

---

## 5. Matriz de permissões

A matriz completa (16 papéis × 27 colunas) está em
[`matriz-permissoes-riSZon.csv`](matriz-permissoes-riSZon.csv), e foi **calculada
aplicando as mesmas condições booleanas do código**, não deduzida pelo nome do
papel.

**Como ela foi montada:** para cada papel, simulou-se uma pessoa que tem
**apenas aquele papel**, na clínica compatível com ele, e rodaram-se as funções
reais (`canViewFinance`, `canViewStock`, etc.). Quem acumula funções vê a soma.

### Resumo — visibilidade dos módulos principais

| Papel | Financeiro | Estoque | Compras | Comercial | Relatórios | Planos | Admin |
|---|---|---|---|---|---|---|---|
| Admin Master | SIM | SIM | SIM | SIM | SIM | SIM | **SIM** |
| Gerente de Unidade | SIM | SIM | SIM | SIM | SIM | SIM | não |
| Franqueado | SIM | SIM | SIM | SIM | SIM | SIM | não |
| Financeiro da Franqueadora | SIM | SIM | SIM | não | não | não | não |
| Comprador da Franqueadora | não | não | SIM | não | não | não | não |
| Consultor Comercial | não | não | não | SIM | SIM | SIM | não |
| Assistente Comercial | não | não | não | SIM | não | não | não |
| Dentista Planner | não | SIM | não | não | SIM | SIM | não |
| Coordenador Clínico | não | SIM | não | não | não | SIM | não |
| Dentista | não | SIM | não | não | não | não | não |
| TSB / ASB | não | SIM | não | não | não | não | não |
| Recepcionista | não | não | não | não | não | não | não |
| SDR | não | não | não | não | não | não | não |
| Franqueadora/Rede | não | não | não | não | SIM | SIM | não |
| Consultor RisLife | não | não | não | não | não | não | não |

**Ler assim:** "SIM" quer dizer *o item aparece no menu para essa função*. Não
quer dizer que a pessoa possa fazer tudo lá dentro — as colunas de **ação** da
planilha (lançar dinheiro, dar entrada no estoque, criar requisição) mostram a
diferença.

### Ações — quem pode de fato executar

| Ação | Quem pode |
|---|---|
| Lançar/editar dinheiro | Admin, Financeiro da Franqueadora, **Gerente** |
| Configurar financeiro da REDE | Admin, Financeiro da Franqueadora |
| Entrada e inventário de estoque | Admin, Financeiro da Franqueadora, **Gerente** |
| Consumo avulso de estoque | Os acima **+ Dentista, Coordenador, Planner, TSB, ASB** |
| Cadastrar item no catálogo | Admin, Financeiro da Franqueadora |
| Criar requisição de compra | Admin, **Gerente** |
| Mesa de negociação de compras | Admin, **Comprador** |
| Configurar PPR+ | **Só Admin** |

**Repare na diferença que mais confunde:** o Franqueado **vê** o Financeiro mas
**não lança** nada; o Gerente vê e lança. É proposital.

---

## 6. Scripts de treinamento por função

Cada roteiro segue a mesma estrutura. Comece pelo da sua função.

> **Antes de qualquer roteiro — 5 minutos de conceitos**
>
> - **Fase:** em que ponto do caminho o paciente está. Sempre uma só.
> - **Sub-status:** o detalhe dentro da fase (ex.: "aguardando aprovação").
> - **SLA:** o prazo daquela fase. Estourou, o caso fica **vermelho** nas listas.
> - **Unidade ativa:** a clínica em que você está trabalhando agora. Aparece no
>   alto da barra lateral.
> - **Prontuário:** a ficha do paciente, com abas.

### 6.1. Recepcionista

**Objetivo:** cadastrar pacientes, organizar a agenda e conduzir a chegada.
**Pré-requisitos:** acesso criado pelo administrador; saber em que unidade
trabalha. **Duração estimada:** 60 minutos.

**Tarefa 1 — Cadastrar um paciente**

1. Menu **Prontuários** → botão de novo cadastro (rota `/prontuarios/novo`).
2. **Comece pelo CPF.** O sistema procura antes de deixar você digitar o resto:
   se o paciente já existir na rede, ele **autopreenche** (evidência: LOTE F1).
3. Preencha nome, nascimento, telefone, e-mail e endereço.
4. Clique em **Cadastrar cliente**.
5. **Resultado esperado:** o sistema abre a ficha do paciente e ele nasce na
   fase **Aquisição**, com um código próprio (ex.: `CAM-00001`).

> **Cuidado:** o CPF é a trava contra paciente repetido. Digitar com pontuação
> ou sem dá no mesmo — o sistema compara só os números (migração 0244).

**Tarefa 2 — Agendar**

1. Na ficha do paciente, botão **Novo agendamento**; ou pelo menu **Agenda**.
2. Preencha: cliente, tipo, profissional, sala, duração, data e horário.
3. **O sistema recusa** horário fora do funcionamento da unidade, dia fechado ou
   sala lotada — exceto urgência/emergência.
4. **Resultado esperado:** a janela fecha e o horário aparece na agenda.

> **Quem atende depende do tipo.** Numa Avaliação o sistema oferece só o
> Coordenador. Isso não é erro: é a regra da fase.

**Tarefa 3 — Receber o paciente no dia**

1. Menu **Atendimento**.
2. Botão **Registrar chegada** → confira profissional, horário e sala com o
   paciente na frente → **Confirmar chegada**.
3. **Quem chama é o profissional**, não a recepção.

**Erros frequentes:** tentar cadastrar sem CPF; agendar fora do horário da
unidade; fechar o aviso modal de "agendar apresentação" clicando em *"Já
agendei"* sem ter agendado — isso afirma um fato que não aconteceu.

**Como confirmar que deu certo:** o paciente aparece na lista de Prontuários com
a fase correta, e o horário aparece na Agenda.

**Exercício sugerido (no ambiente de treino):** cadastre um paciente fictício,
agende uma avaliação para hoje e registre a chegada.

**Checklist final:** ☐ cadastrei ☐ agendei ☐ registrei chegada ☐ sei onde ver a
fase do paciente ☐ sei que não sou eu quem chama

### 6.2. Coordenador Clínico

**Objetivo:** avaliar e preparar o caso. **Duração:** 60 minutos.

1. Menu **Atendimento** → **Chamar** o paciente (é você quem chama numa
   avaliação).
2. Abra a ficha → tela de avaliação (`/avaliacao/[clientId]`).
3. **Registrar consentimento** — obrigatório. **Nada de gravação ou coleta
   acontece antes disso** (exigência de LGPD imposta pelo sistema).
4. **Levantamento de informações** → escolher a ficha de anamnese → preencher →
   **Salvar anamnese**.
5. Subir fotos e exames.
6. **Enviar ao Centro de Planejamento**.

**Segunda tarefa — aprovar plano:** na ficha, aba **Plano** → expandir a opção →
**Aprovar opção** ou **Reprovar opção**.

> **Reprovar exige considerações escritas** — o sistema não deixa reprovar em
> branco (migração 0042).

**Cuidado:** você vê **o total** de cada opção, não o preço item a item. Isso é
proposital: sua aprovação é clínica, não comercial.

### 6.3. Dentista Planner

**Objetivo:** montar plano e orçamento. **Duração:** 75 minutos.

1. Menu **Centro de Planejamento** → a fila vem **priorizada** (apresentação
   comercial mais próxima primeiro).
2. Abra o caso → cockpit em duas colunas: evidências à esquerda, plano à direita.
3. **Iniciar plano de tratamento** → escreva o **Diagnóstico**.
4. **Adicionar opção de tratamento** (marque uma como principal).
5. Dentro da opção, **Procedimento** → escolha do catálogo → **Item**.
6. Classifique o **pilar** (1 dos 6) → **Salvar pilar**.
7. **Enviar para aprovação do Coordenador**.
8. Aprovado, **Enviar ao Comercial**.

**Cuidados:** o sistema exige procedimentos lançados em cada opção para enviar;
plano de tratamento **não tem acréscimo** (o preço vem do orçamento aprovado);
depois de aprovado o plano fica em leitura — há **Reabrir para edição**, que
exige nova aprovação.

### 6.4. Dentista (executor)

**Objetivo:** executar e registrar. **Duração:** 40 minutos.

Seu menu é diferente: **não tem Jornada**, e tem **Meu Dia** e **Minha Agenda**.

1. **Meu Dia** → seus atendimentos.
2. **Atendimento** → **Chamar**.
3. Ficha do paciente → aba **Desenvolvimento Clínico** → descreva o que foi
   feito. **Espere aparecer "Salvo às…"**.
4. **Concluir atendimento** → marque o que foi feito; o que não foi volta para
   "a agendar", com motivo.

> **O botão de concluir só libera depois da anotação.** Não é travamento: é a
> regra de que atendimento sem registro não encerra.

**O que acontece automaticamente ao concluir:** o material do kit **baixa do
estoque** e o repasse do procedimento é apurado. Você não digita nada disso.

### 6.5. Consultor Comercial

**Objetivo:** negociar e fechar. **Duração:** 60 minutos.

1. Menu **Comercial** → seu funil.
2. Abra o caso (`/comercial/[clientId]`) → escolha a **forma de pagamento** →
   **Salvar negociação**.
3. **Cliente aceitou** (o botão só habilita depois de salvar).
4. Tela de apresentação (`/apresentacao/[clientId]`) → marque **Contrato
   assinado** e **Pagamento confirmado**.

> **A regra de ouro:** só é venda com os dois. O banco recusa receber dinheiro
> de venda não fechada.

**Cuidado:** desconto acima do teto da unidade fica **aguardando autorização**,
e a cobrança não muda até alguém autorizar.

### 6.6. Gerente de Unidade

**Objetivo:** responder pela unidade. **Duração:** 90 minutos (é a função com
mais telas).

Módulos: Financeiro, Estoque, Compras, Comercial, Relatórios, Planos,
Risartanos, Empresarial.

**Rotinas mensais:**
1. **Fechamento de competência** (`/financeiro/fechamento`) — trava o mês.
   A conferência **não bloqueia**: ela lista pendências e o botão vira "fechar
   mesmo assim". Só a **depreciação não rodada** é alerta grave.
2. **Inventário de estoque** — a diferença encontrada vira ajuste **com motivo**.
3. **Requisição de compra** — a lista vem do que o Estoque aponta em falta.

> **Cuidado central:** no financeiro **nada se apaga**. Lançamento liquidado
> gera um **contra-lançamento** com motivo. Conferir antes de salvar vale mais
> aqui do que em qualquer outra tela.

### 6.7. Demais funções

**SDR:** cadastrar e agendar; não move fases. **Assistente Comercial:** enviar
documentos e acompanhar. **TSB/ASB:** apoio clínico e consumo de estoque.
**Franqueado:** leitura da própria unidade. **Financeiro da Franqueadora:**
configuração da rede e visão consolidada. **Comprador:** mesa de negociação.
**Consultor RisLife:** programa Empresarial.

Para essas funções, os passos seguem os módulos descritos na
[seção 7](#7-mapeamento-da-interface). ⚠️ Roteiros detalhados
**não foram escritos** por falta de validação em tela — registrado nas lacunas.

---

## 7. Mapeamento da interface

> ⚠️ **Localização visual não confirmada no código.** A posição de cada botão na
> tela deve ser validada na interface em execução. O que está confirmado é: a
> rota, quem pode abrir, e o que a ação faz.

### 7.1. Entrada e autenticação

| Item | Rota | Quem | O que faz |
|---|---|---|---|
| Tela de login | `/login` | todos | E-mail + senha. **Não há auto-cadastro nem "esqueci minha senha"** |
| Botão **Entrar** | `/login` | todos | Autentica; erro genérico não revela se o e-mail existe |
| Botão **Sair** | barra lateral, rodapé | todos | Encerra a sessão |

**Evidência:** `src/app/login/login-form.tsx`; `src/app/login/actions.ts`
(`recordLogin` grava o acesso na auditoria).

### 7.2. Barra lateral (o menu)

28 itens, agrupados. O bloco **Administração** só aparece para o Admin Master.
Há um botão para **minimizar** a barra (a preferência fica guardada), e o
**seletor de unidade** no alto para quem atende em mais de uma.

No rodapé: seu nome, seu e-mail, a **versão do sistema** e o botão **Sair**.

### 7.3. Telas por área

**Cadastros e consultas:** `/prontuarios`, `/prontuarios/novo`,
`/prontuarios/[id]`, `/procedimentos`, `/risartanos`.

**Jornada e clínico:** `/jornada`, `/avaliacao/[clientId]`, `/planejamento`,
`/planejamento/[clientId]`, `/planos`, `/atendimento`, `/meu-dia`,
`/minha-agenda`, `/agenda`.

**Comercial:** `/comercial`, `/comercial/[clientId]`,
`/apresentacao/[clientId]`, `/cancelamentos`, `/renegociacoes/[id]/acordo`.

**Financeiro (21 telas):** `/financeiro` e as subtelas `adquirentes`, `bens`,
`centros-de-custo`, `conciliacao`, `configuracao`, `consolidado`,
`contas-a-pagar`, `dre`, `fechamento`, `fluxo-de-caixa`, `fornecedores`,
`orcamento`, `painel-da-rede`, `plano-de-contas`, `ponto-de-equilibrio`,
`repasses`, `taxas-da-rede`.

**Estoque e compras:** `/estoque`, `/compras`.

**Programas:** `/ppr`, `/empresarial`.

**Administração (10 telas):** `/admin/clinicas`, `/admin/usuarios`,
`/admin/usuarios/novo`, `/admin/usuarios/[id]`, `/admin/sla`,
`/admin/regras-comerciais`, `/admin/agenda`, `/admin/anamnese`,
`/admin/orientacoes`, `/admin/documentos`, `/admin/chat`, `/admin/auditoria`.

**Outros:** `/notificacoes`, `/perfil`, `/chat`, `/relatorios`, `/documentos`.

A lista completa das 82 rotas, com as guardas de acesso encontradas em cada
página, está em
[`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json).

### 7.4. Ações do sistema

Foram encontradas **384 ações de servidor** (as operações que gravam ou alteram
dados). Elas estão catalogadas no inventário JSON, com o arquivo de origem de
cada uma.

⚠️ **Não foi produzida a descrição individual das 384 ações.** Seria material
de referência técnica, não de treinamento, e exigiria validação em tela.
Registrado nas lacunas.

---

## 8. Fluxos principais de uso

### Fluxo 1 — Primeiro acesso

**Papel:** qualquer. **Pré-condição:** administrador criou o seu acesso.

1. Abra o endereço do sistema.
2. Informe e-mail e senha.
3. **Se você tem acesso a mais de uma unidade** e não é da Franqueadora, o
   sistema pede para escolher a unidade **antes** de mostrar qualquer tela
   (evidência: `layout.tsx`, `ChooseClinicWelcome`).
4. **Resultado:** você cai na tela Início.

**Erros possíveis:** ver [seção 9](#9-erros-falhas-e-mau-funcionamento).

### Fluxo 2 — Do cadastro ao fechamento (a jornada completa)

**Papéis:** cinco pessoas diferentes. **Este é o fluxo central do sistema.**

1. **Recepção** cadastra o paciente → nasce na **Aquisição**.
2. **Recepção** move para **Conversão Clínica**.
3. **Coordenador** registra consentimento → anamnese → fotos → **Enviar ao
   Centro de Planejamento** → paciente vai para a **Fase 3**.
4. **Planner** monta plano + orçamento + pilar → **Enviar para aprovação**.
5. **Coordenador** aprova a opção.
6. **Planner** **Envia ao Comercial** → **Fase 4**.
7. **Consultor** negocia → **Cliente aceitou** → marca **Contrato assinado** e
   **Pagamento confirmado** → venda fechada → **Fase 5**.
8. **Recepção** recebe aviso e agenda o início do tratamento.
9. **Dentista** executa, escreve o Desenvolvimento Clínico e conclui →
   **estoque baixa e repasse é apurado automaticamente**.

**Evidência:** este fluxo está coberto por teste automatizado ponta a ponta
(`e2e/01-jornada.spec.ts` a `e2e/10-estoque.spec.ts`), o que confirma que cada
passo funciona como descrito.

**Pontos de decisão:** o Coordenador pode **reprovar** (volta ao Planner com
orientações); o cliente pode **não aceitar** (vai para follow-up).

### Fluxo 3 — Encerrar a sessão

Botão **Sair** no rodapé da barra lateral.

### Fluxos com evidência parcial

⚠️ **Exclusão de registros:** o sistema **não apaga paciente** — a exclusão é
**anonimização** (`status = anonymized`), por exigência de guarda legal do
prontuário. Para procedimentos e itens de estoque, "excluir" significa
**inativar** quando já houve uso.

---

## 9. Erros, falhas e mau funcionamento

### 9.1. Como reconhecer

O sistema avisa por **mensagens que aparecem no canto superior direito**
(sucesso em verde, erro em vermelho) e por mensagens dentro do formulário.

### 9.2. Antes de chamar o suporte — 6 verificações

1. **É preenchimento?** Algum campo obrigatório em branco ou com formato errado?
2. **É permissão?** O botão não aparece, ou some ao clicar? Provavelmente a sua
   função não tem essa ação. Confira na [matriz](#5-matriz-de-permissões).
3. **É a unidade errada?** Veja no alto da barra lateral se a unidade ativa é a
   que você quer.
4. **É conexão?** Se a mensagem falar em servidor ou internet, teste abrir outro
   site.
5. **A tela está velha?** Recarregue com **Ctrl + Shift + R**.
6. **Já aconteceu antes?** Se for a primeira vez, tente de novo **uma vez**.

### 9.3. Quando NÃO repetir a ação

⚠️ **Não repita** se a ação envolve **dinheiro** (receber, pagar, fechar venda)
e você **não tem certeza** de que falhou. Repetir pode gerar lançamento em
dobro. Confira antes se o registro já existe.

O sistema tem travas contra duplicidade em vários pontos (mesma nota fiscal,
mesma emissão de boleto, mesma sessão consumindo kit duas vezes), mas **conferir
custa menos que corrigir**.

### 9.4. Checklist de diagnóstico

Copie e preencha ao registrar um problema:

```
Data e hora:
Usuário (e-mail):
Função/papel usado:
Unidade ativa:
Tela (nome ou endereço):
O que eu fiz (passo a passo):
Dados preenchidos:
Mensagem exibida (texto exato):
Código do erro (se houver):
Print da tela: (anexar)
Acontece sempre ou só uma vez?
Outras pessoas também?
Versão do sistema (rodapé da barra lateral):
```

### 9.5. Categorias

| Categoria | Como reconhecer | Primeira ação |
|---|---|---|
| **Acesso** | Não consegue entrar | Confira e-mail/senha; peça redefinição ao admin |
| **Permissão** | Botão ausente, ou "Você não tem permissão para isto" | Confira a matriz; talvez seja unidade errada |
| **Validação** | Mensagem no próprio campo | Corrija o preenchimento |
| **Dados** | Número que não bate | **Não corrija na mão** — registre e avise |
| **Interface** | Tela em branco, botão que não responde | Ctrl+Shift+R |
| **Indisponibilidade** | "Não consegui falar com o servidor" | Teste a internet; aguarde e tente de novo |
| **Inesperado** | Mensagem com código | Registre o código |

### 9.6. Quando escalar

Escale **imediatamente** se: (a) o problema envolve dinheiro lançado errado;
(b) alguém viu dado de paciente que não deveria; (c) mais de uma pessoa está
travada; (d) o sistema inteiro não abre.

❔ **Não identificado no código analisado:** não existe canal de suporte,
telefone ou e-mail configurado no sistema. **A definir pela operação.**

---

## 10. Mensagens do sistema

Foram catalogadas **179 mensagens de tela**: 141 de sucesso, 30 de erro, 6 de
aviso e 2 informativas. A lista completa está no inventário JSON.

### 10.1. Como interpretar

| Cor/tipo | Significa | O que fazer |
|---|---|---|
| **Sucesso** (verde) | A ação foi concluída e gravada | Nada. Pode seguir |
| **Erro** (vermelho) | A ação **não** foi concluída | Corrija e repita — exceto o caso da [seção 9.3](#93-quando-não-repetir-a-ação) |
| **Aviso** (amarelo) | Concluiu, mas há algo a conferir | Leia antes de seguir |

### 10.2. Mensagens de sucesso frequentes

`Configuração salva.` · `Prazos salvos.` · `Usuário criado com sucesso.` ·
`Senha redefinida.` · `Regra comercial salva.` · `Opção adicionada.` ·
`Datas sugeridas para toda a série.` · `Atendimento concluído.`

**Padrão útil:** *"Ajuste removido — vale o padrão da rede"* aparece quando você
apaga uma exceção da unidade. Não é erro: significa que aquela unidade voltou a
seguir a regra geral.

### 10.3. Erros de preenchimento (você resolve)

| Mensagem | Significa | O que fazer |
|---|---|---|
| `Arquivo vazio.` | O arquivo não tem conteúdo | Escolha outro |
| `Arquivo muito grande (máximo 25 MB).` | Passou do limite | Reduza o arquivo |
| `Nenhuma linha válida (confira Nome e CPF).` | A planilha não tem dados aproveitáveis | Confira as colunas |
| `Não foi possível ler a planilha.` | Formato não reconhecido | Use o modelo (botão "Baixar modelo") |
| `Cadastre uma clínica antes de atribuir funções.` | Falta pré-requisito | Crie a clínica primeiro |
| `Este usuário já tem função em todas as clínicas.` | Nada a adicionar | Nenhuma ação |

### 10.4. Erros do financeiro traduzidos

O sistema traduz os erros do banco de dados para linguagem clara
(`src/lib/finance/errors.ts`):

| Código | Mensagem ao usuário |
|---|---|
| `PERIOD_CLOSED` | *Este mês já foi fechado — o resultado dele não muda mais. Para lançar aqui, peça à Franqueadora para reabrir o período.* |
| `PERIOD_NOT_ENDED` | *O mês ainda não terminou. Só dá para fechar depois do último dia.* |
| `EARLIER_PERIOD_OPEN` | *Existe mês anterior ainda aberto com movimento. Feche os meses em ordem.* |
| `REASON_REQUIRED` | *Escreva o motivo da reabertura.* |
| `NOT_ALLOWED` | *Você não tem permissão para isto.* |
| `ACCOUNT_NOT_ANALYTIC` | *Esta conta é um grupo e não recebe lançamento.* |
| `ACCOUNT_NOT_FOUND` | *Conta não encontrada no plano de contas.* |
| `UNIT_LOCKED` | *O item já tem movimento: a unidade de medida não pode mais mudar.* |

> **Se aparecer um código sem tradução**, o sistema mostra o código. Anote-o no
> chamado — é o que identifica a causa.

### 10.5. Erros de equipamento

`Seu navegador não permite gravar áudio aqui.` e `Não foi possível acessar o
microfone.` — o navegador precisa de permissão para o microfone, e a página
precisa estar em endereço seguro (https).

---

## 11. Segurança e boas práticas

### 11.1. Regras do sistema (impostas, não sugeridas)

- **Não existe auto-cadastro.** Todo acesso nasce de um administrador.
- **Consentimento antes da coleta.** Gravação e coleta de dados clínicos só
  começam depois do consentimento registrado, com data e hora.
- **Paciente não se apaga.** A exclusão é anonimização — guarda legal do
  prontuário.
- **Todo acesso a prontuário é registrado** em auditoria.
- **Mídia clínica abre só por link assinado**, que expira. Nunca é pública.
- **Cada pessoa vê apenas a sua unidade** — imposto pelo banco.
- **O gerente de uma unidade nunca vê o financeiro de outra.**

### 11.2. Recomendações (boa prática, não regra do sistema)

> Estas são recomendações gerais, não políticas oficiais da empresa.

- Não compartilhe a sua senha. Se alguém precisa entrar, peça um acesso próprio
  — a auditoria registra **quem** fez cada coisa.
- Saia do sistema em computador compartilhado.
- Confira antes de salvar em telas de dinheiro: **nada se apaga**.
- Não fotografe telas com dado de paciente.
- Ao receber um aviso modal insistente, **não clique em "Já agendei" sem ter
  agendado** — isso afirma um fato que não aconteceu.

---

## 12. Glossário

| Termo | O que é | Exemplo no sistema |
|---|---|---|
| **Jornada** | O caminho de 7 fases do paciente | Tela "Jornada" mostra o quadro por fase |
| **Fase** | Onde o paciente está agora | "Centro de Planejamento" |
| **Sub-status** | Detalhe dentro da fase | "Aguardando Aprovação" |
| **SLA** | Prazo daquela fase | Estourou → selo vermelho |
| **Pilar** | Classificação do plano (1 de 6) | Saúde, Estética, Prevenção… |
| **Unidade ativa** | A clínica em que você está trabalhando | Alto da barra lateral |
| **Prontuário** | A ficha do paciente | `/prontuarios/[id]` |
| **Kit** | Conjunto de materiais de um procedimento | Baixa sozinho ao concluir a sessão |
| **Competência** | O mês a que o valor pertence | Diferente da data do pagamento |
| **Caixa** | Quando o dinheiro entrou ou saiu | Base do fluxo de caixa |
| **Alçada** | Até quanto alguém pode autorizar | Contas a pagar |
| **Adquirente** | A empresa da maquininha | Cobra taxa e paga em D+n |
| **Repasse** | O que o dentista recebe por procedimento | Valor fixo por nível |
| **Split** | A parte da franqueadora em cada recebimento | Royalty, fundo, etc. |
| **RLS** | Regra do banco que decide quem vê cada linha | É a proteção de verdade |
| **Migração** | Uma alteração na estrutura do banco | "migração 0245" no rodapé |

---

## 13. Perguntas frequentes

**Como acesso o sistema?**
Com o e-mail e a senha que o administrador cadastrou. Não existe "criar conta".

**Esqueci minha senha.**
❔ **Não existe tela de "esqueci minha senha"** no sistema. Peça ao
administrador, que redefine em Admin → Usuários.

**Um botão não aparece para mim. É defeito?**
Provavelmente não. É permissão, ou você está na unidade errada. Confira a
unidade ativa no alto da barra lateral e a [matriz](#5-matriz-de-permissões).

**Vejo um item de menu mas a tela vem vazia.**
Normal. O menu mostra o item, mas os **dados** seguem a sua permissão. Ver
[4.2](#42-as-duas-camadas-de-proteção--e-por-que-isso-importa-para-você).

**Como sei se minha ação foi concluída?**
Pela mensagem verde no canto e pelo dado aparecendo na tela. Em dúvida,
recarregue e confira — **não repita ação de dinheiro** sem conferir.

**Errei um preenchimento. Como corrijo?**
Depende. Cadastro: use **Editar**. Financeiro: **não se apaga** — gera-se um
lançamento de correção. Peça ajuda ao Gerente.

**Como troco de unidade?**
Pelo seletor no alto da barra lateral, se você tiver acesso a mais de uma.

**Quando aciono o suporte?**
Depois das 6 verificações da [seção 9.2](#92-antes-de-chamar-o-suporte--6-verificações),
e **imediatamente** se envolver dinheiro errado ou dado de paciente exposto.

**Como evito duplicidade?**
Sempre comece o cadastro **pelo CPF** — o sistema avisa se o paciente já existe.

**O que é aquele número no rodapé?**
A versão do sistema. Informe-a ao pedir suporte.

---

## 14. Checklists

### 14.1. Primeiro acesso

☐ Consegui entrar
☐ Sei qual é a minha unidade ativa
☐ Sei qual é a minha função (aparece abaixo do nome da unidade)
☐ Reconheço os itens do meu menu
☐ Sei onde fica a versão do sistema
☐ Sei onde fica o botão Sair
☐ Troquei a senha provisória, se recebi uma

### 14.2. Execução de tarefa

☐ Estou na unidade certa
☐ Conferi os dados antes de salvar
☐ Vi a mensagem de confirmação
☐ O registro aparece na lista
☐ Se era ação de dinheiro, conferi que não dupliquei

### 14.3. Diagnóstico de erro

☐ Anotei data, hora e tela
☐ Copiei a mensagem exata
☐ Tirei print
☐ Verifiquei se é preenchimento
☐ Verifiquei se é permissão
☐ Verifiquei a unidade ativa
☐ Recarreguei com Ctrl+Shift+R
☐ Anotei se acontece sempre
☐ Anotei a versão do sistema

### 14.4. Encerramento do treinamento

☐ Executei ao menos uma tarefa completa da minha função
☐ Sei o que **não** posso fazer
☐ Sei reconhecer erro de permissão × erro de preenchimento
☐ Sei registrar um problema com as informações certas
☐ Sei que ação de dinheiro não se apaga
☐ Sei a quem pedir ajuda

---

## Documentos relacionados

- [`evidencias-riSZon.md`](evidencias-riSZon.md) — de onde veio cada afirmação
- [`lacunas-riSZon.md`](lacunas-riSZon.md) — o que não foi possível confirmar
- [`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json) — rotas, menus, mensagens e ações
- [`matriz-permissoes-riSZon.csv`](matriz-permissoes-riSZon.csv) — 16 papéis × 27 colunas
