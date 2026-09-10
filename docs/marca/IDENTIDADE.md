# A identidade visual do riSZon — o que o brandbook determina

Extraído do `BRANDBOOK RISARTE final.pdf` (762 MB, fora do Git — ver
[`.gitignore`](.gitignore)) em 09/09/2026. **Este documento é o resumo
operacional: o brandbook manda, e onde os dois discordarem, o brandbook vence.**

## A lógica que o brandbook já resolveu

> *"O sistema não dá uma cor isolada para cada frente, dá a cada uma um par
> central + detalhe, extraído sempre do mesmo núcleo (marinho e turquesa). É
> essa mecânica de inversão que diferencia as frentes sem fragmentar a marca:
> as cores são as mesmas, o que muda é quem lidera e quem apoia."*

Isso responde sozinho a pergunta desta entrega. **Não há paleta a inventar** —
há uma a aplicar.

| Frente da marca | Ambiente no sistema | Central | Detalhe |
|---|---|---|---|
| Risarte **Odontologia** | as **unidades** franqueadas | marinho `#003257` | turquesa `#01a7b5` |
| Risarte **Franchising** | a **Franqueadora** | turquesa `#01a7b5` | marinho `#003257` |
| Risarte **Empresarial** | o módulo **`/empresarial`** | marinho `#003257` | bordô `#711e38` |

O porquê, na palavra do brandbook:

- **Odontologia fala com o PACIENTE**, que busca segurança: marinho é o código
  universal de saúde e competência. A turquesa aquece.
- **Franchising fala com DENTISTAS E INVESTIDORES**, que precisam ver um negócio
  próspero: turquesa entrega energia e crescimento; o marinho recua para o
  detalhe e garante a credibilidade. *"É decisão de público, não de hierarquia."*
- **Empresarial fala de EMPRESA PARA EMPRESA**: marinho mantém o vínculo com
  saúde, e o bordô marca a mudança de interlocutor. **Nunca dominante, sempre
  em acento** — *"bordô dominante leria como luxo excludente"*.

## A paleta completa

| Cor | HEX | Pantone | Papel |
|---|---|---|---|
| Turquesa | `#01a7b5` | 7710 C | central (Franchising) / detalhe (Odontologia) |
| Azul-marinho | `#003257` | 540c | central (Odontologia, Empresarial) |
| Bordô | `#711e38` | 7421 C | detalhe, **só** no Empresarial |
| Off-white | `#efeee9` | 11-4201 TCX | fundo |
| Cinza claro | `#d9d9d7` | Cool Gray 1 C | bordas, separadores |
| Cinza azulado | `#768693` | 7544 C | texto secundário |
| Marinho profundo | `#061b2c` | 286 C | fundo do modo escuro |

## Tipografia — e por que a decisão já estava tomada

| Fonte | Papel no brandbook | Licença | No sistema |
|---|---|---|---|
| assinatura | só dentro da logo | — | vem pronta na arte |
| **NORD** | títulos institucionais | Designova®, **todos os direitos reservados** | **não usar** |
| **Inter** | *"interface, dedicada aos ambientes digitais — telas, formulários, aplicativos, sites e **sistemas**"* | **SIL Open Font License 1.1** | **é a nossa** |
| Satoshi | textos corridos institucionais | Indian Type Foundry (proprietária) | não usar |

⚠️ **O brandbook nomeia a Inter para o nosso caso exato**, e isso resolve de
graça um problema que seria caro: NORD e Satoshi são fontes proprietárias, e
embutir fonte proprietária num site publicado exige licença de webfont separada
da licença de desktop. Seguir o manual à risca evita a questão inteira.

Hoje o sistema usa **Geist**. A troca para Inter é, portanto, obediência ao
manual — não preferência.

## ⚠️ Três armadilhas desta paleta dentro DESTE sistema

**1. Vermelho, âmbar e verde já significam SITUAÇÃO.** SLA estourado, caixa
negativo, farol do orçamento, margem abaixo do mínimo. O **bordô** é a única cor
da marca que chega perto — por isso ele entra apenas como acento no Empresarial,
exatamente como o brandbook manda, e o vermelho de erro continua mais claro e
mais saturado que ele. Se um dia o bordô virar cor de botão principal, o
"excluir" e o "salvar" passam a ser parecidos.

**2. O dourado atual não existe no brandbook.** O token `--gold` pinta hoje os
contadores do chat, do sino e da boia. Ele sai; o contador passa a usar a cor de
detalhe do ambiente.

**3. O aviso de TREINO manda mais que a cor do ambiente.** Errar entre treino e
produção custa mais caro que errar entre Franqueadora e unidade. A faixa de
treino não cede espaço para a marca — a marca é que cede para ela.

## O que ainda não temos

**Vetor.** As 20 logomarcas vieram em PNG 1080×1080 com transparência. O
`LOGOS.ai` é um PDF de **20 páginas, zero imagens embutidas** — vetor puro, com o
texto já em contorno. É de lá que os SVGs precisam sair; o PNG serve para o
tamanho que a tela usa, mas não para impressão nem para ampliação.

**Pattern** só em PNG 1921×1081 (um por frente).
