"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TopbarItem } from "@/components/topbar-item";
import { contagemConfirmada } from "@/lib/contagem";

/**
 * O sino da barra de cima, com o contador de não lidas.
 *
 * Consulta a cada 60 segundos e a cada navegação (é assim que o número some
 * depois de a pessoa ler). ⚠️ A consulta parte do NAVEGADOR, não do servidor —
 * por isso ela não entra no tempo de abrir cada tela, que foi o que custou o dia
 * 08/09/2026 para descobrir e reduzir.
 */
export function NotificationNavItem() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [semContagem, setSemContagem] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function fetchCount() {
      const n = contagemConfirmada(
        await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null)
      );
      if (cancelled) return;
      // AP136: contagem que falhou NÃO zera o sino. Fica o último número que
      // se sabe, com a marca de que não deu para conferir.
      setSemContagem(n === null);
      if (n !== null) setUnread(n);
    }

    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]); // re-fetch on navigation (e.g. after reading)

  return (
    <TopbarItem
      href="/notificacoes"
      label={semContagem ? "Notificações (não foi possível contar agora)" : "Notificações"}
      icon={<Bell className="size-[18px]" />}
      badge={unread}
      semContagem={semContagem}
    />
  );
}
