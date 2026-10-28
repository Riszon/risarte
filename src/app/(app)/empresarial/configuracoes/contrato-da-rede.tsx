"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj, formatCpf } from "@/lib/masks";
import type { Contratada, ModeloDeContrato } from "@/lib/empresarial/contrato";
import { salvarContratoDaRede, salvarDadosDaContratada } from "./actions";
import { EditorDoContrato } from "./contrato-editor";

/**
 * O CONTRATO, na rede (1027): quem é a Risarte no documento e o texto que
 * toda empresa herda.
 *
 * ⚠️ MEXER AQUI MUDA O CONTRATO DE TODA EMPRESA que não personalizou o texto.
 * A tela inteira é do gestor do programa, e a RLS confirma.
 */
export function ContratoDaRede({
  contratada,
  modelo,
}: {
  contratada: Contratada | null;
  /** `null` = o banco ainda não tem o modelo (migração 1027 por rodar). */
  modelo: ModeloDeContrato | null;
}) {
  if (!modelo) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          O modelo de contrato ainda não existe neste banco. Ele nasce com a{" "}
          <strong className="text-foreground">migração 1027</strong>; depois de
          rodá-la, esta aba mostra o texto e os dados da Risarte.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <DadosDaContratada contratada={contratada} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contrato (modelo da rede)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            É deste texto que nasce o contrato de toda empresa. Os dados da
            empresa, os valores, o vencimento e as cidades vêm da proposta de
            cada uma; o Anexo I é montado com os benefícios dela. A empresa que
            precisar de uma cláusula diferente personaliza o texto na tela do
            contrato dela, e o modelo daqui continua valendo para as outras.
          </p>
          <EditorDoContrato
            key={JSON.stringify(modelo)}
            modelo={modelo}
            acao={salvarContratoDaRede}
            rotuloDoSalvar="Salvar o modelo da rede"
            mensagemDeSucesso="Modelo de contrato salvo."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function DadosDaContratada({ contratada }: { contratada: Contratada | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const faltaRepresentante =
    !contratada?.repName || !contratada?.repRg || !contratada?.repCpf;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarDadosDaContratada(formData);
      if (r.ok) {
        toast.success("Dados da Risarte salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card className={faltaRepresentante ? "border-amber-500/50" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">A Risarte no contrato</CardTitle>
      </CardHeader>
      <CardContent>
        {/* A chave refaz o formulário quando o que está salvo muda — mesma
            razão de `dados-do-contrato.tsx`. */}
        <form key={JSON.stringify(contratada)} onSubmit={onSubmit} className="space-y-3">
          {faltaRepresentante && (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              Falta o nome, o RG ou o CPF de quem assina pela Risarte. Enquanto
              faltar, todo contrato sai com essa linha em branco e a tela do
              contrato avisa.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ct-legal_name">Razão social</Label>
              <Input
                id="ct-legal_name"
                name="legal_name"
                defaultValue={contratada?.legalName ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="ct-cnpj">CNPJ</Label>
              <Input
                id="ct-cnpj"
                name="cnpj"
                defaultValue={contratada?.cnpj ?? ""}
                onChange={(e) => (e.target.value = formatCnpj(e.target.value))}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label htmlFor="ct-signing_city">Cidade da assinatura</Label>
              <Input
                id="ct-signing_city"
                name="signing_city"
                defaultValue={contratada?.signingCity ?? ""}
                placeholder="Cambé/PR"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ct-address">Endereço da sede</Label>
              <Input
                id="ct-address"
                name="address"
                defaultValue={contratada?.address ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="ct-rep_name">Quem assina pela Risarte</Label>
              <Input
                id="ct-rep_name"
                name="rep_name"
                defaultValue={contratada?.repName ?? ""}
                autoComplete="off"
              />
            </div>
            {/* 1037: só aparece quando a coluna existe — antes da migração,
                gravar o campo derrubaria o salvar inteiro. */}
            {contratada?.repGender !== undefined && (
              <div>
                <Label htmlFor="ct-rep_gender">Quem assina é</Label>
                <input type="hidden" name="rep_gender_na_tela" value="1" />
                <select
                  id="ct-rep_gender"
                  name="rep_gender"
                  defaultValue={contratada?.repGender ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">— escolha —</option>
                  <option value="M">Sr. (o texto diz “seu”, “portador”)</option>
                  <option value="F">Sra. (o texto diz “sua”, “portadora”)</option>
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="ct-rep_role">Cargo</Label>
              <Input
                id="ct-rep_role"
                name="rep_role"
                defaultValue={contratada?.repRole ?? ""}
                placeholder="sócio administrador"
              />
            </div>
            <div>
              <Label htmlFor="ct-rep_nationality">Nacionalidade</Label>
              <Input
                id="ct-rep_nationality"
                name="rep_nationality"
                defaultValue={contratada?.repNationality ?? ""}
                placeholder="brasileiro"
              />
            </div>
            <div>
              <Label htmlFor="ct-rep_rg">RG</Label>
              <Input
                id="ct-rep_rg"
                name="rep_rg"
                defaultValue={contratada?.repRg ?? ""}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="ct-rep_cpf">CPF</Label>
              <Input
                id="ct-rep_cpf"
                name="rep_cpf"
                defaultValue={contratada?.repCpf ?? ""}
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
                placeholder="000.000.000-00"
                autoComplete="off"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Estes dados ficam guardados só no banco de dados e são impressos em
            todo contrato. Só o gestor do programa altera.
          </p>
          <Button type="submit" size="sm" disabled={isPending}>
            Salvar os dados da Risarte
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
