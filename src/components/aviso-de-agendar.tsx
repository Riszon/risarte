"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ADIAMENTO_MS, clienteDoAviso } from "@/lib/avisos-de-agendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Item = { id: string; title: string; body: string | null; link: string | null };

// O adiamento sobrevive a um F5 na mesma aba — senão "volta em 15 minutos"
// viraria "volta ao recarregar". É conveniência de quem está usando, então
// fica no navegador; falhar ao ler/gravar só faz o aviso voltar antes.
const CHAVE = "risarte-avisos-adiados";
function lerAdiados(): Map<string, number> {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    const obj = bruto ? (JSON.parse(bruto) as Record<string, number>) : {};
    const agora = Date.now();
    return new Map(Object.entries(obj).filter(([, ate]) => ate > agora));
  } catch {
    return new Map();
  }
}
function gravarAdiados(m: Map<string, number>) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // sem armazenamento: o aviso só volta mais cedo.
  }
}

/**
 * O AVISO QUE COBRA UM AGENDAMENTO (OC-00080, 27/09/2026).
 *
 * Relato da recepção: o pop-up tinha ABRIR AGENDA, JÁ AGENDEI e MARCAR TODOS
 * COMO AGENDADOS — e os dois últimos só marcavam o aviso como lido, sem
 * ninguém conferir a agenda. Até "Abrir agenda" apagava o aviso no clique,
 * antes de agendar. O lembrete podia ser calado sem agendar ninguém.
 *
 * Decisão do dono:
 *   * o aviso SÓ SAI quando o agendamento existe — quem apaga é o banco, ao
 *     criar o agendamento, por qualquer caminho (gatilho da 0283). Esta tela
 *     não marca nada como lido;
 *   * sobra UM botão por cliente, "Abrir agenda";
 *   * "Fechar" (e o X) ADIA 15 minutos — o aviso volta até o agendamento
 *     existir. Aviso NOVO que chegar nesse meio-tempo abre na hora.
 *
 * ⚠️ O botão "Fechar" tem de continuar se chamando "Fechar": a suíte E2E fecha
 * os avisos insistentes por ele (`e2e/apoio.ts`).
 */
export function AvisoDeAgendar({
  padraoDoTitulo,
  titulo,
  icone,
  corDoTitulo,
  descricao,
  quandoSai,
  nomeDoCliente,
}: {
  /** `ilike` do título dos avisos desta família. */
  padraoDoTitulo: string;
  titulo: string;
  icone: ReactNode;
  corDoTitulo: string;
  descricao: (quantos: number) => string;
  /** A frase de quando o aviso sai — ex.: "quando o início for agendado". */
  quandoSai: string;
  nomeDoCliente: (item: Item) => string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  // aviso → até quando está adiado (instante em ms).
  const adiadoAte = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    for (const [id, ate] of lerAdiados()) adiadoAte.current.set(id, ate);
    const supabase = createClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, link")
        .is("read_at", null)
        .ilike("title", padraoDoTitulo)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const list = (data ?? []) as Item[];
      setItems(list);
      if (list.length === 0) {
        setOpen(false);
        return;
      }
      const agora = Date.now();
      if (list.some((i) => (adiadoAte.current.get(i.id) ?? 0) <= agora)) setOpen(true);
    }

    poll();
    const id = setInterval(poll, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [padraoDoTitulo]);

  function adiar() {
    const ate = Date.now() + ADIAMENTO_MS;
    for (const i of items) adiadoAte.current.set(i.id, ate);
    gravarAdiados(adiadoAte.current);
    setOpen(false);
  }

  if (items.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) adiar();
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${corDoTitulo}`}>
            {icone}
            {titulo}
          </DialogTitle>
          <DialogDescription>{descricao(items.length)}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 max-h-[52vh] space-y-2 overflow-y-auto px-1">
          {items.map((i) => {
            const cliente = clienteDoAviso(i.link);
            return (
              <li key={i.id} className="rounded-md border p-2 text-sm">
                <p className="font-medium">{nomeDoCliente(i)}</p>
                {cliente && (
                  <div className="mt-1.5">
                    {/* Abrir NÃO resolve: só adia, para a agenda ficar à vista.
                        Quem tira o aviso é o agendamento criado. */}
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      nativeButton={false}
                      render={
                        <Link href={`/agenda?cliente=${cliente}`} onClick={adiar} />
                      }
                    >
                      Abrir agenda
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Este aviso sai sozinho {quandoSai}. Fechar só adia — ele volta em 15
          minutos.
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={adiar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
