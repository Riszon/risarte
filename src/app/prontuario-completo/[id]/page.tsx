import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { CLINICAL_BUCKET, evaluationLabel, type EvaluationKind } from "@/lib/clinical";
import { BRAZIL_TIME_ZONE, formatIsoDateBr } from "@/lib/dates";
import { carregarOdontograma } from "@/lib/odontograma/carregar";
import { descricaoDoAchado, marcasAtuais, marcasDoDesenho } from "@/lib/odontograma/diagnostico";
import { achadosTratados, localDaSessao } from "@/lib/odontograma/execucao";
import { agruparAdendos } from "@/lib/prontuario/evolucao";
import {
  MOTIVOS_DO_PRONTUARIO,
  VALIDADE_DO_PRONTUARIO_HORAS,
  prontuarioVencido,
  type MotivoDoProntuario,
} from "@/lib/prontuario/linha-do-tempo";
import { Odontograma } from "@/components/odontograma/odontograma";
import { PrintButton } from "@/app/renegociacoes/[id]/acordo/print-button";

export const metadata: Metadata = { title: "Prontuário completo" };

/** O link vale por 24 horas: depois, gera-se de novo (e fica registrado de novo). */
const VALIDADE_HORAS = VALIDADE_DO_PRONTUARIO_HORAS;

const quando = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: BRAZIL_TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const ROTULO_DO_DOCUMENTO: Record<string, string> = {
  prescription: "Receita",
  certificate: "Atestado",
  declaration: "Declaração",
  guidance: "Orientação",
};
const ROTULO_DA_MIDIA: Record<string, string> = {
  photo: "Foto",
  radiograph: "Radiografia",
  scan: "Escaneamento",
  exam: "Exame",
  document: "Documento",
  audio: "Áudio",
  video: "Vídeo",
};
const ROTULO_DO_PLANO: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado para aprovação",
  approved: "Aprovado",
  rejected: "Reprovado",
  returned: "Devolvido",
};

/** A resposta da anamnese, legível (o valor é jsonb). */
function resposta(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.map(resposta).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-black pb-0.5 text-base font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

/**
 * OD6 (J3/J4) — O PRONTUÁRIO COMPLETO do paciente, para imprimir / salvar em PDF:
 * o que a LGPD pede quando o paciente solicita os dados dele. Só abre pelo
 * REGISTRO da geração (Admin Master ou Gerente da unidade, com motivo — 0315),
 * e cada abertura fica na auditoria. Fotos e radiografias entram impressas
 * (J4); áudio, vídeo e outros arquivos ficam na lista.
 */
export default async function ProntuarioCompletoPage(props: { params: Promise<{ id: string }> }) {
  await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: ex } = await supabase
    .from("clinical_record_exports")
    .select("id, client_id, created_at, requested_by, reason_code, reason_note")
    .eq("id", id)
    .maybeSingle();
  if (!ex) notFound();

  if (prontuarioVencido(ex.created_at as string)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12 text-sm">
        <p className="font-semibold">Este link do prontuário completo venceu.</p>
        <p className="mt-1 text-muted-foreground">
          Ele vale por {VALIDADE_HORAS} horas. Gere de novo pela ficha do paciente (aba Linha do tempo)
          — a nova geração fica registrada.
        </p>
      </div>
    );
  }

  const clientId = ex.client_id as string;
  await logAudit({
    action: "export",
    entityType: "clinical_record_export",
    entityId: id,
    details: { client_id: clientId, aberto: true },
  });

  const [
    { data: cli },
    { data: consents },
    { data: fills },
    { data: rodadas },
    { data: notas },
    { data: midias },
    { data: planos },
    { data: evolucoes },
    { data: saidas },
    { data: docs },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("full_name, code, cpf, birth_date, clinic:clinics!clients_clinic_id_fkey ( name )")
      .eq("id", clientId)
      .maybeSingle(),
    supabase.from("client_consents").select("granted_at, revoked_at, notes, recorded_by").eq("client_id", clientId).order("granted_at"),
    supabase
      .from("anamnesis_fills")
      .select("id, template_name, filled_at, filled_by, note, no_changes, anamnesis_answers ( section, label, value, detail, sort_order )")
      .eq("client_id", clientId)
      .order("filled_at"),
    supabase
      .from("clinical_evaluations")
      .select("id, kind, seq, title, status, opened_at, closed_at, diagnosis_finalized_at, diagnosis_finalized_by, content_hash")
      .eq("client_id", clientId)
      .order("opened_at"),
    supabase.from("clinical_notes").select("evaluation_id, body, created_at, created_by").eq("client_id", clientId).order("created_at"),
    supabase
      .from("clinical_media")
      .select("id, evaluation_id, kind, storage_path, original_name, display_name, content_type, external_url, note, created_at")
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("treatment_plans")
      .select("id, version_no, status, created_at, superseded_at, diagnosis, objectives, treatment_plan_options ( title, is_primary, review_status, treatment_plan_option_items ( description, quantity, tooth_code, face_codes, region_code, sort_order ) )")
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("clinical_progress_notes")
      .select("id, body, created_at, author_id, appointment_id, addendum_of, addendum_reason")
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("attendance_session_outcomes")
      .select("appointment_id, label, done, unplanned, reason")
      .eq("client_id", clientId),
    supabase.from("clinical_documents").select("kind, title, body, created_at, author_id").eq("client_id", clientId).order("created_at"),
  ]);
  if (!cli) notFound();

  const odonto = await carregarOdontograma(clientId, (cli.birth_date as string | null) ?? null);

  // Os nomes de quem registrou (uma leitura só).
  const ids = new Set<string>();
  const junta = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  junta(ex.requested_by);
  for (const r of consents ?? []) junta(r.recorded_by);
  for (const r of fills ?? []) junta(r.filled_by);
  for (const r of rodadas ?? []) junta(r.diagnosis_finalized_by);
  for (const r of notas ?? []) junta(r.created_by);
  for (const r of evolucoes ?? []) junta(r.author_id);
  for (const r of docs ?? []) junta(r.author_id);
  const nomes = new Map<string, string>(Object.entries(odonto?.pessoas ?? {}));
  const faltam = [...ids].filter((i) => !nomes.has(i));
  if (faltam.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", faltam);
    for (const p of data ?? []) nomes.set(p.id as string, p.full_name as string);
  }
  const quem = (v: unknown) => (typeof v === "string" ? (nomes.get(v) ?? "—") : "—");

  // J4: as imagens entram impressas (link assinado de 1 hora — basta para imprimir).
  const ehImagem = (m: { kind: string; content_type: string | null; storage_path: string | null }) =>
    Boolean(m.storage_path) &&
    (m.content_type?.startsWith("image/") || ["photo", "radiograph", "scan"].includes(m.kind));
  const urlDaImagem = new Map<string, string>();
  await Promise.all(
    (midias ?? [])
      .filter((m) => ehImagem(m as { kind: string; content_type: string | null; storage_path: string | null }))
      .map(async (m) => {
        const { data } = await supabase.storage.from(CLINICAL_BUCKET).createSignedUrl(m.storage_path as string, 3600);
        if (data?.signedUrl) urlDaImagem.set(m.id as string, data.signedUrl);
      })
  );

  const clinic = (Array.isArray(cli.clinic) ? cli.clinic[0] : cli.clinic) as { name: string } | null;
  const nomeDaSituacao = new Map((odonto?.situacoes ?? []).map((s) => [s.code, s.name]));
  const atuais = odonto?.achados ? marcasAtuais(odonto.achados) : [];
  const tratados = odonto ? achadosTratados(atuais, odonto.feitos, odonto.situacoes) : new Map();
  const nomeDaRegiao = (c: string) => odonto?.regioes.find((r) => r.code === c)?.name;
  const saidasDoAtendimento = new Map<string, NonNullable<typeof saidas>>();
  for (const s of saidas ?? []) {
    const k = s.appointment_id as string;
    saidasDoAtendimento.set(k, [...(saidasDoAtendimento.get(k) ?? []), s]);
  }
  const evolucao = agruparAdendos(
    (evolucoes ?? []).map((n) => ({
      ...n,
      appointmentId: n.appointment_id as string | null,
      createdAt: n.created_at as string,
      addendumOf: n.addendum_of as string | null,
    }))
  );
  // Considerações, diagnóstico por dente e mídias de um bloco (rodada ou "fora").
  type Nota = NonNullable<typeof notas>[number];
  type Midia = NonNullable<typeof midias>[number];
  const registros = (
    notasX: Nota[],
    midiasX: Midia[],
    achadosX: NonNullable<typeof odonto>["achados"] & object,
    tituloDosAchados = "Diagnóstico por dente"
  ) => (
    <>
      {notasX.length > 0 && (
        <div className="mt-1">
          <p className="text-xs font-semibold">Considerações</p>
          {notasX.map((n, i) => (
            <p key={i} className="whitespace-pre-wrap text-xs">
              {quando(n.created_at as string)} · {quem(n.created_by)}: {n.body as string}
            </p>
          ))}
        </div>
      )}
      {achadosX.length > 0 && (
        <div className="mt-1">
          <p className="text-xs font-semibold">{tituloDosAchados}</p>
          <ul className="list-inside list-disc text-xs">
            {achadosX.map((a) => (
              <li key={a.id}>
                {descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}
                {a.adendo ? ` · adendo: ${a.motivoDoAdendo ?? ""}` : ""}
                {tratados.has(a.id) ? ` · tratado em ${quando(tratados.get(a.id)?.feitoEm)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {midiasX.length > 0 && (
        <div className="mt-1">
          <p className="text-xs font-semibold">Fotos, exames e arquivos</p>
          {midiasX.map((m) => {
            const nome = (m.display_name as string | null) ?? (m.original_name as string | null) ?? "Arquivo";
            const legenda = `${ROTULO_DA_MIDIA[m.kind as string] ?? "Arquivo"} · ${nome} · ${quando(m.created_at as string)}`;
            const url = urlDaImagem.get(m.id as string);
            return url ? (
              <figure key={m.id as string} className="avoid-break my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={nome} className="max-h-[22cm] w-full object-contain" />
                <figcaption className="text-[10px]">{legenda}</figcaption>
              </figure>
            ) : (
              <p key={m.id as string} className="text-xs">
                • {legenda}
                {m.external_url ? " (link externo)" : ""}
                {m.note ? ` — ${m.note as string}` : ""}
              </p>
            );
          })}
        </div>
      )}
    </>
  );
  const semRodada = {
    notas: (notas ?? []).filter((n) => !n.evaluation_id),
    midias: (midias ?? []).filter((m) => !m.evaluation_id),
    achados: (odonto?.achados ?? []).filter((a) => !a.evaluationId && a.status === "defined"),
    vazio: false,
  };
  semRodada.vazio = semRodada.notas.length + semRodada.midias.length + semRodada.achados.length === 0;

  const motivo = MOTIVOS_DO_PRONTUARIO[ex.reason_code as MotivoDoProntuario] ?? (ex.reason_code as string);

  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href={`/prontuarios/${clientId}`} className="text-xs underline">
          ← Voltar à ficha
        </a>
        <PrintButton />
      </div>

      <header className="mb-6 border-b-2 border-black pb-3">
        <h1 className="text-xl font-bold">Prontuário clínico</h1>
        <p className="mt-1 text-xs">
          {clinic?.name ?? "Risarte Odontologia"} · gerado em {quando(ex.created_at as string)} por{" "}
          {quem(ex.requested_by)} · motivo: {motivo}
          {ex.reason_note ? ` (${ex.reason_note as string})` : ""}
        </p>
      </header>

      <Secao titulo="1. Paciente">
        <p>
          <strong>{cli.full_name as string}</strong>
          {cli.code ? ` · ${cli.code as string}` : ""}
          {cli.cpf ? ` · CPF ${cli.cpf as string}` : ""}
          {cli.birth_date ? ` · nascimento ${formatIsoDateBr(cli.birth_date as string)}` : ""}
        </p>
      </Secao>

      <Secao titulo="2. Consentimentos">
        {(consents ?? []).length === 0 ? (
          <p className="text-xs">Nenhum consentimento registrado.</p>
        ) : (
          <ul className="list-inside list-disc text-xs">
            {(consents ?? []).map((c, i) => (
              <li key={i}>
                Registrado em {quando(c.granted_at as string)} por {quem(c.recorded_by)}
                {c.revoked_at ? ` · revogado em ${quando(c.revoked_at as string)}` : ""}
                {c.notes ? ` · ${c.notes as string}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="3. Anamnese (todas as versões)">
        {(fills ?? []).length === 0 ? (
          <p className="text-xs">Nenhuma anamnese preenchida.</p>
        ) : (
          (fills ?? []).map((f) => {
            const respostas = [...((f.anamnesis_answers as { section: string | null; label: string; value: unknown; detail: string | null; sort_order: number }[] | null) ?? [])].sort(
              (a, b) => a.sort_order - b.sort_order
            );
            return (
              <div key={f.id as string} className="avoid-break mb-3">
                <p className="text-xs font-semibold">
                  {(f.template_name as string | null) ?? "Anamnese"} — {quando(f.filled_at as string)} · {quem(f.filled_by)}
                  {f.no_changes ? " · sem alterações" : ""}
                </p>
                {f.note ? <p className="text-xs italic">{f.note as string}</p> : null}
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {respostas.map((r, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="w-1/2 py-0.5 pr-2">{r.label}</td>
                        <td className="py-0.5">
                          {resposta(r.value)}
                          {r.detail ? ` — ${r.detail}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </Secao>

      <Secao titulo="4. Avaliações e registros clínicos">
        {(rodadas ?? []).length === 0 && semRodada.vazio ? (
          <p className="text-xs">Nenhuma avaliação registrada.</p>
        ) : (
          <>
            {(rodadas ?? []).map((r) => (
              <div key={r.id as string} className="mb-4">
                <p className="font-semibold">
                  {evaluationLabel({ kind: r.kind as EvaluationKind, seq: r.seq as number, title: r.title as string | null })} — aberta em{" "}
                  {quando(r.opened_at as string)}
                </p>
                {r.diagnosis_finalized_at ? (
                  <p className="text-xs">
                    Diagnóstico finalizado em {quando(r.diagnosis_finalized_at as string)} por {quem(r.diagnosis_finalized_by)}
                    {r.content_hash ? (
                      <>
                        {" "}· carimbo do conteúdo (SHA-256): <span className="break-all font-mono text-[10px]">{r.content_hash as string}</span>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs">Diagnóstico ainda em aberto.</p>
                )}
                {registros(
                  (notas ?? []).filter((n) => n.evaluation_id === r.id),
                  (midias ?? []).filter((m) => m.evaluation_id === r.id),
                  (odonto?.achados ?? []).filter((a) => a.evaluationId === r.id && a.status === "defined")
                )}
              </div>
            ))}
            {/* O que não tem rodada: registros antigos (antes das rodadas) e o
                achado do atendimento (OD5) — também é prontuário. */}
            {!semRodada.vazio && (
              <div className="mb-4">
                <p className="font-semibold">Registros fora de uma rodada de avaliação</p>
                {registros(semRodada.notas, semRodada.midias, semRodada.achados, "Achados registrados durante o tratamento")}
              </div>
            )}
          </>
        )}
      </Secao>

      <Secao titulo="5. Odontograma (hoje)">
        {odonto ? (
          <div className="avoid-break">
            <Odontograma
              modo="impresso"
              denticaoInicial={odonto.denticao}
              nomes={odonto.nomes}
              faces={odonto.faces}
              marcas={[...odonto.aFazer, ...marcasDoDesenho(odonto.achados ?? [], odonto.situacoes, "definidos", odonto.feitos)]}
              className="mx-auto max-w-xl"
            />
            <p className="mt-1 text-center text-[10px]">
              Vista de frente (o lado direito do paciente à esquerda). Vermelho: a fazer ou achado que pede
              tratamento; azul: existente ou feito; cinza com X: ausente.
            </p>
            {odonto.feitos.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs">
                {odonto.feitos.map((f) => (
                  <li key={f.itemId}>
                    {nomeDaSituacao.get(f.efeito) ?? f.efeito} — {localDaSessao({ toothCode: f.dente, faceCodes: f.faces, regionCode: null })} ·
                    feito em {quando(f.feitoEm)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-xs">O odontograma não pôde ser carregado agora.</p>
        )}
      </Secao>

      <Secao titulo="6. Planos de tratamento">
        {(planos ?? []).length === 0 ? (
          <p className="text-xs">Nenhum plano.</p>
        ) : (
          (planos ?? []).map((p) => {
            const opcoes = [
              ...((p.treatment_plan_options as { title: string; is_primary: boolean; review_status: string; treatment_plan_option_items: { description: string; quantity: number; tooth_code: string | null; face_codes: string[] | null; region_code: string | null; sort_order: number }[] }[] | null) ?? []),
            ].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
            return (
              <div key={p.id as string} className="avoid-break mb-3">
                <p className="font-semibold">
                  Versão {(p.version_no as number | null) ?? 1} — {ROTULO_DO_PLANO[p.status as string] ?? (p.status as string)}
                  {p.superseded_at ? ` · substituída em ${quando(p.superseded_at as string)}` : ""} · criada em{" "}
                  {quando(p.created_at as string)}
                </p>
                {p.diagnosis ? <p className="whitespace-pre-wrap text-xs">Diagnóstico: {p.diagnosis as string}</p> : null}
                {p.objectives ? <p className="whitespace-pre-wrap text-xs">Objetivos: {p.objectives as string}</p> : null}
                {opcoes.map((o, i) => (
                  <div key={i} className="mt-1">
                    <p className="text-xs font-semibold">
                      {o.is_primary ? "Principal" : "Alternativa"}: {o.title}
                      {o.review_status === "approved" ? " · aprovada" : ""}
                    </p>
                    <ul className="list-inside list-disc text-xs">
                      {[...(o.treatment_plan_option_items ?? [])]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((it, j) => {
                          const onde = localDaSessao(
                            { toothCode: it.tooth_code, faceCodes: it.face_codes ?? [], regionCode: it.region_code },
                            nomeDaRegiao
                          );
                          return (
                            <li key={j}>
                              {it.quantity > 1 ? `${it.quantity}× ` : ""}
                              {it.description}
                              {onde ? ` — ${onde}` : ""}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </Secao>

      <Secao titulo="7. Evolução clínica (atendimentos)">
        {evolucao.length === 0 ? (
          <p className="text-xs">Nenhuma evolução registrada.</p>
        ) : (
          evolucao.map(({ original: n, adendos }) => (
            <div key={n.id as string} className="avoid-break mb-3">
              <p className="text-xs font-semibold">
                {quando(n.created_at as string)} · {quem(n.author_id)}
              </p>
              <p className="whitespace-pre-wrap text-xs">{n.body as string}</p>
              {n.appointment_id && (saidasDoAtendimento.get(n.appointment_id as string) ?? []).length > 0 && (
                <ul className="mt-0.5 list-inside list-disc text-[11px]">
                  {(saidasDoAtendimento.get(n.appointment_id as string) ?? []).map((s, i) => (
                    <li key={i}>
                      {s.done ? "Feita" : "Não realizada"}: {s.label as string}
                      {s.unplanned ? " (fora do programado)" : ""}
                      {s.reason ? ` — ${s.reason as string}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {adendos.map((a) => (
                <p key={a.id as string} className="mt-1 whitespace-pre-wrap border-l-2 border-black pl-2 text-xs">
                  <strong>Adendo</strong> · {quando(a.created_at as string)} · {quem(a.author_id)}
                  {a.addendum_reason ? ` · motivo: ${a.addendum_reason as string}` : ""}
                  {"\n"}
                  {a.body as string}
                </p>
              ))}
            </div>
          ))
        )}
      </Secao>

      <Secao titulo="8. Documentos clínicos emitidos">
        {(docs ?? []).length === 0 ? (
          <p className="text-xs">Nenhum documento emitido.</p>
        ) : (
          (docs ?? []).map((d, i) => (
            <div key={i} className="avoid-break mb-3">
              <p className="text-xs font-semibold">
                {ROTULO_DO_DOCUMENTO[d.kind as string] ?? "Documento"}: {d.title as string} — {quando(d.created_at as string)} ·{" "}
                {quem(d.author_id)}
              </p>
              <p className="whitespace-pre-wrap text-xs">{d.body as string}</p>
            </div>
          ))
        )}
      </Secao>

      <footer className="mt-8 border-t border-black pt-2 text-[10px]">
        Documento gerado em {quando(ex.created_at as string)} por {quem(ex.requested_by)} · motivo: {motivo}
        {ex.reason_note ? ` (${ex.reason_note as string})` : ""}. Cada geração e cada abertura ficam
        registradas na auditoria do sistema. Registro clínico: dado sensível de saúde (LGPD) — guarde e
        entregue apenas a quem tem direito.
      </footer>
    </div>
  );
}
