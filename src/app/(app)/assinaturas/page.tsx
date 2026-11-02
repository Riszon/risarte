import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature, FileStack, PenLine, Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { canConfigureSignatures, canViewSignatures } from "@/lib/signatures/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Assinaturas digitais" };

/**
 * A PORTA DO MÓDULO. Até o painel com indicadores (ZS7), ela aponta para a
 * lista de pacotes (ZS4) e para "Minhas assinaturas pendentes" (ZS3).
 */
export default async function AssinaturasPage() {
  const session = await getSessionContext();
  if (!canViewSignatures(session)) redirect("/");

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileSignature}
        titulo="Assinaturas"
        descricao="Contratos, TCLE, orçamentos aprovados, autorizações de imagem e contratos de adesão assinados pelo celular, com validade jurídica (ZapSign)."
      >
        {canConfigureSignatures(session) && (
          <Button render={<Link href="/assinaturas/configuracoes" />} nativeButton={false} variant="secondary" size="sm">
            <Settings className="size-4" />
            Configurações
          </Button>
        )}
      </CabecalhoDeModulo>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/assinaturas/pacotes" className="rounded-xl border p-5 transition-colors hover:bg-muted/50">
          <p className="flex items-center gap-2 font-semibold">
            <FileStack className="size-4 text-gold-tinta" /> Pacotes enviados
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tudo o que foi enviado para assinatura: situação, quem já assinou, o PDF, baixar, reenviar e cancelar.
          </p>
        </Link>
        <Link href="/assinaturas/minhas" className="rounded-xl border p-5 transition-colors hover:bg-muted/50">
          <p className="flex items-center gap-2 font-semibold">
            <PenLine className="size-4 text-gold-tinta" /> Minhas assinaturas pendentes
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Os documentos que esperam a sua assinatura como testemunha ou representante.</p>
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        O envio de documentos ao paciente sai pela ficha dele (botão <b>Enviar para assinatura</b>). O painel com os indicadores
        da rede e das unidades chega numa próxima etapa.
      </p>
    </div>
  );
}
