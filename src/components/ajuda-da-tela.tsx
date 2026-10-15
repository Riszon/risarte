"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { BookMarked, CircleHelp, XIcon } from "lucide-react";
import { ajudaDaTela, linkDoManual } from "@/lib/ajuda-das-telas";

/**
 * O BOTÃO ? DA BARRA DE CIMA — o passo a passo da tela em que a pessoa está
 * (relato OC-00102, decisão do dono: painel na própria tela).
 *
 * Abre ao lado, como o "Relatar um problema": a tela continua à vista
 * enquanto a pessoa lê o que fazer nela. O conteúdo mora em
 * `src/lib/ajuda-das-telas.ts`; tela sem ajuda escrita DIZ isso e oferece o
 * manual, em vez de mostrar um passo a passo genérico que não serve para ela.
 */

/** `**texto**` vira negrito — os nomes de botão, como aparecem na tela. */
function ComNegrito({ texto }: { texto: string }) {
  return (
    <>
      {texto.split("**").map((parte, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {parte}
          </strong>
        ) : (
          <Fragment key={i}>{parte}</Fragment>
        )
      )}
    </>
  );
}

export function AjudaDaTela({ podeVerManual }: { podeVerManual: boolean }) {
  const pathname = usePathname();
  const ajuda = ajudaDaTela(pathname);
  // Controlado: ir ao manual pelo link FECHA o painel — a barra de cima não
  // sai da tela ao navegar, e ele ficaria aberto por cima do manual.
  const [aberto, setAberto] = useState(false);
  const fechar = () => setAberto(false);

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={setAberto}>
      <DialogPrimitive.Trigger
        title="Ajuda desta tela — o passo a passo"
        className="grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <CircleHelp className="size-[18px]" />
        <span className="sr-only">Ajuda desta tela</span>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup
          data-moldura
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-right-8"
        >
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Ajuda desta tela
              </p>
              <DialogPrimitive.Title className="text-base font-semibold">
                {ajuda?.titulo ?? "Passo a passo"}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Fechar a ajuda"
            >
              <XIcon className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
            {ajuda ? (
              <>
                <DialogPrimitive.Description className="text-muted-foreground">
                  {ajuda.paraQue}
                </DialogPrimitive.Description>

                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Quem faz
                  </h3>
                  <p>{ajuda.quem}</p>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Passo a passo
                  </h3>
                  <ol className="space-y-2">
                    {ajuda.passos.map((p, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                          {i + 1}
                        </span>
                        <span className="text-muted-foreground">
                          <ComNegrito texto={p} />
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                {ajuda.atencao && ajuda.atencao.length > 0 && (
                  <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      Atenção
                    </h3>
                    <ul className="list-disc space-y-1 pl-4 text-amber-900 dark:text-amber-200">
                      {ajuda.atencao.map((a, i) => (
                        <li key={i}>
                          <ComNegrito texto={a} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {podeVerManual && (
                  <Link
                    href={linkDoManual(ajuda.manual)}
                    onClick={fechar}
                    className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2"
                  >
                    <BookMarked className="size-4" />
                    Ver no manual
                  </Link>
                )}
              </>
            ) : (
              <>
                <DialogPrimitive.Description className="text-muted-foreground">
                  Esta tela ainda não tem o passo a passo aqui. Ele está sendo
                  escrito tela a tela, começando por Compras.
                </DialogPrimitive.Description>
                {podeVerManual && (
                  <>
                    <p className="text-muted-foreground">
                      Enquanto isso, o manual explica cada parte do sistema — dá
                      para procurar pelo nome da tela.
                    </p>
                    <Link
                      href="/manual"
                      onClick={fechar}
                      className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2"
                    >
                      <BookMarked className="size-4" />
                      Abrir o manual
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
