# Evidências — análise do riSZon

Relatório de rastreabilidade do
[`manual-treinamento-riSZon.md`](manual-treinamento-riSZon.md). Cada afirmação
do manual nasce de um destes itens.

**Método.** Duas frentes: (a) **extração automática** do código — rotas,
itens de menu, condições de acesso, mensagens de tela e ações de servidor,
gravadas em
[`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json);
(b) **leitura dirigida** dos arquivos de permissão, do layout e da documentação
do repositório.

**Escopo analisado.** `src/app/`, `src/lib/`, `src/components/`,
`supabase/migrations/`, `e2e/`, `CLAUDE.md`, `AGENTS.md`,
`docs/ARQUITETURA-TECNICA.md`, `.env.example`, `package.json`.

**Não analisado (e por quê).** A aplicação **em execução** — logo, nenhuma
posição visual foi confirmada. O conteúdo das 245 migrações foi consultado
pelos resumos do `CLAUDE.md` e por buscas dirigidas, não linha a linha.

**Níveis de confiança usados:** ✅ confirmado · ⚠️ parcialmente confirmado ·
❔ não identificado.

---

## Índice de evidências

### [EV-001] As 7 fases da jornada ✅

- **Arquivo:** `CLAUDE.md`, seção 3 "Arquitetura — a Jornada do Cliente".
- **Também em:** `supabase/migrations/` (tabela `journey_phase_history`,
  função `move_client_phase`).
- **Conclusão:** as sete fases, quem age em cada uma e a regra de que quem move
  depende da função. A matriz de movimentação está em `docs/JORNADA.md`.

### [EV-002] Inventário de rotas ✅

- **Extração:** todos os `src/app/(app)/**/page.tsx`.
- **Resultado:** **87 rotas** (conferido em 08/09/2026; uma delas, `/sistema`, é apenas um encaminhamento para `/alertas` ou `/problemas`).
- **Conclusão:** é a lista completa de telas do sistema. Para cada uma, o
  inventário JSON registra também as guardas encontradas no arquivo
  (`requireAdminMaster`, `hasRoleInClinic`, `notFound`, `redirect`, `canView*`).
- **Limite:** a presença de uma guarda no arquivo **não** prova qual papel
  passa por ela — só que existe verificação.

### [EV-003] Itens de menu ✅

- **Arquivo:** `src/components/app-sidebar.tsx`.
- **Resultado:** **28 itens**, com `href` e `label` exatos.
- **Conclusão:** são os rótulos que o usuário vê. O bloco de Administração está
  dentro de `{isAdminMaster && (…)}`.

### [EV-004] Os 15 papéis + Admin Master ✅

- **Arquivo:** `src/lib/roles.ts`, linhas 3–39.
- **Conclusão:** `USER_ROLES` lista 15 papéis; `ROLE_LABELS` dá o nome em
  português de cada um. O Admin Master **não** está nessa lista — é
  `profiles.is_admin_master`, uma marca global (comentário na linha 51).

### [EV-005] Papel pertence a um ambiente ✅

- **Arquivo:** `src/lib/roles.ts`, linhas 52–96.
- **Conclusão:** `FRANCHISOR_ROLES` (8) e `UNIT_ROLES` (7) são disjuntos;
  `isRoleAllowedForClinicType` impede atribuição cruzada. O comentário declara
  que a regra é imposta **no banco (trigger) e na interface**.
- **Confirmação independente:** ao semear o banco de teste com uma clínica de
  tipo errado, o banco recusou com `ROLE_NOT_ALLOWED_FOR_CLINIC_TYPE`.

### [EV-006] Condições de visibilidade do menu ✅

- **Arquivo:** `src/app/(app)/layout.tsx`, linhas 46–109.
- **Conclusão, com os papéis exatos:**
  - `canViewReports`: Admin, ou — **na clínica ativa** — `franchisor_staff`,
    `planner_dentist`, `commercial_consultant` (se franqueadora) ou
    `unit_manager`, `franchisee` (se unidade).
  - `canViewPlans`: Admin, ou `franchisor_staff`, `planner_dentist`,
    `commercial_consultant` (franqueadora) ou `unit_manager`,
    `clinical_coordinator`, `franchisee` (unidade).
  - `canViewStaff`: Admin, `unit_manager`, `franchisor_staff`, `franchisee`
    (em qualquer clínica).
  - `canViewComercial`: Admin, `commercial_consultant`, `commercial_assistant`,
    `unit_manager`, `franchisee` (em qualquer clínica).
- **Detalhe relevante:** Relatórios e Planos olham a **clínica ativa**; os
  outros olham **todas as clínicas** da pessoa. Isso muda o resultado de quem
  atende em mais de uma unidade.

### [EV-007] Três níveis de permissão no Financeiro ✅

- **Arquivo:** `src/lib/finance/access.ts`.
- **Conclusão:**
  - `canViewFinance` (abrir): Admin, `finance_franchisor`, `unit_manager`,
    `franchisee`.
  - `canPostFinance` (lançar): Admin, `finance_franchisor`, `unit_manager` —
    **não** `franchisee`. Comentário: *"franqueado é somente leitura"*.
  - `canConfigureFinanceNetwork` (configurar a rede): Admin,
    `finance_franchisor` — **não** o gerente.
- **Importância:** é o exemplo mais claro de que **ver ≠ poder fazer**.

### [EV-008] Estoque separa gestão de atendimento ✅

- **Arquivo:** `src/lib/stock-access.ts`.
- **Conclusão:** `CLINICAL_ROLES` = dentista, coordenador, planner, TSB, ASB.
  - `canManageStock` (entrada, inventário): Admin, `finance_franchisor`,
    `unit_manager`.
  - `canConsumeStock` (consumo avulso): os acima **+ CLINICAL_ROLES**.
  - `canManageStockCatalog` (cadastrar item): Admin, `finance_franchisor`.
- **Comentário no código:** *"Recepção fica de fora — receber mercadoria e
  contar prateleira não é ato de balcão"*.

### [EV-009] Compras separa quem compra de quem paga ✅

- **Arquivo:** `src/lib/purchases-access.ts`.
- **Conclusão:** `isPurchaser` = Admin ou `purchaser`;
  `canManagePurchaseRequests` = Admin ou `unit_manager` **da clínica ativa**;
  `canViewPurchases` soma esses mais `franchisee` e `finance_franchisor`.
- **Comentário no código:** *"quem compra não é quem paga, e separar as duas
  funções é controle interno básico"*.

### [EV-010] Única exceção de menu por papel ✅

- **Arquivo:** `src/components/app-sidebar.tsx`, variável `dentistOnly`.
- **Conclusão:** quem tem **somente** o papel `dentist` na clínica ativa perde
  o item "Jornada" e ganha "Meu Dia" e "Minha Agenda". Nenhum outro papel altera
  a lista básica de navegação.
- **Consequência documentada no manual:** os cinco primeiros itens do menu
  aparecem para **todas** as funções.

### [EV-011] Integrações previstas, não conectadas ✅

- **Extração:** busca por `process.env.*` em `src/` e `scripts/`.
- **Resultado:** `ZAPSIGN_API_TOKEN`, `ZAPSIGN_BASE_URL`, `ASAAS_API_KEY`,
  `ASAAS_BASE_URL`, `GAMMA_API_KEY` existem como variáveis.
- **Conclusão:** as variáveis existem; `.env.example` documenta apenas as três
  do Supabase mais `NEXT_PUBLIC_AMBIENTE`. O `CLAUDE.md` confirma que ficam
  "prontas para plugar".

### [EV-012] Mensagens de tela ✅

- **Extração:** `toast.success|error|warning|info("…")` em todo o `src/`.
- **Resultado:** **179 mensagens** — 141 sucesso, 30 erro, 6 aviso, 2 info.
- **Limite:** só captura mensagens escritas como literal. Mensagens montadas em
  variável ou vindas do servidor **não** entram nessa contagem.

### [EV-013] Erros do banco traduzidos ✅

- **Arquivo:** `src/lib/finance/errors.ts`.
- **Resultado:** **8 códigos** com tradução em português.
- **Conclusão:** o arquivo devolve `null` para código desconhecido — o sistema
  então mostra o código cru, de propósito, para não inventar mensagem errada.

### [EV-014] Ações de servidor ✅

- **Extração:** `export async function` em todo arquivo `actions.ts`.
- **Resultado:** **384 ações**.
- **Limite:** o nome e o arquivo estão confirmados; **o que cada uma faz não foi
  verificado individualmente**.

### [EV-015] Não existe auto-cadastro ✅

- **Arquivos:** `src/app/login/` (só `page.tsx`, `login-form.tsx`,
  `actions.ts`); `src/app/(app)/risartanos/acesso-actions.ts` → `createUser` com
  `email_confirm: true`.
- **Conclusão:** o administrador cria o usuário **já com a senha definida**.
  Não há tela de cadastro nem de "esqueci minha senha".
- **Confirmação independente:** teste contra o banco de produção respondeu
  `Signups not allowed for this instance`.

### [EV-016] A regra de ouro é imposta pelo banco ✅

- **Arquivo:** `CLAUDE.md` §8b; migração 0203.
- **Conclusão:** gatilho em `payment_receipts` levanta `SALE_NOT_CLOSED`. A
  regra não depende da tela.

### [EV-017] Duas camadas de autorização ✅

- **Arquivo:** `docs/ARQUITETURA-TECNICA.md`, seção "Autenticação e RBAC
  multi-tenant".
- **Citação:** *"Autorização é validada duas vezes, e só a camada do banco é
  confiável"*; as guardas do app *"servem para UX (esconder botões, erros
  amigáveis) — nunca como única barreira"*.
- **Conclusão:** é a base da explicação "o menu esconde, o banco barra".

### [EV-018] LGPD — regras impostas ✅

- **Arquivos:** `CLAUDE.md` §6; `AGENTS.md`; `src/lib/audit.ts`.
- **Conclusão:** consentimento antes da coleta; exclusão = anonimização (não há
  política de DELETE em `clients`); auditoria em todo acesso a ficha; mídia por
  URL assinada.

### [EV-019] Fluxo completo coberto por teste ✅

- **Arquivos:** `e2e/01-jornada.spec.ts` … `e2e/12-fechamento-competencia.spec.ts`.
- **Conclusão:** o caminho descrito no Fluxo 2 do manual é exercitado por teste
  automatizado ponta a ponta, papel por papel. Última execução conhecida: 15
  testes verdes, 1 pulado.
- **Valor para o treinamento:** o passo a passo do manual não é suposição — é o
  mesmo caminho que o teste percorre.

### [EV-020] Matriz de permissões calculada ✅

- **Método:** as condições de [EV-006] a [EV-009] foram **reimplementadas e
  executadas** para cada um dos 16 papéis, simulando uma pessoa com aquele único
  papel na clínica compatível.
- **Resultado:** `matriz-permissoes-riSZon.csv`, 16 linhas × 27 colunas.
- **Limite declarado:** a matriz descreve **visibilidade de menu** e **guardas de
  aplicação**. Ela **não** reflete as políticas de RLS do banco, que são a
  barreira real e podem ser mais restritivas.

---

## Tabela consolidada

| Ref. | Assunto | Arquivo principal | Confiança |
|---|---|---|---|
| EV-001 | 7 fases da jornada | `CLAUDE.md` §3 | ✅ |
| EV-002 | 87 rotas | `src/app/(app)/**/page.tsx` | ✅ |
| EV-003 | 30 itens de menu | `src/components/app-sidebar.tsx` | ✅ |
| EV-004 | 15 papéis + Admin | `src/lib/roles.ts` | ✅ |
| EV-005 | Papel × ambiente | `src/lib/roles.ts` | ✅ |
| EV-006 | Condições de menu | `src/app/(app)/layout.tsx` | ✅ |
| EV-007 | Financeiro em 3 níveis | `src/lib/finance/access.ts` | ✅ |
| EV-008 | Estoque: gestão × atendimento | `src/lib/stock-access.ts` | ✅ |
| EV-009 | Compras: comprar × pagar | `src/lib/purchases-access.ts` | ✅ |
| EV-010 | Exceção do dentista | `src/components/app-sidebar.tsx` | ✅ |
| EV-011 | Integrações não conectadas | `.env.example` + código | ✅ |
| EV-012 | 179 mensagens | `src/**/*.tsx` | ✅ |
| EV-013 | 8 erros traduzidos | `src/lib/finance/errors.ts` | ✅ |
| EV-014 | 384 ações de servidor | `src/**/actions.ts` | ⚠️ nomes sim, efeito não |
| EV-015 | Sem auto-cadastro | `src/app/login/` + Supabase | ✅ |
| EV-016 | Regra de ouro no banco | migração 0203 | ✅ |
| EV-017 | Duas camadas | `docs/ARQUITETURA-TECNICA.md` | ✅ |
| EV-018 | LGPD | `CLAUDE.md` §6 | ✅ |
| EV-019 | Jornada testada ponta a ponta | `e2e/*.spec.ts` | ✅ |
| EV-020 | Matriz calculada | script sobre EV-006..009 | ✅ com limite |
| EV-021 | Manual e Sistema no menu, para todos os papéis | migração 0247 + `src/lib/permissions.ts` | ✅ |
| EV-022 | Relato de problema: campos e situações | `supabase/migrations/0247_diario_do_sistema.sql` | ✅ |
| EV-023 | Tela de erro com código e botão de relato | `src/app/(app)/error.tsx` | ✅ |
| EV-024 | Novidades filtradas por papel | `src/lib/changelog.ts` + `changelog.test.ts` | ✅ |
| EV-025 | Alertas reunidos sem porta nova | `src/app/(app)/sistema/page.tsx` (lê `finance_alerts` e as RPCs de estoque) | ✅ |
| EV-026 | Relatório é página própria, não a tela impressa | `src/components/relatorio-impresso.tsx` + `src/app/(app)/financeiro/recebiveis/**/relatorio/page.tsx` | ✅ |
| EV-027 | Moldura do sistema não sai no papel | `src/app/globals.css` (bloco `@media print`, `[data-moldura]`) + `finance-nav.tsx` | ✅ conferido no navegador em modo impressão |
| EV-028 | Planilha formatada, com número e data de verdade | `src/lib/finance/relatorio-xlsx.ts` + `relatorio.test.ts` | ✅ conferido abrindo o `.xlsx` gerado |
| EV-029 | PDF e planilha leem o MESMO modelo | `src/lib/finance/relatorio.ts` + `recebiveis/relatorio-dados.ts` | ✅ |
| EV-030 | Conversa do relato: nada se apaga, situação registrada por gatilho | `supabase/migrations/0256_relatos_conversa_e_tempo.sql` | ✅ provado no banco de teste (28 checagens) |
| EV-031 | Abas, busca, cores de idade (até 2 / 3–7 / mais de 7 dias) | `src/lib/system-reports.ts` + `system-reports.test.ts` | ✅ |
| EV-032 | Quem relatou complementa (aberto) e reabre com motivo (encerrado); não encerra | 0256 (`add_system_report_comment`, `reopen_system_report`) | ✅ |
| EV-033 | "Resposta nova" por relato; resposta seguinte reacende a boia | 0256 (`mark_system_report_seen`, `answer_system_report`) | ✅ conferido logado |
| EV-034 | Tela funciona em banco sem a 0256 (lista como antes) | `src/app/(app)/problemas/dados.ts` + `problemas-dados.test.ts` | ✅ |
| EV-035 | Anexos em pasta privada; tipo e tamanho travados no bucket; só quem relatou (aberto) e o suporte anexam | `supabase/migrations/0257_relatos_anexos.sql` | ✅ provado pelo Storage com 4 sessões (31 checagens) |
| EV-036 | Remoção por quem enviou ou suporte, com lápide e arquivo apagado | 0257 (`remove_system_report_attachment`) + `problemas/actions.ts` | ✅ |
| EV-037 | Captura real da aba, com o painel escondido na hora da foto; sem captura no celular | `src/lib/captura-de-tela.ts` | ✅ conferido no Chromium (imagem inspecionada) |
| EV-038 | Boia abre painel ao lado da tela atual, com tela e parte do sistema preenchidas | `src/components/report-nav-item.tsx` | ✅ conferido logado |
| EV-039 | Limites 5 por envio / 10 MB / 10 por relato; recusa com motivo | `src/lib/anexos-de-relato.ts` + teste | ✅ |
| EV-040 | Três caminhos de captura (esta tela / ir até a tela do problema / outra aba ou janela) e rascunho guardado ao navegar | `src/components/report-nav-item.tsx` + `src/lib/captura-de-tela.ts` | ✅ conferido logado (27 checagens; captura inspecionada sem a barra) |
| EV-041 | Tela e parte do sistema seguem a captura, salvo se editadas à mão; nome do arquivo leva a tela, sem id de ficha | `report-nav-item.tsx` + `anexos-de-relato.ts` + teste | ✅ |
| EV-042 | "Como usar o print" junto dos botões | `src/app/(app)/problemas/anexos.tsx` (`AjudaDoPrint`) | ✅ |
| EV-043 | Painel de indicadores e o escopo por papel (rede com ranking de pessoas × unidade sem) | `supabase/migrations/0258_painel_de_relatos.sql` + `src/app/(app)/problemas/painel/page.tsx` | ✅ provado no banco (26 checagens, números conferidos à mão) e na tela (Admin, Rede, Gerente, Recepção) |
| EV-044 | Regras: período pela data de registro; mediana; aproveitado = resolvido; Admin fora do ranking; parados sem título | 0258 (comentário) + quadro "Como ler este painel" | ✅ |
| EV-045 | Risartanos e "Usuários (acesso)" viraram uma tela: cada pessoa é uma linha com cadastro e login | `src/app/(app)/risartanos/page.tsx` + `src/app/(app)/risartanos/dados.ts` | ✅ conferido logado (Admin, Franqueadora, Gerente, Recepção) |
| EV-046 | As 5 situações de acesso, a ordem (risco no topo, pendência no fim) e os filtros | `src/lib/risartanos.ts` + `risartanos.test.ts` (23 testes) | ✅ |
| EV-047 | Permissões preservadas: acesso (login/senha/função) só do Admin Master; cadastro segue a RLS `can_manage_staff` | `src/app/(app)/risartanos/acesso-actions.ts` (`requireAdminMaster` em todas) + `[codigo]/page.tsx` | ✅ provado logado: gerente vê o acesso sem botões, 404 em cadastro de outra unidade, `/risartanos/acesso/[userId]` devolve o gerente para o Início |
| EV-048 | Criar acesso a partir do cadastro e completar cadastro a partir de um login | `risartanos/acesso.tsx` (`CriarAcesso`) + `risartanos/novo/page.tsx` + gatilhos da 0079 | ✅ provado ponta a ponta no banco de teste (cadastro sem login → acesso criado com função; login do TSB → cadastro ligado a ele) |
| EV-049 | Máscara de CPF, CEP e WhatsApp enquanto se digita (e de novo no servidor, antes de salvar) | `src/app/(app)/risartanos/formulario.tsx` + `src/lib/masks.ts` | ✅ conferido digitando só números: saiu `529.982.247-25`, `86000-000`, `(43) 99999-1234` |
| EV-050 | Função na unidade é campo do cadastro, validada contra a lista da clínica (não é texto livre) | `risartanos/actions.ts` (`funcoesDaClinica` + `oneOf`) | ✅ gravado no banco como `dentist` |
| EV-051 | Especialidades só para dentista; quem deixa de ser dentista perde as marcações | `src/lib/risartanos.ts` (`pedeEspecialidades`) + teste + `actions.ts` | ✅ conferido na tela (recepcionista: bloco ausente; dentista: presente) |
| EV-052 | Ficha em duas abas; sem cadastro completo não se cria acesso, e a aba diz o que falta | `risartanos/[codigo]/page.tsx` + `faltaNoCadastro` + teste | ✅ conferido logado (cadastro sem função trava a aba Acesso) |
| EV-053 | Ficha do acesso pré-preenchida (unidade, função e senha provisória sorteada no servidor) | `risartanos/acesso.tsx` (`CriarAcesso`) + `senhaSugerida` + teste | ✅ conferido logado; senha sem 0/O e 1/l |
| EV-054 | Acesso fora da unidade do cadastro exige autorização no ato e vai para a auditoria | `acesso.tsx` (autorização + ConfirmDialog) + `acesso-actions.ts` (`foraDaUnidadeDoCadastro`) | ✅ conferido: botão travado até autorizar |
| EV-055 | Três ambientes por pessoa (sistema/treino/Academy), com padrão: treino e Academy abertos, sistema fechado | `supabase/migrations/0259_ambientes.sql` (`environment_allowed`) + `src/lib/ambientes.ts` + teste | ✅ provado na tela e no banco |
| EV-056 | Modo portal: sem o sistema liberado, só Início, Perfil e Manual abrem — barrado no servidor | `src/lib/auth.ts` (`caminhoDoPortal`) + `src/proxy.ts` (cabeçalho `x-risarte-path`) | ✅ conferido logado: /agenda, /prontuarios, /financeiro e /risartanos devolveram para o Início |
| EV-057 | Atalhos do Início só aparecem com ambiente liberado E endereço preenchido | `cartoesDoInicio` + `src/lib/ambientes-db.ts` + teste | ✅ Academy sem endereço não vira cartão |
| EV-058 | Liberar o treino cria (ou reabre) o login no OUTRO banco; retirar bane. *Desde a 0.254.0 a função e a unidade não vêm mais daqui, e sim da cópia (EV-062)* | `src/lib/treino.ts` (`liberarNoTreino`) + `acesso-actions.ts` (`definirAmbiente`) | ✅ conferido ponta a ponta em 17/09 (retirar gravou `allowed:false`; liberar devolveu a senha provisória do treino) |
| EV-059 | Trocar a própria senha exige a senha atual e mantém a sessão de pé; a nova vale no treino | `src/app/(app)/perfil/actions.ts` (`trocarMinhaSenha`) | ✅ senha errada recusada, senha nova entra, sessão continua |
| EV-060 | Endereços dos ambientes são configuração do Admin, não código | `/admin/ambientes` + `set_environment_url` (0259) | ✅ salvo e lido pela tela de Início |
| EV-061 | No treino, Risartanos, acessos, perfil e permissões só para consulta — para todos, inclusive o Admin | três barreiras: tela (`dados.ts` `alcanceDoUsuario`, `adminEdita`, `somenteLeitura`), ações (`SOMENTE_CONSULTA_NO_TREINO` em `risartanos/actions.ts`, `acesso-actions.ts`, `permissoes/actions.ts`, `perfil/actions.ts`) e banco (gatilho `mirror_read_only`, 0260) | ✅ provado em 19/09: banco (Admin logado recusado) e tela do treino (sem Novo/Salvar/Criar acesso/Redefinir senha/Liberar/Retirar; fieldset travado; 375 caixas da matriz travadas; /risartanos/novo manda embora) |
| EV-062 | Cada alteração na produção copia a pessoa/ficha inteira para o treino, depois da resposta; falha vira pendência com aviso | `src/lib/espelho-treino.ts` (`agendarEspelho`, `after`) + `mirror_state` (0260) | ✅ primeira sincronização completa em 19/09: 3 logins, 2 fichas (campos iguais), funções por unidade iguais, 161 linhas de permissão idênticas; produção sem pendência |
| EV-063 | Regras da cópia: ambientes da produção, "sistema" do treino = treino liberado, login aberto só se ativo e liberado, foto na pasta da unidade de lá, nada de texto do banco nas mensagens | `src/lib/espelho.ts` + `espelho.test.ts` (14 testes) | ✅ testes puros |
| EV-064 | Lista do treino mostra só quem veio da produção; usuários de teste por função ficam fora | `dados.ts` (`mirrored_at`, `loginsEspelhados`) + 0260 | ✅ conferido logado no treino: só RIS-000001/000002; nenhuma -TREINO nem 000003/7/9; nenhum login de teste |
| EV-065 | Botão "Sincronizar treino agora" e aviso de pendência para o Admin | `/admin/ambientes` (`sincronizarTreinoAgora`) + `aviso-espelho-pendente.tsx` | ✅ dono sincronizou pela tela; no treino o botão não aparece |
| EV-066 | A ficha do treino mostra os ambientes do sistema REAL | `mirror_user_map.source_environments` (0260) + `carregarAmbientesDoUsuario` | ✅ gravado para as 3 pessoas copiadas |
| EV-067 | No treino, o nível de carreira do dentista continua editável (só ele); a cópia preserva o nível de lá | `0261` (`block_mirror_role_writes`) + `espelho.ts` (`nivelPreservado`, 3 testes) | ✅ provado no banco do treino: nível muda; função sozinha ou com nível recusada; estado restaurado |
| EV-068 | Numeração RIS-… ocupada no treino por ficha local: a local é renomeada (-TREINO), nada se apaga | `espelho-treino.ts` (`liberarNumeracao`) + `espelho.ts` (`codigoAfastado`, 2 testes) | ✅ provado na sincronização de 19/09: RIS-000001/000002 locais viraram -TREINO; nada apagado (5 locais seguem no banco) |
