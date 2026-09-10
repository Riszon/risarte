# Arquivos de marca — o que colocar aqui

Esta pasta guarda **a fonte da identidade visual**: o que o sistema desenha na
tela sai daqui, e não da memória de ninguém.

**Decisões do dono (09/09/2026):**

- **Uma marca, três assinaturas** — o mesmo símbolo Risarte, com complemento por
  ambiente: `Risarte`, `Risarte Empresarial`, `Risarte <unidade>`.
- **Cor principal diferente por ambiente**, mantendo tipografia, pattern e
  espaçamento iguais. Um sistema só, três tons.
- Os três ambientes: **Franqueadora**, **Unidades franqueadas**, **Empresarial**.
- **Todas as unidades usam o MESMO tom.** O que diferencia Cambé de Londrina é o
  nome, não a cor. Com 200 unidades na meta, cor por unidade viraria arco-íris
  sem significado — e cor que não significa nada é cor que ninguém lê.
- **A regra da cor tem duas metades:** o sistema segue a **unidade ativa**
  (Franqueadora ou unidade) e as telas de **`/empresarial` usam o tom delas**
  mesmo com uma unidade ativa. O Empresarial é um lugar, não um chapéu.
- **O modo escuro ENTRA** — três tons × claro/escuro = **seis conjuntos de cor**,
  e cada tela precisa ser conferida nas duas luzes.
- **RisLife NÃO é assinatura visível** (só o nome da outra parte no acerto
  financeiro). Não há quarta marca a receber.
- **Feito AGORA, antes do recadastro** — decisão do dono contra a recomendação de
  fazer depois. O custo assumido é adiar a abertura para a equipe.

### ⚠️ O MODO ESCURO ESTÁ INALCANÇÁVEL HOJE

`globals.css` define as cores de `.dark`, mas **nada no sistema jamais põe essa
marca na página**: não há botão nem seguimento da preferência do sistema
operacional. Pintar três paletas escuras sem resolver isso seria trabalho que
ninguém enxerga e que nenhum teste alcança — a mesma armadilha do portão que
passa por ausência. Por isso a entrega do escuro leva junto o meio de ligá-lo.

## O que colocar (nomes sugeridos, mas o que importa é o formato)

| Arquivo | Formato | Por que |
|---|---|---|
| `manual-de-marca.pdf` | PDF | A fonte de tudo. Cores, tipografia, usos e proibições. |
| `logo-horizontal.svg` | **vetor** | A assinatura principal. |
| `logo-vertical.svg` | **vetor** | Para espaço estreito. |
| `simbolo.svg` | **vetor** | Só o losango — é o que cabe num ícone de 24 px. |
| `logo-mono-clara.svg` | **vetor** | Uma cor só, para fundo escuro. |
| `logo-mono-escura.svg` | **vetor** | Uma cor só, para fundo claro. |
| `pattern.svg` | **vetor** | O padrão gráfico. |
| `fontes/` | `.woff2` / `.otf` | Só se NÃO for do Google Fonts. Com a licença junto. |
| `empresarial/` | vetor | A assinatura do Risarte Empresarial. |
| `pecas/` | qualquer | Fachada, cartão, uniforme, post, apresentação. Referência de sensação. |

## ⚠️ VETOR NÃO É DETALHE, É REQUISITO

A logo de hoje (`public/risarte-logo-branca.png`) é um **PNG branco usado como
recorte**: o sistema pinta o desenho com a cor que quiser, e por isso a mesma
arte serve em branco, navy ou dourado sem arquivo novo.

**Esse truque só funciona com logo de UMA cor.** Logo colorida em PNG fica com
borda serrilhada ao ampliar e não se adapta ao fundo escuro. Se a marca nova
tiver mais de uma cor, o vetor deixa de ser conveniência e passa a ser a única
forma de fazer certo.

## ⚠️ DUAS CORES JÁ ESTÃO OCUPADAS DENTRO DO SISTEMA

Vermelho, âmbar e verde significam **situação** em toda parte: SLA estourado,
alerta de caixa, farol do orçamento, margem abaixo do mínimo. Se a cor principal
de um ambiente for vermelha ou verde, o status deixa de ser lido como status —
a pessoa vê vermelho e não sabe se é a marca ou se é problema.

Por isso a escolha dos três tons não é livre: ela tem de deixar essas três
faixas reservadas.

## ⚠️ E O SINAL DO TREINO MANDA MAIS QUE O DA MARCA

O ambiente de treino (`risarte-treino.vercel.app`) se anuncia hoje pelo nome da
aba e por uma faixa. Errar entre treino e produção custa mais caro que errar
entre Franqueadora e unidade — é cadastrar paciente no lugar errado. **Qualquer
cor de ambiente tem de ceder espaço para esse aviso, nunca competir com ele.**

## O que NÃO precisa vir

- PNG/JPG da logo em várias resoluções — o vetor resolve todas.
- Mockups e artes finalizadas de campanha (a não ser como referência em `pecas/`).
