"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, PhoneCall, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBrDate } from "@/lib/dates";
import { formatCpf } from "@/lib/masks";
import {
  limparContato,
  registrarContato,
  RESULTADOS,
  RESULTADO_ROTULO,
  type Resultado,
} from "./actions";
import type { FamiliaParaContatar, PessoaParaContatar } from "./dados";

/**
 * ⚠️ A LINHA É A PESSOA, E O BOTÃO DE LIGAR ESTÁ NELA. Uma tela que listasse e
 * mandasse registrar o contato noutro lugar seria abandonada na segunda
 * ligação: quem está com o telefone na mão não troca de tela.
 */

function Situacao({ p }: { p: PessoaParaContatar }) {
  if (!p.liberacao.liberada) {
    return (
      <Badge variant="outline" className="border-gold/50 text-gold-tinta">
        Carência até {formatBrDate(p.liberacao.liberadoEm!)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">
      Pode agendar
    </Badge>
  );
}

function Pendencias({ p }: { p: PessoaParaContatar }) {
  const faltas: string[] = [];
  if (!p.cadastroCompleto) faltas.push("cadastro incompleto");
  if (!p.temFicha) faltas.push("sem ficha de paciente");
  if (!p.telefone) faltas.push("sem telefone");
  if (faltas.length === 0) return <span className="text-muted-foreground">—</span>;
  return <span className="text-gold-tinta">{faltas.join(" · ")}</span>;
}

export function ListaDeBoasVindas({
  companyId,
  familias,
  filtro,
}: {
  companyId: string;
  familias: FamiliaParaContatar[];
  filtro: string;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [alvo, setAlvo] = useState<PessoaParaContatar | null>(null);
  const [resultado, setResultado] = useState<Resultado>("CONTACTED");
  const [nota, setNota] = useState("");

  function registrar() {
    if (!alvo) return;
    startTransition(async () => {
      const r = await registrarContato(
        companyId,
        { employeeId: alvo.employeeId, dependentId: alvo.dependentId },
        resultado,
        nota
      );
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível registrar.");
        return;
      }
      toast.success("Contato registrado.");
      setAlvo(null);
      setNota("");
      setResultado("CONTACTED");
      router.refresh();
    });
  }

  function desfazer(p: PessoaParaContatar) {
    startTransition(async () => {
      const r = await limparContato(companyId, {
        employeeId: p.employeeId,
        dependentId: p.dependentId,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível desfazer.");
        return;
      }
      router.refresh();
    });
  }

  if (familias.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        {filtro === "a_contatar"
          ? "Ninguém esperando ligação nesta empresa."
          : "Nenhuma pessoa ativa nesta empresa."}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {familias.map((f) => (
          <div key={f.employeeId} className="overflow-hidden rounded-xl border">
            {f.pessoas.map((p, i) => (
              <div
                key={p.employeeId ?? p.dependentId}
                className={cn(
                  "grid gap-2 p-3 sm:grid-cols-[1.6fr_1fr_1fr_auto] sm:items-center",
                  i > 0 && "border-t",
                  // O dependente fica visualmente preso ao titular: é a mesma
                  // ligação, e separá-los faria chamar a casa duas vezes.
                  !p.titular && "bg-muted/30 pl-6"
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.papel} · {formatCpf(p.cpf)}
                    {p.unidade && ` · ${p.unidade}`}
                  </p>
                </div>

                <div className="text-sm">
                  {p.telefone ? (
                    <a
                      href={`tel:${p.telefone.replace(/\D/g, "")}`}
                      className="font-medium hover:underline"
                    >
                      {p.telefone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">sem telefone</span>
                  )}
                  <p className="text-xs">
                    <Pendencias p={p} />
                  </p>
                </div>

                <div className="text-xs">
                  <Situacao p={p} />
                  {p.contato && (
                    <p className="mt-1 text-muted-foreground">
                      {RESULTADO_ROTULO[p.contato.resultado]} em{" "}
                      {formatBrDate(p.contato.em)}
                      {p.contato.por && ` · ${p.contato.por}`}
                      {p.contato.nota && (
                        <>
                          <br />
                          <span className="italic">{p.contato.nota}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {/* `data-moldura` sai na impressão: no papel não há botão. */}
                <div data-moldura className="flex gap-1">
                  <Button
                    size="sm"
                    variant={p.contato ? "ghost" : "outline"}
                    onClick={() => setAlvo(p)}
                    disabled={pendente}
                  >
                    {p.contato ? (
                      <Check className="size-4" />
                    ) : (
                      <PhoneCall className="mr-1 size-4" />
                    )}
                    {p.contato ? "" : "Registrar"}
                  </Button>
                  {p.contato && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Desfazer o registro"
                      onClick={() => desfazer(p)}
                      disabled={pendente}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {alvo && (
        <Dialog open onOpenChange={() => setAlvo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Registrar contato — {alvo.nome}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {RESULTADOS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="resultado"
                    checked={resultado === r}
                    onChange={() => setResultado(r)}
                  />
                  {RESULTADO_ROTULO[r]}
                </label>
              ))}
            </div>
            {/* ⚠️ SÓ "NÃO ATENDEU" E "LIGAR DEPOIS" VOLTAM PARA A FILA, e a tela
                diz isso — senão quem registra escolhe no escuro e o filtro
                "a contatar" passa a esconder trabalho por fazer. */}
            <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              <strong>Não atendeu</strong> e <strong>ligar depois</strong>{" "}
              continuam na lista de quem falta ligar. Os outros dois saem.
            </p>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Observação (opcional)"
              maxLength={280}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAlvo(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={registrar} disabled={pendente}>
                Registrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
