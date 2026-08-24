# Correções achadas pelos testes — fila para o fim da camada 3

**Regra combinada com o dono (24/08/2026):** achado durante os testes **não
interrompe os testes**. Ele entra nesta lista com a prova do que acontece, e as
correções saem **todas juntas** no fim, num lote só. Parar a cada achado
transformaria a camada 3 numa sequência de desvios, e o valor dela está em
percorrer a jornada inteira.

Cada item traz: **o que é**, **como se prova**, **o que quebra se não for
corrigido** e **o tamanho da correção**.

---

## 1. A trava de CPF repetido não enxerga o CPF sem pontuação

**Achado em:** E2E-1, cadastro do paciente (24/08/2026).

**O que é.** O CPF é guardado com máscara (`123.456.789-09`) e a trava contra
cliente repetido é um índice único sobre esse **texto**. Para o banco,
`123.456.789-09` e `12345678909` são duas pessoas diferentes.

**Como se prova.** No banco de teste, inserindo o mesmo CPF sem pontuação em um
cliente novo: o banco **aceita**. (Feito em transação desfeita — não ficou
rastro.)

**Por que hoje não quebra.** Todo cadastro passa pela tela, e a tela sempre
aplica a máscara. A regra funciona por hábito do caminho, não por garantia.

**O que quebra se não for corrigido.** Qualquer caminho futuro que grave o CPF
sem pontuação — importação de planilha, ASAAS, ZapSign, integração nova — cria um
**paciente duplicado na rede**, exatamente o que "cliente é único na rede" existe
para impedir. Duplicado desses parte histórico clínico e financeiro em dois, e
ninguém descobre até alguém procurar o paciente e achar dois.

**Correção.** Migração pequena: trocar `clients_cpf_unique` por índice único
sobre `regexp_replace(cpf, '\D', '', 'g')`. Antes de criar o índice, conferir se
a produção já tem duplicado dessa forma (se tiver, o índice falha ao ser criado —
e isso também é informação).

**Tamanho:** pequeno. Uma migração, sem mudança de tela.

---

## 2. O Coordenador precisa clicar DUAS vezes para abrir a opção e aprovar o plano

**Achado em:** E2E-1 Fase 3, aprovação do plano (24/08/2026).

**O que é.** Na ficha do paciente, o Coordenador clica na seta para abrir a
opção de tratamento e **nada acontece**. Só no segundo clique ela abre — e é lá
dentro que ficam os botões *Aprovar opção* e *Reprovar opção*.

**Como se prova.** Robô na tela do Coordenador, com um plano aguardando
aprovação: depois do 1º clique, o botão "Aprovar opção" existe **0** vezes;
depois do 2º, existe **1**. Está preso pelo teste
`e2e/03-planejamento.spec.ts` → *"um clique devia abrir a opção para o
Coordenador"*, que **falha de propósito** enquanto o defeito existir e vira
verde quando ele for corrigido.

**Por que acontece.** Em
`src/app/(app)/prontuarios/[id]/planning-section.tsx` os dois lados usam
padrões diferentes para o mesmo estado:

- ao DESENHAR: `openOptions[o.id] ?? (canEditContent ? o.isPrimary : false)`
- ao CLICAR: `!(prev[o.id] ?? o.isPrimary)`

Para quem não edita (o Coordenador), a tela assume *fechado* e o clique assume
*aberto* — então o primeiro clique grava "fechado" por cima de "fechado", e a
tela não muda. Vale para a opção **principal**, que é justamente a que ele
precisa avaliar.

**O que quebra.** É o gargalo do núcleo clínico: aprovação de plano. Quem não
descobre o segundo clique conclui que o botão de aprovar não existe — e o caso
para no Centro de Planejamento, estourando o SLA de 24h.

**Correção.** Usar o MESMO padrão nos dois lugares (passar
`canEditContent ? o.isPrimary : false` também para o clique). Uma linha.

**Tamanho:** pequeno. Sem migração.
