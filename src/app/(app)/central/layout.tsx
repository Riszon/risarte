import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { podeVerCentral } from "@/lib/central/central";

/**
 * A CENTRAL DE CONFIGURAÇÃO (ASA0). Só abre para quem tem `modulo.central` —
 * que nasce só com o Admin Master. O que cada pessoa LÊ lá dentro quem decide
 * é o banco (regras de linha da 4000 e as portas da 4002).
 */
export default async function CentralLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();
  if (!podeVerCentral(session)) redirect("/");
  return <>{children}</>;
}
