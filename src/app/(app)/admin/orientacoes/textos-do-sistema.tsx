import { FlaskConical, HandHeart } from "lucide-react";
import { ComNegrito } from "@/components/com-negrito";
import { BOAS_VINDAS, GUIA_DO_TREINO } from "@/lib/textos-automaticos";

/**
 * O QUE O SISTEMA JÁ DIZ SOZINHO — só para consulta.
 *
 * Pedido do dono (20/09/2026): *"coloque na tela Orientações os textos que
 * estão configurados para a tela de boas-vindas, para saber o que os usuários
 * estão recebendo quando entram no sistema; daqui 2 semanas provavelmente não
 * vou lembrar mais"*.
 *
 * ⚠️ ISTO NÃO É UMA CÓPIA DO TEXTO: é o MESMO texto, lido de
 * `textos-automaticos.ts`. Uma cópia divergiria na primeira correção, e a tela
 * que existe para o dono saber o que a equipe recebe passaria a mentir. Por
 * isso aqui não se edita — mudar o texto é mudar aquele arquivo, e a mudança
 * entra numa entrega, com a novidade registrada.
 */
function Bloco({
  icone,
  titulo,
  quando,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  quando: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <header className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icone}
          {titulo}
        </h3>
        <p className="text-xs text-muted-foreground">
          <b>Quando aparece:</b> {quando}
        </p>
      </header>
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export function TextosDoSistema() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">O que o sistema já diz sozinho</h2>
        <p className="text-sm text-muted-foreground">
          Estes textos não são editados aqui: eles vêm com o sistema e aparecem
          sozinhos para a equipe. Esta tela mostra exatamente o que cada pessoa
          lê — para você conferir depois, sem precisar lembrar de cabeça. Para
          mudar algum deles, peça a alteração: ela entra numa entrega e fica
          registrada nas novidades.
        </p>
      </div>

      <Bloco
        icone={<HandHeart className="size-4 text-gold-tinta" />}
        titulo="Boas-vindas ao riSZon"
        quando={BOAS_VINDAS.quando}
      >
        <p className="font-semibold">{BOAS_VINDAS.titulo("[primeiro nome]")}</p>
        <p>{BOAS_VINDAS.abertura}</p>
        <div className="space-y-2 border-l-2 border-gold/50 pl-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Para quem ainda está só no Início (sem o sistema real liberado)
          </p>
          <p>
            <ComNegrito texto={BOAS_VINDAS.proximoPasso.recemChegado} />
          </p>
        </div>
        <div className="space-y-2 border-l-2 border-primary/40 pl-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Para quem já tem o sistema liberado
          </p>
          <p>
            <ComNegrito texto={BOAS_VINDAS.proximoPasso.liberado} />
          </p>
        </div>
        <p>
          <ComNegrito texto={BOAS_VINDAS.senha} />
        </p>
        <p>
          <ComNegrito texto={BOAS_VINDAS.manual} />
        </p>
        <p className="text-xs text-muted-foreground">
          Botão: <b>{BOAS_VINDAS.botao}</b>
        </p>
      </Bloco>

      <Bloco
        icone={<FlaskConical className="size-4 text-gold-tinta" />}
        titulo="Guia do riSZon Treino"
        quando={GUIA_DO_TREINO.quando}
      >
        <p className="font-semibold">{GUIA_DO_TREINO.titulo}</p>
        <p>
          <ComNegrito texto={GUIA_DO_TREINO.abertura} />
        </p>
        <ul className="space-y-2">
          {GUIA_DO_TREINO.itens.map((item) => (
            <li key={item.titulo}>
              <b>{item.titulo}</b> {item.texto}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{GUIA_DO_TREINO.rodape}</p>
      </Bloco>
    </div>
  );
}
