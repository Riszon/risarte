import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { parseMarkdown, secoesDoManual } from "@/lib/markdown";
import { EMPRESARIAL_VERSION, EMPRESARIAL_MIGRATION } from "@/lib/version";
import { ManualReader } from "../../manual/manual-reader";

export const metadata: Metadata = {
  title: "Manual · Risarte Empresarial",
};

/**
 * O MANUAL DO RISARTE EMPRESARIAL, DENTRO DO MÓDULO.
 *
 * Pedido do dono (24/09/2026): *"crie um manual vivo, como o que já tem para
 * todo o sistema, exclusivo para o empresarial para ficar dentro do
 * empresarial. Para orientar e treinar os envolvidos no Empresarial."*
 *
 * ⚠️ POR QUE UM MANUAL SEPARADO, e não um capítulo do manual do riSZon. O
 * manual do sistema é lido por toda a operação clínica — recepção, dentista,
 * coordenador. O Empresarial é um programa comercial com vocabulário próprio
 * (titular, faixa, carência, split, termo de inclusão) e com um público
 * pequeno. Enfiar 20 seções disso no manual geral faria o texto que TODOS leem
 * crescer para atender POUCOS, e é assim que manual deixa de ser lido.
 *
 * ⚠️ E POR QUE ELE REUSA O LEITOR DO NÚCLEO (`../../manual/manual-reader`),
 * em vez de ter um próprio: duas telas iguais divergem na primeira correção
 * feita só de um lado. O leitor ganhou dois parâmetros opcionais (título e os
 * exemplos da busca) — mudança mínima e aditiva num arquivo do núcleo, como
 * manda a §0 do CLAUDE.md.
 *
 * A FONTE É A MESMA do Word (`npm run manual:empresarial`): um texto só para
 * os dois destinos, senão eles divergem e ninguém sabe qual está certo.
 */

const CAMINHO = path.join(
  process.cwd(),
  "docs",
  "treinamento",
  "manual-empresarial.md"
);

// Lido uma vez por processo: o arquivo não muda entre requisições (muda entre
// publicações), e relê-lo a cada abertura de tela seria desperdício puro.
let cache: string | null = null;

function lerManual(): string | null {
  if (cache !== null) return cache;
  try {
    cache = fs.readFileSync(CAMINHO, "utf8");
    return cache;
  } catch {
    // O arquivo é levado para o servidor pelo `outputFileTracingIncludes` do
    // next.config.ts. Se a configuração se perder, a tela DIZ isso em vez de
    // quebrar — página de erro no lugar do manual seria o pior momento
    // possível para o sistema ficar mudo.
    return null;
  }
}

export default async function ManualEmpresarialPage() {
  const session = await getSessionContext();
  // Quem entra no módulo lê o manual dele. Manual que só o gestor pode abrir
  // não treina a recepção, que é justamente quem liga para os titulares.
  if (!canViewEmpresarial(session)) redirect("/");

  const bruto = lerManual();

  if (!bruto) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Manual do Risarte Empresarial</h1>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          O texto do manual não foi encontrado nesta publicação. Avise pela tela{" "}
          <strong>Sistema → Problemas</strong>, informando a versão{" "}
          {EMPRESARIAL_VERSION} do Empresarial.
        </p>
      </div>
    );
  }

  const secoes = secoesDoManual(parseMarkdown(bruto));

  return (
    <ManualReader
      secoes={secoes}
      versao={EMPRESARIAL_VERSION}
      migracao={EMPRESARIAL_MIGRATION}
      titulo="Manual do Risarte Empresarial"
      exemplosDeBusca="carência, faixa, termo de inclusão, split"
    />
  );
}
