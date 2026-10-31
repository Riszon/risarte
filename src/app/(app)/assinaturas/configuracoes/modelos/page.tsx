import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";
import { canConfigureSignatures } from "@/lib/signatures/access";
import { AUTH_LEVEL_LABEL, representanteLabel } from "@/lib/signatures/modelos-ui";
import type { RisarteSignerMode, TemplateAuthLevel } from "@/lib/signatures/types";
import { createClient } from "@/lib/supabase/server";

/**
 * OS MODELOS DE DOCUMENTO (ZS2): a lista do que o pacote pode levar, com o
 * selo "texto provisório" enquanto o dono não trocar pelo texto do jurídico.
 * Só quem configura (Admin Master sempre).
 */

export const metadata: Metadata = { title: "Assinaturas — Modelos" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  code: string;
  name: string;
  audience: "patient" | "company";
  kind: string;
  source: string | null;
  auth_level: TemplateAuthLevel;
  witness_count: number;
  risarte_signer_mode: RisarteSignerMode;
  risarte_signer_role: UserRole | null;
  is_active: boolean;
  is_provisional_text: boolean;
  sort_order: number;
};

export default async function ModelosPage() {
  const session = await getSessionContext();
  if (!canConfigureSignatures(session)) redirect("/assinaturas");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signature_templates")
    .select("id, code, name, audience, kind, source, auth_level, witness_count, risarte_signer_mode, risarte_signer_role, is_active, is_provisional_text, sort_order")
    .order("audience")
    .order("sort_order")
    .returns<Row[]>();

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileText}
        titulo="Modelos de documento"
        descricao="O texto de cada documento que vai para assinatura, os campos que ele preenche sozinho, as testemunhas e quem assina pela Risarte."
        voltar={{ href: "/assinaturas/configuracoes", rotulo: "Configurações" }}
      />
      {error && <p className="text-sm text-destructive">Não foi possível ler os modelos (falta a migração 0342?).</p>}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {(data ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.name}
                    <Badge variant="outline" className="text-[10px]">
                      {t.audience === "patient" ? "paciente" : "empresa"}
                    </Badge>
                    {t.is_provisional_text && (
                      <Badge className="bg-amber-100 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-100">texto provisório</Badge>
                    )}
                    {!t.is_active && (
                      <Badge variant="secondary" className="text-[10px]">
                        inativo
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {AUTH_LEVEL_LABEL[t.auth_level]} · {t.witness_count} testemunha{t.witness_count === 1 ? "" : "s"} · pela Risarte:{" "}
                    {representanteLabel(t.risarte_signer_mode, t.risarte_signer_role)}
                    {t.source ? " · texto vem do Empresarial" : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/assinaturas/configuracoes/modelos/${t.id}`} />}>
                  <Pencil className="mr-1 size-3.5" /> Editar
                </Button>
              </li>
            ))}
            {!error && (data ?? []).length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum modelo cadastrado.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
