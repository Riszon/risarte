import Link from "next/link";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LeadStage } from "@/lib/empresarial/constants";

/**
 * A EMPRESA A UM CLIQUE DO FUNIL (pedido do dono, 09/11/2026: "deve ter como
 * acessar as informações da empresa depois que foi feito o fechamento, direto
 * do funil"). Antes o caminho ficava só dentro da aba Fechamento e no cartão
 * da fase Ganho. Aparece no alto da ficha assim que o cadastro existe.
 */
export function AtalhosDaEmpresa({
  companyId,
  stage,
}: {
  companyId: string;
  stage: LeadStage;
}) {
  const atalhos = [
    { rotulo: "Titulares", aba: "colaboradores" },
    { rotulo: "Cobranças", aba: "financeiro" },
    { rotulo: "Contratos", aba: "contratos" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
      <Button
        size="sm"
        className="h-8 text-xs"
        nativeButton={false}
        render={<Link href={`/empresarial/${companyId}`} />}
      >
        <Building2 className="mr-1 size-3.5" />
        Abrir a empresa
      </Button>
      {atalhos.map((a) => (
        <Button
          key={a.aba}
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          nativeButton={false}
          render={<Link href={`/empresarial/${companyId}?aba=${a.aba}`} />}
        >
          {a.rotulo}
        </Button>
      ))}
      <span className="text-xs text-muted-foreground">
        {stage === "CLOSED_LOST"
          ? "O cadastro desta empresa continua no Empresarial."
          : "O cadastro da empresa já existe: o que acontece depois do fechamento fica lá."}
      </span>
    </div>
  );
}
