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

## 10. Contratos e proposta (Fase 5)

33. Na empresa, aba **Contratos** → **Novo contrato** (título + assinante). **Enviar**
    → **Marcar assinado** (simula o retorno da ZapSign).
34. (Se `GAMMA_API_KEY` configurada) **Gerar proposta** → aguarde → **Abrir proposta
    no Gamma**. Sem a chave, o cartão explica que está desativado.

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
