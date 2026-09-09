import { AlertTriangle, BookMarked, LifeBuoy } from "lucide-react";
import { ChatNavItem } from "@/components/chat-nav-item";
import { NotificationNavItem } from "@/components/notification-nav-item";
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
 * **Por que o ícone de Alertas não tem número.** Contar tudo o que a tela de
 * alertas mostra exigiria três consultas de estoque por minuto, por pessoa — o
 * custo que o dia 08/09 foi gasto removendo. E contar só a parte barata daria um
 * número DIFERENTE do que a tela mostra, que é pior que número nenhum. O que é
 * urgente já chega pelo sino: os alertas do financeiro disparam notificação
 * (FIN7.3). Aqui é para consultar.
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
            <TopbarItem
              href="/problemas?relatar=1"
              label="Relatar um problema"
              icon={<LifeBuoy className="size-[18px]" />}
            />
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
