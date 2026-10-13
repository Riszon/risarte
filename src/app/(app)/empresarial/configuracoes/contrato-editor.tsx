"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CAMPOS_DO_CONTRATO,
  type BlocoDoContrato,
  type GrupoDeCampo,
  type ModeloDeContrato,
} from "@/lib/empresarial/contrato";

/**
 * O EDITOR DO TEXTO DO CONTRATO (1027) — um só, usado em dois lugares: no
 * modelo da REDE (Configurações) e no texto personalizado de UMA empresa.
 *
 * ⚠️ UM EDITOR, E NÃO DOIS. As duas telas editam a mesma coisa em níveis
 * diferentes da cascata; com dois formulários, o da empresa deixaria de saber
 * de um campo no dia em que o da rede ganhasse um — e salvar a empresa
 * apagaria esse campo.
 *
 * Quem recebe a action é o servidor (`acao` é uma server action, que pode
 * atravessar a fronteira; função comum não pode).
 */

const GRUPOS: GrupoDeCampo[] = ["Empresa", "Risarte", "Valores", "Condições"];

export function EditorDoContrato({
  modelo,
  acao,
  rotuloDoSalvar,
  mensagemDeSucesso,
}: {
  modelo: ModeloDeContrato;
  acao: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  rotuloDoSalvar: string;
  mensagemDeSucesso: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Cada bloco carrega uma chave própria: apagar o do meio por ÍNDICE faria o
  // React reaproveitar os campos de baixo, e o texto apareceria uma cláusula
  // acima de onde foi digitado.
  const [lista, setLista] = useState(() =>
    modelo.blocos.map((b, i) => ({ ...b, chave: `b${i}` }))
  );
  const [proxima, setProxima] = useState(modelo.blocos.length);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await acao(formData);
      if (r.ok) {
        toast.success(mensagemDeSucesso);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <details className="rounded-md border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Campos que o sistema preenche sozinho
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Escreva o campo entre chaves duplas, como aparece abaixo, no ponto do
          texto em que o valor deve entrar. Para negrito, use dois asteriscos
          de cada lado: <code>**assim**</code>. Campo escrito errado é
          recusado ao salvar — ele sairia impresso com as chaves.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {GRUPOS.map((g) => (
            <div key={g}>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {g}
              </p>
              <ul className="space-y-0.5 text-xs">
                {CAMPOS_DO_CONTRATO.filter((c) => c.grupo === g).map((c) => (
                  <li key={c.chave}>
                    <code className="select-all">{`{{${c.chave}}}`}</code>{" "}
                    <span className="text-muted-foreground">— {c.rotulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      <div>
        <Label htmlFor="contrato-title">Título do contrato</Label>
        <Input id="contrato-title" name="title" defaultValue={modelo.titulo} required />
      </div>

      <div>
        <Label htmlFor="contrato-preamble">Qualificação das partes</Label>
        <textarea
          id="contrato-preamble"
          name="preamble"
          defaultValue={modelo.preambulo}
          rows={8}
          required
          className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
        />
      </div>

      <div>
        <p className="text-sm font-medium">Cláusulas</p>
        <p className="text-xs text-muted-foreground">
          Uma linha por parágrafo. A linha que começa com
          &quot;Parágrafo primeiro:&quot; (ou &quot;Parágrafo único:&quot;) já
          sai com esse início em negrito.
        </p>
      </div>

      <div className="space-y-2">
        {lista.map((b, i) => (
          <div key={b.chave} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                name={`titulo_${i}`}
                defaultValue={b.titulo}
                placeholder="CLÁUSULA …"
                aria-label={`Título da cláusula ${i + 1}`}
                className="h-8 flex-1 text-sm font-medium"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label={`Apagar a cláusula ${i + 1}`}
                onClick={() =>
                  setLista((atual) => atual.filter((x) => x.chave !== b.chave))
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <textarea
              name={`corpo_${i}`}
              defaultValue={b.corpo}
              rows={Math.min(14, Math.max(3, Math.ceil(b.corpo.length / 160)))}
              aria-label={`Texto da cláusula ${i + 1}`}
              className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => {
          setLista((atual) => [
            ...atual,
            { titulo: "", corpo: "", chave: `n${proxima}` } satisfies BlocoDoContrato & {
              chave: string;
            },
          ]);
          setProxima((n) => n + 1);
        }}
      >
        <Plus className="mr-1 size-3.5" />
        Nova cláusula
      </Button>

      <div>
        <Label htmlFor="contrato-closing">Fecho (antes da data e das assinaturas)</Label>
        <textarea
          id="contrato-closing"
          name="closing"
          defaultValue={modelo.fecho}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          A cidade, a data e os quadros de assinatura são impressos pelo
          sistema, depois deste texto.
        </p>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {rotuloDoSalvar}
      </Button>
    </form>
  );
}
