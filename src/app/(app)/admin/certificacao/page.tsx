import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PADRAO_DO_PORTAO,
  ehEscopo,
  ehGatilho,
  type ConfiguracaoDoPortao,
  type MetaDoTreino,
} from "@/lib/certificacao";
import { PortaoEditor } from "./portao-editor";
import { MissoesEditor } from "./missoes-editor";

export const metadata: Metadata = { title: "Certificação para o sistema real" };

export default async function CertificacaoPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: metas }, { data: config }] = await Promise.all([
    supabase
      .from("training_requirements")
      .select("role, indicator, minimum_count")
      .returns<MetaDoTreino[]>(),
    supabase
      .from("training_settings")
      .select("release_scope, release_trigger")
      .maybeSingle(),
  ]);

  // ⚠️ Linha ausente ou valor estranho cai no PADRÃO, e o padrão é o cauteloso
  // (individual + aprovação). A tela nunca fica sem resposta — e, se a migração
  // ainda não rodou naquele banco, ela mostra o padrão em vez de quebrar
  // (mesma janela tratada em `permission_matrix`, §0b do CLAUDE.md).
  const atual: ConfiguracaoDoPortao = {
    release_scope:
      config && ehEscopo(String(config.release_scope))
        ? (config.release_scope as ConfiguracaoDoPortao["release_scope"])
        : PADRAO_DO_PORTAO.release_scope,
    release_trigger:
      config && ehGatilho(String(config.release_trigger))
        ? (config.release_trigger as ConfiguracaoDoPortao["release_trigger"])
        : PADRAO_DO_PORTAO.release_trigger,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Certificação para o sistema real
        </h1>
        <p className="text-sm text-muted-foreground">
          O riSZon real já nasce <strong>fechado</strong> para todo Risartano
          novo: ele entra primeiro no treino. Aqui se define o que cada função
          precisa cumprir no treino para que o sistema real seja liberado.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Vale para a rede inteira.</p>
        <p className="mt-1 text-muted-foreground">
          Não há ajuste por unidade, de propósito: é o padrão único de entrada
          no sistema real. Unidade que pudesse baixar a própria régua
          transformaria o portão em sugestão.
        </p>
      </div>

      <PortaoEditor atual={atual} />

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            A missão de cada função
          </h2>
          <p className="text-sm text-muted-foreground">
            Quantas vezes a pessoa precisa fazer cada coisa <strong>no
            treino</strong>. Função sem nenhum número exigido não é barrada.
          </p>
        </div>
        <MissoesEditor metas={metas ?? []} />
      </div>

      <p className="text-xs text-muted-foreground">
        A medição do progresso e a liberação automática entram nas próximas
        etapas. Por enquanto esta tela guarda a definição, e a liberação
        continua sendo feita à mão em Administração → Ambientes.
      </p>
    </div>
  );
}
