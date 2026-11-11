import { redirect } from "next/navigation";
import { requireAdminMaster } from "@/lib/auth";
import { rotaDaRede } from "@/lib/central/central";

/**
 * ASA1 (entrega 1): as Regras Comerciais viraram a aba **Comercial** da
 * Central de Configuração (D19) — o padrão da rede em Central › Rede, o ajuste
 * de cada unidade em Central › [unidade]. Este endereço continua existindo
 * para os menus e favoritos antigos.
 */
export default async function CommercialRulesPage() {
  await requireAdminMaster();
  redirect(rotaDaRede("comercial"));
}
