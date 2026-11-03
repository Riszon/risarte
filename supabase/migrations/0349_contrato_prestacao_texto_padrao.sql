-- =============================================================================
-- 0349 — O CONTRATO DE PRESTAÇÃO DE SERVIÇOS GANHA O TEXTO PADRÃO DA REDE
--
-- Pedido do dono (03/11/2026): usar como padrão da rede o contrato que ele
-- enviou, sem os dados do cliente e da clínica, personalizado pelos campos do
-- sistema, e com uma cláusula sobre os registros (transcrição, resumo) da
-- apresentação e da negociação. Revisão e decisões B1–B12 em
-- `docs/assinaturas/CONTRATO-PRESTACAO-PADRAO.md`.
--
-- O que muda:
--   * o modelo `contrato_prestacao` troca o texto provisório (9 cláusulas da
--     0342, mais o resumo da 0348) pelo texto padrão (14 cláusulas);
--   * a lista de campos acompanha o texto;
--   * `is_provisional_text` passa a falso: o PDF deixa de sair com a marca
--     d'água "TEXTO PROVISÓRIO".
--
-- Só troca enquanto o modelo ainda estiver marcado como provisório. Texto que
-- o Admin já tenha aprovado pela tela (desmarcando "Texto provisório") não é
-- tocado — o aviso no fim diz quando isso aconteceu. O texto anterior não se
-- perde: a auditoria (0288) guarda o antes e o depois da linha.
--
-- O resumo da apresentação deixa de ser exigido para ENVIAR o contrato
-- (decisão do dono, B12): o contrato pode ser gerado e assinado no mesmo ato
-- da negociação. Isso é do app (`valores.ts`), não desta migração. O aceite
-- continua exigindo o resumo (0348).
--
-- Nada apaga. Idempotente: rodar de novo não muda nada (o modelo já não é
-- provisório).
-- =============================================================================

update public.signature_templates t
set
  body = jsonb_build_object(
    'preamble',
    'De um lado, como CONTRATANTE, {{contratante_nome}}, inscrito(a) no CPF sob o nº {{contratante_cpf}}, residente e domiciliado(a) em {{paciente_endereco}}, na condição de paciente ou de responsável legal pelo(a) PACIENTE {{paciente_nome}}, inscrito(a) no CPF sob o nº {{paciente_cpf}}; e, de outro lado, como CONTRATADA, {{unidade_razao_social}}, pessoa jurídica de direito privado inscrita no CNPJ sob o nº {{unidade_cnpj}}, com sede em {{unidade_endereco}}, unidade da rede Risarte Odontologia, neste ato representada na forma do seu contrato social, têm entre si certo e ajustado o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS, que se regerá pela legislação brasileira, em especial o Código Civil e o Código de Defesa do Consumidor, e pelas cláusulas a seguir.'
    || E'\n\n' || 'Quando o(a) CONTRATANTE for o(a) próprio(a) PACIENTE, as menções a um e a outro referem-se à mesma pessoa.',
    'sections', jsonb_build_array(
      jsonb_build_object('title', 'Cláusula 1ª — Do objeto',
        'body',
        'O presente contrato tem por objeto a prestação, pela CONTRATADA e por sua equipe de cirurgiões-dentistas, de serviços de tratamento odontológico ao(à) PACIENTE.'
        || E'\n\n' || 'Parágrafo primeiro. As etapas e os procedimentos do tratamento seguem o MÉTODO RISARTE e são definidos nos Orçamentos/Planejamentos e nos Termos de Consentimento que, assinados pelas partes, integram este contrato como anexos para todos os efeitos, doravante denominados "Orçamento/Planejamento" e "Termo de Consentimento".'
        || E'\n\n' || 'Parágrafo segundo. Entende-se por MÉTODO RISARTE a programação e a organização do tratamento em 5 (cinco) etapas, nesta ordem: DIAGNÓSTICO, PREVENÇÃO, SAÚDE, FUNÇÃO e ESTÉTICA.'
        || E'\n\n' || 'Parágrafo terceiro. Este contrato não se limita a um único Orçamento/Planejamento. Conforme o MÉTODO RISARTE, o tratamento é realizado por etapas que, de acordo com a necessidade e a condição clínica do(a) PACIENTE e respeitada a sequência indicada pela CONTRATADA, podem constar de diferentes Orçamentos/Planejamentos, sempre com a ciência e a concordância do(a) CONTRATANTE. Cada novo Orçamento/Planejamento assinado passa a integrar este contrato.'
        || E'\n\n' || 'Parágrafo quarto. O(A) CONTRATANTE declara que, antes da assinatura deste instrumento, a CONTRATADA lhe esclareceu a natureza do tratamento proposto, os procedimentos envolvidos, os riscos a que se sujeita o(a) PACIENTE e as alternativas de tratamento existentes, inclusive por escrito, no Termo de Consentimento.'
        || E'\n\n' || 'Parágrafo quinto. Nesta data, o Orçamento/Planejamento contratado compreende os seguintes procedimentos:' || E'\n' || '{{tratamento_procedimentos}}' || E'\n' || 'no valor total de {{tratamento_valor_total}} ({{tratamento_valor_extenso}}), nas seguintes condições de pagamento: {{tratamento_condicoes}}.'),
      jsonb_build_object('title', 'Cláusula 2ª — Dos profissionais',
        'body',
        'O(A) CONTRATANTE está ciente de que contrata o serviço prestado pela CONTRATADA, executado por profissional habilitado e regularmente inscrito no Conselho Regional de Odontologia, e não um profissional específico.'
        || E'\n\n' || 'Parágrafo primeiro. A designação dos profissionais responsáveis pelo tratamento cabe à CONTRATADA e leva em conta o caso clínico do(a) PACIENTE, a capacitação técnica do profissional e a sua disponibilidade.'
        || E'\n\n' || 'Parágrafo segundo. O tratamento poderá ser iniciado com um profissional e continuado por outro igualmente habilitado, por decisão da CONTRATADA, sem que a troca gere penalidade a qualquer das partes ou constitua motivo de rescisão.'),
      jsonb_build_object('title', 'Cláusula 3ª — Do pagamento',
        'body',
        'Os valores e as formas de pagamento dos serviços objeto deste contrato estão estabelecidos no Orçamento/Planejamento (Cláusula 1ª, parágrafos primeiro e quinto).'
        || E'\n\n' || 'Parágrafo primeiro. O Orçamento/Planejamento informa o valor individual de cada etapa e procedimento. Se o tratamento não for realizado por completo, por qualquer motivo, o(a) CONTRATANTE pagará cada etapa e procedimento realizado até então pelo seu valor individual, sem o desconto eventualmente concedido para o tratamento completo.'
        || E'\n\n' || 'Parágrafo segundo. Exames, radiografias, serviços de laboratório e procedimentos não previstos no Orçamento/Planejamento, que se mostrem necessários ao sucesso do tratamento, no pré-operatório, durante a cirurgia, no pós-operatório ou durante o tratamento ortodôntico, serão informados previamente ao(à) CONTRATANTE e cobrados à parte, com a sua concordância, pelo valor praticado na ocasião. Em situação de urgência durante um procedimento, a CONTRATADA poderá realizá-los para preservar a saúde do(a) PACIENTE, comunicando-os logo em seguida.'
        || E'\n\n' || 'Parágrafo terceiro. Nos pagamentos em mensalidades (especialmente, mas não só, nos tratamentos ortodônticos), as mensalidades são devidas durante todo o tratamento ou, se o tratamento terminar antes, até o fim das parcelas acordadas, independentemente da frequência às consultas. Paga-se todos os meses, na data estipulada, e não somente quando há consulta: a mensalidade do mês sem comparecimento é exigível da mesma forma.'
        || E'\n\n' || 'Parágrafo quarto. O não pagamento de qualquer valor no vencimento acarretará multa moratória de 2% (dois por cento) sobre o valor em atraso, juros de mora de 1% (um por cento) ao mês e correção monetária pelo INPC, sem prejuízo das demais consequências previstas neste contrato, inclusive a rescisão, a critério da CONTRATADA.'
        || E'\n\n' || 'Parágrafo quinto. Se for necessária a cobrança judicial ou extrajudicial por meio de advogado, o(a) CONTRATANTE arcará com honorários advocatícios de 20% (vinte por cento) sobre o valor atualizado do débito.'
        || E'\n\n' || 'Parágrafo sexto. Qualquer atraso no pagamento dos valores estipulados no Orçamento/Planejamento acarretará a suspensão imediata da prestação dos serviços, até a regularização.'
        || E'\n\n' || 'Parágrafo sétimo. A CONTRATADA poderá emitir títulos de crédito e boletos bancários para a cobrança de quaisquer valores relacionados a este contrato, inclusive os previstos no Orçamento/Planejamento.'
        || E'\n\n' || 'Parágrafo oitavo. Se o(a) PACIENTE não comparecer a horário agendado sem desmarcar com antecedência mínima de 24 (vinte e quatro) horas, o(a) CONTRATANTE pagará multa equivalente a 50% (cinquenta por cento) do valor do procedimento "consulta odontológica" da tabela de preços vigente da CONTRATADA, por hora agendada, sem prejuízo das demais consequências previstas neste contrato. A multa não será devida em caso fortuito ou de força maior, desde que comprovado por documento apresentado à CONTRATADA (por exemplo, atestado médico ou boletim de ocorrência). O novo agendamento dependerá da disponibilidade da CONTRATADA.'),
      jsonb_build_object('title', 'Cláusula 4ª — Das obrigações da CONTRATADA',
        'body',
        'São obrigações da CONTRATADA:'
        || E'\n\n' || 'Parágrafo primeiro. Executar o tratamento em ambiente de trabalho seguro ao(à) PACIENTE, observando os padrões de higiene e biossegurança aplicáveis.'
        || E'\n\n' || 'Parágrafo segundo. Realizar os procedimentos de acordo com a técnica odontológica adequada ao caso, observando o estado atual da ciência.'
        || E'\n\n' || 'Parágrafo terceiro. Esclarecer previamente o(a) CONTRATANTE, por meio do Termo de Consentimento, sobre as vantagens, os riscos, as consequências e os valores do tratamento contratado, e sobre as consequências da desistência ou do abandono do tratamento.'
        || E'\n\n' || 'Parágrafo quarto. Informar o(a) CONTRATANTE, a cada procedimento realizado, sobre o plano de tratamento e a sua sequência.'
        || E'\n\n' || 'Parágrafo quinto. Resguardar a privacidade do(a) CONTRATANTE e do(a) PACIENTE durante todo o tratamento e após o seu término, nos termos da Cláusula 11ª.'),
      jsonb_build_object('title', 'Cláusula 5ª — Das obrigações do(a) CONTRATANTE',
        'body',
        'São obrigações do(a) CONTRATANTE, por si e pelo(a) PACIENTE:'
        || E'\n\n' || 'Parágrafo primeiro. Informar à CONTRATADA o histórico do(a) PACIENTE quanto a sensibilidade e alergias a medicamentos e anestésicos, problemas de sangramento, tratamentos médicos e odontológicos atuais e anteriores, doenças, cirurgias, reações gengivais ou de pele e qualquer outro fato relevante sobre a sua saúde e o seu estado físico e mental, respondendo com veracidade à anamnese e fornecendo os documentos solicitados. O(A) CONTRATANTE responde pelas intercorrências que decorrerem de informação omitida ou incorreta.'
        || E'\n\n' || 'Parágrafo segundo. Seguir fielmente as recomendações e prescrições da CONTRATADA, quanto a medicamentos, controles e cuidados antes, durante e depois do tratamento, cirúrgico ou não.'
        || E'\n\n' || 'Parágrafo terceiro. Realizar todos os exames solicitados pela CONTRATADA, necessários à continuidade adequada do tratamento, arcando com os seus custos.'
        || E'\n\n' || 'Parágrafo quarto. Comunicar imediatamente à CONTRATADA qualquer fato ou intercorrência relacionada ao tratamento que surgir durante ou após o procedimento realizado. A falta dessa comunicação exime a CONTRATADA de qualquer responsabilidade.'
        || E'\n\n' || 'Parágrafo quinto. Comparecer, após o término do procedimento e quando necessário, para o controle periódico da evolução do tratamento, no período e na forma orientados pela CONTRATADA, arcando com os custos dessas consultas, sob pena de perder a garantia do procedimento ou do tratamento realizado.'
        || E'\n\n' || 'Parágrafo sexto. Seguir rigorosamente as orientações de cuidados pós-tratamento e todas as instruções do profissional responsável pelo tratamento. O(A) CONTRATANTE declara conhecer os riscos do descumprimento dessas obrigações e orientações, e que o descumprimento, por inobservância, imprudência ou mera liberalidade, exonera a CONTRATADA de qualquer ônus ou responsabilidade pelos danos que o(a) PACIENTE vier a sofrer, de qualquer monta.'),
      jsonb_build_object('title', 'Cláusula 6ª — Da prestação dos serviços',
        'body',
        'A CONTRATADA é responsável pela correta prestação dos serviços, nos termos deste contrato.'
        || E'\n\n' || 'Parágrafo primeiro. A obrigação assumida pela CONTRATADA é de meio, e não de resultado ou garantia: cabe ao profissional agir com diligência, na técnica que entender mais indicada, empregando os esforços e meios necessários para alcançar o objetivo do tratamento, que depende também de fatores como a reação do organismo do(a) PACIENTE, a sua cooperação, o cumprimento das recomendações da CONTRATADA e o comparecimento para controle após o tratamento, previsto no parágrafo quinto da Cláusula 5ª.'
        || E'\n\n' || 'Parágrafo segundo. Se o(a) PACIENTE não cooperar durante ou após o tratamento, ou omitir informação relevante para o correto diagnóstico, a CONTRATADA fica isenta de responsabilidade pelas possíveis consequências e sequelas dos procedimentos adotados e pelos prejuízos financeiros, estéticos ou morais eventualmente causados ao(à) PACIENTE.'
        || E'\n\n' || 'Parágrafo terceiro. Considera-se não cooperação do(a) PACIENTE, entre outras situações: faltar às consultas agendadas, abandonar o tratamento, não observar as recomendações do cirurgião-dentista e não comparecer ao controle previsto no parágrafo quinto da Cláusula 5ª.'
        || E'\n\n' || 'Parágrafo quarto. O(A) CONTRATANTE está ciente de que não existe garantia absoluta de sucesso do tratamento, que depende também da manutenção regular e dos demais cuidados recomendados pela CONTRATADA.'
        || E'\n\n' || 'Parágrafo quinto. O(A) CONTRATANTE está ciente de que certos procedimentos causam desconforto inicial e de que isso não significa, por si só, falha do tratamento. Nesses casos, o(a) PACIENTE seguirá as recomendações da CONTRATADA.'
        || E'\n\n' || 'Parágrafo sexto. O(A) CONTRATANTE e o(a) PACIENTE autorizam, desde já, o uso das imagens relacionadas ao tratamento ou ao procedimento em matérias e campanhas promocionais e institucionais destinadas à divulgação ao público em geral. A autorização é concedida a título gratuito e abrange o uso das imagens em todo o território nacional e no exterior, sem que nada seja devido a título de direitos conexos à imagem ou a qualquer outro.'),
      jsonb_build_object('title', 'Cláusula 7ª — Do refazimento de procedimentos',
        'body',
        'Se for necessário refazer algum procedimento por questões que não configurem falha do tratamento, ou por culpa exclusiva do(a) PACIENTE:'
        || E'\n\n' || 'Parágrafo primeiro. Se o refazimento decorrer de questões que não configurem falha do tratamento nem culpa exclusiva do(a) PACIENTE, o(a) CONTRATANTE arcará com os custos de insumos e exames necessários à nova execução.'
        || E'\n\n' || 'Parágrafo segundo. Se o refazimento decorrer de culpa exclusiva do(a) PACIENTE, o(a) CONTRATANTE arcará integralmente com a nova execução, inclusive os honorários odontológicos do procedimento e as horas clínicas empregadas.'
        || E'\n\n' || 'Parágrafo terceiro. Considera-se culpa exclusiva do(a) PACIENTE, entre outras situações:' || E'\n' || '• a não cooperação durante ou após o tratamento;' || E'\n' || '• a omissão de informação relevante para o diagnóstico;' || E'\n' || '• o não cumprimento das recomendações da CONTRATADA quanto a medicamentos, controles e cuidados antes, durante e depois do tratamento;' || E'\n' || '• o não cumprimento das orientações de cuidados pós-tratamento;' || E'\n' || '• a falta de comunicação imediata à CONTRATADA de fato ou intercorrência relacionada ao tratamento;' || E'\n' || '• o não comparecimento para a avaliação dos resultados após o término do procedimento;' || E'\n' || '• o não comparecimento ao controle periódico, quando necessário;' || E'\n' || '• buscar o esclarecimento de dúvidas sobre o tratamento com terceiros alheios a este contrato, em vez de com a CONTRATADA;' || E'\n' || '• buscar a intervenção de outros profissionais em intercorrência do tratamento executado ou em execução, sem antes comunicar a CONTRATADA.'),
      jsonb_build_object('title', 'Cláusula 8ª — Das faltas',
        'body',
        'Se o(a) PACIENTE não comparecer na data agendada, o(a) CONTRATANTE deverá contatar a CONTRATADA para remarcar o atendimento, sob pena de caracterizar abandono ou desistência do tratamento (Cláusula 9ª), sem prejuízo da multa do parágrafo oitavo da Cláusula 3ª.'),
      jsonb_build_object('title', 'Cláusula 9ª — Do abandono ou da desistência do tratamento',
        'body',
        'Considera-se abandono ou desistência do tratamento, independentemente de aviso ou notificação:' || E'\n' || '• a falta a 3 (três) consultas consecutivas, com ou sem justificativa;' || E'\n' || '• a ausência por mais de 30 (trinta) dias contados de uma falta, com ou sem justificativa, salvo acordo com a CONTRATADA;' || E'\n' || '• o atraso de qualquer pagamento por mais de 30 (trinta) dias.'
        || E'\n\n' || 'Parágrafo primeiro. O abandono ou a desistência equivale, para todos os efeitos, à rescisão do contrato por iniciativa do(a) CONTRATANTE.'
        || E'\n\n' || 'Parágrafo segundo. Caracterizado o abandono ou a desistência, a CONTRATADA notificará o(a) CONTRATANTE por telefone, WhatsApp ou e-mail. Se o(a) CONTRATANTE não retomar o tratamento em 30 (trinta) dias da notificação, o contrato será considerado rescindido e aplicar-se-á o parágrafo primeiro da Cláusula 10ª. Os valores pagos e não utilizados não podem ser transferidos para outro paciente.'),
      jsonb_build_object('title', 'Cláusula 10ª — Da rescisão',
        'body',
        'Além das hipóteses legais, este contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de qualquer cláusula ou condição, sem prejuízo da cobrança dos serviços realizados e dos materiais empregados pela CONTRATADA até a data da rescisão.'
        || E'\n\n' || 'Parágrafo primeiro. Se o contrato for rescindido pelo(a) CONTRATANTE sem motivo imputável à CONTRATADA, inclusive por abandono ou desistência, antes do término do tratamento:' || E'\n' || '• são devidos os serviços realizados, pelo valor individual de cada etapa e procedimento, sem o desconto do tratamento completo, e os materiais já adquiridos ou confeccionados especificamente para o(a) PACIENTE;' || E'\n' || '• do valor pago pelo(a) CONTRATANTE abatem-se esses valores, e o que sobrar é o saldo;' || E'\n' || '• sobre o saldo incide multa compensatória de 50% (cinquenta por cento), retida pela CONTRATADA, e o restante do saldo é devolvido ao(à) CONTRATANTE.' || E'\n' || 'Se o valor pago não cobrir os serviços realizados e os materiais, a diferença será cobrada do(a) CONTRATANTE.'
        || E'\n\n' || 'Parágrafo segundo. Se o contrato for rescindido pela CONTRATADA sem motivo, antes do término do tratamento, os valores pagos pelos serviços do Orçamento/Planejamento ainda não realizados serão integralmente devolvidos ao(à) CONTRATANTE.'),
      jsonb_build_object('title', 'Cláusula 11ª — Da proteção de dados pessoais',
        'body',
        'A CONTRATADA trata os dados pessoais do(a) CONTRATANTE e do(a) PACIENTE, inclusive os dados de saúde, na condição de controladora, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD).'
        || E'\n\n' || 'Parágrafo primeiro. Os dados são tratados para a prestação do tratamento, o registro em prontuário, o agendamento e a comunicação com o(a) CONTRATANTE, o faturamento e a cobrança, o cumprimento de obrigações legais e regulatórias e o exercício regular de direitos, com fundamento no art. 7º, incisos II, V e VI, e no art. 11, inciso II, alíneas "a", "d" e "f", da LGPD; e, quanto às imagens, para a divulgação autorizada no parágrafo sexto da Cláusula 6ª, com fundamento no consentimento (art. 7º, inciso I, e art. 11, inciso I, da LGPD).'
        || E'\n\n' || 'Parágrafo segundo. Os dados são compartilhados somente com quem for necessário a essas finalidades: os profissionais e a equipe da CONTRATADA; a administração da rede Risarte, que opera o sistema de gestão utilizado pela CONTRATADA; laboratórios de prótese e centros de imagem; os fornecedores de sistemas de prontuário, agenda, assinatura eletrônica, comunicação e meios de pagamento; contadores e assessores jurídicos; e as autoridades, quando exigido por lei. Todos ficam obrigados à confidencialidade.'
        || E'\n\n' || 'Parágrafo terceiro. A CONTRATADA adota medidas técnicas e administrativas para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida, e mantém política de privacidade e procedimento de resposta a incidentes de segurança.'
        || E'\n\n' || 'Parágrafo quarto. O prontuário e a documentação clínica serão guardados pelo prazo exigido pela legislação e pelas normas do Conselho Federal de Odontologia. Os demais dados serão eliminados quando deixarem de ser necessários, salvo os que precisarem ser mantidos para cumprimento de obrigação legal ou exercício regular de direitos, na forma do art. 16 da LGPD.'
        || E'\n\n' || 'Parágrafo quinto. O(A) titular dos dados pode, a qualquer tempo, solicitar à CONTRATADA a confirmação do tratamento, o acesso, a correção, a portabilidade e as informações sobre o compartilhamento dos seus dados, e exercer os demais direitos do art. 18 da LGPD, pelos canais de atendimento da unidade.'),
      jsonb_build_object('title', 'Cláusula 12ª — Dos registros da apresentação e da negociação',
        'body',
        'O(A) CONTRATANTE declara estar ciente de que a apresentação do plano de tratamento e a negociação comercial que antecederam esta contratação podem ter sido registradas pela CONTRATADA por meio de anotações, gravação de áudio ou vídeo, transcrição ou resumo, inclusive com o apoio de ferramentas de tecnologia.'
        || E'\n\n' || 'Parágrafo primeiro. Esses registros integram a documentação desta contratação e servem para documentar as informações prestadas, as condições oferecidas e as escolhas do(a) CONTRATANTE. Se necessário, a CONTRATADA poderá utilizá-los para esclarecer dúvidas, conferir o que foi combinado, atender reclamações e exercer regularmente os seus direitos em processo judicial, administrativo ou arbitral, nos termos do art. 7º, inciso VI, e do art. 11, inciso II, alínea "d", da LGPD.'
        || E'\n\n' || 'Parágrafo segundo. Os registros são confidenciais, tratados na forma da Cláusula 11ª e guardados pelo tempo necessário a essas finalidades, observados os prazos legais de prescrição. O(A) CONTRATANTE pode solicitar acesso a eles.'
        || E'\n\n' || 'Parágrafo terceiro. Quando o resumo da apresentação já estiver registrado na data da assinatura deste contrato, ele é reproduzido abaixo. Quando o contrato for gerado e assinado no mesmo ato da negociação, o resumo pode não constar deste instrumento; nesse caso, ele integra a documentação da contratação assim que for registrado e fica à disposição do(a) CONTRATANTE.' || E'\n' || 'Resumo da apresentação: {{apresentacao_resumo}}'
        || E'\n\n' || 'Parágrafo quarto. Havendo divergência entre um registro da apresentação ou da negociação (inclusive o resumo) e este contrato ou o Orçamento/Planejamento assinados, prevalecem os documentos assinados.'),
      jsonb_build_object('title', 'Cláusula 13ª — Das disposições gerais',
        'body',
        'O(A) CONTRATANTE declara que todas as suas perguntas e dúvidas foram respondidas, que a CONTRATADA explicou claramente os detalhes e as etapas do tratamento objeto deste contrato e que consente com o plano de tratamento apresentado.'
        || E'\n\n' || 'Parágrafo primeiro. O(A) CONTRATANTE manterá a CONTRATADA informada sobre o seu endereço, telefone, e-mail e demais dados cadastrais.'
        || E'\n\n' || 'Parágrafo segundo. O pedido de documentação odontológica prévia (exames, radiografias, modelos) não implica, necessariamente, o início do tratamento pretendido. A análise dessa documentação serve para verificar a possibilidade e a adequação do tratamento, e pode resultar na indicação de tratamento diferente do imaginado ou de nenhum tratamento.'
        || E'\n\n' || 'Parágrafo terceiro. A documentação e os exames radiográficos do(a) PACIENTE poderão ser disponibilizados, mediante solicitação, ao final dos procedimentos ou do tratamento, desde que os custos e as multas contratuais tenham sido integralmente pagos.'
        || E'\n\n' || 'Parágrafo quarto. O(A) CONTRATANTE declara que leu e entendeu este contrato, o Orçamento/Planejamento, o Termo de Consentimento e, quando entregue, o Termo de Cuidados Pós-tratamento, e que suas dúvidas foram esclarecidas antes da assinatura.'
        || E'\n\n' || 'Parágrafo quinto. Este contrato obriga as partes e os seus sucessores a qualquer título.'
        || E'\n\n' || 'Parágrafo sexto. A tolerância de qualquer das partes quanto ao cumprimento das obrigações deste contrato não significa novação, renúncia ou alteração do que foi pactuado.'),
      jsonb_build_object('title', 'Cláusula 14ª — Do foro',
        'body',
        'Fica eleito o foro da comarca de {{unidade_cidade}} para dirimir as questões decorrentes deste contrato, ressalvado o direito do(a) CONTRATANTE de propor ação no foro do seu domicílio, nos termos do art. 101, inciso I, do Código de Defesa do Consumidor.')
    ),
    'closing',
    'E, por estarem assim justas e contratadas, as partes assinam este instrumento por meio de assinatura eletrônica, na presença das testemunhas abaixo, reconhecendo a validade dessa forma de assinatura, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, para que produza os seus efeitos legais.'
    || E'\n\n' || '{{documento_data_extenso}}'
  ),
  variables = array['contratante_nome', 'contratante_cpf', 'paciente_endereco', 'paciente_nome', 'paciente_cpf', 'unidade_razao_social', 'unidade_cnpj', 'unidade_endereco', 'tratamento_procedimentos', 'tratamento_valor_total', 'tratamento_valor_extenso', 'tratamento_condicoes', 'apresentacao_resumo', 'unidade_cidade', 'documento_data_extenso']::text[],
  is_provisional_text = false,
  updated_at = now()
where t.code = 'contrato_prestacao'
  and t.is_provisional_text;

do $$
begin
  if exists (
    select 1 from public.signature_templates
    where code = 'contrato_prestacao' and not is_provisional_text
      and position('Cláusula 14ª' in body::text) = 0
  ) then
    raise notice 'O contrato de prestação já estava com texto aprovado pela tela: o texto padrão NÃO foi aplicado. Cole-o em Assinaturas → Configurações → Modelos, se quiser.';
  end if;
end $$;
