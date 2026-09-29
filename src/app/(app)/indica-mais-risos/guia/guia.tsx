import "server-only";
import { indicaDb } from "@/lib/indica/db";
import { formatBRL } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parametroDaRede } from "../campanhas/opcoes";

/**
 * O GUIA do Indica +Risos: o que é, quem ganha, os termos e o passo a passo.
 *
 * Os números (pontos, carência, prazos, níveis) vêm da CONFIGURAÇÃO da rede,
 * lidos na hora — o guia não envelhece quando a franqueadora muda uma regra.
 * O que o sistema ainda não faz sozinho está dito como tal.
 */

type Nivel = { nome: string; ordem: number; criterio_conversoes: number; multiplicador: number; beneficios: string | null };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const fmt = (n: number) => String(n).replace(".", ",");

function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  );
}

function Termo({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="font-medium">{nome}</dt>
      <dd className="mt-0.5 text-muted-foreground">{children}</dd>
    </div>
  );
}

const INDICE = [
  ["objetivo", "O que é e para que serve"],
  ["quem-ganha", "Quem ganha com o programa"],
  ["passo-a-passo", "Como uma indicação anda"],
  ["niveis", "Níveis de Embaixador"],
  ["premios", "Riso Coins e prêmios"],
  ["termos", "O que significa cada termo"],
  ["regras", "Regras importantes"],
  ["funcoes", "O que cada função faz"],
  ["perguntas", "Perguntas frequentes"],
] as const;

export async function GuiaIndica() {
  const db = await indicaDb();
  const chaves = [
    "pontos_registro", "pontos_comparecimento", "pontos_fechamento", "bonus_percentual_valor_fechado",
    "carencia_dias", "validade_riso_coins_meses", "teto_conversoes_12_meses", "trava_atribuicao_dias",
    "janela_cliente_novo_meses", "consentimento_prazo_dias", "valor_riso_coin_centavos", "voucher_validade_dias",
    "niveis_janela_meses", "resgate_aprovacao_acima", "anonimizar_encerradas_apos_meses",
  ] as const;
  const [valores, { data: niveis }] = await Promise.all([
    Promise.all(chaves.map((c) => parametroDaRede<unknown>(c))),
    db.from("niveis").select("nome, ordem, criterio_conversoes, multiplicador, beneficios").eq("ativo", true).order("ordem")
      .returns<Nivel[]>(),
  ]);
  const p = Object.fromEntries(chaves.map((c, i) => [c, num(valores[i])])) as Record<(typeof chaves)[number], number>;
  const valorCoin = p.valor_riso_coin_centavos;
  const reaisDe = (coins: number) => formatBRL(Math.round(coins * valorCoin));
  const totalConversao = p.pontos_registro + p.pontos_comparecimento + p.pontos_fechamento;

  return (
    <div className="space-y-5">
      <nav aria-label="Índice do guia" className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Neste guia</p>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
          {INDICE.map(([id, rotulo], i) => (
            <li key={id}>
              <a href={`#${id}`} className="text-primary hover:underline">{i + 1}. {rotulo}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Secao id="objetivo" titulo="1. O que é e para que serve">
        <p>
          O <strong>Indica +Risos</strong> é o programa de indicação da Risarte. A ideia é simples: quem já é cliente e gostou
          do atendimento indica amigos e familiares — e é reconhecido por isso. Esse cliente passa a ser um{" "}
          <strong>Embaixador</strong> e ganha <strong>Riso Coins</strong>, que troca por prêmios.
        </p>
        <p>O objetivo do programa é:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Trazer clientes novos com confiança:</strong> quem chega por indicação já vem com uma boa referência de alguém próximo.</li>
          <li><strong>Reconhecer quem recomenda a Risarte</strong>, de forma organizada, justa e registrada.</li>
          <li><strong>Dar à equipe um jeito claro de pedir indicação</strong> no momento certo, com metas e acompanhamento.</li>
          <li><strong>Medir o resultado:</strong> quantas indicações viram tratamento, quanto o programa custa e quanto retorna.</li>
        </ul>
      </Secao>

      <Secao id="quem-ganha" titulo="2. Quem ganha com o programa">
        <div className="grid gap-3 sm:grid-cols-2">
          <Termo nome="O Embaixador (o cliente que indica)">
            Ganha Riso Coins a cada etapa que o amigo avança, sobe de nível conforme as indicações viram tratamento e troca
            os pontos por prêmios do catálogo. Acompanha tudo pelo celular, no portal.
          </Termo>
          <Termo nome="O indicado (o amigo)">
            Chega à Risarte pela recomendação de alguém de confiança e é atendido com cuidado desde o primeiro contato. Só é
            procurado depois de aceitar o contato (LGPD). Quando a rede ou uma campanha oferecer um presente de boas-vindas, a
            unidade informa — hoje isso <strong>não é aplicado automaticamente</strong> pelo sistema.
          </Termo>
          <Termo nome="A equipe (Risartanos)">
            Tem metas coletivas com prêmios por faixa e um ranking individual. Pedir indicação vira parte do atendimento, com
            botões próprios na ficha do cliente.
          </Termo>
          <Termo nome="A unidade e a rede">
            Clientes novos com custo menor do que outros canais, e números para decidir: funil, custo por cliente, retorno,
            campanhas que funcionam e alertas contra fraude.
          </Termo>
        </div>
      </Secao>

      <Secao id="passo-a-passo" titulo="3. Como uma indicação anda">
        <p>Cada indicação passa por etapas. Quase todas andam <strong>sozinhas</strong>, pela agenda, pelo Comercial e pelo Financeiro:</p>
        <ol className="space-y-2">
          {[
            ["Registrada", `O Embaixador indica (pela recepção, pelo link pessoal ou pelo portal). Ele ganha ${p.pontos_registro} Riso Coins PENDENTES — ainda não pode usar.`],
            ["Aceite do indicado", `O amigo precisa aceitar o contato. Se ele não aceitar em ${p.consentimento_prazo_dias} dias, a indicação é recusada e os dados dele são anonimizados.`],
            ["Agendada", "Quando a avaliação do indicado é marcada na agenda, a indicação se liga a ele sozinha."],
            ["Compareceu", `No check-in da avaliação, os pontos pendentes são liberados e o Embaixador ganha mais ${p.pontos_comparecimento} Riso Coins, já disponíveis.`],
            ["Fechou", `Quando a venda é fechada no Comercial, o Embaixador ganha ${p.pontos_fechamento} Riso Coins${p.bonus_percentual_valor_fechado > 0 ? ` (mais ${fmt(p.bonus_percentual_valor_fechado)}% do valor fechado)` : ""} — em CARÊNCIA.`],
            ["Convertida", `Com a 1ª parcela paga (ou depois de ${p.carencia_dias} dias), a carência acaba e os pontos do fechamento ficam disponíveis. É isto que conta como conversão.`],
          ].map(([etapa, texto], i) => (
            <li key={etapa} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
              <span><strong>{etapa}.</strong> {texto}</span>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-muted/60 p-3">
          Numa indicação que chega até o fim, o Embaixador soma <strong>{totalConversao} Riso Coins</strong> na regra base
          (≈ {reaisDe(totalConversao)} em prêmios). O nível e as campanhas podem aumentar esse número.
        </p>
        <p className="text-muted-foreground">
          Caminhos que encerram a indicação: <strong>recusada</strong> (não quis contato ou não se aplica), <strong>faltou</strong>{" "}
          (pode ser reagendada), <strong>não fechou</strong>, <strong>cancelada</strong> (a venda foi desfeita na carência — os
          pontos da carência são estornados) e <strong>expirada</strong> (passou a trava de {p.trava_atribuicao_dias} dias sem
          comparecimento).
        </p>
      </Secao>

      <Secao id="niveis" titulo="4. Níveis de Embaixador">
        <p>
          O nível sobe com as <strong>conversões dos últimos {p.niveis_janela_meses} meses</strong> (indicações que fecharam e passaram da carência). Nível mais alto multiplica os
          pontos das próximas indicações (o multiplicador não soma com o de campanha: vale o maior).
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Nível</th>
                <th className="p-2 text-right">A partir de</th>
                <th className="p-2 text-right">Multiplicador</th>
                <th className="p-2">Benefício</th>
              </tr>
            </thead>
            <tbody>
              {(niveis ?? []).map((n) => (
                <tr key={n.nome} className="border-t">
                  <td className="p-2 font-medium">{n.nome}</td>
                  <td className="p-2 text-right">{n.criterio_conversoes} conversão(ões)</td>
                  <td className="p-2 text-right">{fmt(Number(n.multiplicador))}×</td>
                  <td className="p-2 text-muted-foreground">{n.beneficios ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao id="premios" titulo="5. Riso Coins e prêmios">
        <ul className="list-disc space-y-1 pl-5">
          <li>Riso Coins são <strong>pontos, não dinheiro</strong>. Não podem ser trocados por dinheiro nem transferidos.</li>
          <li>Para medir o custo do programa, a rede considera 1 Riso Coin = {formatBRL(valorCoin)} (1.000 Riso Coins ≈ {reaisDe(1000)}).</li>
          <li>Os pontos disponíveis valem por <strong>{p.validade_riso_coins_meses} meses</strong>. Antes de vencer, a unidade recebe na fila de Mensagens um lembrete pronto para enviar ao Embaixador.</li>
          <li>
            Os prêmios estão no <strong>Catálogo</strong>: Crédito Risarte (vale em qualquer tratamento, depois da avaliação),
            vouchers e produtos de parceiros, experiências e doações. <strong>Procedimento clínico nunca é prêmio</strong>{" "}
            (ética odontológica).
          </li>
          <li>O prêmio pode ser <strong>cedido</strong> a outra pessoa (com nome, CPF e telefone de quem recebe); os pontos não.</li>
          <li>Crédito Risarte vira um <strong>voucher</strong> com código (ex.: RIS-XXXX-XXXX), válido por {p.voucher_validade_dias} dias, usado na negociação.</li>
          <li>Pedidos acima de {p.resgate_aprovacao_acima} Riso Coins precisam da aprovação do gestor; os demais são aprovados na hora.</li>
        </ul>
      </Secao>

      <Secao id="termos" titulo="6. O que significa cada termo">
        <dl className="grid gap-2 sm:grid-cols-2">
          <Termo nome="Embaixador">Cliente com cadastro na Risarte que aceitou o regulamento e indica pessoas. Tem um código pessoal (ex.: JOANA12).</Termo>
          <Termo nome="Indicado">A pessoa que foi indicada. Precisa aceitar o contato antes de ser procurada.</Termo>
          <Termo nome="Risartano">Qualquer pessoa da equipe Risarte.</Termo>
          <Termo nome="Riso Coins">Os pontos do programa. Trocados por prêmios do catálogo.</Termo>
          <Termo nome="Pendente">Pontos do registro que só liberam quando o indicado comparece.</Termo>
          <Termo nome="Disponível">Pontos que o Embaixador já pode trocar por prêmios.</Termo>
          <Termo nome="Em carência">Pontos do fechamento que esperam a 1ª parcela paga (ou {p.carencia_dias} dias). Se a venda for cancelada antes, são estornados.</Termo>
          <Termo nome="Conversão">Indicação que chegou ao fim: fechou e passou da carência. É a medida principal do programa.</Termo>
          <Termo nome="Trava de atribuição">Por {p.trava_atribuicao_dias} dias a indicação fica presa a quem indicou primeiro. Sem comparecimento nesse prazo, ela expira.</Termo>
          <Termo nome="Vale o primeiro registro">A mesma pessoa não pode ser indicada por dois Embaixadores ao mesmo tempo: fica com quem registrou primeiro.</Termo>
          <Termo nome="Cliente novo">Só pode ser indicado quem não foi atendido na rede nos últimos {p.janela_cliente_novo_meses} meses.</Termo>
          <Termo nome="Teto">Cada Embaixador gera pontos por até {p.teto_conversoes_12_meses} fechamentos em 12 meses.</Termo>
          <Termo nome="Nível e multiplicador">Quanto mais conversões nos últimos {p.niveis_janela_meses} meses, maior o nível e o multiplicador dos pontos.</Termo>
          <Termo nome="Campanha">Período com vantagem extra (ex.: pontos em dobro). Entra sozinha: a mais vantajosa para o Embaixador. Campanha em andamento só pode aumentar a vantagem.</Termo>
          <Termo nome="Especialidade-alvo">Campanha que só vale no fechamento se o tratamento do indicado for daquela especialidade.</Termo>
          <Termo nome="Marco">Bônus de uma campanha quando o Embaixador chega a um número de conversões dentro dela.</Termo>
          <Termo nome="Regra congelada">Cada indicação guarda a regra do dia em que foi registrada. Mudanças valem só para as próximas.</Termo>
          <Termo nome="Resgate">Troca de Riso Coins por um prêmio. Os pontos saem na hora do pedido.</Termo>
          <Termo nome="Portal do Embaixador">Página no celular, aberta por um link enviado no WhatsApp, onde o Embaixador vê saldo, indica e resgata. Não precisa de senha.</Termo>
          <Termo nome="Link pessoal">Endereço com o código do Embaixador para o amigo se cadastrar sozinho.</Termo>
          <Termo nome="Convite e aceite (LGPD)">Mensagem ao indicado pedindo autorização para a Risarte entrar em contato.</Termo>
          <Termo nome="Pedi indicação">Botão da ficha que registra que a equipe pediu uma indicação ao cliente (e como ele respondeu).</Termo>
          <Termo nome="Meta da equipe e faixas">Objetivo coletivo da unidade no período, com prêmios por faixa (ex.: Meta 1, Super Meta).</Termo>
          <Termo nome="Trava de qualidade">Comparecimento mínimo das indicações do período para a faixa da meta ser paga.</Termo>
          <Termo nome="Apuração">Contagem da meta: provisória (acompanhamento) ou final (base do prêmio, aprovada pelo gestor).</Termo>
          <Termo nome="Custo gerado e realizado">Gerado: pontos dados × valor do Riso Coin + prêmios da equipe. Realizado: prêmios efetivamente entregues + prêmios da equipe.</Termo>
          <Termo nome="CAC indicação">Custo do programa dividido pelas conversões: quanto custou trazer cada cliente.</Termo>
          <Termo nome="Alerta de fraude">Sinal automático para a franqueadora conferir (ex.: muitas indicações em poucos dias). Alerta alto em aberto segura os resgates do Embaixador.</Termo>
        </dl>
      </Secao>

      <Secao id="regras" titulo="7. Regras importantes">
        <ul className="list-disc space-y-1 pl-5">
          <li>Ninguém indica a si mesmo (mesmo CPF ou telefone).</li>
          <li>Quem já é paciente (atendido nos últimos {p.janela_cliente_novo_meses} meses) não pode ser indicado.</li>
          <li>A equipe <strong>nunca promete preço, desconto ou gratuidade</strong> no convite. A indicação é uma recomendação, não uma promoção.</li>
          <li>O Embaixador vê só a <strong>etapa</strong> da indicação — nunca diagnóstico, tratamento ou valor do amigo.</li>
          <li>Guardamos o mínimo do indicado (nome e telefone). Indicações encerradas são anonimizadas depois de {p.anonimizar_encerradas_apos_meses} meses.</li>
          <li>Ajuste manual de pontos só com motivo, e fica registrado na auditoria.</li>
        </ul>
      </Secao>

      <Secao id="funcoes" titulo="8. O que cada função faz">
        <div className="grid gap-3 sm:grid-cols-2">
          <Termo nome="Recepção e SDR">Registram indicações, cuidam do aceite, enviam as mensagens da fila, entregam prêmios e vouchers.</Termo>
          <Termo nome="Dentistas, coordenação, TSB e ASB">Na ficha do cliente: “Pedi indicação” nos bons momentos (fechamento, entrega de etapa, elogio) e “Nova indicação”.</Termo>
          <Termo nome="Comercial">Pede indicação no fechamento e usa o voucher de Crédito Risarte na negociação.</Termo>
          <Termo nome="Gerente e franqueado">Acompanham o painel, criam campanhas e metas, aprovam apurações, resgates e ajustes da unidade.</Termo>
          <Termo nome="Franqueadora">Define as regras da rede, vê a rede inteira, decide os alertas de fraude e acompanha o retorno.</Termo>
        </div>
      </Secao>

      <Secao id="perguntas" titulo="9. Perguntas frequentes">
        <dl className="space-y-3">
          {[
            ["O Embaixador precisa de senha?", "Não. Ele recebe pelo WhatsApp um link do portal, válido por um tempo, gerado pela unidade."],
            ["O amigo não aceitou o contato. E agora?", `Nada é feito com os dados dele. Sem aceite em ${p.consentimento_prazo_dias} dias, a indicação é recusada e os dados, anonimizados.`],
            ["Duas pessoas indicaram o mesmo amigo.", "Vale o primeiro registro. O sistema avisa na hora de registrar."],
            ["O indicado faltou.", "A indicação fica como “faltou” e pode ser reagendada. Aparece nas Ações do dia do painel."],
            ["A venda foi cancelada depois de fechada.", "Se ainda estava na carência, a indicação vira “cancelada” e os pontos da carência são estornados. Depois da carência, os pontos ficam."],
            ["Por que o resgate apareceu “em análise”?", "Há um alerta de conferência em aberto para aquele Embaixador. A franqueadora analisa e libera; oriente o cliente a aguardar o contato da unidade."],
            ["Posso mudar a pontuação de uma indicação antiga?", "Não. Cada indicação guarda a regra do dia do registro. Mudanças na configuração valem para as próximas."],
          ].map(([pgt, resp]) => (
            <div key={pgt}>
              <dt className="font-medium">{pgt}</dt>
              <dd className="text-muted-foreground">{resp}</dd>
            </div>
          ))}
        </dl>
      </Secao>
    </div>
  );
}
