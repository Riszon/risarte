import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, USER_ROLES } from "@/lib/roles";
import { INATIVIDADE_PADRAO_MIN, PAPEL_PADRAO } from "@/lib/acesso";
import { TemposEditor } from "./tempos-editor";

export const metadata: Metadata = { title: "Sessão e inatividade" };

/**
 * SESSÃO E INATIVIDADE (0287) — quanto tempo sem uso até o sistema desconectar,
 * por função. Só o Admin Master.
 */
export default async function SessaoPage() {
  await requireAdminMaster();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_idle_settings")
    .select("papel, idle_minutes")
    .returns<{ papel: string; idle_minutes: number }[]>();

  // ⚠️ SEM A 0287 NESTE BANCO a tela mostra o padrão e NÃO deixa salvar — o
  // código viaja sozinho, a migração não (CLAUDE.md §0b). Fingir que gravou
  // seria pior que avisar.
  const semTabela = Boolean(error);
  const tempos: Record<string, number> = semTabela
    ? { [PAPEL_PADRAO]: INATIVIDADE_PADRAO_MIN }
    : Object.fromEntries((data ?? []).map((r) => [r.papel, r.idle_minutes]));

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sessão e inatividade
        </h1>
        <p className="text-sm text-muted-foreground">
          Quanto tempo o sistema pode ficar <strong>sem uso</strong> antes de
          desconectar a pessoa. Dois minutos antes, a tela avisa.
        </p>
      </div>

      {semTabela && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>Falta rodar a migração 0287 neste banco.</strong> Até lá não há
          desconexão por inatividade, e o que for digitado aqui não é gravado.
        </p>
      )}

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Como funciona</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>Sem uso</strong> é ficar sem clicar, digitar ou rolar a
            tela. Deixar o sistema aberto não conta como uso.
          </li>
          <li>
            <strong>Um login por dia:</strong> o acesso vale para a data em que
            foi feito. No dia seguinte o sistema pede a senha de novo, qualquer
            que seja o tempo configurado aqui.
          </li>
          <li>
            <strong>Gravação de consulta em andamento não desconecta</strong> —
            nem por inatividade, nem pela virada do dia.
          </li>
          <li>
            Cada acesso fica registrado em <strong>Auditoria</strong>: dia,
            hora de entrada e de saída, motivo da saída, tempo em uso e tempo
            parado, navegador e endereço de internet.
          </li>
        </ul>
      </div>

      <TemposEditor
        tempos={tempos}
        papeis={USER_ROLES.map((r) => ({ papel: r, rotulo: ROLE_LABELS[r] }))}
        podeSalvar={!semTabela}
      />
    </div>
  );
}
