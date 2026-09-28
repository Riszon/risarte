import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { origemDoSite } from "@/lib/indica/publico";
import { whatsappLink } from "@/lib/whatsapp";
import { formatBrDateTime } from "@/lib/dates";
import { FilterForm } from "@/components/filter-form";
import { BotoesMensagem } from "./botoes";

export const metadata: Metadata = { title: "Mensagens — Indica +Risos" };

type Mensagem = {
  id: number;
  unidade_id: string;
  evento: string;
  destinatario: "embaixador" | "indicado";
  embaixador_id: string | null;
  indicacao_id: string | null;
  nome: string;
  telefone: string;
  texto: string;
  link_caminho: string | null;
  status: string;
  criado_em: string;
  enviada_em: string | null;
};

const EVENTO: Record<string, string> = {
  convite: "Convite ao indicado (aceite LGPD)",
  registrada: "Obrigado por indicar",
  compareceu: "Indicado compareceu",
  fechou: "Indicado fechou",
  convertida: "Pontos liberados",
  a_vencer: "Pontos a vencer",
};

/**
 * A FILA DE MENSAGENS (decisão do dono: WhatsApp manual por ora). O sistema
 * monta o texto de cada evento; aqui a recepção abre o WhatsApp com o texto
 * pronto, envia e marca. Um provedor automático, depois, lê esta mesma fila.
 */
export default async function MensagensPage(props: PageProps<"/indica-mais-risos/mensagens">) {
  const session = await getSessionContext();
  const sp = await props.searchParams;
  const filtro = typeof sp.situacao === "string" ? sp.situacao : "a_enviar";
  const ativa = session.activeClinic;
  const naRede = !ativa || ativa.type === "franchisor";

  const db = await indicaDb();
  let consulta = db
    .from("mensagens")
    .select("id, unidade_id, evento, destinatario, embaixador_id, indicacao_id, nome, telefone, texto, link_caminho, status, criado_em, enviada_em")
    .order("criado_em", { ascending: filtro === "a_enviar" })
    .limit(200);
  if (!naRede && ativa) consulta = consulta.eq("unidade_id", ativa.id);
  if (filtro !== "todas") consulta = consulta.eq("status", filtro);
  const { data, error } = await consulta.returns<Mensagem[]>();
  const origem = await origemDoSite();

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mensagens</h1>
        <p className="text-sm text-muted-foreground">
          {naRede ? "Visão da rede" : ativa?.name} · abra o WhatsApp com o texto pronto, envie e marque como
          enviada. Mensagem ao Embaixador nunca traz dado clínico nem valor do tratamento do indicado.
        </p>
      </div>
      <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <select name="situacao" defaultValue={filtro} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="a_enviar">A enviar</option>
          <option value="enviada">Enviadas</option>
          <option value="descartada">Descartadas</option>
          <option value="todas">Todas</option>
        </select>
      </FilterForm>
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mensagemDoBanco(error)}
        </p>
      ) : (data ?? []).length === 0 ? (
        <p className="rounded-xl border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {filtro === "a_enviar" ? "Nada para enviar agora." : "Nenhuma mensagem com este filtro."}
        </p>
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((m) => {
            const texto = m.texto.replace("{link}", m.link_caminho ? `${origem}${m.link_caminho}` : "");
            return (
              <li key={m.id} className="rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {EVENTO[m.evento] ?? m.evento} · para {m.nome}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({m.destinatario === "indicado" ? "indicado" : "Embaixador"}) {m.telefone}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBrDateTime(m.criado_em)}
                      {m.enviada_em ? ` · enviada em ${formatBrDateTime(m.enviada_em)}` : ""}
                      {m.indicacao_id && (
                        <>
                          {" · "}
                          <Link href={`/indica-mais-risos/indicacoes/${m.indicacao_id}`} className="hover:underline">
                            ver indicação
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <BotoesMensagem id={m.id} link={whatsappLink(m.telefone, texto)} status={m.status} />
                </div>
                <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">{texto}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
