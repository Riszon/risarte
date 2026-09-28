import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { CascaPublica } from "@/components/indica/casca-publica";

export const metadata: Metadata = {
  title: "Obrigado",
  robots: { index: false, follow: false },
};

// A mesma resposta para todo mundo: a página pública não diz se a pessoa já
// era paciente ou já tinha sido indicada (LGPD).
export default function ObrigadoPage() {
  return (
    <CascaPublica>
      <div className="space-y-2 rounded-xl border bg-background p-5 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <h1 className="text-xl font-semibold">Recebemos o seu contato</h1>
        <p className="text-sm text-muted-foreground">
          A unidade vai falar com você pelo WhatsApp para combinar o melhor horário. Até breve!
        </p>
      </div>
    </CascaPublica>
  );
}
