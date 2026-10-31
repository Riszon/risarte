import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature, Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { canConfigureSignatures, canViewSignatures } from "@/lib/signatures/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Assinaturas digitais" };

/**
 * ZS1: a porta do módulo existe para o menu não levar a 404. O painel de
 * verdade (cartões, pendências, consumo do plano) chega na ZS7; o envio, na
 * ZS2. Até lá a tela diz isso com todas as letras.
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

      <section className="rounded-xl border border-dashed bg-muted/30 p-6 text-sm">
        <h2 className="text-base font-semibold">Módulo em construção</h2>
        <p className="mt-2 text-muted-foreground">
          A assinatura digital está sendo montada em etapas. Nesta primeira etapa entraram o cadastro
          das permissões (Administração → Permissões, grupo <b>Assinaturas digitais</b>) e a tela de
          configurações da rede. O botão <b>Enviar para assinatura</b> na ficha do paciente, o acompanhamento
          dos documentos e o painel com os indicadores chegam nas próximas etapas, e as novidades avisam
          quando cada uma entrar.
        </p>
        <p className="mt-2 text-muted-foreground">
          Nenhum documento é enviado por aqui ainda.
        </p>
      </section>
    </div>
  );
}
