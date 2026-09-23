# Roteiro de teste — Módulo Risarte Empresarial

Passo a passo para validar o módulo inteiro, do cadastro da empresa ao dashboard.
Marque cada item ao concluir. Se algo não bater, anote o número do passo.

## 0. Antes de começar (uma vez)

1. No **SQL Editor do Supabase**, aplique as migrações **em ordem**: `0096`, `0097`,
   `0098`, `0099`, `0100`, `0101`, `0102`, `0103`. (Cada uma é segura para rodar de novo.)
2. No painel Supabase: **Project Settings → API → Exposed schemas** → adicione
   `empresarial` → **Save**. (Sem isso o módulo não enxerga as tabelas.)
3. Confira no rodapé da barra lateral: **versão 0.34.0 · migração 0103**.
4. Opcional (só para ASAAS/ZapSign/Gamma reais): cadastre `ASAAS_API_KEY`,
   `ZAPSIGN_API_TOKEN`, `GAMMA_API_KEY` no ambiente e faça deploy das Edge Functions
   `asaas-webhook` e `zapsign-webhook`. **Sem as chaves, tudo é testável** com a
   "baixa manual" / "marcar assinado".

## 1. Papel do Consultor RisLife (opcional, para testar o funil)

5. Como **Admin**, em **Administração → Usuários (acesso)**, crie/edite um usuário e
   dê a ele o papel **Consultor Comercial Empresarial (RisLife)** na **Franqueadora**.

## 2. Funil comercial (Fase 6)

6. Menu **Empresarial → Funil** (ou botão "Funil"). Clique **Novo lead**: preencha
   empresa, CNPJ, contato, valor estimado e uma **próxima ação** para hoje.
7. Veja o card na coluna **Captação** e o lead em **★ Hoje do consultor** (topo).
8. Mova o card pelas etapas (seletor no card). Abra o lead (**Abrir**): registre uma
   **nota/ligação** na linha do tempo.
9. No lead, clique **Fechar (ganho) → criar empresa**. Confirme que aparece uma
   **empresa nova** na lista de Empresas (o lead vira "Fechado (ganho)").

## 3. Configuração da rede (Fase 2)

10. **Empresarial → Configurações**. Aba **Preços de adesão**: confira os valores
    padrão (titular 39,90 etc.) e salve.
11. Aba **Split**: confira 1º pagamento 0%/100% e mensalidades 50%/50%.
12. Aba **Benefícios**: **Adicionar benefício** — ex.: procedimento "Limpeza",
    cobertura **Sem custo**, Usos **1**, A cada **6** meses. Salve.

## 4. Cadastro de empresa e colaboradores (Fase 1)

13. **Empresarial → Nova empresa**: CNPJ, razão social, **modelo de pagamento**
    (ex.: "Empresa paga integral"), dia de vencimento, meios de pagamento,
    **carência** (deixe 0 para testar liberado). Salve.
14. Abra a empresa → aba **Colaboradores** → **Novo colaborador** (nome, CPF, telefone,
    plano de dependentes). Repita para 2–3 colaboradores.
15. **Importar Excel**: baixe o modelo, preencha 2 linhas e importe — confira que
    aparecem na lista.
16. Em um colaborador, **Dependentes** → **Adicionar dependente** (CPF + parentesco).
17. Clique **Completar cadastro** num colaborador → escolha a **unidade** → confirme.
    Ele deve mostrar **★ Cliente vinculado** e o botão **Ver ficha**.
18. Abra a ficha (Ver ficha ou **Prontuários**): confirme o selo **★ Risarte
    Empresarial** no topo.

## 5. Mensalidade e simulador (Fase 2)

19. Na empresa, aba **Plano & Benefícios**: confira a **Mensalidade atual** (deve
    somar titular + dependentes dos colaboradores ativos).
20. Use o **Simulador** (mude os números) e veja o total recalcular.
21. Em **Preços de adesão** dessa empresa, mude um valor e salve → vira **override**
    (aparece "Voltar ao padrão da rede"). A mensalidade muda conforme o override.

## 6. Orçamento com benefício (Fase 3)

22. Como **Planner**, abra a ficha do cliente vinculado → **Plano de Tratamento**.
    Crie uma opção e adicione o procedimento com benefício (ex.: Limpeza).
23. Confira o banner **★ Risarte Empresarial** e, na opção, a linha **"Com Risarte
    Empresarial: R$ … · economia R$ …"** (valor cheio × com programa).
24. (Frequência) Depois de **concluir** um atendimento dessa limpeza (painel
    **Atendimento**), o benefício deve constar como **usado**; ao orçar de novo antes
    de 6 meses, o painel do cliente mostra "aguardando liberação" com a data.

## 7. Painéis de uso e economia (Fase 7)

25. Na ficha do cliente, veja o card **★ Programa Empresarial**: economia acumulada,
    benefícios usados, disponíveis agora e histórico.
26. **Empresarial → Painel**: confira os KPIs (empresas ativas, colaboradores,
    **mensalidade MRR**, **economia gerada**, funil aberto) e a tabela por empresa.
27. Na empresa, aba **Financeiro**: economia gerada + benefícios utilizados.

## 8. Riso+ Social (Fase 8)

28. Na empresa (modelo "integral" ou "parcial"), aba **Riso+ Social** → escolha um
    gatilho → **Gerar ficha social**. (No modelo "colaborador paga", o botão explica
    que não participa.)
29. Numa ficha integral, **Atribuir** um beneficiário e depois **Marcar utilizada**.

## 9. Financeiro / ASAAS (Fase 4)

30. Na empresa, aba **Financeiro** → **Gerar cobrança mensal**. Aparece uma linha
    **Pendente** com o valor da mensalidade e o vencimento.
31. Clique **Marcar pago** → a linha vira **Pago** e mostra o **split** (Risarte/RisLife).
32. (Inadimplência) Gere uma cobrança, e para simular atraso rode **Checar
    inadimplência** após o vencimento — a empresa vira **Suspensa** e os benefícios
    ficam bloqueados (aparece o aviso na ficha/orçamento).

### 9.1. Estornar uma baixa (relato OC-00058, entregue em 22/09/2026)

Baixa incorreta acontece — o que não pode é ficar sem saída dentro do sistema.

32a. Em **Empresarial → Cobranças**, a linha **Paga** mostra o botão
     **Estornar**. Nas demais situações ele não aparece: não há baixa a desfazer.

32b. Clique nele. O sistema **exige o motivo** (mínimo de 5 letras) e avisa o
     que vai acontecer antes de confirmar.

32c. **Resultado esperado:** a cobrança volta à **situação do vencimento** —
     **Em atraso** se já venceu, **Pendente** se ainda não —, o pagamento e o
     **split Risarte/RisLife são apagados**, e o motivo fica gravado com o nome
     de quem estornou.

32d. **Se a empresa tinha sido reativada por aquela baixa** e continua devendo
     além da carência de 5 dias, ela é **suspensa de novo**. Isto é de
     propósito: estornar não pode virar um jeito silencioso de manter ativa uma
     empresa inadimplente.

32e. Tente estornar a mesma cobrança duas vezes — o sistema recusa, porque não
     há mais baixa a desfazer.

### 8.1. Boas-vindas — a fila de ligação (pedido do dono, 11/09/2026)

Serve a **recepção e a SDR**: ligar para quem entrou no programa, dar as
boas-vindas, completar o cadastro e marcar a primeira consulta.

29a. Na empresa, aba **Colaboradores** → botão **Boas-vindas** (o primeiro).

29b. A lista traz **uma linha por pessoa** — titular e cada dependente —
     agrupadas por família, com telefone, o que falta no cadastro e **a partir
     de quando cada um pode agendar**. Dependente sem telefone próprio mostra o
     do titular.

29c. No alto, o bloco **Carências desta empresa**: a da empresa (contada do
     início do contrato), a do colaborador (contada da entrada de cada um) e a
     lista de **procedimentos com carência própria**.

29d. Clique em **Registrar** numa pessoa e escolha o resultado. **"Não atendeu"
     e "pediu para ligar depois" CONTINUAM na aba "Falta ligar"**; "falei com a
     pessoa" e "não quer agora" saem. Registre de novo na mesma pessoa: o
     registro é **atualizado**, não duplicado.

29e. O botão de desfazer (seta) apaga o registro e a pessoa volta para a fila.

29f. Troque para a aba **Todas as pessoas** para ver quem já foi contatado, com
     a data, quem ligou e a observação.

> ⚠️ **A carência mostrada é a GERAL** (empresa + colaborador, vale a mais
> longa). Os procedimentos com carência própria aparecem na lista do topo e
> **não** entram na data de cada pessoa: como o prazo é diferente por
> procedimento, uma data única estaria errada para quase todos os casos. Quem
> decide na hora do orçamento continua sendo o motor de benefícios.

> ⚠️ **A lista traz só quem está ATIVO** no programa. Quem saiu não recebe
> boas-vindas.

### 9.1. Cobranças de TODAS as empresas (relato OC-00004)

32a. Em **Empresarial**, clique em **Cobranças** (no alto). Abre a lista de todas
     as empresas juntas — era isto que faltava: antes só dava para ver empresa
     por empresa.

32b. Confira os quatro quadros (**Em aberto**, **Vencidas**, **Pagas**, e quantas
     cobranças estão na tela). Eles somam **o que está na lista**, com os filtros
     aplicados — mude a situação e veja os números acompanharem.

32c. Filtre por **situação** e por **período de vencimento**, e busque pelo nome
     da empresa.

32d. Marque duas ou três cobranças pendentes e clique **Dar baixa**. Ao terminar
     aparece um aviso dizendo **quantas entraram e quais ficaram de fora, com o
     motivo** (já paga, cancelada, ou o banco recusou). Cobrança já paga não pode
     ser marcada — a caixa de escolher vem desabilitada.

32e. Clique **Gerar mensalidades**, escolha as empresas e confirme. Empresa que
     **já tem cobrança do mês é pulada**, e o aviso do fim diz quais. Gere duas
     vezes seguidas para ver a segunda não duplicar nada.

32f. **Imprimir a lista** manda a tabela para o papel (as caixas de escolher
     saem).

> ⚠️ **São cobranças, não boletos.** O sistema registra valor, vencimento e
> pagador; a baixa é **manual**. A emissão de boleto pelo ASAAS ainda **não está
> ligada** — a função existe no código e não é chamada por lugar nenhum. A tela
> declara isso no alto. Quando a emissão for ligada, o link do boleto entra
> nesta mesma tela.
>
> ⚠️ **Falta uma trava no banco.** Nada impede, no banco, criar duas
> mensalidades do mesmo mês para a mesma empresa. A tela nova evita isso ao
> gerar em lote, mas duas pessoas gerando ao mesmo tempo ainda passariam. A
> trava de verdade é um índice único e precisa de migração — decisão do dono.
> **Conferido em 10/09/2026: não há duplicata nos dados de teste**; as duas
> linhas da Xamacudo no mesmo mês são o modelo "um boleto por CNPJ", que é o
> comportamento certo.

## 10. Contratos e proposta (Fase 5)

33. Na empresa, aba **Contratos** → **Novo contrato** (título + assinante). **Enviar**
    → **Marcar assinado** (simula o retorno da ZapSign).
34. (Se `GAMMA_API_KEY` configurada) **Gerar proposta** → aguarde → **Abrir proposta
    no Gamma**. Sem a chave, o cartão explica que está desativado.

## 10.1. A ficha da empresa em abas (relato OC-00083, entregue em 23/09/2026)

Objetivo: conferir que a ficha abre na etapa em que a empresa está e que cada
aba diz o que falta.

1. **Funil comercial** → abra uma empresa que esteja em **Captação**.
   - O cabeçalho deve dizer **"Funil comercial · Captação"** (a fase de
     verdade, não "fase 4").
   - Deve abrir na aba **Levantamento**, com o selo **agora** nela.
2. Olhe a fita de abas: **Levantamento · Apresentação · Envio e selos ·
   Fechamento**, cada uma com uma linha embaixo dizendo a situação
   (*falta 2 campos*, *modelo da rede*, *nada enviado*, *em aberto*).
3. **Troque de aba sem salvar.** Digite algo no Levantamento, vá para
   Apresentação e volte: **o que você digitou tem de continuar lá**. As abas
   escondem, não apagam.
4. Abra agora uma empresa em **Proposta enviada** ou **Follow-up**: tem de
   abrir direto em **Envio e selos**.
5. Uma em **Implantação** ou **Fechamento (ganho)**: abre em **Fechamento**.
   Com passos de implantação pela metade, a aba diz **"implantação 3/7"** —
   nunca "concluída".
6. Uma empresa **perdida** abre em **Fechamento**, não no levantamento.
7. **Nenhuma aba é trancada, de propósito**: dá para ir ao Envio mesmo com o
   levantamento incompleto. A aba avisa o que falta; quem decide a ordem é
   quem atende.

## 10.2. A proposta como documento (relato OC-00083, entregue em 23/09/2026)

1. Abra uma empresa **sem levantamento**. A aba **Levantamento** deve dizer
   **"não começou"** — nunca "falta 1 campo".
2. Na ficha, o botão **Ver a proposta** (ao lado da simulação) fica
   **desligado**, com o aviso de preencher o que falta.
3. Abra pelo endereço direto `/empresarial/funil/<id>/proposta`: a página
   **recusa** e lista o que falta, com botão de voltar. Ela NÃO pode imprimir
   "R$ 0,00" com cara de proposta.
4. Agora uma empresa **com levantamento completo**: clique em **Ver a
   proposta**. Abre em outra aba com cabeçalho, razão social, CNPJ, data de
   emissão e **validade de 15 dias**.
5. Confira o quadro: **Mensalidade · Por colaborador · Empresa paga ·
   Colaborador paga**, e a frase de quem paga o quê.
6. **Salvar em PDF**: os botões do topo somem na impressão; o arquivo sai como
   `risarte-empresarial_proposta_<empresa>_<data>`.
7. ⚠️ **Confira o que NÃO está lá**: interesse, chance de fechar e observações
   do consultor são notas internas e não podem aparecer — o documento vai para
   a mão da empresa.
8. Ponha no levantamento um convênio atual **mais barato** que o programa: o
   documento tem de dizer que custa **mais**, e não esconder.

## 11. LGPD / retenção (Fase 8)

35. Como **Admin**, em **Empresarial → Configurações**, use **Rodar retenção agora** —
    ela anonimiza dados de quem saiu há mais de 5 anos (rotina também roda sozinha
    todo mês).

---

**Observações:**
- ASAAS/ZapSign/Gamma são serviços externos: a estrutura está pronta e testável com
  as ações manuais; para o fluxo real, cadastre as chaves e faça o deploy das Edge
  Functions.
- Os relatórios da rede nunca expõem dados de paciente; o Consultor RisLife não
  acessa dados clínicos (LGPD).
