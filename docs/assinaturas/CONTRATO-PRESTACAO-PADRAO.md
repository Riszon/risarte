# Contrato de prestação de serviços odontológicos — texto padrão da rede (proposta)

**Situação:** proposta de 03/11/2026, aguardando o OK do dono. **Ainda não está no
sistema.** Depois do OK, uma migração troca o texto do modelo
`contrato_prestacao` (hoje é o texto provisório da 0342, mais o resumo
acrescentado pela 0348).

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

## B. Pontos que mudam regra ou têm risco jurídico (decisão do dono)

| # | Onde | Original | Proposta | Por quê |
|---|---|---|---|---|
| B1 | Cl. 9ª §2 (abandono) | Respondendo em 30 dias, devolve 50% do pago (menos o realizado); depois disso, perde tudo ("ou ficarão como crédito") | Devolve o saldo pago e não usado, menos o realizado, os materiais já feitos para o paciente e **multa de 20% sobre o saldo** (Cl. 10ª §1) | O texto se contradiz ("não restituirá… ou ficarão como crédito"). E a perda total do que foi pago é cláusula que o CDC (art. 51 e 53) costuma anular. **O percentual de 20% é sugestão; o dono escolhe** |
| B2 | Cl. 6ª §7 (uso de imagem) | Autoriza uso de imagem, gratuito, no Brasil e no exterior, dentro do contrato | Sai do contrato; vai no termo próprio (o sistema já tem o modelo "Autorização de uso de imagem") | Imagem do tratamento é dado de saúde: a LGPD pede consentimento específico e que possa ser retirado. Dentro do contrato, o paciente não consegue recusar sem recusar o tratamento |
| B3 | Cl. 11ª (LGPD) | Texto de contrato entre empresas: a clínica "segue as instruções do contratante", que "pode rescindir sem ônus"; os dados são "destruídos" ao fim | Reescrita: a clínica é a **controladora**; finalidades, compartilhamento, segurança, guarda do prontuário pelo prazo legal, direitos do paciente | O original troca os papéis e manda destruir dados que a clínica é **obrigada** a guardar (prontuário) |
| B4 | Cl. 3ª §2 (gastos extras) | "Fica desde já autorizado" | Informados antes e cobrados com a concordância; em urgência durante o procedimento, comunicados logo depois | O CDC (art. 39, VI) proíbe executar serviço sem orçamento e autorização prévia |
| B5 | Cl. 3ª §6 (atraso) | "Suspensão imediata" | Suspende os procedimentos eletivos até regularizar; urgência continua sendo atendida | O Código de Ética Odontológica não permite abandonar o paciente em urgência |
| B6 | Cl. 5ª §4 e §6; Cl. 6ª §2 | Exime a clínica de "qualquer responsabilidade", "de qualquer monta" | A clínica não responde pelo que **decorrer** da falta do paciente | Cláusula que exonera de toda responsabilidade é nula no CDC (art. 51, I) e derruba a cláusula inteira |
| B7 | Cl. 3ª §5 (honorários) | 20% de honorários na cobrança | Mantido, com o mesmo direito ao paciente se precisar cobrar da clínica | O CDC (art. 51, XII) exige reciprocidade |
| B8 | Cl. 13ª §3 (documentação) | Só entrega exames e documentação depois de pagos os custos e as multas | Cópias sempre que pedidas; os originais produzidos à parte (modelos, radiografias) podem esperar o pagamento deles; o prontuário é sempre acessível | O paciente tem direito de acesso aos próprios dados de saúde (LGPD art. 18; Código de Ética) |
| B9 | Foro | Londrina, fixo (até para Cambé) | Cidade da unidade, sem tirar do paciente o direito de processar na cidade dele | O CDC (art. 101, I) garante o foro do consumidor; foro fixo distante costuma ser anulado |
| B10 | Cl. 12ª §5 | "Irrevogável e irretratável" | "Obriga as partes e seus sucessores" | Contradiz as cláusulas de rescisão do próprio contrato |
| B11 | Cl. 3ª §8 (falta) | R$ 120,00 por hora agendada | Mantido, com "salvo caso fortuito ou força maior" | Valor fixo para a rede inteira. Se cada unidade precisar de um valor, vira campo novo |
| B12 | **Nova Cl. 12ª** (pedido do dono) | Não existia | Registros da apresentação e da negociação: anotação, gravação, transcrição ou resumo, inclusive com ferramentas de tecnologia; uso quando necessário; o resumo do Consultor vai no contrato; o assinado prevalece | Pedido do dono. Ver a observação abaixo |

**Observação sobre a B12:** a cláusula declara que o paciente **sabe** que a
apresentação pode ter sido registrada. Ela não substitui o aviso **na hora da
gravação**, que o plano do AP94 já prevê (termo de consentimento antes de ligar
a IA). Uma gravação feita sem aviso continua sendo problema, mesmo com a
cláusula.

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

## D. O texto padrão

*(Os campos entre `{{ }}` são preenchidos pelo sistema no envio. Os
parágrafos de cada cláusula ficam separados por linha em branco.)*

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

Parágrafo quinto. Se for necessária a cobrança judicial ou extrajudicial por meio de advogado, o(a) CONTRATANTE arcará com honorários advocatícios de 20% (vinte por cento) sobre o valor atualizado do débito. O mesmo direito fica assegurado ao(à) CONTRATANTE se precisar cobrar da CONTRATADA valor devido por força deste contrato.

Parágrafo sexto. O atraso no pagamento permite à CONTRATADA suspender a realização de novos procedimentos eletivos até a regularização, mantido o atendimento de urgência.

Parágrafo sétimo. A CONTRATADA poderá emitir títulos de crédito e boletos bancários para a cobrança de quaisquer valores relacionados a este contrato, inclusive os previstos no Orçamento/Planejamento.

Parágrafo oitavo. Se o(a) PACIENTE não comparecer a horário agendado sem desmarcar com antecedência mínima de 24 (vinte e quatro) horas, o(a) CONTRATANTE pagará multa de R$ 120,00 (cento e vinte reais) por hora agendada, salvo caso fortuito ou força maior comprovados, sem prejuízo das demais consequências previstas neste contrato. O novo agendamento dependerá da disponibilidade da CONTRATADA.

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

Parágrafo quarto. Comunicar imediatamente à CONTRATADA qualquer fato ou intercorrência relacionada ao tratamento, durante ou após o procedimento. A CONTRATADA não responderá pelos agravamentos que decorrerem da falta dessa comunicação.

Parágrafo quinto. Comparecer, após o término do procedimento e quando necessário, para o controle periódico da evolução do tratamento, no período e na forma orientados pela CONTRATADA, arcando com os custos dessas consultas, sob pena de perder a garantia do procedimento ou do tratamento realizado.

Parágrafo sexto. Seguir rigorosamente as orientações de cuidados pós-tratamento e as instruções do profissional responsável. O(A) CONTRATANTE declara conhecer os riscos do descumprimento dessas orientações e que a CONTRATADA não responderá pelos danos que dele decorrerem.

### Cláusula 6ª — Da prestação dos serviços

A CONTRATADA é responsável pela correta prestação dos serviços, nos termos deste contrato.

Parágrafo primeiro. A obrigação assumida pela CONTRATADA é de meio, e não de resultado ou garantia: cabe ao profissional agir com diligência, na técnica que entender mais indicada, empregando os esforços e meios necessários para alcançar o objetivo do tratamento, que depende também de fatores como a reação do organismo do(a) PACIENTE, a sua cooperação, o cumprimento das recomendações da CONTRATADA e o comparecimento para controle após o tratamento, previsto no parágrafo quinto da Cláusula 5ª.

Parágrafo segundo. Se o(a) PACIENTE não cooperar durante ou após o tratamento, ou omitir informação relevante para o diagnóstico, a CONTRATADA não responderá pelas consequências, sequelas e prejuízos financeiros, estéticos ou morais que decorrerem dessa conduta.

Parágrafo terceiro. Considera-se não cooperação do(a) PACIENTE, entre outras situações: faltar às consultas agendadas, abandonar o tratamento, não observar as recomendações do cirurgião-dentista e não comparecer ao controle previsto no parágrafo quinto da Cláusula 5ª.

Parágrafo quarto. O(A) CONTRATANTE está ciente de que não existe garantia absoluta de sucesso do tratamento, que depende também da manutenção regular e dos demais cuidados recomendados pela CONTRATADA.

Parágrafo quinto. O(A) CONTRATANTE está ciente de que certos procedimentos causam desconforto inicial e de que isso não significa, por si só, falha do tratamento. Nesses casos, o(a) PACIENTE seguirá as recomendações da CONTRATADA.

Parágrafo sexto. O uso de imagens do(a) PACIENTE para divulgação depende de autorização própria, em termo separado, que pode ser recusada sem qualquer prejuízo ao tratamento.

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

Parágrafo primeiro. Se o contrato for rescindido pelo(a) CONTRATANTE sem motivo imputável à CONTRATADA, inclusive por abandono ou desistência, antes do término do tratamento, serão devidos: os serviços realizados, pelo valor individual de cada etapa e procedimento, sem o desconto do tratamento completo; os materiais já adquiridos ou confeccionados especificamente para o(a) PACIENTE; e multa compensatória de 20% (vinte por cento) sobre o valor dos serviços contratados e ainda não realizados. Apurado o saldo, a diferença a favor do(a) CONTRATANTE será devolvida, e a diferença a favor da CONTRATADA será cobrada.

Parágrafo segundo. Se o contrato for rescindido pela CONTRATADA sem motivo, antes do término do tratamento, os valores pagos pelos serviços do Orçamento/Planejamento ainda não realizados serão integralmente devolvidos ao(à) CONTRATANTE.

### Cláusula 11ª — Da proteção de dados pessoais

A CONTRATADA trata os dados pessoais do(a) CONTRATANTE e do(a) PACIENTE, inclusive os dados de saúde, na condição de controladora, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD).

Parágrafo primeiro. Os dados são tratados para a prestação do tratamento, o registro em prontuário, o agendamento e a comunicação com o(a) CONTRATANTE, o faturamento e a cobrança, o cumprimento de obrigações legais e regulatórias e o exercício regular de direitos, com fundamento no art. 7º, incisos II, V e VI, e no art. 11, inciso II, alíneas "a", "d" e "f", da LGPD.

Parágrafo segundo. Os dados são compartilhados somente com quem for necessário a essas finalidades: os profissionais e a equipe da CONTRATADA; a administração da rede Risarte, que opera o sistema de gestão utilizado pela CONTRATADA; laboratórios de prótese e centros de imagem; os fornecedores de sistemas de prontuário, agenda, assinatura eletrônica, comunicação e meios de pagamento; contadores e assessores jurídicos; e as autoridades, quando exigido por lei. Todos ficam obrigados à confidencialidade.

Parágrafo terceiro. A CONTRATADA adota medidas técnicas e administrativas para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida, e mantém política de privacidade e procedimento de resposta a incidentes de segurança.

Parágrafo quarto. O prontuário e a documentação clínica serão guardados pelo prazo exigido pela legislação e pelas normas do Conselho Federal de Odontologia. Os demais dados serão eliminados quando deixarem de ser necessários, salvo os que precisarem ser mantidos para cumprimento de obrigação legal ou exercício regular de direitos, na forma do art. 16 da LGPD.

Parágrafo quinto. O(A) titular dos dados pode, a qualquer tempo, solicitar à CONTRATADA a confirmação do tratamento, o acesso, a correção, a portabilidade e as informações sobre o compartilhamento dos seus dados, e exercer os demais direitos do art. 18 da LGPD, pelos canais de atendimento da unidade.

### Cláusula 12ª — Dos registros da apresentação e da negociação

O(A) CONTRATANTE declara estar ciente de que a apresentação do plano de tratamento e a negociação comercial que antecederam esta contratação podem ter sido registradas pela CONTRATADA por meio de anotações, gravação de áudio ou vídeo, transcrição ou resumo, inclusive com o apoio de ferramentas de tecnologia.

Parágrafo primeiro. Esses registros integram a documentação desta contratação e servem para documentar as informações prestadas, as condições oferecidas e as escolhas do(a) CONTRATANTE. Se necessário, a CONTRATADA poderá utilizá-los para esclarecer dúvidas, conferir o que foi combinado, atender reclamações e exercer regularmente os seus direitos em processo judicial, administrativo ou arbitral, nos termos do art. 7º, inciso VI, e do art. 11, inciso II, alínea "d", da LGPD.

Parágrafo segundo. Os registros são confidenciais, tratados na forma da Cláusula 11ª e guardados pelo tempo necessário a essas finalidades, observados os prazos legais de prescrição. O(A) CONTRATANTE pode solicitar acesso a eles.

Parágrafo terceiro. O resumo da apresentação registrado pelo Consultor Comercial integra este contrato e é reproduzido a seguir:
{{apresentacao_resumo}}

Parágrafo quarto. Havendo divergência entre um registro da apresentação ou da negociação (inclusive o resumo acima) e este contrato ou o Orçamento/Planejamento assinados, prevalecem os documentos assinados.

### Cláusula 13ª — Das disposições gerais

O(A) CONTRATANTE declara que todas as suas perguntas e dúvidas foram respondidas, que a CONTRATADA explicou claramente os detalhes e as etapas do tratamento objeto deste contrato e que consente com o plano de tratamento apresentado.

Parágrafo primeiro. O(A) CONTRATANTE manterá a CONTRATADA informada sobre o seu endereço, telefone, e-mail e demais dados cadastrais.

Parágrafo segundo. O pedido de documentação odontológica prévia (exames, radiografias, modelos) não implica, necessariamente, o início do tratamento pretendido. A análise dessa documentação serve para verificar a possibilidade e a adequação do tratamento, e pode resultar na indicação de tratamento diferente do imaginado ou de nenhum tratamento.

Parágrafo terceiro. Cópias dos exames e da documentação odontológica do(a) PACIENTE serão fornecidas mediante solicitação. A entrega de originais produzidos e cobrados à parte, como modelos e radiografias, pode ficar condicionada ao pagamento dos respectivos custos. O acesso ao prontuário é sempre garantido, na forma da lei.

Parágrafo quarto. O(A) CONTRATANTE declara que leu e entendeu este contrato, o Orçamento/Planejamento, o Termo de Consentimento e, quando entregue, o Termo de Cuidados Pós-tratamento, e que suas dúvidas foram esclarecidas antes da assinatura.

Parágrafo quinto. Este contrato obriga as partes e os seus sucessores a qualquer título.

Parágrafo sexto. A tolerância de qualquer das partes quanto ao cumprimento das obrigações deste contrato não significa novação, renúncia ou alteração do que foi pactuado.

### Cláusula 14ª — Do foro

Fica eleito o foro da comarca de {{unidade_cidade}} para dirimir as questões decorrentes deste contrato, ressalvado o direito do(a) CONTRATANTE de propor ação no foro do seu domicílio, nos termos do art. 101, inciso I, do Código de Defesa do Consumidor.

### Fecho

E, por estarem assim justas e contratadas, as partes assinam este instrumento por meio de assinatura eletrônica, na presença das testemunhas abaixo, reconhecendo a validade dessa forma de assinatura, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, para que produza os seus efeitos legais.

{{documento_data_extenso}}

---

## E. Depois do OK (o que a entrega faz)

1. **Migração do core** (próximo número livre): troca o corpo do modelo
   `contrato_prestacao` por este texto, atualiza a lista de campos e marca o
   texto como **aprovado** (`is_provisional_text = false`), que tira a marca
   d'água "TEXTO PROVISÓRIO" do PDF. **Só troca se o modelo ainda for o
   provisório**: se alguém já editou o texto pela tela, a migração não passa
   por cima e avisa.
2. Régua: o teste dos modelos confere que todo campo do texto existe no
   sistema e que o texto não tem nome, CPF nem CNPJ de ninguém.
3. Ensaio no treino: gerar o PDF de um pacote de teste com este texto e
   conferir a paginação, as listas e o quadro de assinaturas.
4. Manual (seção das assinaturas), novidades, versão e o registro de estado.
