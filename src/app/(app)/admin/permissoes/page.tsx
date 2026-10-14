import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CAPACIDADES, matrizPadrao } from "@/lib/permissions";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import { isTreino } from "@/lib/environment";
import { padraoEfetivo, type PadraoFixado } from "@/lib/matriz-de-permissoes";
import { AvisoSomenteConsulta } from "@/components/aviso-somente-consulta";
import { PermissionsMatrix } from "./permissions-matrix";

export const metadata: Metadata = { title: "Matriz de permissões" };

/**
 * A matriz de permissões — quem pode o quê, por função.
 *
 * Só o Admin Master entra: `requireAdminMaster()` redireciona os demais, e a
 * política do banco recusa a escrita mesmo que alguém chame a função por fora.
 */
export default async function PermissoesPage() {
  await requireAdminMaster();

  const supabase = await createClient();
  const [matriz, padroes] = await Promise.all([
    supabase
      .from("permission_matrix")
      .select("capability, role")
      .eq("allowed", true)
      .returns<{ capability: string; role: UserRole }[]>(),
    // OC-00002 (0292): o padrão fixado pelo dono. Sem a migração (ou se a
    // leitura falhar), a tela compara com o de fábrica e o "Tornar padrão"
    // fica desligado com o motivo — nunca finge que fixou.
    supabase
      .from("permission_defaults")
      .select("capability, roles, updated_at")
      .returns<{ capability: string; roles: UserRole[]; updated_at: string | null }[]>(),
  ]);

  // Sem a tabela ou sem linha, mostra o padrão do código — a mesma escolha que
  // a sessão faz. Assim a tela nunca aparece vazia dando a impressão de que
  // ninguém tem permissão nenhuma.
  const semDados = Boolean(matriz.error) || !matriz.data || matriz.data.length === 0;
  const fabrica = matrizPadrao();
  const atual = semDados
    ? fabrica
    : matriz.data.reduce<Record<string, UserRole[]>>((acc, r) => {
        (acc[r.capability] ??= []).push(r.role);
        return acc;
      }, {});

  const padroesLidos = !padroes.error && padroes.data !== null;
  if (padroes.error) console.error("permission_defaults:", padroes.error.message);
  const fixados: Record<string, PadraoFixado> = {};
  if (padroesLidos) {
    for (const p of padroes.data) fixados[p.capability] = { roles: p.roles ?? [], updatedAt: p.updated_at };
  }

  return (
    <PermissionsMatrix
      capacidades={CAPACIDADES}
      papeis={[...USER_ROLES]}
      atual={atual}
      padrao={padraoEfetivo(fabrica, fixados)}
      fabrica={fabrica}
      fixados={fixados}
      podeFixar={padroesLidos}
      aindaSemTabela={semDados}
      somenteLeitura={isTreino()}
      aviso={<AvisoSomenteConsulta />}
    />
  );
}
