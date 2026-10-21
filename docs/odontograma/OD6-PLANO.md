# Odontograma — Fase OD6: histórico e prontuário (plano, sem código)

*21/10/2026 · base: o pedido do dono (OD0, fase OD6: "linha do tempo,
adendos, exportação do prontuário (LGPD)"; OD0 §3, o prontuário digital),
as decisões D6, D9, E1, H1–H4, e a leitura do sistema na versão 0.339.0.*

> **Em uma frase:** o que foi registrado no atendimento deixa de poder ser
> reescrito (corrige-se com **adendo**, com motivo), a ficha ganha uma **linha
> do tempo clínica** com o odontograma de qualquer dia do passado, e sai o
> **prontuário completo** do paciente para imprimir/salvar em PDF — o que a LGPD
> pede quando o paciente solicita os dados dele.

---

## 1. O que existe hoje

| Assunto | Hoje | O furo |
|---|---|---|
| **Evolução** (Desenvolvimento Clínico) | O autor escreve com salvamento automático; a tela para de oferecer a edição quando o atendimento é concluído | **Só a tela para.** Pelo banco, o autor ainda altera a evolução **para sempre** (até o atendimento, o cliente e a unidade da anotação). A trilha de auditoria guarda o antes/depois, mas só o Admin lê — ninguém vê na ficha que o texto mudou |
| **Diagnóstico por rodada** | Finalizado = trancado no banco (E1), com o "carimbo" (SHA-256) do conteúdo | Ok. O carimbo é gravado e **nunca é mostrado** |
| **Documentos clínicos** (receita, atestado, declaração, orientação) | Emitidos e impressos; nenhuma tela altera depois | A **regra do banco** deixa o autor alterar o documento já emitido, para sempre |
| **Anamnese** | Cada preenchimento é uma versão; a migração diz "imutável" | A **regra do banco** deixa o Coordenador/Admin alterar e apagar versões. A única remoção que a tela faz é desfazer uma versão que acabou de nascer sem respostas |
| **Linha do tempo** | Existem várias, separadas: a da jornada, a do plano (histórico), a das sessões, a da evolução | **Não há uma linha do tempo clínica** juntando tudo; o odontograma só mostra o **hoje** (a conta "em uma data" existe, mas nenhuma tela usa) |
| **Prontuário completo / LGPD** | Abrir a ficha é auditado; cada documento se imprime sozinho | **Não existe** exportação do prontuário (nem pedido de dados do paciente) |
| **Assinatura digital** | Colunas de assinatura só na rodada de avaliação; nada as usa | Segue para quando houver a chave do ZapSign (D9) |

**A produção tem 0 evoluções e 0 achados** — nada para adaptar.

---

## 2. Como vai funcionar

### 2.1. Evolução: tranca e adendo (decisão J1)

- Enquanto o atendimento está aberto, a evolução se escreve e se corrige
  livremente (como hoje).
- **Depois que tranca (J1), o banco recusa alterar.** Para corrigir: botão
  **Adendo** na própria anotação → texto + **motivo** (mínimo de 5 letras). O
  adendo aparece **logo abaixo** da original, com autor, data e motivo. A
  original não muda e não some.
- Anotação "solta" (sem atendimento) tranca no **fim do dia** em que foi
  escrita.
- Os **documentos clínicos** emitidos passam a não mudar pelo banco (já não
  mudam pela tela); errou, emite outro. A **anamnese** passa a ser imutável
  também no banco (como a migração dela já diz), mantendo o "desfazer" da
  versão recém-criada sem respostas.

### 2.2. Linha do tempo clínica (decisão J2)

Na ficha, uma aba (ou seção) **Linha do tempo**, do mais novo para o mais
antigo, juntando o que já existe espalhado: avaliações abertas e
**finalizadas**, achados definidos e retirados, planos (versões, aprovação,
substituição), a venda, as sessões feitas, a evolução e os **adendos**, os
documentos emitidos. Cada linha com data, quem e um resumo — e o link para o
lugar.

Ao lado: **"Ver o odontograma neste dia"** — escolhe a data (ou clica num
evento) e o desenho mostra a boca **como estava naquele dia**: achados
definidos até ali, retiradas até ali, procedimentos feitos até ali (H1/H2).

⚠️ Um limite que eu digo antes: quando uma sessão é **reprovada e vai para
refação**, o sistema apaga a data em que ela tinha sido feita (é assim desde
a 0143). Para dias anteriores à refação, o desenho usa o **registro de cada
atendimento** (que guarda o que foi feito e quando), não a sessão.

### 2.3. O prontuário completo (decisões J3 e J4)

Uma página própria (como o orçamento), **Prontuário — imprimir / salvar em
PDF**, com:

1. identificação do paciente e da unidade;
2. consentimentos (data, versão, quem colheu);
3. anamnese — **todas** as versões, com as respostas;
4. avaliações por rodada — considerações, lista de fotos e exames (nome,
   tipo, data) e o diagnóstico por dente, com o **carimbo** de quando foi
   finalizado;
5. odontograma de hoje (miniatura impressa) e a lista do que foi feito;
6. planos — a versão que vale, as substituídas, o que foi aceito;
7. sessões, evolução e adendos, em ordem;
8. documentos clínicos emitidos;
9. rodapé: **"Gerado por … em … · motivo: …"** — toda geração fica na
   auditoria.

---

## 3. O que muda no banco (migração 0315, no treino primeiro)

- `clinical_progress_notes`: `addendum_of` (a anotação corrigida) e
  `addendum_reason`; gatilho que **recusa alterar** depois de trancada (J1)
  e recusa trocar cliente/unidade/atendimento; adendo só pela função
  `add_progress_addendum` (quem pode escrever evolução naquele atendimento,
  ou o autor da original).
- `clinical_documents`: sem alteração depois de emitido.
- `anamnesis_fills` / `anamnesis_answers`: imutáveis; apagar só a versão sem
  respostas, logo depois de criada.
- A linha do tempo e o prontuário **leem o que já existe** — nada novo para
  guardar, além da auditoria de cada exportação.

## 4. Telas

| Tela | O que muda |
|---|---|
| Ficha → Desenvolvimento Clínico | anotação trancada mostra **"Adendo"**; os adendos abaixo da original |
| Ficha → **Linha do tempo** (nova) | os eventos clínicos + "ver o odontograma neste dia" |
| **Novo:** prontuário completo | página para imprimir / salvar em PDF, com motivo (J3) |

**Fica para depois:** a assinatura digital (ZapSign — D9); entregar os
**arquivos** das fotos e exames em pacote (J4); a anonimização do paciente
(não existe função no núcleo — vira item do BACKLOG).

---

## 5. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **J1** | Quando a **evolução** tranca (e só se corrige por adendo)? | **Quando o atendimento é concluído** (é quando ela vira registro; hoje a tela já para ali). Anotação sem atendimento: no fim do dia |
| **J2** | A **linha do tempo** | **Uma linha do tempo clínica única** + "ver o odontograma neste dia" |
| **J3** | Quem **gera o prontuário completo** | **O Admin Master e o Gerente da unidade**, sempre com o **motivo** (pedido do paciente, transferência, auditoria, ordem judicial…) e tudo na auditoria |
| **J4** | As **fotos e exames** no prontuário | **A lista** (nome, tipo, data) no PDF; os arquivos, só sob pedido (fica para depois) |

---

## 6. Como vai ser provado

Ensaio da 0315 no treino (transação desfeita, 2×): evolução aberta altera,
trancada recusa; adendo com motivo; quem não pode, recusa; documento e
anamnese imutáveis (e o "desfazer" da versão vazia ainda funciona). Testes
da parte pura (a linha do tempo montada e ordenada; o odontograma em uma
data, inclusive o caso da refação) + prova de quebra. Tela no treino com o
cliente de ensaio (que já tem avaliação, plano, sessões e evolução).
