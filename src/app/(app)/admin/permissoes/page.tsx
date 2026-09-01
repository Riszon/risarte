import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CAPACIDADES, matrizPadrao } from "@/lib/permissions";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import { PermissionsMatrix } from "./permissions-matrix";

export const metadata: Metadata = { title: "Matriz de permissões" };

/**
 * A matriz de permissões — quem pode o quê, por papel.
 *
 * Só o Admin Master entra: `requireAdminMaster()` redireciona os demais, e a
 * política do banco recusa a escrita mesmo que alguém chame a função por fora.
 */
export default async function PermissoesPage() {
  await requireAdminMaster();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permission_matrix")
    .select("capability, role")
    .eq("allowed", true)
    .returns<{ capability: string; role: UserRole }[]>();

  // Sem a tabela ou sem linha, mostra o padrão do código — a mesma escolha que
  // a sessão faz. Assim a tela nunca aparece vazia dando a impressão de que
  // ninguém tem permissão nenhuma.
  const semDados = Boolean(error) || !data || data.length === 0;
  const atual = semDados
    ? matrizPadrao()
    : data.reduce<Record<string, UserRole[]>>((acc, r) => {
        (acc[r.capability] ??= []).push(r.role);
        return acc;
      }, {});

  return (
    <PermissionsMatrix
      capacidades={CAPACIDADES}
      papeis={[...USER_ROLES]}
      atual={atual}
      padrao={matrizPadrao()}
      aindaSemTabela={semDados}
    />
  );
}
