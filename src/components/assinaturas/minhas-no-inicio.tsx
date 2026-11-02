import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { minhasPendentes } from "@/lib/signatures/minhas";
import { createClient } from "@/lib/supabase/server";

/**
 * "ASSINATURAS ESPERANDO VOCÊ" NO INÍCIO (ZS3). Só aparece quando há algo:
 * quem nunca é chamado a assinar nunca vê o cartão. Falhar na leitura some
 * com o cartão — o Início não cai por causa dele.
 */
export async function MinhasAssinaturasNoInicio() {
  const supabase = await createClient();
  const lista = await minhasPendentes(supabase);
  if (!lista || lista.length === 0) return null;
  const minhaVez = lista.filter((p) => p.is_my_turn).length;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <FileSignature className="size-5 text-gold-tinta" />
          <div>
            <p className="text-sm font-medium">
              {lista.length === 1 ? "1 documento espera a sua assinatura" : `${lista.length} documentos esperam a sua assinatura`}
            </p>
            <p className="text-xs text-muted-foreground">
              {minhaVez === 0 ? "Ainda não é a sua vez: alguém assina antes de você." : minhaVez === 1 ? "1 já é a sua vez." : `${minhaVez} já são a sua vez.`}
            </p>
          </div>
        </div>
        <Button size="sm" nativeButton={false} render={<Link href="/assinaturas/minhas" />}>
          Ver e assinar
        </Button>
      </CardContent>
    </Card>
  );
}
