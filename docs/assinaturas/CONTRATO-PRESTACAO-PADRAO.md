# Contrato de prestação de serviços odontológicos — texto padrão da rede

**Situação:** aprovado pelo dono em 03/11/2026, com as decisões da seção B.
**No sistema desde a 0.383.0 (migração 0349).**

**De onde veio:** o contrato que o dono enviou ("CONTRATO DE PRESTAÇÃO DE
TRATAMENTO ODONTOLÓGICO", emitido pelo ControleODONTO em 03/11/2026). Mantive a
estrutura, as cláusulas e as regras de negócio. Mudei o que estava errado e o
que um advogado provavelmente apontaria; cada mudança está listada abaixo.

> ⚠️ Esta é uma revisão de redação e de coerência. Ela **não substitui a leitura
> de um advogado**. Os pontos da seção B mudam regra de negócio ou têm risco
> jurídico, e precisam da decisão do dono (de preferência com o jurídico).

---

## A. O que foi tirado do documento (dados do cliente e da clínica)

| No documento original | No texto padrão |
|---|---|
| Nome, CPF e RG da paciente | `{{contratante_nome}}`, `{{contratante_cpf}}`; paciente `{{paciente_nome}}`, `{{paciente_cpf}}`. **O RG saiu**: o sistema não tem esse campo, e o CPF identifica |
| `#pacienteEndereco` (campo que o outro sistema não preencheu) | `{{paciente_endereco}}` |
| Risarte Odontologia Cambé Ltda, CNPJ, endereço em Cambé | `{{unidade_razao_social}}`, `{{unidade_cnpj}}`, `{{unidade_endereco}}` |
| "representada por Jeferson Lopes de Souza… CRO/PR 21.694" | "representada na forma do seu contrato social". Quem assina pela unidade aparece no quadro de assinaturas (o representante do modelo) |
| Cabeçalho "Risarte Cambé" e "Dr. Jeferson" | Sai. O cabeçalho do PDF é o do sistema |
| "Foro Regional da Comarca de Londrina/PR" | `{{unidade_cidade}}` (ver B9) |
| Rodapé "Emitido por Dr. Edson… ControleODONTO" | Sai |
| "2 vias… na presença do responsável jurídico" | Assinatura eletrônica, com as 2 testemunhas do modelo |

Todos os campos `{{…}}` acima já existem no sistema. Nenhum campo novo é
necessário.

## B. Pontos que mudavam regra ou tinham risco jurídico — decisões do dono (03/11/2026)

| # | Onde (texto final) | Proposta da revisão | **Decisão do dono** |
|---|---|---|---|
| B1 | Cl. 10ª §1 (desistência/abandono) | Devolver o saldo pago e não usado, menos o realizado, os materiais e multa de 20% | **Segue o proposto, com multa de 50% sobre o saldo** |
| B2 | Cl. 6ª §6 (uso de imagem) | Tirar do contrato e levar para o termo próprio | **Mantém o original** no contrato. O termo específico de uso de imagem também será criado |
| B3 | Cl. 11ª (LGPD) | Reescrever: clínica controladora, prontuário guardado pelo prazo legal | **Segue o proposto** (com o uso de imagem acrescentado às finalidades, por causa da B2) |
| B4 | Cl. 3ª §2 (gastos extras) | Informar antes e cobrar com concordância; urgência comunicada depois | **Segue o recomendado** |
| B5 | Cl. 3ª §6 (atraso) | Suspender só o eletivo, mantendo a urgência | **Segue o original:** suspensão imediata da prestação dos serviços |
| B6 | Cl. 5ª §4 e §6; Cl. 6ª §2 | Trocar "qualquer responsabilidade" por "o que decorrer da falta do paciente" | **Segue o original** (o texto já liga a isenção à falta do paciente) |
| B7 | Cl. 3ª §5 (honorários) | Honorários de 20% valendo para os dois lados | **Segue o original:** 20% cobrados do contratante |
| B8 | Cl. 13ª §3 (documentação) | Cópias sempre; originais podem esperar o pagamento | **Segue o original:** entregues ao final, pagos os custos e as multas |
| B9 | Cl. 14ª (foro) | Cidade da unidade, ressalvado o foro do consumidor | **Segue o recomendado** |
| B10 | Cl. 13ª §5 | Tirar "irrevogável e irretratável" | **Segue o recomendado** |
| B11 | Cl. 3ª §8 (falta) | R$ 120,00 por hora, salvo caso fortuito ou força maior comprovados | **Segue o recomendado, com prova documental** do caso fortuito ou força maior, e o valor passa a **50% do procedimento "consulta odontológica" da tabela da unidade, por hora** |
| B12 | Cl. 12ª (registros da apresentação) | O resumo do Consultor vai no contrato | **Não prometer o resumo:** o contrato pode ser gerado e assinado na hora, sem tempo de ter o resumo. Se for assinado depois da apresentação, o resumo estará presente |

**Consequência da B12 no sistema (0.383.0):** o envio deixou de recusar o
contrato sem resumo (regra que a 0.382.0 tinha criado). Sem resumo, o campo
`{{apresentacao_resumo}}` sai como *"(não registrado até a data da assinatura
deste documento)"*, em vez da linha em branco. O **aceite** continua exigindo o
resumo (0348).

**Observação sobre a Cl. 12ª:** a cláusula declara que o paciente **sabe** que a
apresentação pode ter sido registrada. Ela não substitui o aviso **na hora da
gravação**, que o plano do AP94 já prevê (termo de consentimento antes de ligar
a IA).

> ⚠️ Pontos em que o dono manteve o original contra a recomendação (B2, B5, B6,
> B7, B8): o texto é decisão do dono. Os riscos apontados na revisão (Código de
> Defesa do Consumidor, LGPD para imagem de saúde, Código de Ética
> Odontológica) continuam valendo como alerta para a leitura do advogado.

## C. Correções de redação (sem mudar regra)

- A Cl. 6ª pulava do §5 para o §7. Renumerado.
- A Cl. 6ª §1 e §3 remetiam ao "§5 da Cláusula **Quarta**" (que trata de
  privacidade). O retorno para controle está no §5 da Cláusula **Quinta**. Corrigido.
- "R$ 120,00 (cem e vinte reais)" → "(cento e vinte reais)".
- "30 (dias) dias" → "30 (trinta) dias".
- "inscrito", "portador", "residente" → com (a), porque o texto serve a qualquer
  paciente.
- Cl. 2ª: "respeitando os mesmos, a escolha do profissional e da CONTRATADA" e
  "não ocorrendo nenhum tipo de sanção, até mesmo rescisão contratual"
  reescritos para ficar claros.
- Cl. 10ª §1: "valor total constante no Orçamento" ficava ambíguo (o total do
  orçamento ou o realizado?). Agora: o realizado, pelo valor individual, sem o
  desconto do tratamento completo, como já dizia a Cl. 3ª §1.
- Contratante e paciente: o original repetia "CONTRATANTE e PACIENTE" em todo
  lugar. Agora o preâmbulo diz uma vez que, quando o paciente contrata para si,
  os dois são a mesma pessoa; e quando é menor, o responsável contrata.
- Entrou um parágrafo com o plano contratado nesta data (procedimentos, valor e
  condições, pelos campos do sistema), para o contrato não depender só do anexo.
- O "Termo de Cuidados Pós-tratamento" citado nas Cl. 9ª e 13ª **não existe
  como modelo no sistema**. Ficou citado "quando entregue". Se o dono quiser,
  ele vira um modelo novo.

---

## D. O texto padrão (como está no sistema desde a 0349)

*(Os campos entre `{{ }}` são preenchidos pelo sistema no envio. Gerado da
mesma fonte que a migração 0349.)*

**Título do modelo:** Contrato de prestação de serviços odontológicos

### Preâmbulo

De um lado, como CONTRATANTE, {{contratante_nome}}, inscrito(a) no CPF sob o nº {{contratante_cpf}}, residente e domiciliado(a) em {{paciente_endereco}}, na condição de paciente ou de responsável legal pelo(a) PACIENTE {{paciente_nome}}, inscrito(a) no CPF sob o nº {{paciente_cpf}}; e, de outro lado, como CONTRATADA, {{unidade_razao_social}}, pessoa jurídica de direito privado inscrita no CNPJ sob o nº {{unidade_cnpj}}, com sede em {{unidade_endereco}}, unidade da rede Risarte Odontologia, neste ato representada na forma do seu contrato social, têm entre si certo e ajustado o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS, que se regerá pela legislação brasileira, em especial o Código Civil e o Código de Defesa do Consumidor, e pelas cláusulas a seguir.

Quando o(a) CONTRATANTE for o(a) próprio(a) PACIENTE, as menções a um e a outro referem-se à mesma pessoa.

### Cláusula 1ª — Do objeto

O presente contrato tem por objeto a prestação, pela CONTRATADA e por sua equipe de cirurgiões-dentistas, de serviços de tratamento odontológico ao(à) PACIENTE.

Parágrafo primeiro. As etapas e os procedimentos do tratamento seguem o MÉTODO RISARTE e são definidos nos Orçamentos/Planejamentos e nos Termos de Consentimento que, assinados pelas partes, integram este contrato como anexos para todos os efeitos, doravante denominados "Orçamento/Planejamento" e "Termo de Consentimento".

Parágrafo segundo. Entende-se por MÉTODO RISARTE a programação e a organização do tratamento em 5 (cinco) etapas, nesta ordem: DIAGNÓSTICO, PREVENÇÃO, SAÚDE, FUNÇÃO e ESTÉTICA.

Parágrafo terceiro. Este contrato não se limita a um único Orçamento/Planejamento. Conforme o MÉTODO RISARTE, o tratamento é realizado por etapas que, de acordo com a necessidade e a condição clínica do(a) PACIENTE e respeitada a sequência indicada pela CONTRATADA, podem constar de diferentes Orçamentos/Planejamentos, sempre com a ciência e a concordância do(a) CONTRATANTE. Cada novo Orçamento/Planejamento assinado passa a integrar este contrato.

Parágrafo quarto. O(A) CONTRATANTE declara que, antes da assinatura deste instrumento, a CONTRATADA lhe esclareceu a natureza do tratamento proposto, os procedimentos envolvidos, os riscos a que se sujeita o(a) PACIENTE e as alternativas de tratamento existentes, inclusive por escrito, no Termo de Consentimento.

Parágrafo quinto. Nesta data, o Orçamento/Planejamento contratado compreende os seguintes procedimentos:
{{tratamento_procedimentos}}
no valor total de {{tratamento_valor_total}} ({{tratamento_valor_extenso}}), nas seguintes condições de pagamento: {{tratamento_condicoes}}.

### Cláusula 2ª — Dos profissionais

O(A) CONTRATANTE está ciente de que contrata o serviço prestado pela CONTRATADA, executado por profissional habilitado e regularmente inscrito no Conselho Regional de Odontologia, e não um profissional específico.

Parágrafo primeiro. A designação dos profissionais responsáveis pelo tratamento cabe à CONTRATADA e leva em conta o caso clínico do(a) PACIENTE, a capacitação técnica do profissional e a sua disponibilidade.

Parágrafo segundo. O tratamento poderá ser iniciado com um profissional e continuado por outro igualmente habilitado, por decisão da CONTRATADA, sem que a troca gere penalidade a qualquer das partes ou constitua motivo de rescisão.

### Cláusula 3ª — Do pagamento

Os valores e as formas de pagamento dos serviços objeto deste contrato estão estabelecidos no Orçamento/Planejamento (Cláusula 1ª, parágrafos primeiro e quinto).

Parágrafo primeiro. O Orçamento/Planejamento informa o valor individual de cada etapa e procedimento. Se o tratamento não for realizado por completo, por qualquer motivo, o(a) CONTRATANTE pagará cada etapa e procedimento realizado até então pelo seu valor individual, sem o desconto eventualmente concedido para o tratamento completo.

Parágrafo segundo. Exames, radiografias, serviços de laboratório e procedimentos não previstos no Orçamento/Planejamento, que se mostrem necessários ao sucesso do tratamento, no pré-operatório, durante a cirurgia, no pós-operatório ou durante o tratamento ortodôntico, serão informados previamente ao(à) CONTRATANTE e cobrados à parte, com a sua concordância, pelo valor praticado na ocasião. Em situação de urgência durante um procedimento, a CONTRATADA poderá realizá-los para preservar a saúde do(a) PACIENTE, comunicando-os logo em seguida.

Parágrafo terceiro. Nos pagamentos em mensalidades (especialmente, mas não só, nos tratamentos ortodônticos), as mensalidades são devidas durante todo o tratamento ou, se o tratamento terminar antes, até o fim das parcelas acordadas, independentemente da frequência às consultas. Paga-se todos os meses, na data estipulada, e não somente quando há consulta: a mensalidade do mês sem comparecimento é exigível da mesma forma.

Parágrafo quarto. O não pagamento de qualquer valor no vencimento acarretará multa moratória de 2% (dois por cento) sobre o valor em atraso, juros de mora de 1% (um por cento) ao mês e correção monetária pelo INPC, sem prejuízo das demais consequências previstas neste contrato, inclusive a rescisão, a critério da CONTRATADA.

Parágrafo quinto. Se for necessária a cobrança judicial ou extrajudicial por meio de advogado, o(a) CONTRATANTE arcará com honorários advocatícios de 20% (vinte por cento) sobre o valor atualizado do débito.

Parágrafo sexto. Qualquer atraso no pagamento dos valores estipulados no Orçamento/Planejamento acarretará a suspensão imediata da prestação dos serviços, até a regularização.

Parágrafo sétimo. A CONTRATADA poderá emitir títulos de crédito e boletos bancários para a cobrança de quaisquer valores relacionados a este contrato, inclusive os previstos no Orçamento/Planejamento.

Parágrafo oitavo. Se o(a) PACIENTE não comparecer a horário agendado sem desmarcar com antecedência mínima de 24 (vinte e quatro) horas, o(a) CONTRATANTE pagará multa equivalente a 50% (cinquenta por cento) do valor do procedimento "consulta odontológica" da tabela de preços vigente da CONTRATADA, por hora agendada, sem prejuízo das demais consequências previstas neste contrato. A multa não será devida em caso fortuito ou de força maior, desde que comprovado por documento apresentado à CONTRATADA (por exemplo, atestado médico ou boletim de ocorrência). O novo agendamento dependerá da disponibilidade da CONTRATADA.

### Cláusula 4ª — Das obrigações da CONTRATADA

São obrigações da CONTRATADA:

Parágrafo primeiro. Executar o tratamento em ambiente de trabalho seguro ao(à) PACIENTE, observando os padrões de higiene e biossegurança aplicáveis.

Parágrafo segundo. Realizar os procedimentos de acordo com a técnica odontológica adequada ao caso, observando o estado atual da ciência.

Parágrafo terceiro. Esclarecer previamente o(a) CONTRATANTE, por meio do Termo de Consentimento, sobre as vantagens, os riscos, as consequências e os valores do tratamento contratado, e sobre as consequências da desistência ou do abandono do tratamento.

Parágrafo quarto. Informar o(a) CONTRATANTE, a cada procedimento realizado, sobre o plano de tratamento e a sua sequência.

Parágrafo quinto. Resguardar a privacidade do(a) CONTRATANTE e do(a) PACIENTE durante todo o tratamento e após o seu término, nos termos da Cláusula 11ª.

### Cláusula 5ª — Das obrigações do(a) CONTRATANTE

São obrigações do(a) CONTRATANTE, por si e pelo(a) PACIENTE:

Parágrafo primeiro. Informar à CONTRATADA o histórico do(a) PACIENTE quanto a sensibilidade e alergias a medicamentos e anestésicos, problemas de sangramento, tratamentos médicos e odontológicos atuais e anteriores, doenças, cirurgias, reações gengivais ou de pele e qualquer outro fato relevante sobre a sua saúde e o seu estado físico e mental, respondendo com veracidade à anamnese e fornecendo os documentos solicitados. O(A) CONTRATANTE responde pelas intercorrências que decorrerem de informação omitida ou incorreta.

Parágrafo segundo. Seguir fielmente as recomendações e prescrições da CONTRATADA, quanto a medicamentos, controles e cuidados antes, durante e depois do tratamento, cirúrgico ou não.

Parágrafo terceiro. Realizar todos os exames solicitados pela CONTRATADA, necessários à continuidade adequada do tratamento, arcando com os seus custos.

Parágrafo quarto. Comunicar imediatamente à CONTRATADA qualquer fato ou intercorrência relacionada ao tratamento que surgir durante ou após o procedimento realizado. A falta dessa comunicação exime a CONTRATADA de qualquer responsabilidade.

Parágrafo quinto. Comparecer, após o término do procedimento e quando necessário, para o controle periódico da evolução do tratamento, no período e na forma orientados pela CONTRATADA, arcando com os custos dessas consultas, sob pena de perder a garantia do procedimento ou do tratamento realizado.

Parágrafo sexto. Seguir rigorosamente as orientações de cuidados pós-tratamento e todas as instruções do profissional responsável pelo tratamento. O(A) CONTRATANTE declara conhecer os riscos do descumprimento dessas obrigações e orientações, e que o descumprimento, por inobservância, imprudência ou mera liberalidade, exonera a CONTRATADA de qualquer ônus ou responsabilidade pelos danos que o(a) PACIENTE vier a sofrer, de qualquer monta.

### Cláusula 6ª — Da prestação dos serviços

A CONTRATADA é responsável pela correta prestação dos serviços, nos termos deste contrato.

Parágrafo primeiro. A obrigação assumida pela CONTRATADA é de meio, e não de resultado ou garantia: cabe ao profissional agir com diligência, na técnica que entender mais indicada, empregando os esforços e meios necessários para alcançar o objetivo do tratamento, que depende também de fatores como a reação do organismo do(a) PACIENTE, a sua cooperação, o cumprimento das recomendações da CONTRATADA e o comparecimento para controle após o tratamento, previsto no parágrafo quinto da Cláusula 5ª.

Parágrafo segundo. Se o(a) PACIENTE não cooperar durante ou após o tratamento, ou omitir informação relevante para o correto diagnóstico, a CONTRATADA fica isenta de responsabilidade pelas possíveis consequências e sequelas dos procedimentos adotados e pelos prejuízos financeiros, estéticos ou morais eventualmente causados ao(à) PACIENTE.

Parágrafo terceiro. Considera-se não cooperação do(a) PACIENTE, entre outras situações: faltar às consultas agendadas, abandonar o tratamento, não observar as recomendações do cirurgião-dentista e não comparecer ao controle previsto no parágrafo quinto da Cláusula 5ª.

Parágrafo quarto. O(A) CONTRATANTE está ciente de que não existe garantia absoluta de sucesso do tratamento, que depende também da manutenção regular e dos demais cuidados recomendados pela CONTRATADA.

Parágrafo quinto. O(A) CONTRATANTE está ciente de que certos procedimentos causam desconforto inicial e de que isso não significa, por si só, falha do tratamento. Nesses casos, o(a) PACIENTE seguirá as recomendações da CONTRATADA.

Parágrafo sexto. O(A) CONTRATANTE e o(a) PACIENTE autorizam, desde já, o uso das imagens relacionadas ao tratamento ou ao procedimento em matérias e campanhas promocionais e institucionais destinadas à divulgação ao público em geral. A autorização é concedida a título gratuito e abrange o uso das imagens em todo o território nacional e no exterior, sem que nada seja devido a título de direitos conexos à imagem ou a qualquer outro.

### Cláusula 7ª — Do refazimento de procedimentos

Se for necessário refazer algum procedimento por questões que não configurem falha do tratamento, ou por culpa exclusiva do(a) PACIENTE:

Parágrafo primeiro. Se o refazimento decorrer de questões que não configurem falha do tratamento nem culpa exclusiva do(a) PACIENTE, o(a) CONTRATANTE arcará com os custos de insumos e exames necessários à nova execução.

Parágrafo segundo. Se o refazimento decorrer de culpa exclusiva do(a) PACIENTE, o(a) CONTRATANTE arcará integralmente com a nova execução, inclusive os honorários odontológicos do procedimento e as horas clínicas empregadas.

Parágrafo terceiro. Considera-se culpa exclusiva do(a) PACIENTE, entre outras situações:
• a não cooperação durante ou após o tratamento;
• a omissão de informação relevante para o diagnóstico;
• o não cumprimento das recomendações da CONTRATADA quanto a medicamentos, controles e cuidados antes, durante e depois do tratamento;
• o não cumprimento das orientações de cuidados pós-tratamento;
• a falta de comunicação imediata à CONTRATADA de fato ou intercorrência relacionada ao tratamento;
• o não comparecimento para a avaliação dos resultados após o término do procedimento;
• o não comparecimento ao controle periódico, quando necessário;
• buscar o esclarecimento de dúvidas sobre o tratamento com terceiros alheios a este contrato, em vez de com a CONTRATADA;
• buscar a intervenção de outros profissionais em intercorrência do tratamento executado ou em execução, sem antes comunicar a CONTRATADA.

### Cláusula 8ª — Das faltas

Se o(a) PACIENTE não comparecer na data agendada, o(a) CONTRATANTE deverá contatar a CONTRATADA para remarcar o atendimento, sob pena de caracterizar abandono ou desistência do tratamento (Cláusula 9ª), sem prejuízo da multa do parágrafo oitavo da Cláusula 3ª.

### Cláusula 9ª — Do abandono ou da desistência do tratamento

Considera-se abandono ou desistência do tratamento, independentemente de aviso ou notificação:
• a falta a 3 (três) consultas consecutivas, com ou sem justificativa;
• a ausência por mais de 30 (trinta) dias contados de uma falta, com ou sem justificativa, salvo acordo com a CONTRATADA;
• o atraso de qualquer pagamento por mais de 30 (trinta) dias.

Parágrafo primeiro. O abandono ou a desistência equivale, para todos os efeitos, à rescisão do contrato por iniciativa do(a) CONTRATANTE.

Parágrafo segundo. Caracterizado o abandono ou a desistência, a CONTRATADA notificará o(a) CONTRATANTE por telefone, WhatsApp ou e-mail. Se o(a) CONTRATANTE não retomar o tratamento em 30 (trinta) dias da notificação, o contrato será considerado rescindido e aplicar-se-á o parágrafo primeiro da Cláusula 10ª. Os valores pagos e não utilizados não podem ser transferidos para outro paciente.

### Cláusula 10ª — Da rescisão

Além das hipóteses legais, este contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de qualquer cláusula ou condição, sem prejuízo da cobrança dos serviços realizados e dos materiais empregados pela CONTRATADA até a data da rescisão.

Parágrafo primeiro. Se o contrato for rescindido pelo(a) CONTRATANTE sem motivo imputável à CONTRATADA, inclusive por abandono ou desistência, antes do término do tratamento:
• são devidos os serviços realizados, pelo valor individual de cada etapa e procedimento, sem o desconto do tratamento completo, e os materiais já adquiridos ou confeccionados especificamente para o(a) PACIENTE;
• do valor pago pelo(a) CONTRATANTE abatem-se esses valores, e o que sobrar é o saldo;
• sobre o saldo incide multa compensatória de 50% (cinquenta por cento), retida pela CONTRATADA, e o restante do saldo é devolvido ao(à) CONTRATANTE.
Se o valor pago não cobrir os serviços realizados e os materiais, a diferença será cobrada do(a) CONTRATANTE.

Parágrafo segundo. Se o contrato for rescindido pela CONTRATADA sem motivo, antes do término do tratamento, os valores pagos pelos serviços do Orçamento/Planejamento ainda não realizados serão integralmente devolvidos ao(à) CONTRATANTE.

### Cláusula 11ª — Da proteção de dados pessoais

A CONTRATADA trata os dados pessoais do(a) CONTRATANTE e do(a) PACIENTE, inclusive os dados de saúde, na condição de controladora, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD).

Parágrafo primeiro. Os dados são tratados para a prestação do tratamento, o registro em prontuário, o agendamento e a comunicação com o(a) CONTRATANTE, o faturamento e a cobrança, o cumprimento de obrigações legais e regulatórias e o exercício regular de direitos, com fundamento no art. 7º, incisos II, V e VI, e no art. 11, inciso II, alíneas "a", "d" e "f", da LGPD; e, quanto às imagens, para a divulgação autorizada no parágrafo sexto da Cláusula 6ª, com fundamento no consentimento (art. 7º, inciso I, e art. 11, inciso I, da LGPD).

Parágrafo segundo. Os dados são compartilhados somente com quem for necessário a essas finalidades: os profissionais e a equipe da CONTRATADA; a administração da rede Risarte, que opera o sistema de gestão utilizado pela CONTRATADA; laboratórios de prótese e centros de imagem; os fornecedores de sistemas de prontuário, agenda, assinatura eletrônica, comunicação e meios de pagamento; contadores e assessores jurídicos; e as autoridades, quando exigido por lei. Todos ficam obrigados à confidencialidade.

Parágrafo terceiro. A CONTRATADA adota medidas técnicas e administrativas para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida, e mantém política de privacidade e procedimento de resposta a incidentes de segurança.

Parágrafo quarto. O prontuário e a documentação clínica serão guardados pelo prazo exigido pela legislação e pelas normas do Conselho Federal de Odontologia. Os demais dados serão eliminados quando deixarem de ser necessários, salvo os que precisarem ser mantidos para cumprimento de obrigação legal ou exercício regular de direitos, na forma do art. 16 da LGPD.

Parágrafo quinto. O(A) titular dos dados pode, a qualquer tempo, solicitar à CONTRATADA a confirmação do tratamento, o acesso, a correção, a portabilidade e as informações sobre o compartilhamento dos seus dados, e exercer os demais direitos do art. 18 da LGPD, pelos canais de atendimento da unidade.

### Cláusula 12ª — Dos registros da apresentação e da negociação

O(A) CONTRATANTE declara estar ciente de que a apresentação do plano de tratamento e a negociação comercial que antecederam esta contratação podem ter sido registradas pela CONTRATADA por meio de anotações, gravação de áudio ou vídeo, transcrição ou resumo, inclusive com o apoio de ferramentas de tecnologia.

Parágrafo primeiro. Esses registros integram a documentação desta contratação e servem para documentar as informações prestadas, as condições oferecidas e as escolhas do(a) CONTRATANTE. Se necessário, a CONTRATADA poderá utilizá-los para esclarecer dúvidas, conferir o que foi combinado, atender reclamações e exercer regularmente os seus direitos em processo judicial, administrativo ou arbitral, nos termos do art. 7º, inciso VI, e do art. 11, inciso II, alínea "d", da LGPD.

Parágrafo segundo. Os registros são confidenciais, tratados na forma da Cláusula 11ª e guardados pelo tempo necessário a essas finalidades, observados os prazos legais de prescrição. O(A) CONTRATANTE pode solicitar acesso a eles.

Parágrafo terceiro. Quando o resumo da apresentação já estiver registrado na data da assinatura deste contrato, ele é reproduzido abaixo. Quando o contrato for gerado e assinado no mesmo ato da negociação, o resumo pode não constar deste instrumento; nesse caso, ele integra a documentação da contratação assim que for registrado e fica à disposição do(a) CONTRATANTE.
Resumo da apresentação: {{apresentacao_resumo}}

Parágrafo quarto. Havendo divergência entre um registro da apresentação ou da negociação (inclusive o resumo) e este contrato ou o Orçamento/Planejamento assinados, prevalecem os documentos assinados.

### Cláusula 13ª — Das disposições gerais

O(A) CONTRATANTE declara que todas as suas perguntas e dúvidas foram respondidas, que a CONTRATADA explicou claramente os detalhes e as etapas do tratamento objeto deste contrato e que consente com o plano de tratamento apresentado.

Parágrafo primeiro. O(A) CONTRATANTE manterá a CONTRATADA informada sobre o seu endereço, telefone, e-mail e demais dados cadastrais.

Parágrafo segundo. O pedido de documentação odontológica prévia (exames, radiografias, modelos) não implica, necessariamente, o início do tratamento pretendido. A análise dessa documentação serve para verificar a possibilidade e a adequação do tratamento, e pode resultar na indicação de tratamento diferente do imaginado ou de nenhum tratamento.

Parágrafo terceiro. A documentação e os exames radiográficos do(a) PACIENTE poderão ser disponibilizados, mediante solicitação, ao final dos procedimentos ou do tratamento, desde que os custos e as multas contratuais tenham sido integralmente pagos.

Parágrafo quarto. O(A) CONTRATANTE declara que leu e entendeu este contrato, o Orçamento/Planejamento, o Termo de Consentimento e, quando entregue, o Termo de Cuidados Pós-tratamento, e que suas dúvidas foram esclarecidas antes da assinatura.

Parágrafo quinto. Este contrato obriga as partes e os seus sucessores a qualquer título.

Parágrafo sexto. A tolerância de qualquer das partes quanto ao cumprimento das obrigações deste contrato não significa novação, renúncia ou alteração do que foi pactuado.

### Cláusula 14ª — Do foro

Fica eleito o foro da comarca de {{unidade_cidade}} para dirimir as questões decorrentes deste contrato, ressalvado o direito do(a) CONTRATANTE de propor ação no foro do seu domicílio, nos termos do art. 101, inciso I, do Código de Defesa do Consumidor.

### Fecho

E, por estarem assim justas e contratadas, as partes assinam este instrumento por meio de assinatura eletrônica, na presença das testemunhas abaixo, reconhecendo a validade dessa forma de assinatura, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, para que produza os seus efeitos legais.

{{documento_data_extenso}}

---

## E. Como entrou no sistema

1. **Migração 0349** (`supabase/migrations/0349_contrato_prestacao_texto_padrao.sql`):
   troca o corpo e a lista de campos do modelo `contrato_prestacao` e desmarca
   "Texto provisório" (o PDF sai sem a marca d'água). Só troca enquanto o
   modelo estiver marcado como provisório; o texto anterior fica na auditoria.
2. **App (0.383.0):** o envio não exige mais o resumo (B12); sem ele, o campo
   diz que não estava registrado. O PDF passou a não esticar a última linha de
   cada parágrafo (achado no ensaio).
3. **Régua:** `assinaturas-modelos.test.ts` confere os campos, a ausência de
   CPF/CNPJ/RG/nomes do documento de origem, as 14 cláusulas e as decisões
   B1–B12 no texto.
4. **Ensaio:** aplicada no treino em 03/11/2026; PDF gerado com dados de
   ensaio (com e sem resumo), 9 páginas, sem marca d'água.
5. **Pendente:** o termo específico de uso de imagem (B2). A razão social da
   unidade entrou na 0.384.0 (0350): sem ela o envio é recusado.
