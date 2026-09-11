import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HandHeart } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Card, CardContent } from "@/components/ui/card";
import { formatCnpj } from "@/lib/masks";
import { formatBrDate, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { carregarBoasVindas, precisaDeContato } from "./dados";
import { ListaDeBoasVindas } from "./lista";

export const metadata: Metadata = {
  title: "Boas-vindas · Risarte Empresarial",
};

/**
 * A LISTA DE BOAS-VINDAS DE UMA EMPRESA (pedido do dono, 11/09/2026).
 *
 * Quem entrou no programa precisa de uma ligação: dar as boas-vindas, completar
 * o cadastro e marcar a primeira consulta. Esta tela é a fila dessa ligação —
 * uma linha por pessoa, agrupada por família, com o telefone, o que falta no
 * cadastro e **a partir de quando aquela pessoa pode agendar**.
 *
 * ⚠️ A CARÊNCIA ESTAVA NO PEDIDO POR UM MOTIVO PRÁTICO: sem ela, a recepção
 * marca consulta para quem ainda não pode usar o benefício, e a negativa
 * acontece na cadeira, na frente do paciente. Ver `carencia.ts` para por que a
 * data mostra as carências gerais e os procedimentos com carência própria ficam
 * numa lista à parte.
 */

type Filtro = "a_contatar" | "todos";

export default async function BoasVindasPage(props: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  // A recepção e a SDR entram aqui — são elas que ligam. O gate é o mesmo do
  // relatório da empresa: dados de contato, não dados clínicos.
  if (!canViewEmpresarial(session)) redirect("/");

  const { companyId } = await props.params;
  const params = await props.searchParams;
  const bruto = params.filtro;
  const filtro: Filtro =
    (Array.isArray(bruto) ? bruto[0] : bruto) === "todos" ? "todos" : "a_contatar";

  // ⚠️ O "HOJE" VEM DO RELÓGIO BRASILEIRO, não do servidor. A carência é data de
  // negócio: na Vercel (UTC), das 21h à meia-noite o dia já virou, e alguém
  // apareceria liberado um dia antes.
  const hoje = new Date(`${todayInBrazil()}T12:00:00-03:00`);
  const lista = await carregarBoasVindas(companyId, hoje);
  if (!lista) notFound();

  // LGPD: a lista mostra nome, CPF e telefone de colaboradores e dependentes.
  await logAudit({
    action: "view",
    entityType: "empresarial_welcome_list",
    entityId: companyId,
    details: { pessoas: lista.familias.reduce((s, f) => s + f.pessoas.length, 0) },
  });

  const todasAsPessoas = lista.familias.flatMap((f) => f.pessoas);
  const aContatar = todasAsPessoas.filter(precisaDeContato);
  const emCarencia = todasAsPessoas.filter((p) => !p.liberacao.liberada);
  const semCadastro = todasAsPessoas.filter((p) => !p.cadastroCompleto);

  // ⚠️ O FILTRO ESCONDE A FAMÍLIA INTEIRA SÓ QUANDO NINGUÉM NELA PRECISA DE
  // LIGAÇÃO. Filtrar pessoa a pessoa quebraria o agrupamento e mostraria um
  // dependente solto, sem o titular ao lado — e quem liga perderia o contexto
  // da casa para quem está ligando.
  const familias =
    filtro === "todos"
      ? lista.familias
      : lista.familias.filter((f) => f.pessoas.some(precisaDeContato));

  const abas: { chave: Filtro; rotulo: string; n: number }[] = [
    { chave: "a_contatar", rotulo: "Falta ligar", n: aContatar.length },
    { chave: "todos", rotulo: "Todas as pessoas", n: todasAsPessoas.length },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={HandHeart}
        titulo={`Boas-vindas — ${lista.empresa.nome}`}
        descricao={`CNPJ ${formatCnpj(lista.empresa.cnpj)} · para ligar, completar cadastro e agendar a primeira consulta.`}
        voltar={{ href: `/empresarial/${companyId}`, rotulo: "Empresa" }}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { r: "Pessoas no programa", v: todasAsPessoas.length },
          { r: "Falta ligar", v: aContatar.length, destaque: aContatar.length > 0 },
          { r: "Cadastro incompleto", v: semCadastro.length },
          { r: "Ainda em carência", v: emCarencia.length },
        ].map((k) => (
          <Card key={k.r} className={k.destaque ? "border-gold/40" : undefined}>
            <CardContent className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {k.r}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{k.v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ------------------------------------------------------ as carências */}
      <div className="rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed">
        <p className="font-semibold">Carências desta empresa</p>
        <ul className="mt-1.5 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Da empresa:</strong>{" "}
            {lista.empresa.diasDaEmpresa > 0 ? (
              lista.empresa.contratoIniciadoEm ? (
                <>
                  {lista.empresa.diasDaEmpresa} dia(s) a partir do início do
                  contrato ({formatBrDate(lista.empresa.contratoIniciadoEm)}).
                </>
              ) : (
                <>
                  {lista.empresa.diasDaEmpresa} dia(s) — mas o{" "}
                  <strong className="text-foreground">
                    contrato ainda não tem data de início
                  </strong>
                  , então ela não está sendo contada.
                </>
              )
            ) : (
              "não há."
            )}
          </li>
          <li>
            <strong className="text-foreground">Do colaborador:</strong>{" "}
            {lista.empresa.diasDoColaboradorPadrao > 0
              ? `${lista.empresa.diasDoColaboradorPadrao} dia(s) a partir da entrada de cada pessoa. Alguns colaboradores podem ter prazo próprio.`
              : "não há."}
          </li>
        </ul>

        {lista.procedimentosComCarencia.length > 0 && (
          <>
            <p className="mt-3 border-t pt-2 font-semibold">
              Procedimentos com carência própria
            </p>
            {/* ⚠️ ESTES NÃO ENTRAM NA DATA DE CADA PESSOA, e a tela explica por
                quê: a carência é diferente por procedimento, e uma data única
                estaria errada para quase todos os casos. */}
            <p className="text-xs text-muted-foreground">
              Contados a partir da entrada da pessoa. A data de cada linha acima
              é a carência <strong>geral</strong>; estes procedimentos, mesmo
              depois dela, ainda esperam o próprio prazo.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {lista.procedimentosComCarencia.map((p) => (
                <li key={p.nome}>
                  {p.nome} —{" "}
                  <strong className="text-foreground">{p.meses} mês(es)</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div data-moldura className="flex flex-wrap gap-1">
        {abas.map((a) => (
          <Link
            key={a.chave}
            href={`/empresarial/${companyId}/boas-vindas?filtro=${a.chave}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition",
              filtro === a.chave
                ? "border-primary/40 bg-primary/5 font-semibold"
                : "hover:border-primary/40"
            )}
          >
            {a.rotulo}
            <span className="ml-1.5 text-xs text-muted-foreground">{a.n}</span>
          </Link>
        ))}
      </div>

      <ListaDeBoasVindas
        companyId={companyId}
        familias={familias}
        filtro={filtro}
      />

      <p className="text-xs text-muted-foreground">
        A lista traz só quem está <strong>ativo</strong> no programa. Quem saiu
        não recebe boas-vindas — e oferecer a alguém um benefício que ele não tem
        mais é pior que não ligar.
      </p>
    </div>
  );
}
