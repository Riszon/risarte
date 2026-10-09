"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O botão que realmente encerra a sessão.
 *
 * Sem ele a pessoa ficaria presa: o token continua válido até vencer, então o
 * porteiro devolveria qualquer tentativa de ir ao login de volta para dentro do
 * sistema — e de dentro ela seria mandada para cá outra vez.
 *
 * 0287: sai pela rota que encerra o acesso e registra a saída (a mesma do
 * menu). `window.location`, e não `<Link>`: o Next pré-carregaria a rota.
 */
export function SignOutButton() {
  const [saindo, setSaindo] = useState(false);

  function sair() {
    setSaindo(true);
    window.location.assign("/auth/encerrar?motivo=saiu");
  }

  return (
    <Button onClick={sair} disabled={saindo} className="w-full">
      <LogOut className="mr-2 size-4" />
      {saindo ? "Saindo…" : "Sair do sistema"}
    </Button>
  );
}
