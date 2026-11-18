# Pedido ao Asaas: confirmação por escrito do uso da chave da unidade (roteiro, item A2)

Rascunho de 18/11/2026. Os campos entre colchetes são do dono.

---

**Assunto:** Confirmação por escrito — operação das contas das unidades franqueadas pelo sistema da franqueadora (rede Risarte)

Olá, [nome do contato],

Somos a Risarte, uma rede de franquias odontológicas. A franqueadora é a [razão social da franqueadora], CNPJ [CNPJ]. Estamos concluindo a integração do nosso sistema de gestão, o riSZon, com o Asaas. Antes de colocar a primeira unidade em produção, precisamos de uma **confirmação por escrito** sobre o desenho abaixo.

**Como vai funcionar**
- Cada unidade franqueada tem a **própria conta Asaas**, aberta em nome dela, com **CNPJ e titular próprios** (não é subconta da franqueadora).
- O franqueado gera a chave de API da conta dele e a entrega à franqueadora, com um **termo de autorização** assinado. A chave fica guardada criptografada no nosso servidor e nunca chega ao navegador.
- Com essa chave, o riSZon, operado pela franqueadora, faz na conta da unidade:
  - cadastro de clientes;
  - emissão, alteração e cancelamento de cobranças (boleto, Pix, cartão à vista e parcelado);
  - estornos;
  - consulta de saldo, extrato, tarifas e situação da conta;
  - cadastro do webhook.
- Cada cobrança leva **split** para a carteira da franqueadora (royalties e outras taxas da rede).
- A chave de produção será criada **só com as permissões mínimas**. Clientes, notificações, cobranças, estornos, parcelamentos e webhooks com leitura e escrita. Chargeback, chaves Pix, antecipação, extrato e dados da conta só com leitura. **Nenhuma permissão** de transferência, Pix enviado ou pagamento de contas.

**O que pedimos que o Asaas confirme por escrito**
1. Esse uso é permitido pelos termos do Asaas: a franqueadora operar, por API, contas de **CNPJs e titulares diferentes do dela**, com a chave gerada e autorizada pelo titular de cada conta.
2. Esse desenho **não exige** operação BaaS, contas filiais nem subcontas da franqueadora.
3. A chave com permissões restritas por recurso, como descrita acima, é suportada, e o Asaas recomenda esse uso.
4. Se existe algum **cadastro, contrato, aceite ou configuração** necessário, na conta da franqueadora ou na de cada unidade, para operar dessa forma. Se existir, quais são.
5. Se há **limite** de quantas contas um mesmo sistema pode operar assim, ou alguma exigência quando a rede crescer.

Pedimos a resposta por e-mail, em nome do Asaas, porque vamos **anexá-la como comprovante** ao nosso controle interno antes de ligar a produção.

Obrigado,

[seu nome]
[cargo] — Risarte
[telefone]
