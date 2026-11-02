import type { Metadata } from "next";
import { ExternalLink, FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { AtualizaAoVivo } from "@/components/assinaturas/atualiza-ao-vivo";
import { getSessionContext } from "@/lib/auth";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { canViewSignatures } from "@/lib/signatures/access";
import { minhasPendentes, papelDoGrupo } from "@/lib/signatures/minhas";
import { createClient } from "@/lib/supabase/server";

/**
 * MINHAS ASSINATURAS PENDENTES (ZS3). Aberta a qualquer pessoa logada: quem
 * foi escolhido como testemunha ou representante assina aqui, na ordem — o
 * botão só abre quando é a vez dela.
 */

export const metadata: Metadata = { title: "Minhas assinaturas pendentes" };
export const dynamic = "force-dynamic";

export default async function MinhasAssinaturasPage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const lista = await minhasPendentes(supabase);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileSignature}
        titulo="Minhas assinaturas pendentes"
        descricao="Os documentos que esperam a sua assinatura como testemunha ou representante da Risarte. Cada pessoa assina na sua vez: o botão abre quando chegar a sua."
        voltar={canViewSignatures(session) ? { href: "/assinaturas", rotulo: "Assinaturas" } : undefined}
      />
      <AtualizaAoVivo />
      {lista === null ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Não foi possível ler a sua fila (falta a migração 0343 neste banco?).
        </p>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">Nada esperando a sua assinatura.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {lista.map((p) => (
            <li key={`${p.package_id}-${p.order_group}`}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <span className="font-mono">{p.number}</span> · {p.client_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.documents ?? "documentos"} · você assina como {papelDoGrupo(p.order_group)}
                      {p.sent_at ? ` · enviado em ${formatBrDateTime(p.sent_at)}` : ""}
                      {p.expires_at ? ` · vale até ${formatBrDate(p.expires_at)}` : ""}
                    </p>
                  </div>
                  {p.is_my_turn && p.sign_url ? (
                    <Button size="sm" nativeButton={false} render={<a href={p.sign_url} target="_blank" rel="noopener noreferrer" />}>
                      <ExternalLink className="mr-1 size-3.5" /> Assinar agora
                    </Button>
                  ) : (
                    <Badge variant="outline">ainda não é a sua vez</Badge>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
