import { Eye } from "lucide-react";
import { isTreino } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { formatBrDateTime } from "@/lib/dates";

/**
 * NO TREINO, ESTAS TELAS SÃO SÓ PARA CONSULTA (0260).
 *
 * Risartanos, acessos e permissões são cópia do sistema real. Sem o aviso, quem
 * treina procuraria o botão de editar e concluiria que o sistema quebrou — o
 * aviso diz onde a alteração se faz e de quando é a cópia. Fora do treino não
 * desenha nada.
 */
export async function AvisoSomenteConsulta() {
  if (!isTreino()) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("mirror_state")
    .select("last_sync_at")
    .maybeSingle<{ last_sync_at: string | null }>();

  return (
    <p className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
      <Eye className="mt-0.5 size-4 shrink-0 text-gold-tinta" />
      <span>
        <b>Só consulta no treino.</b> Os Risartanos, os acessos e as permissões
        são uma cópia do sistema real: para cadastrar ou alterar, use o sistema
        real — a mudança chega aqui sozinha.
        {data?.last_sync_at ? (
          <span className="text-muted-foreground">
            {" "}
            Última cópia: {formatBrDateTime(data.last_sync_at)}.
          </span>
        ) : (
          <span className="text-muted-foreground">
            {" "}
            A primeira cópia ainda não foi feita.
          </span>
        )}
      </span>
    </p>
  );
}
