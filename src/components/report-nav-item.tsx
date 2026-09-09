"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TopbarItem } from "@/components/topbar-item";

/** Quem já leu a resposta avisa por aqui, e o número cai na hora. */
export const RELATOS_VISTOS = "relatos-vistos";

/**
 * A BOIA, com o indicador de relatos esperando.
 *
 * ⚠️ O NÚMERO NÃO É O MESMO PARA TODO MUNDO, e é essa a decisão central. Quem
 * responde é o Admin Master, então para ele o indicador é a FILA DELE (relatos
 * abertos e em análise) e zera respondendo. Para todo o resto, contar a fila
 * seria pendurar no ícone um número sobre o qual a pessoa não pode fazer nada —
 * e ícone com número que não é seu ensina a ignorar números. Para ela o
 * indicador conta as RESPOSTAS que ainda não leu, e zera ao abrir a tela.
 *
 * **A regra mora no banco** (`system_reports_pending`, 0252), não aqui. A tela
 * daria conta de montar as duas consultas; se montasse, a régua do que "está
 * pendente" passaria a existir em dois lugares, e o dia em que discordassem
 * seria o dia em que alguém precisa confiar no número.
 *
 * ⚠️ A CONSULTA PARTE DO NAVEGADOR, como a do sino — uma vez por minuto e a
 * cada navegação. Ela não entra no tempo de abrir tela nenhuma, que foi o custo
 * que o dia 08/09/2026 inteiro foi gasto reduzindo.
 *
 * Banco ainda sem a 0252: a função não existe, o `rpc` devolve erro e o número
 * fica em zero. Ícone sem indicador é a mesma coisa de antes desta entrega; um
 * erro na tela por causa de migração pendente não seria.
 */
export function ReportNavItem() {
  const pathname = usePathname();
  const [pendentes, setPendentes] = useState(0);

  const consultar = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("system_reports_pending");
    return typeof data === "number" ? data : 0;
  }, []);

  useEffect(() => {
    let cancelado = false;

    const atualizar = async () => {
      const n = await consultar();
      if (!cancelado) setPendentes(n);
    };

    atualizar();
    const intervalo = setInterval(atualizar, 60_000);

    // Sem isto, quem acabou de ler a resposta continuaria vendo o número até a
    // próxima consulta — até um minuto olhando para um aviso já resolvido.
    window.addEventListener(RELATOS_VISTOS, atualizar);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      window.removeEventListener(RELATOS_VISTOS, atualizar);
    };
  }, [consultar, pathname]); // reconsulta ao navegar (ex.: depois de responder)

  return (
    <TopbarItem
      href="/problemas"
      label="Problemas relatados"
      icon={<LifeBuoy className="size-[18px]" />}
      badge={pendentes}
    />
  );
}
