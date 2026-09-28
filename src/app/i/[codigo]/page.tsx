import type { Metadata } from "next";
import { CascaPublica } from "@/components/indica/casca-publica";
import { convitePublico } from "@/lib/indica/publico";
import { FormularioConvite } from "./formulario";

export const metadata: Metadata = {
  title: "Convite",
  robots: { index: false, follow: false },
};

/**
 * /i/[código] — o link pessoal do Embaixador. Sem login. Sem preço e sem
 * promessa de gratuidade (ética odontológica): o convite é para conhecer.
 */
export default async function ConvitePage(props: PageProps<"/i/[codigo]">) {
  const { codigo } = await props.params;
  const convite = /^[a-z0-9]{4,12}$/i.test(codigo) ? await convitePublico(codigo) : null;

  return (
    <CascaPublica>
      {convite ? (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {convite.indicador} te convidou para conhecer a Risarte
            </h1>
            <p className="text-sm text-muted-foreground">
              Deixe seu contato e a unidade escolhida fala com você para marcar uma avaliação de
              boas-vindas, com calma, para entender o seu sorriso.
            </p>
          </div>
          <FormularioConvite codigo={convite.codigo} unidades={convite.unidades} termoVersao={convite.termo_versao} />
        </>
      ) : (
        <div className="rounded-xl border bg-background p-4 text-sm">
          <h1 className="text-lg font-semibold">Convite não encontrado</h1>
          <p className="mt-1 text-muted-foreground">
            Este link não está mais ativo. Peça um novo a quem te indicou.
          </p>
        </div>
      )}
    </CascaPublica>
  );
}
