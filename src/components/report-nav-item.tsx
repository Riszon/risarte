"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowRight, LifeBuoy, XIcon } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { FormularioDeRelato } from "@/app/(app)/problemas/formulario";

/** Quem já leu a resposta avisa por aqui, e o número cai na hora. */
export const RELATOS_VISTOS = "relatos-vistos";

/**
 * A BOIA, com o indicador de relatos esperando — e, desde a 0257, a porta do
 * relato: ela abre o formulário num painel POR CIMA da tela atual, que é onde
 * a captura de tela precisa estar.
 *
 * ⚠️ O NÚMERO NÃO É O MESMO PARA TODO MUNDO, e é essa a decisão central. Quem
 * responde é o Admin Master, então para ele o indicador é a FILA DELE (relatos
 * abertos e em análise) e zera respondendo. Para todo o resto, contar a fila
 * seria pendurar no ícone um número sobre o qual a pessoa não pode fazer nada —
 * e ícone com número que não é seu ensina a ignorar números. Para ela o
 * indicador conta as RESPOSTAS que ainda não leu, e zera ao abrir a tela.
 *
 * **A regra mora no banco** (`system_reports_pending`, 0252), não aqui. A tela
 * daria conta de montar as duas consultas; se montasse, a régua do que "está
 * pendente" passaria a existir em dois lugares, e o dia em que discordassem
 * seria o dia em que alguém precisa confiar no número.
 *
 * ⚠️ A CONSULTA PARTE DO NAVEGADOR, como a do sino — uma vez por minuto e a
 * cada navegação. Ela não entra no tempo de abrir tela nenhuma, que foi o custo
 * que o dia 08/09/2026 inteiro foi gasto reduzindo.
 *
 * Banco ainda sem a 0252: a função não existe, o `rpc` devolve erro e o número
 * fica em zero. Ícone sem indicador é a mesma coisa de antes desta entrega; um
 * erro na tela por causa de migração pendente não seria.
 */
export function ReportNavItem({
  temUnidade,
  isAdminMaster,
}: {
  /** Relato pertence a uma unidade: sem unidade ativa não há onde gravar. */
  temUnidade: boolean;
  isAdminMaster: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendentes, setPendentes] = useState(0);
  const [aberto, setAberto] = useState(false);
  // Durante a captura de tela o painel fica INVISÍVEL (não fechado): fechar
  // apagaria o que a pessoa já escreveu, e aberto ele sairia na foto.
  const [escondido, setEscondido] = useState(false);

  const consultar = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("system_reports_pending");
    return typeof data === "number" ? data : 0;
  }, []);

  useEffect(() => {
    let cancelado = false;

    const atualizar = async () => {
      const n = await consultar();
      if (!cancelado) setPendentes(n);
    };

    atualizar();
    const intervalo = setInterval(atualizar, 60_000);

    // Sem isto, quem acabou de ler a resposta continuaria vendo o número até a
    // próxima consulta — até um minuto olhando para um aviso já resolvido.
    window.addEventListener(RELATOS_VISTOS, atualizar);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      window.removeEventListener(RELATOS_VISTOS, atualizar);
    };
  }, [consultar, pathname]); // reconsulta ao navegar (ex.: depois de responder)

  // Na própria tela de Problemas o formulário já está na página: ali a boia
  // continua sendo o atalho para a lista.
  const naTelaDeProblemas =
    pathname === "/problemas" || pathname.startsWith("/problemas/");

  const icone = (
    <>
      <LifeBuoy className="size-[18px]" />
      <span className="sr-only">Relatar um problema</span>
      {pendentes > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-medium tabular-nums text-gold-foreground">
          {pendentes > 99 ? "99+" : pendentes}
        </span>
      )}
    </>
  );
  const classeDoIcone =
    "relative grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground";

  if (naTelaDeProblemas) {
    return (
      <Link href="/problemas" title="Problemas relatados" className={classeDoIcone}>
        {icone}
      </Link>
    );
  }

  const aviso = isAdminMaster
    ? pendentes === 0
      ? "Nenhum relato esperando por você."
      : `${pendentes === 1 ? "1 relato espera" : `${pendentes} relatos esperam`} por você.`
    : pendentes === 0
      ? "Acompanhe seus relatos e as respostas."
      : `Você tem ${pendentes === 1 ? "1 resposta nova" : `${pendentes} respostas novas`}.`;

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={setAberto}>
      <DialogPrimitive.Trigger title="Relatar um problema" className={classeDoIcone}>
        {icone}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/20 data-open:animate-in data-open:fade-in-0",
            escondido && "invisible"
          )}
        />
        {/*
          ⚠️ O PAINEL FICA AO LADO, NÃO NO MEIO: a tela do problema continua à
          vista enquanto a pessoa escreve — e é ela que a captura fotografa.
          `data-moldura`: não sai na impressão.
        */}
        <DialogPrimitive.Popup
          data-moldura
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-background shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-right-8",
            escondido && "invisible"
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">
                Relatar um problema
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                Nesta tela: <span className="font-mono">{pathname}</span>
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Fechar"
            >
              <XIcon className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <Link
            href="/problemas"
            onClick={() => setAberto(false)}
            className={cn(
              "flex items-center justify-between gap-2 border-b px-4 py-2.5 text-sm hover:bg-muted/60",
              pendentes > 0 && "bg-gold/10 font-medium"
            )}
          >
            <span>{aviso}</span>
            <span className="flex shrink-0 items-center gap-1 text-primary">
              Ver relatos
              <ArrowRight className="size-4" />
            </span>
          </Link>

          <div className="flex-1 overflow-y-auto p-4">
            {temUnidade ? (
              <FormularioDeRelato
                // Nova chave a cada tela: abrir o painel em outra tela começa
                // um relato novo, com a tela e a parte do sistema certas.
                key={pathname}
                telaSugerida={pathname}
                digestSugerido=""
                versaoAtual={APP_VERSION}
                silencioso
                esconder={() => setEscondido(true)}
                mostrar={() => setEscondido(false)}
                aoCancelar={() => setAberto(false)}
                aoRegistrar={(codigo) => {
                  setAberto(false);
                  window.dispatchEvent(new Event(RELATOS_VISTOS));
                  toast.success(`Registrado como ${codigo}.`, {
                    description: "A resposta chega pela boia, aqui em cima.",
                    action: {
                      label: "Abrir",
                      onClick: () => router.push(`/problemas/${codigo}`),
                    },
                  });
                }}
              />
            ) : (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                Escolha uma unidade no menu lateral para registrar — o relato
                pertence à unidade em que aconteceu.
              </p>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
