import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canIndicar, canViewIndica } from "@/lib/indica/access";
import { GuiaIndica } from "../indica-mais-risos/guia/guia";

export const metadata: Metadata = { title: "Como funciona o Indica +Risos" };

/**
 * O MESMO guia para quem só pede e registra indicação (dentistas, coordenação,
 * TSB, ASB): a porta do módulo barra essas pessoas, mas elas precisam saber
 * como o programa funciona para explicar ao cliente.
 */
export default async function GuiaIndicaPage() {
  const session = await getSessionContext();
  if (!canIndicar(session)) redirect("/");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Como funciona o Indica +Risos</h1>
        <p className="text-sm text-muted-foreground">
          O guia do programa de indicação. Os números vêm da configuração da rede.
          {canViewIndica(session) && (
            <>
              {" "}
              <Link href="/indica-mais-risos" className="text-primary hover:underline">Abrir o módulo</Link>
            </>
          )}
        </p>
      </div>
      <GuiaIndica />
    </div>
  );
}
