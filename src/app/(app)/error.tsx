"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";

/**
 * A TELA DE ERRO — o que a equipe vê quando algo quebra de verdade.
 *
 * Até aqui o sistema não tinha nenhuma: uma exceção não tratada mostrava a tela
 * crua do Next.js, em inglês, sem dizer o que fazer e **sem deixar registro
 * nenhum**. Para quem está no balcão com paciente na frente, aquilo é o sistema
 * inteiro sumindo — e o único caminho que sobrava era mandar mensagem para o
 * dono, se a pessoa lembrasse dos detalhes.
 *
 * Três coisas mudam aqui:
 *
 * 1. **Diz o que aconteceu em português**, e diz que não foi culpa de quem está
 *    olhando — porque a primeira reação é achar que apagou alguma coisa.
 * 2. **Mostra o código do erro** (`digest`). É o que liga esta tela ao registro
 *    do servidor; sem ele, investigar depois é adivinhação.
 * 3. **Leva o código junto para o relato.** Um clique abre o formulário de
 *    /sistema já com a tela e o código preenchidos: o erro que evaporava vira
 *    registro com rastro técnico.
 *
 * ⚠️ NÃO grava sozinha. Um erro em laço geraria centenas de linhas iguais e
 * afogaria os relatos de gente, que são os que têm contexto. Captura automática
 * entra depois, com limite de repetição.
 */
export default function ErroDaTela({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const caminho = usePathname();

  useEffect(() => {
    // Vai para o registro do servidor (Vercel). Nunca para a tela: a mensagem
    // técnica pode citar id de paciente, e a regra da LGPD vale aqui também.
    console.error("Falha na tela:", caminho, error);
  }, [error, caminho]);

  const paraRelato = new URLSearchParams({
    aba: "problemas",
    relatar: "1",
    tela: caminho,
    ...(error.digest ? { digest: error.digest } : {}),
  });

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-l-4 border-l-red-500 p-6">
        <div className="flex items-start gap-3">
          <AlertOctagon className="mt-0.5 size-6 shrink-0 text-red-500" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Esta tela não conseguiu abrir</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Foi uma falha do sistema, não algo que você fez — e{" "}
              <strong className="font-medium text-foreground">
                nada do que você já tinha salvo se perdeu
              </strong>
              . Tente abrir de novo; se acontecer outra vez, registre o problema
              para a gente conseguir olhar.
            </p>

            <dl className="mt-4 space-y-1 rounded-md bg-muted/50 p-3 text-xs">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Tela:</dt>
                <dd className="font-mono">{caminho}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Versão:</dt>
                <dd className="font-mono">{APP_VERSION}</dd>
              </div>
              {error.digest && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Código do erro:</dt>
                  <dd className="font-mono">{error.digest}</dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => unstable_retry()}>Tentar de novo</Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/sistema?${paraRelato.toString()}`} />}
              >
                Registrar este problema
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
                Voltar ao Início
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
