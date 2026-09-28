"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/masks";
import { indicarPeloPortal, resgatarPeloPortal } from "./actions";

/** "Enviar pelo WhatsApp" — o Embaixador escolhe o contato no próprio WhatsApp. */
export function CompartilharLink({ link, primeiroNome }: { link: string; primeiroNome: string }) {
  const texto = `Oi! Quero te indicar a Risarte Odontologia. Se quiser conhecer, é por aqui (convite meu, ${primeiroNome}): ${link}`;
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        nativeButton={false}
        render={<a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer" />}
      >
        <Send className="mr-1 size-4" /> Enviar meu convite pelo WhatsApp
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copiado."))}
      >
        <Copy className="mr-1 size-4" /> Copiar meu link
      </Button>
    </div>
  );
}

/** Cadastrar o amigo; ele recebe um convite para aceitar o contato. */
export function IndicarAmigo({ token }: { token: string }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, enviar] = useTransition();
  const router = useRouter();

  if (mensagem) {
    const numero = telefone.replace(/\D/g, "");
    return (
      <div className="space-y-2 rounded-lg border bg-emerald-500/10 p-3 text-sm">
        <p className="font-medium">Indicação registrada! Agora mande o convite para o seu amigo aceitar o contato:</p>
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <a
              href={`https://wa.me/55${numero}?text=${encodeURIComponent(mensagem)}`}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <Send className="mr-1 size-4" /> Mandar o convite
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => { setMensagem(null); setNome(""); setTelefone(""); router.refresh(); }}>
          Indicar outra pessoa
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="amigo-nome">Nome do amigo</Label>
        <Input id="amigo-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="amigo-tel">WhatsApp do amigo</Label>
        <Input
          id="amigo-tel"
          inputMode="tel"
          value={telefone}
          onChange={(e) => setTelefone(formatPhone(e.target.value))}
          placeholder="(43) 99999-8888"
        />
      </div>
      <Button
        className="w-full"
        variant="outline"
        disabled={enviando}
        onClick={() =>
          enviar(async () => {
            const r = await indicarPeloPortal(token, nome, telefone);
            if (r.ok) setMensagem(r.mensagem ?? "");
            else toast.error(r.erro ?? "Não foi possível enviar.");
          })
        }
      >
        {enviando ? "Enviando…" : "Indicar"}
      </Button>
    </div>
  );
}

export function BotaoResgatar({ token, itemId, custo, pode }: { token: string; itemId: string; custo: number; pode: boolean }) {
  const [enviando, enviar] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      disabled={!pode || enviando}
      onClick={() =>
        enviar(async () => {
          const r = await resgatarPeloPortal(token, itemId);
          if (r.ok) {
            toast.success(
              r.status === "solicitado"
                ? `Pedido ${r.codigo} feito! A unidade vai aprovar e avisar você.`
                : `Pedido ${r.codigo} feito! Retire na sua unidade.`
            );
            router.refresh();
          } else toast.error(r.erro ?? "Não foi possível pedir.");
        })
      }
    >
      {enviando ? "Pedindo…" : `Trocar por ${custo}`}
    </Button>
  );
}
