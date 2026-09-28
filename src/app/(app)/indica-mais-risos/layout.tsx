import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewIndica } from "@/lib/indica/access";

/**
 * A porta do módulo. Quem não tem "Indica +Risos" na matriz de permissões
 * volta para o Início — o menu já não mostra, e o endereço digitado também não
 * abre. O que cada um vê lá dentro, o banco decide (RLS do schema `indica`).
 */
export default async function IndicaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();
  if (!canViewIndica(session)) redirect("/");
  return <>{children}</>;
}
