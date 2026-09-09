import { AlertTriangle, BookMarked } from "lucide-react";
import { ChatNavItem } from "@/components/chat-nav-item";
import { NotificationNavItem } from "@/components/notification-nav-item";
import { ReportNavItem } from "@/components/report-nav-item";
import { QuickSearch } from "@/components/quick-search";
import { SystemClock } from "@/components/clock";
import { TopbarItem } from "@/components/topbar-item";

/**
 * A BARRA DE CIMA — o que se usa em qualquer tela.
 *
 * Decisão do dono (08/09/2026): a barra lateral tinha ficado longa demais. O que
 * não é NAVEGAÇÃO DE MÓDULO saiu de lá e veio para cá — busca, chat, avisos,
 * manual, relato de problema e alertas. A lateral voltou a ser só o caminho
 * entre os módulos, que é o que ela sabe fazer.
 *
 * ⚠️ ESTA BARRA VIVE NO LAYOUT, e isso não é detalhe de arrumação: o
 * `ChatNavItem` é quem mantém o canal de presença ("quem está online"). Ele
 * precisa estar montado em toda tela — se um dia alguém mover esta barra para
 * dentro de uma página, a presença cai sem erro nenhum aparecer.
 *
 * **Por que a BOIA tem número e o TRIÂNGULO não.** A diferença não é descuido:
 * é o que cada um consegue contar sem mentir.
 *
 * A boia conta relatos, que são linhas de UMA tabela — uma consulta barata, e o
 * número bate exatamente com o que a tela mostra (`ReportNavItem`, 0252).
 *
 * O triângulo teria de contar alertas de financeiro E estoque; a parte do
 * estoque são três chamadas por pessoa, por minuto — o custo que o dia
 * 08/09/2026 inteiro foi gasto removendo. E contar só a metade barata daria um
 * número DIFERENTE do que a tela mostra, que é pior que número nenhum. O que é
 * urgente ali já chega pelo sino: os alertas do financeiro disparam notificação
 * (FIN7.3). O triângulo é para consultar.
 */
export function Topbar({
  podeBuscar,
  podeVerManual,
  podeVerSistema,
}: {
  podeBuscar: boolean;
  podeVerManual: boolean;
  podeVerSistema: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {/* A busca ocupa o espaço livre; os ícones ficam colados à direita. */}
      <div className="min-w-0 flex-1">
        {podeBuscar && <QuickSearch />}
      </div>

      <SystemClock />

      <div className="flex shrink-0 items-center gap-0.5">
        <ChatNavItem />
        <NotificationNavItem />
        {podeVerSistema && (
          <>
            <TopbarItem
              href="/alertas"
              label="Alertas do sistema"
              icon={<AlertTriangle className="size-[18px]" />}
              destaque
            />
            {/* A boia tem número, o triângulo não — ver o comentário abaixo:
                a diferença não é descuido, é o que cada um consegue contar sem
                mentir. */}
            <ReportNavItem />
          </>
        )}
        {podeVerManual && (
          <TopbarItem
            href="/manual"
            label="Manual de treinamento"
            icon={<BookMarked className="size-[18px]" />}
          />
        )}
      </div>
    </header>
  );
}
