import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Bot, CheckCircle2 } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateInBrazil } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/roles";
import type { UserRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  AVISO_SEM_SCHEMA,
  DIAS_DA_SEMANA,
  ESTADO_DA_RITA,
  MODO_DA_RITA,
  estadoDaUnidade,
  faltaExporRita,
  podeDesligarRita,
  podeLigarRita,
  podeVerRita,
} from "@/lib/rita-tela";
import { InterruptorDaRita } from "../interruptor";

export const metadata: Metadata = { title: "Assistente virtual" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lacuna = { ordem: number; item: string; rotulo: string; ok: boolean; detalhe: string | null };
type Dia = {
  weekday: number;
  closed: boolean;
  open_time: string | null;
  close_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  origem: string | null;
};
type Acao = {
  id: number;
  kind: string;
  summary: string;
  scope: "rede" | "unidade";
  actor_kind: "pessoa" | "assistente" | "sistema";
  actor_name: string | null;
  created_at: string;
};
type TelaDaUnidade = {
  clinic: { id: string; name: string; address: string | null; city: string | null; state: string | null; phone: string | null };
  public_info: {
    public_name: string | null;
    landmark: string | null;
    maps_url: string | null;
    parking: string | null;
    accessibility: string | null;
    whatsapp_e164: string | null;
    min_child_age: number | null;
    updated_at: string | null;
  } | null;
  network: { enabled: boolean; mode: string } | null;
  settings: {
    enabled: boolean;
    mode: string;
    activated_at: string | null;
    activated_by: string | null;
    paused_at: string | null;
    paused_reason: string | null;
    paused_by: string | null;
    updated_at: string | null;
  } | null;
  effective_mode: string;
  gaps: Lacuna[];
  hours: Dia[];
  closed_days: { date: string; holiday_name: string | null; reason: string | null }[];
  catalog: { procedure_id: string; name: string; patient_name: string; rita_role: string | null; price_cents: number | null; minutes: number | null }[];
  fee: {
    offered: boolean;
    price_cents: number | null;
    minutes: number | null;
    campaign_title: string | null;
    campaign_text: string | null;
    campaign_ends_on: string | null;
    free_for_indica: boolean;
    companies_with_benefit: number;
    ppr_plans_with_benefit: number;
  } | null;
  route: {
    scope: "rede" | "unidade";
    business_hours_roles: UserRole[];
    sla_alert_roles: UserRole[];
    sla_alert_after_minutes: number;
    sla_escalate_to_admin_after_minutes: number | null;
    fallback_name: string | null;
  } | null;
  actions: Acao[];
};

const hora = (t: string | null) => (t ? t.slice(0, 5) : "");
const papeis = (rs: UserRole[] | undefined) => (rs ?? []).map((r) => ROLE_LABELS[r] ?? r).join(", ");
const QUEM: Record<Acao["actor_kind"], string> = {
  pessoa: "",
  assistente: "Rita (assistente virtual)",
  sistema: "Sistema",
};

/** Um item do que a Rita vai dizer. Vazio = a lacuna em destaque. */
function Item({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  const vazio = valor === null || valor === undefined || valor === "";
  return (
    <div className="grid gap-0.5 sm:grid-cols-[12rem_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className={cn("text-sm", vazio && "font-medium text-amber-700 dark:text-amber-300")}>
        {vazio ? "Não cadastrado" : valor}
      </dd>
    </div>
  );
}

export default async function RitaUnidadePage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const session = await getSessionContext();
  if (!podeVerRita(session)) redirect("/");
  const { clinicId } = await params;
  if (!UUID.test(clinicId)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.schema("rita").rpc("screen_unit", { p_clinic: clinicId });

  if (error) {
    if (/NOT_ALLOWED|NOT_FOUND/.test(error.message ?? "")) notFound();
    return (
      <div className="space-y-6">
        <CabecalhoDeModulo
          chapeu="Assistente virtual"
          icone={Bot}
          titulo="O que a Rita sabe"
          descricao=""
          voltar={{ href: "/rita", rotulo: "Todas as unidades" }}
        />
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {faltaExporRita(error)
            ? AVISO_SEM_SCHEMA
            : "Não foi possível ler a assistente virtual agora. Tente de novo em instantes."}
        </p>
      </div>
    );
  }

  const t = data as TelaDaUnidade;
  const s = t.settings;
  const ligada = s?.enabled ?? false;
  const faltam = t.gaps.filter((g) => !g.ok);
  const pausadaSozinha = !ligada && !!s?.paused_at && !s.paused_by;
  const estado = ESTADO_DA_RITA[estadoDaUnidade({ enabled: ligada, paused_auto: pausadaSozinha, gaps: faltam.length })];
  const pi = t.public_info;
  const endereco = [t.clinic.address, [t.clinic.city, t.clinic.state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const avaliacao = t.catalog.find((c) => c.rita_role === "evaluation_new");
  const consulta = t.catalog.find((c) => c.rita_role === "evaluation_returning");

  return (
    <div className="space-y-6">
      <CabecalhoDeModulo
        chapeu="Assistente virtual"
        icone={Bot}
        titulo={t.clinic.name}
        descricao="O que a Rita vai dizer sobre esta unidade, montado pelas mesmas leituras que ela usa."
        voltar={{ href: "/rita", rotulo: "Todas as unidades" }}
      />

      {/* Situação e interruptor */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              Situação
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", estado.tom)}>{estado.rotulo}</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Modo: {MODO_DA_RITA[t.effective_mode] ?? t.effective_mode}
              {!t.network?.enabled && " · A rede está desligada."}
            </p>
            {ligada && s?.activated_at && (
              <p className="text-sm text-muted-foreground">
                Ligada em {formatBrDateTime(s.activated_at)}
                {s.activated_by ? ` por ${s.activated_by}` : ""}.
              </p>
            )}
            {!ligada && s?.paused_at && (
              <p className="text-sm text-muted-foreground">
                {s.paused_by ? `Desligada por ${s.paused_by}` : "Pausada sozinha"} em {formatBrDateTime(s.paused_at)}
                {s.paused_reason ? `: ${s.paused_reason}` : "."}
              </p>
            )}
          </div>
          <InterruptorDaRita
            clinicId={t.clinic.id}
            nome={t.clinic.name}
            ligada={ligada}
            podeLigar={podeLigarRita(session) && faltam.length === 0 && !!t.network?.enabled}
            podeDesligar={podeDesligarRita(session, t.clinic.id)}
          />
        </CardHeader>
        {!ligada && podeLigarRita(session) && (faltam.length > 0 || !t.network?.enabled) && (
          <CardContent className="pt-0 text-sm text-muted-foreground">
            {!t.network?.enabled
              ? "Para ligar esta unidade, ligue antes a rede (na lista de unidades)."
              : "O botão Ligar aparece quando nada mais faltar."}
          </CardContent>
        )}
      </Card>

      {/* O portão */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {faltam.length === 0 ? "Nada falta para ligar" : `Falta para ligar (${faltam.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {t.gaps.map((g) => (
              <li key={g.item} className="flex gap-2 text-sm">
                {g.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <span className={cn(!g.ok && "font-medium")}>
                  {g.rotulo}
                  {!g.ok && g.detalhe ? <span className="font-normal text-muted-foreground"> — {g.detalhe}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* A unidade */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">A unidade</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2">
            <Item rotulo="Nome para o paciente" valor={pi?.public_name ?? t.clinic.name} />
            <Item rotulo="Endereço" valor={endereco} />
            <Item rotulo="Ponto de referência" valor={pi?.landmark} />
            <Item
              rotulo="Link do mapa"
              valor={
                pi?.maps_url ? (
                  <a href={pi.maps_url} target="_blank" rel="noreferrer" className="text-primary underline">
                    Abrir o mapa
                  </a>
                ) : null
              }
            />
            <Item rotulo="Estacionamento" valor={pi?.parking} />
            <Item rotulo="Acessibilidade" valor={pi?.accessibility} />
            <Item rotulo="WhatsApp da unidade" valor={pi?.whatsapp_e164} />
            <Item
              rotulo="Idade mínima (criança)"
              valor={pi?.min_child_age != null ? `${pi.min_child_age} anos` : "Sem idade definida: a Rita não promete e passa para a equipe"}
            />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Muda-se na Administração → Unidades, aba Dados públicos.
            {pi?.updated_at ? ` Última alteração: ${formatBrDateTime(pi.updated_at)}.` : ""}
          </p>
        </CardContent>
      </Card>

      {/* Horários e feriados */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horários e feriados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1 text-sm">
            {t.hours.map((d) => (
              <li key={d.weekday} className="flex gap-3">
                <span className="w-20 shrink-0 text-muted-foreground">{DIAS_DA_SEMANA[d.weekday]}</span>
                <span>
                  {d.closed
                    ? "Fechado"
                    : `${hora(d.open_time)} às ${hora(d.close_time)}${
                        d.lunch_start && d.lunch_end ? ` (almoço ${hora(d.lunch_start)}–${hora(d.lunch_end)})` : ""
                      }`}
                </span>
              </li>
            ))}
          </ul>
          <div>
            <p className="text-sm font-medium">Feriados fechados nos próximos 45 dias</p>
            {t.closed_days.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {t.closed_days.map((d) => (
                  <li key={d.date}>
                    {formatIsoDateInBrazil(d.date, { weekday: "short", day: "2-digit", month: "2-digit" })} —{" "}
                    {d.holiday_name}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Para a Rita, feriado sem decisão da unidade conta como fechado. Muda-se na Agenda → Configuração.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* A avaliação */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">A avaliação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-2">
            <Item rotulo="A unidade oferece" valor={t.fee ? (t.fee.offered ? "Sim" : "Não") : null} />
            <Item
              rotulo="Valor"
              valor={t.fee?.price_cents ? formatBRL(t.fee.price_cents) : null}
            />
            <Item rotulo="Duração" valor={t.fee?.minutes ? `${t.fee.minutes} minutos` : null} />
            <Item
              rotulo="Campanha de isenção"
              valor={
                t.fee?.campaign_title
                  ? `${t.fee.campaign_title}${t.fee.campaign_ends_on ? ` (até ${formatIsoDateInBrazil(t.fee.campaign_ends_on, { day: "2-digit", month: "2-digit", year: "numeric" })})` : ""}`
                  : "Nenhuma ativa"
              }
            />
            <Item
              rotulo="Sem custo para"
              valor={[
                t.fee?.free_for_indica ? "indicados do Indica +Risos" : null,
                t.fee?.companies_with_benefit ? `colaboradores de ${t.fee.companies_with_benefit} empresa(s) do Empresarial` : null,
                t.fee?.ppr_plans_with_benefit ? `${t.fee.ppr_plans_with_benefit} plano(s) do PPR+` : null,
              ]
                .filter(Boolean)
                .join("; ")}
            />
          </dl>
          <div>
            <p className="text-sm font-medium">O que a Rita pode oferecer aqui</p>
            {t.catalog.length === 0 ? (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Nada no rol da Rita.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {t.catalog.map((c) => (
                  <li key={c.procedure_id}>
                    {c.patient_name}
                    {c.price_cents != null ? ` — ${formatBRL(c.price_cents)}` : ""}
                    {c === avaliacao
                      ? " (avaliação de quem é novo)"
                      : c === consulta
                        ? " (consulta de quem já é cliente)"
                        : c.rita_role === "urgency"
                          ? " (urgência: a Rita reconhece e passa para a equipe)"
                          : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              A Rita nunca informa preço de tratamento. O valor muda em Procedimentos → preço da unidade; o rol, no
              cadastro do procedimento (só o Admin).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Transferências */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quando a Rita passa para a equipe</CardTitle>
        </CardHeader>
        <CardContent>
          {t.route ? (
            <dl className="space-y-2">
              <Item rotulo="Recebe em horário comercial" valor={papeis(t.route.business_hours_roles)} />
              <Item
                rotulo="Se ninguém responder"
                valor={`${papeis(t.route.sla_alert_roles)} é avisado depois de ${t.route.sla_alert_after_minutes} minutos`}
              />
              <Item
                rotulo="Sobe ao Admin Master"
                valor={
                  t.route.sla_escalate_to_admin_after_minutes
                    ? `depois de ${t.route.sla_escalate_to_admin_after_minutes} minutos`
                    : "Não sobe"
                }
              />
              <Item rotulo="Pessoa de reserva" valor={t.route.fallback_name ?? "Nenhuma"} />
              <Item rotulo="Vale" valor={t.route.scope === "unidade" ? "Regra própria desta unidade" : "A regra da rede"} />
            </dl>
          ) : (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Nenhuma regra cadastrada.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Fora do horário não há transferência: a Rita dá a mensagem de urgência e o pedido fica para a abertura.
          </p>
        </CardContent>
      </Card>

      {/* O registro */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que aconteceu com a Rita</CardTitle>
        </CardHeader>
        <CardContent>
          {t.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {t.actions.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="text-muted-foreground">{formatBrDateTime(a.created_at)}</span> — {a.summary}
                  <span className="text-muted-foreground">
                    {" "}
                    ({a.actor_kind === "pessoa" ? (a.actor_name ?? "uma pessoa") : QUEM[a.actor_kind]}
                    {a.scope === "rede" ? ", na rede" : ""})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">As 30 mais recentes, desta unidade e da rede.</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Editar a rota, a duração, a oferta e os textos por esta tela vem na próxima etapa.{" "}
        <Link href="/rita" className="underline">
          Voltar para todas as unidades
        </Link>
      </p>
    </div>
  );
}
