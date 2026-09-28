import type { Metadata } from "next";
import { CascaPublica } from "@/components/indica/casca-publica";
import { verConvite } from "@/lib/indica/publico";
import { BotaoAceitar } from "./botao-aceitar";

export const metadata: Metadata = {
  title: "Convite",
  robots: { index: false, follow: false },
};

/**
 * /c/[token] — o indicado aceita (ou não) que a Risarte entre em contato.
 * Sem aceite no prazo (7 dias), a indicação é encerrada e os dados dele são
 * anonimizados pela rotina diária.
 */
export default async function AceiteConvitePage(props: PageProps<"/c/[token]">) {
  const { token } = await props.params;
  const convite = /^[0-9a-f]{64}$/.test(token) ? await verConvite(token) : null;

  return (
    <CascaPublica>
      {convite ? (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Oi, {convite.indicado}! {convite.indicador} indicou você
            </h1>
            <p className="text-sm text-muted-foreground">
              A Risarte Odontologia ({convite.unidade}) gostaria de falar com você para marcar uma
              avaliação. Só entramos em contato com a sua autorização.
            </p>
          </div>
          <BotaoAceitar token={token} termoVersao={convite.termo_versao} />
          <p className="text-center text-xs text-muted-foreground">
            Se não quiser, é só ignorar: seus dados são apagados em poucos dias.
          </p>
        </>
      ) : (
        <div className="rounded-xl border bg-background p-4 text-sm">
          <h1 className="text-lg font-semibold">Convite não encontrado</h1>
          <p className="mt-1 text-muted-foreground">
            Este convite já foi respondido ou venceu. Se ainda quiser conhecer a Risarte, peça um novo a
            quem te indicou.
          </p>
        </div>
      )}
    </CascaPublica>
  );
}
