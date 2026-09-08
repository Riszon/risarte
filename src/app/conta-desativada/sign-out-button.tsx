"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * O botão que realmente encerra a sessão.
 *
 * Sem ele a pessoa ficaria presa: o token continua válido até vencer, então o
 * porteiro devolveria qualquer tentativa de ir ao login de volta para dentro do
 * sistema — e de dentro ela seria mandada para cá outra vez.
 */
export function SignOutButton() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button onClick={sair} disabled={saindo} className="w-full">
      <LogOut className="mr-2 size-4" />
      {saindo ? "Saindo…" : "Sair do sistema"}
    </Button>
  );
}
