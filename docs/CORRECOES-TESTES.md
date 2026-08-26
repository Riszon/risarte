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
> **LOTE 2 — fila aberta (26/08/2026).** Os itens **3** e **4** abaixo saíram do
> teste de estoque, que agora está **completo e verde**: a baixa automática do
> kit do procedimento está provada de ponta a ponta. Nenhum dos dois foi
> corrigido ainda; o item 3 tem contorno em uso no teste.

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

**Correção.** É a limpeza do modal (Base UI) não desfazendo o `aria-hidden` ao
desmontar — provavelmente por causa dos avisos **empilhados**: os dois marcam o
mesmo invólucro e só um restaura. Investigar o componente de diálogo em
`src/components/ui/` e garantir que a marca só saia quando o **último** modal
fechar.

**Contorno em uso no teste:** os avisos passaram a ser fechados pelo **botão
"Fechar"**, nunca por Esc, e `garantirTelaVisivel` (em `e2e/apoio.ts`) confere se
a tela voltou, recarregando quando não voltou. **Quando a correção sair, o
contorno pode ser removido.**

**Tamanho:** pequeno a médio. Sem migração.

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

**Correção.** Cronômetro é informação do **agora**, e o servidor não tem "agora"
compartilhado com o navegador: desenhar o tempo só depois de montar no cliente
(o servidor mostra o rótulo sem o número). Vale para os dois componentes.

**Tamanho:** pequeno. Sem migração.

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
