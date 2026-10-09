import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  OPERACAO_ROTULO,
  camposDaAlteracao,
  destinoDoRegistro,
  nomeDoRegistro,
  quemFez,
  resumoDosCampos,
  rotuloDaArea,
  rotuloDaTabela,
  type Alteracao,
} from "@/lib/auditoria-alteracoes";
import { dataEHora, enderecoDaVisao, hora, type Pessoas } from "./comum";

/**
 * UMA alteração: a linha resumida ("quem · fez o quê · em qual registro") e,
 * ao abrir, o campo a campo com o antes e o depois. Sem JavaScript: é um
 * <details> do próprio navegador, então a lista inteira já vem pronta.
 */
export function LinhaDaAlteracao({
  a,
  pessoas,
  mostrarQuem = true,
  soHora = false,
}: {
  a: Alteracao;
  pessoas: Pessoas;
  mostrarQuem?: boolean;
  soHora?: boolean;
}) {
  const campos = camposDaAlteracao(a, pessoas.nomes);
  const destino = destinoDoRegistro(a);
  const resumo = resumoDosCampos(a);
  const unidade = a.clinic_id ? pessoas.nomes.unidades.get(a.clinic_id) : null;
  const codigo = a.user_id ? pessoas.codigoPorUsuario.get(a.user_id) : null;

  return (
    <details className="group border-b last:border-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="w-3 shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {soHora ? hora(a.occurred_at, true) : dataEHora(a.occurred_at)}
        </span>
        {mostrarQuem && (
          <span className="whitespace-nowrap">
            {codigo && (
              <span className="mr-1 font-mono text-xs text-gold-tinta">{codigo}</span>
            )}
            {quemFez(a, pessoas.nomes)}
          </span>
        )}
        <Badge variant={a.op === "D" ? "destructive" : a.op === "I" ? "default" : "secondary"}>
          {OPERACAO_ROTULO[a.op]}
        </Badge>
        <span className="font-medium">{rotuloDaTabela(a.schema_name, a.table_name)}</span>
        {a.schema_name !== "public" && (
          <span className="text-xs text-muted-foreground">
            ({rotuloDaArea(a.schema_name)})
          </span>
        )}
        <span className="min-w-0 break-words">{nomeDoRegistro(a, pessoas.nomes)}</span>
        {resumo && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            — {resumo}
          </span>
        )}
      </summary>

      <div className="space-y-2 px-2 pb-3 pt-1">
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {unidade && <span>Unidade: {unidade}</span>}
          <span title={`${a.schema_name}.${a.table_name} · ${a.row_id ?? ""}`}>
            Lançamento nº {a.id} da auditoria
          </span>
          {destino && (
            <Link href={destino} className="underline underline-offset-2">
              Abrir o prontuário do cliente
            </Link>
          )}
          {a.client_id && (
            <Link
              href={enderecoDaVisao("alteracoes", { cliente: a.client_id, periodo: "tudo" })}
              className="underline underline-offset-2"
            >
              Ver tudo o que mudou neste cliente
            </Link>
          )}
        </p>
        {campos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem campos para mostrar.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/50 text-left uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Campo</th>
                  {a.op !== "I" && (
                    <th className="px-2 py-1 font-medium">
                      {a.op === "D" ? "O que existia" : "Antes"}
                    </th>
                  )}
                  {a.op !== "D" && (
                    <th className="px-2 py-1 font-medium">
                      {a.op === "I" ? "Valor" : "Depois"}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {campos.map((c) => (
                  <tr key={c.campo} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap px-2 py-1 font-medium" title={c.campo}>
                      {c.rotulo}
                    </td>
                    {a.op !== "I" && (
                      <td className="max-w-md whitespace-pre-wrap break-words px-2 py-1 text-muted-foreground">
                        {c.antes}
                      </td>
                    )}
                    {a.op !== "D" && (
                      <td className="max-w-md whitespace-pre-wrap break-words px-2 py-1">
                        {c.depois}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
