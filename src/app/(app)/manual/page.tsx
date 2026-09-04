import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, pode } from "@/lib/auth";
import { parseMarkdown, secoesDoManual } from "@/lib/markdown";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { ManualReader } from "./manual-reader";

export const metadata: Metadata = { title: "Manual de Treinamento" };

/**
 * O MANUAL DENTRO DO SISTEMA.
 *
 * Antes desta tela o manual só existia como arquivo: eu gerava o Word, o dono
 * mandava para a equipe, e a partir dali cada versão nova era mais um arquivo
 * circulando por mensagem. Sempre haveria alguém operando pelo manual de três
 * meses atrás — e, pior, sem meio de saber disso.
 *
 * Aqui ele é CÓDIGO: viaja no mesmo push que o resto (seção 0b do CLAUDE.md),
 * então a tela mostra sempre a versão que está no ar, nos dois ambientes. O
 * arquivo Word continua existindo para imprimir e para quem prefere ler fora.
 *
 * A FONTE É A MESMA do Word (`scripts/gerar-manual-docx.cjs` lê este arquivo):
 * um único texto para os dois destinos, senão eles divergem e ninguém sabe qual
 * está certo.
 */

const CAMINHO = path.join(
  process.cwd(),
  "docs",
  "treinamento",
  "manual-treinamento-riSZon.md"
);

// Lido uma vez por processo: o arquivo não muda entre requisições (muda entre
// publicações), e reler 48 KB a cada abertura de tela seria desperdício puro.
let cache: string | null = null;

function lerManual(): string | null {
  if (cache !== null) return cache;
  try {
    cache = fs.readFileSync(CAMINHO, "utf8");
    return cache;
  } catch {
    // O arquivo é levado para o servidor pelo `outputFileTracingIncludes` do
    // next.config.ts. Se algum dia a configuração se perder, a tela DIZ isso em
    // vez de quebrar — página de erro no lugar do manual seria o pior momento
    // possível para o sistema ficar mudo.
    return null;
  }
}

export default async function ManualPage() {
  const session = await getSessionContext();
  if (!pode(session, "menu.manual")) redirect("/");

  const bruto = lerManual();

  if (!bruto) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Manual de Treinamento</h1>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          O texto do manual não foi encontrado nesta publicação. O conteúdo
          continua disponível no arquivo Word que a Franqueadora distribui.
          Avise pela tela <strong>Sistema → Problemas</strong>, informando a
          versão {APP_VERSION}.
        </p>
      </div>
    );
  }

  const secoes = secoesDoManual(parseMarkdown(bruto));

  return (
    <ManualReader
      secoes={secoes}
      versao={APP_VERSION}
      migracao={LATEST_MIGRATION}
    />
  );
}
