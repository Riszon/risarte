import "server-only";
import { getSessionContext, hasRoleWithScopeForClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLINICAL_BUCKET } from "@/lib/clinical";
import { PILLAR_LABELS, type MethodologyPillar } from "@/lib/journey";
import {
  budgetTotalCents,
  formatBRL,
  formatMinutes,
  formatSessions,
  type BudgetItem,
} from "@/lib/pricing";
import type { PresentationData, PresentationOption } from "./presentation-view";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { pacoteDosItens } from "@/lib/procedimentos/grupos-db";
import { pacotesDaOpcao } from "@/lib/procedimentos/grupos";
import { carregarOdontoDaApresentacao } from "@/lib/odontograma/carregar";
import { localDoItem, marcasDoAceite, porDente } from "@/lib/odontograma/aceite";
import type { ProjectedSession } from "@/lib/planning";
import { itensPelaSequencia, textoDosTotais, totaisDoTratamento } from "@/lib/sequencia-do-plano";
import { projectOptionSessions } from "../../prontuarios/[id]/planning-actions";

export type LoadResult =
  | { ok: true; data: PresentationData; clinicId: string; hasApprovedPlan: boolean }
  | { ok: false; reason: "not_found" | "forbidden" };

/** Carrega os dados da apresentação (opções aprovadas, a principal primeiro) e valida o acesso.
 * Usado pela página (server component) e pela action de geração no Gamma. */
export async function loadPresentationData(
  clientId: string
): Promise<LoadResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, clinic_id, journey_phase, methodology_pillar, birth_date, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, reason: "not_found" };

  const isPlannerAnywhere = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  // O Consultor Comercial tem papel na Franqueadora (escopo de unidades),
  // nunca na clínica do cliente — a checagem precisa considerar o escopo.
  const canPresent =
    session.isAdminMaster ||
    isPlannerAnywhere ||
    (await hasRoleWithScopeForClinic(session, client.clinic_id, [
      "commercial_consultant",
      "clinical_coordinator",
      "unit_manager",
    ]));
  if (!canPresent) return { ok: false, reason: "forbidden" };
  // D7 / F4 (AP59): o Coordenador vê só os TOTAIS — o preço item a item é de
  // quem vende (Consultor), planeja (Planner) ou gere (Gerente) e do Admin.
  const veApenasTotais =
    !session.isAdminMaster &&
    !isPlannerAnywhere &&
    !(await hasRoleWithScopeForClinic(session, client.clinic_id, ["commercial_consultant", "unit_manager"]));

  // -- O plano que VALE: a versão aprovada mais nova que não foi substituída
  // (OD3, D4). AP60: antes era o plano mais novo de QUALQUER situação — uma
  // nova versão ainda em rascunho escondia o aprovado.
  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select("id, status, diagnosis, objectives, planning_notes")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<
      {
        id: string;
        status: string;
        diagnosis: string | null;
        objectives: string | null;
        planning_notes: string | null;
      }[]
    >();
  // Substituídos à parte: num banco sem a 0311 a coluna não existe e nada é substituído.
  const substituidos = new Set<string>();
  {
    const { data: subRows, error: subErro } = await supabase
      .from("treatment_plans")
      .select("id")
      .eq("client_id", clientId)
      .not("superseded_at", "is", null)
      .returns<{ id: string }[]>();
    if (!subErro) for (const s of subRows ?? []) substituidos.add(s.id);
  }
  const vigentes = (planRows ?? []).filter((p) => !substituidos.has(p.id));
  const planRow = vigentes.find((p) => p.status === "approved") ?? vigentes[0] ?? planRows?.[0];
  const hasApprovedPlan = planRow?.status === "approved";

  let diagnosis: string | null = null;
  let objectives: string | null = null;
  let planningNotes: string | null = null;
  const options: PresentationOption[] = [];
  let sessionGroups: PresentationData["sessionGroups"] = [];
  // OD4: o desenho da boca (diagnóstico definido + o que cada opção faz).
  const odonto = planRow
    ? await carregarOdontoDaApresentacao(clientId, (client.birth_date as string | null) ?? null)
    : null;
  if (planRow) {
    diagnosis = planRow.diagnosis;
    objectives = planRow.objectives;
    planningNotes = planRow.planning_notes;
    // G1 (OD4): TODAS as opções aprovadas — a principal primeiro; as outras
    // só aparecem quando o Consultor escolhe "mostrar alternativa".
    const { data: optRows } = await supabase
      .from("treatment_plan_options")
      .select("id, is_primary, title, sort_order, review_status")
      .eq("plan_id", planRow.id)
      .eq("review_status", "approved")
      .order("is_primary", { ascending: false })
      .order("sort_order")
      .returns<
        {
          id: string;
          is_primary: boolean;
          title: string;
          sort_order: number;
          review_status: string;
        }[]
      >();
    const { data: itemRows } = optRows?.length
      ? await supabase
          .from("treatment_plan_option_items")
          .select(
            "id, option_id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, sort_order, tooth_code, face_codes, region_code"
          )
          .in("option_id", optRows.map((o) => o.id))
          .order("sort_order")
          .returns<
            {
              id: string;
              option_id: string;
              procedure_id: string | null;
              description: string;
              quantity: number;
              unit_price_cents: number;
              planned_sessions: number | null;
              planned_total_minutes: number | null;
              sort_order: number;
              tooth_code: string | null;
              face_codes: string[] | null;
              region_code: string | null;
            }[]
          >()
      : { data: [] };

    // 0325 (GP6): o grupo e o preço de tabela de cada item, à parte.
    const pacoteDe = await pacoteDosItens(supabase, (itemRows ?? []).map((it) => it.id));

    let principal: BudgetItem[] = [];
    let sessoesDaPrincipal: ProjectedSession[] = [];
    for (const opt of optRows ?? []) {
      const linhas = (itemRows ?? []).filter((it) => it.option_id === opt.id);
      // OC-00006/OC-00007: o cliente vê o tamanho da sequência montada. O plano
      // aprovado não recebe mais confirmação: vale a ordem gravada.
      const sessoes = await projectOptionSessions(opt.id);
      const planejados: BudgetItem[] = linhas.map((it) => ({
        id: it.id,
        procedureId: it.procedure_id,
        description: it.description,
        quantity: it.quantity,
        unitPriceCents: it.unit_price_cents,
        plannedSessions: it.planned_sessions,
        plannedMinutes: it.planned_total_minutes,
        // A apresentação não usa etapas/indicação — campos só para o tipo.
        stageId: null,
        suggestedProviderId: null,
        toothCode: it.tooth_code,
        faceCodes: it.face_codes ?? [],
        regionCode: it.region_code,
      }));
      const items = itensPelaSequencia(planejados, sessoes);
      if (options.length === 0) {
        principal = items;
        sessoesDaPrincipal = sessoes;
      }
      const summaryLabel = textoDosTotais(
        totaisDoTratamento(planejados, { confirmadaEm: null, sessions: sessoes }, false)
      );
      const comLocal = items.map((it) => ({ ...it, faceCodes: it.faceCodes ?? [] }));
      options.push({
        id: opt.id,
        title: opt.title,
        isPrimary: opt.is_primary,
        // "Proposta e investimento" por dente/região (OD4).
        items: porDente(comLocal, odonto?.regioes).map(({ item: it, local }) => ({
          description: it.description,
          local,
          quantity: it.quantity,
          sessionsLabel: it.plannedSessions ? formatSessions(it.plannedSessions) : null,
          minutesLabel: it.plannedMinutes ? formatMinutes(it.plannedMinutes) : null,
          priceLabel:
            !veApenasTotais && it.unitPriceCents > 0
              ? formatBRL(it.unitPriceCents * it.quantity)
              : null,
        })),
        totalLabel: budgetTotalCents(items) > 0 ? formatBRL(budgetTotalCents(items)) : null,
        pacotes: veApenasTotais
          ? []
          : pacotesDaOpcao(
              items.map((it) => ({
                grupo: pacoteDe.get(it.id)?.grupo ?? null,
                quantidade: it.quantity,
                precoCents: it.unitPriceCents,
                precoDeTabelaCents: pacoteDe.get(it.id)?.precoDeTabelaCents ?? null,
              }))
            ).map((p) => ({ nome: p.nome, deLabel: formatBRL(p.deCents), porLabel: formatBRL(p.porCents) })),
        summaryLabel,
        marcas: odonto ? marcasDoAceite(comLocal, [], odonto) : [],
      });
    }

    // Sessão por sessão (da principal): protocolo de cada procedimento
    // (unidade > Rede); sem protocolo, cai na contagem planejada do item.
    const items = principal;
    if (items.length > 0) {
      const procIds = items
        .map((it) => it.procedureId)
        .filter((x): x is string => Boolean(x));
      const protoByProc = new Map<
        string,
        {
          unit: { name: string | null; minutes: number }[];
          net: { name: string | null; minutes: number }[];
        }
      >();
      if (procIds.length > 0) {
        const { data: protoRows } = await supabase
          .from("procedure_sessions")
          .select(
            "procedure_id, clinic_id, session_index, name, estimated_minutes"
          )
          .in("procedure_id", procIds)
          .or(`clinic_id.is.null,clinic_id.eq.${client.clinic_id}`)
          .order("session_index")
          .returns<
            {
              procedure_id: string;
              clinic_id: string | null;
              session_index: number;
              name: string | null;
              estimated_minutes: number;
            }[]
          >();
        for (const r of protoRows ?? []) {
          const e = protoByProc.get(r.procedure_id) ?? { unit: [], net: [] };
          (r.clinic_id === null ? e.net : e.unit).push({
            name: r.name,
            minutes: r.estimated_minutes,
          });
          protoByProc.set(r.procedure_id, e);
        }
      }
      sessionGroups = items.map((it) => {
        const proto = it.procedureId
          ? protoByProc.get(it.procedureId)
          : undefined;
        const base =
          proto && proto.unit.length > 0 ? proto.unit : (proto?.net ?? []);
        const daSequencia = sessoesDaPrincipal
          .filter((s) => s.itemId === it.id)
          .sort((a, b) => a.sessionIndex - b.sessionIndex);
        let sessions: { label: string; minutesLabel: string | null }[];
        if (daSequencia.length > 0) {
          sessions = daSequencia.map((s) => ({
            label: s.name?.trim() || `Sessão ${s.sessionIndex}`,
            minutesLabel: s.plannedMinutes ? formatMinutes(s.plannedMinutes) : null,
          }));
        } else if (base.length > 0) {
          sessions = base.map((s, i) => ({
            label: s.name?.trim() || `Sessão ${i + 1}`,
            minutesLabel: s.minutes ? formatMinutes(s.minutes) : null,
          }));
        } else {
          const n = Math.max(1, it.plannedSessions ?? 1);
          const per =
            it.plannedMinutes && n > 0 ? Math.round(it.plannedMinutes / n) : null;
          sessions = Array.from({ length: n }, (_, i) => ({
            label: `Sessão ${i + 1}`,
            minutesLabel: per ? formatMinutes(per) : null,
          }));
        }
        const onde = localDoItem(it, odonto?.regioes);
        return {
          procedure: onde ? `${it.description} — ${onde}` : it.description,
          quantity: it.quantity,
          repeatNote:
            it.quantity > 1 && base.length > 0 && daSequencia.length === 0
              ? `Este procedimento se repete ${it.quantity}×.`
              : null,
          sessions,
        };
      });
    }
  }

  // G4 (OD4): as anotações clínicas do Coordenador (clinical_notes) NÃO vão
  // para a tela do cliente — são registro interno. O cliente vê o diagnóstico
  // do plano, o odontograma e as considerações do planejamento.

  // -- Imagens clínicas (somente imagens; URLs assinadas) --
  const { data: mediaRows } = await supabase
    .from("clinical_media")
    .select("id, original_name, storage_path, content_type, kind, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        original_name: string | null;
        storage_path: string | null;
        content_type: string | null;
        kind: string;
        created_at: string;
      }[]
    >();
  const imageRows = (mediaRows ?? []).filter(
    (m) =>
      m.storage_path &&
      (m.content_type?.startsWith("image/") ||
        m.kind === "photo" ||
        m.kind === "radiograph" ||
        m.kind === "scan")
  );
  const photos = (
    await Promise.all(
      imageRows.map(async (m) => {
        const { data: signed } = await supabase.storage
          .from(CLINICAL_BUCKET)
          .createSignedUrl(m.storage_path as string, 3600);
        return signed?.signedUrl
          ? { id: m.id, url: signed.signedUrl, name: m.original_name }
          : null;
      })
    )
  ).filter((p): p is { id: string; url: string; name: string | null } =>
    Boolean(p)
  );

  const clinicRaw = (
    client as unknown as { clinic: { name: string } | { name: string }[] | null }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;

  const pillar = client.methodology_pillar as MethodologyPillar | null;

  const data: PresentationData = {
    clientName: client.full_name,
    clientCode: client.code,
    clinicName,
    pillarLabel: pillar ? PILLAR_LABELS[pillar] : null,
    dateLabel: new Date().toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE }),
    diagnosis,
    objectives,
    planningNotes,
    photos,
    option: options[0] ?? null,
    alternatives: options.slice(1),
    odonto: odonto
      ? { nomes: odonto.nomes, faces: odonto.faces, denticao: odonto.denticao }
      : null,
    sessionGroups,
  };

  return { ok: true, data, clinicId: client.clinic_id, hasApprovedPlan };
}
