"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/masks";
import { enviarPeloConvite } from "./actions";

export function FormularioConvite({
  codigo,
  unidades,
  termoVersao,
}: {
  codigo: string;
  unidades: { id: string; nome: string; cidade: string | null }[];
  termoVersao: string;
}) {
  const router = useRouter();
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, enviar] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErro(null);
    enviar(async () => {
      const r = await enviarPeloConvite(codigo, fd);
      if (r.ok) router.push(`/i/${codigo}/obrigado`);
      else setErro(r.erro ?? "Não foi possível enviar agora.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
      <div>
        <Label htmlFor="nome">Seu nome</Label>
        <Input id="nome" name="nome" autoComplete="name" required />
      </div>
      <div>
        <Label htmlFor="telefone">Seu WhatsApp</Label>
        <Input
          id="telefone"
          name="telefone"
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          onChange={(e) => setTelefone(formatPhone(e.target.value))}
          placeholder="(43) 99999-8888"
          required
        />
      </div>
      <div>
        <Label htmlFor="unidade">Unidade mais perto de você</Label>
        <select
          id="unidade"
          name="unidade_id"
          required
          defaultValue={unidades.length === 1 ? unidades[0].id : ""}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {unidades.length !== 1 && <option value="">Escolha</option>}
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
              {u.cidade ? ` — ${u.cidade}` : ""}
            </option>
          ))}
        </select>
      </div>
      {/* Campo-isca contra robôs: escondido de quem usa a tela. */}
      <input type="text" name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="aceite" className="mt-1" required />
        <span>
          Autorizo a Risarte Odontologia a entrar em contato comigo pelo WhatsApp para agendar uma
          avaliação (termo de contato, versão {termoVersao}).
        </span>
      </label>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Enviando…" : "Quero ser contatado(a)"}
      </Button>
    </form>
  );
}
