import { redirect } from "next/navigation";

// O painel do programa (cartões, funil, metas) chega na IND5. Até lá, a
// entrada do módulo é a tela de trabalho: as indicações.
export default function IndicaPage() {
  redirect("/indica-mais-risos/indicacoes");
}
