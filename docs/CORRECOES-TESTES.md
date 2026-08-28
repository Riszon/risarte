# Correções achadas pelos testes — fila para o fim da camada 3

> **LOTE 1 ENTREGUE em 25/08/2026 (v0.220.0 · migração 0244).** Os dois itens
> abaixo estão **corrigidos e provados**. Ficam registrados porque a explicação
> de *por que* cada um existia é o que impede o mesmo erro de voltar.
>
> - **Item 1 (CPF):** migração 0244 aplicada na produção. Conferido depois de
>   aplicar, não só "rodou sem erro": gravar um CPF existente sem pontuação é
>   **recusado** pelo índice `clients_cpf_digits_unique`.
> - **Item 2 (clique duplo):** corrigido em `planning-section.tsx`. O teste que
>   nascera como *falha esperada* ficou **verde sozinho** e virou guarda
>   permanente; os contornos foram removidos dos dois lugares onde viviam.
>
> **LOTE 2 ENTREGUE em 27/08/2026 (v0.222.0, sem migração).** Os itens **3** e
> **4** saíram do teste de estoque e estão **corrigidos e provados** — pelo
> caminho que falhava, não por um caminho parecido: um paciente que acabou de
> fechar venda (que gera os DOIS avisos empilhados), fechados **só pelo
> teclado**. Depois disso as quatro abas da ficha continuam existindo e nenhum
> ancestral ficou marcado como escondido; a tela de Atendimento abriu com **zero**
> erros. A prova rodou como teste temporário e foi apagada: o que ela garante
> agora é guardado pelo próprio sistema (`AccessibilityGuard`) e pelo
> `useNow()`.

**Regra combinada com o dono (24/08/2026):** achado durante os testes **não
interrompe os testes**. Ele entra nesta lista com a prova do que acontece, e as
correções saem **todas juntas** no fim, num lote só. Parar a cada achado
transformaria a camada 3 numa sequência de desvios, e o valor dela está em
percorrer a jornada inteira.

Cada item traz: **o que é**, **como se prova**, **o que quebra se não for
corrigido** e **o tamanho da correção**.

---

## 3. Fechar o aviso pelo teclado apaga a tela inteira para quem usa leitor de tela

**Achado em:** E2E-5 (estoque), 26/08/2026 — depois de uma investigação inteira,
porque o sintoma engana.

**O que é.** Os avisos modais da recepção ("Agendar apresentação comercial",
"Fechamento! Iniciar tratamento") escondem o resto da página enquanto estão
abertos — isso é correto e é como todo modal funciona. O defeito é o que sobra
**depois** de fechar: quando o aviso é fechado pela tecla **Esc**, o invólucro da
aplicação continua com `aria-hidden="true"`, e ninguém o remove.

**Como se prova.** Robô na ficha do paciente, depois de fechar os avisos com
Esc: nenhum aviso aberto, a página desenhada normalmente, 34 botões e 4 abas
presentes no HTML — e **zero** elementos encontrados por papel. Perguntando ao
navegador quem está escondendo:

```
ancestraisEscondidos: ["DIV.flex min-h-screen w-full aria-hidden=true"]
```

**Por que engana.** Os elementos continuam na tela e no HTML: quem olha a foto
do erro vê o sistema inteiro funcionando. O que sumiu foi a **árvore de
acessibilidade** — a versão da página que um leitor de tela (e o robô) usa para
saber o que existe. É defeito invisível para quem enxerga o monitor.

**O que quebra.** Para **quem depende de leitor de tela, a tela fica vazia**
depois de fechar um aviso pelo teclado — e fechar pelo teclado é justamente o
gesto de quem navega sem mouse. Só recarregar a página resolve. Também explica
instabilidade antiga dos testes: qualquer passo depois disso parecia "página não
carregou".

**A CAUSA, encontrada no código da biblioteca** (Base UI 1.5.0,
`floating-ui-react/utils/markOthers.js`). A marca é **contada**: cada modal
aberto soma 1 no invólucro e só o último a fechar apaga. Mas quando a conta
chega a zero a biblioteca descarta a tabela inteira de contagens:

```js
lockCount -= 1;
if (!lockCount) { counters['aria-hidden'] = new WeakMap(); }
```

Se uma limpeza atrasada roda depois disso, o contador vira **−1**, e o teste que
apaga a marca é `if (!counterValue)` — **falso para −1**. A marca fica para
sempre. Com dois avisos empilhados (a recepção recebe "agendar apresentação" e
"iniciar tratamento" ao mesmo tempo), essa corrida acontece.

**CORRIGIDO (27/08/2026):** `AccessibilityGuard`
(`src/components/accessibility-guard.tsx`), montado no layout. Ele vigia a
página e, **só quando não há nenhuma janela aberta**, apaga a marca que tenha
sobrado por cima da aplicação. Enquanto houver modal, menu ou lista suspensa, a
marca é legítima e ele não encosta.

É **contorno de um defeito da biblioteca**, não decisão de desenho: quando o
Base UI corrigir a contagem, o arquivo inteiro pode sair. Está escrito lá.

No teste, os avisos continuam sendo fechados pelo **botão "Fechar"** (mais
próximo do que uma pessoa faz) e `garantirTelaVisivel` segue como segunda rede.

---

## 4. O cronômetro ao vivo é desenhado no servidor e briga com o navegador

**Achado em:** E2E-5 (estoque), 26/08/2026 — no registro do servidor, durante
uma execução que passou.

**O que é.** `LiveTimer` (painel de Atendimento) e `AttendanceClock` (ficha)
mostram "Em espera há 0:04". O servidor desenha `0:03`, o navegador chega um
segundo depois e desenha `0:04` — e o React derruba a árvore inteira com
*"Hydration failed because the server rendered text didn't match the client"*.

**Como se prova.** Abrir `/atendimento` com paciente em espera: o erro sai no
console a cada carregamento, com o diff `+ 0:04 / − 0:03`.

**O que quebra.** Nada visível: o React redesenha e o tempo aparece certo. O
custo é outro — **um erro de verdade fica escondido no meio do ruído**, e a
varredura de telas (camada 2) procura exatamente marcas de erro na página.
Erro que sempre aparece é erro que ninguém lê.

**CORRIGIDO (27/08/2026):** `useNow()` (`src/lib/use-now.ts`), um relógio só
para a tela toda, que **devolve nada no servidor**. Usa `useSyncExternalStore`,
que existe para este caso: a resposta do servidor (`null`) vale também no
primeiro desenho do navegador, e só depois entra o valor de verdade — não há
instante em que os dois discordem.

Enquanto não há hora, aparece um **traço**, nunca "0:00": número errado por um
instante é pior que ausência declarada. E o que aparece na tela não muda com o
relógio (a frase "Em atendimento há…" depende de o paciente ter sido chamado,
não da hora), senão a tela piscaria de uma frase para outra.

Ganho de brinde: o painel de Atendimento tinha **um despertador por paciente na
fila**; agora é um só para todos.

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
