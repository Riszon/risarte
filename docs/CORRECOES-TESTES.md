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
