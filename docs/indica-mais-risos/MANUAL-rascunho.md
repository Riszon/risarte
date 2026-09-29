# Indica +Risos — rascunho da seção do manual

> **RASCUNHO — não está no manual da equipe.** O módulo segue escondido (só o
> Admin Master vê). Quando o dono ligar as permissões, esta seção entra no
> `docs/treinamento/manual-treinamento-riSZon.md` no MESMO commit, com as
> evidências em `docs/treinamento/evidencias-riSZon.md`, a novidade em
> `src/lib/changelog.ts` e o Word regerado (`npm run manual:docx`) — §0c do
> CLAUDE.md. Conferir cada passo na tela antes de colar: o que mudar até lá
> muda aqui também.

## O que é

O Indica +Risos é o programa de indicação da Risarte. Um cliente vira
**Embaixador**, indica amigos e ganha **Riso Coins**, que troca por prêmios do
catálogo. A indicação anda sozinha: quando o indicado faz check-in na
avaliação, fecha a venda e paga a 1ª parcela, o sistema avança as etapas e
lança os pontos.

**Onde fica:** menu lateral → **Indica +Risos**. As abas no topo: Painel ·
Indicações · Embaixadores · Campanhas · Equipe · Resgates · Mensagens ·
Catálogo · Relatórios · Auditoria · Configurações.

**Quem vê:** recepção, SDR, consultor e assistente comercial, gerente,
franqueado e franqueadora. Dentistas, coordenação, TSB e ASB veem só os botões
**"Pedi indicação"** e **"Nova indicação"** na ficha do cliente.

## Regras que valem para todos

- **Riso Coins não são dinheiro** e não se trocam por dinheiro. Procedimento
  clínico nunca é prêmio: o prêmio é **Crédito Risarte** (vale em qualquer
  tratamento, depois da avaliação), produto de parceiro ou experiência.
- **Vale o primeiro registro.** A mesma pessoa não pode ser indicada duas vezes
  enquanto a primeira indicação estiver em andamento. Quem já é paciente não
  pode ser indicado, e ninguém indica a si mesmo.
- **Os pontos do registro ficam "pendentes"** e só liberam quando o indicado
  comparece. Os do fechamento ficam "em carência" até a 1ª parcela paga (ou o
  prazo). Venda cancelada na carência estorna os pontos.
- **LGPD:** o indicado precisa aceitar o contato. Sem aceite em 7 dias, a
  indicação é recusada e os dados do indicado são anonimizados. O Embaixador nunca vê diagnóstico,
  tratamento ou valor — só a etapa.

## Recepção e SDR

1. **Registrar uma indicação:** Indicações → **Nova indicação** (ou na ficha do
   cliente). Busque o Embaixador pelo nome, código ou telefone; preencha nome e
   WhatsApp do indicado; escolha a unidade. O sistema confere duplicidade na
   hora.
2. **Aceite do indicado:** marque como ele aceitou (pessoalmente ou por
   telefone). Se ainda não aceitou, marque "ainda não": o convite com o link
   vai para a aba **Mensagens**.
3. **Mensagens:** a fila tem o texto pronto. Clique em **Abrir WhatsApp**,
   envie e marque **Enviada**.
4. **Resgates:** o Embaixador pede o prêmio (na recepção ou pelo portal). Você
   aprova, entrega e, se for Crédito Risarte, informa o código do voucher na
   negociação.
5. Se aparecer **"os resgates deste Embaixador estão em análise"**, não é
   defeito: a franqueadora está conferindo um alerta. Oriente o cliente a
   aguardar o contato da unidade.

## Gerente e franqueado

- **Painel:** os números do período com a comparação ao período anterior do
  mesmo tamanho, o funil, a evolução de 12 meses e as **Ações do dia**
  (indicações paradas, quem faltou, resgates esperando, pontos a vencer).
- **Campanhas:** crie a partir de um modelo pronto, simule o custo pelo
  histórico da unidade, defina orçamento e **Publique**. Campanha em andamento
  só pode ser **ampliada**. A indicação entra sozinha na campanha mais
  vantajosa para o Embaixador.
- **Equipe:** crie a meta do mês (as faixas já vêm preenchidas), acompanhe com
  **Apurar agora** e, depois do período, faça a **Apuração final** e
  **Aprove**. O **Relatório para a folha** lista quem recebe o quê. O prêmio em
  dinheiro vai para a folha: o sistema **não** lança no Financeiro.
- **Relatórios:** retorno e custo por campanha, coortes e as planilhas (sem
  telefone ou e-mail dos indicados).
- **Auditoria:** você vê os alertas da sua unidade e os ajustes manuais.
  Quem decide o alerta é a franqueadora.

## Franqueadora

- Tudo o que o gerente vê, para a **rede inteira** (deixe a unidade em branco
  nos filtros).
- **Auditoria:** a conferência antifraude roda sozinha de madrugada (e pelo
  botão **Rodar conferência agora**). Para cada alerta: **Em análise** e depois
  **Decidir** (procedente ou improcedente, sempre dizendo o que foi apurado).
  Enquanto um alerta **alto** estiver aberto, os resgates daquele Embaixador
  ficam segurados.
- **Configurações:** pontos por etapa, carência, validade, níveis, limites do
  antifraude, modelos de mensagem, modelos de campanha e faixas das metas.
  Toda mudança vale **daqui para frente**: indicação registrada mantém a regra
  com que nasceu.

## Mensagens de erro que a equipe pode ver

| Mensagem | O que significa | O que fazer |
|---|---|---|
| "esta pessoa já foi indicada (IND-…). Vale o primeiro registro." | já existe indicação em andamento | abrir a indicação existente |
| "o indicado teve atendimento na rede nos últimos N meses" | já é paciente | não é indicação nova |
| "o Embaixador não pode indicar a si mesmo" | autoindicação | — |
| "os resgates deste Embaixador estão em análise pela franqueadora" | alerta de fraude alto em aberto | aguardar a franqueadora |
| "campanha em andamento não pode ter o multiplicador reduzido" | campanha ativa só amplia | encerrar e criar outra |
| "a final sai depois do período e da carência" | ainda há venda do período em carência | apurar a final depois |
