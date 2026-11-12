import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionContext } from "@/lib/auth";
import { estimativaDoCusto, type AvisoDaRegua, type SlotDaRegua } from "@/lib/asaas/regua";
import { rotaDaRede, rotaDaUnidade } from "@/lib/central/central";
import { formatBRL } from "@/lib/pricing";
import { AvisoSemMigracao } from "./abas";
import { BotaoDaUnidade, DeclaracaoDoTermo, ReguaDaRede } from "./regua-form";

/**
 * A ABA COBRANÇA E COMUNICAÇÃO (ASA2, entrega 3; 4007; spec 17.3 a 17.5).
 *
 * Rede: a declaração do termo de privacidade, a régua (uma só, da rede) e as
 * unidades. Unidade: o botão, os pagadores, o custo estimado e a régua só para
 * ler. Tudo lido pelas portas do banco, COMO a pessoa logada.
 */

type LinhaDaRegua = {
  slot: SlotDaRegua;
  event: string;
  schedule_offset: number | null;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  phone_call: boolean;
  updated_at: string;
  updated_by_name: string | null;
  privacy_declared_at: string | null;
  privacy_declared_by_name: string | null;
  privacy_note: string | null;
  can_edit: boolean;
  can_declare: boolean;
};

type Panorama = {
  enabled: boolean;
  changed_at: string | null;
  changed_by_name: string | null;
  privacy_declared: boolean;
  account_status: string | null;
  fee_messaging_cents: number | null;
  fee_whatsapp_cents: number | null;
  fee_phone_call_cents: number | null;
  notification_fees_synced_at: string | null;
  balance_cents: number | null;
  balance_checked_at: string | null;
  payers: number;
  payers_without_email: number;
  payers_without_mobile: number;
  payers_opted_out: number;
  payers_pending: number;
  payers_with_error: number;
  payers_on: number;
  charges_30d: number;
  paid_30d: number;
  can_edit: boolean;
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

async function lerRegua(supabase: SupabaseClient): Promise<LinhaDaRegua[] | null> {
  const { data, error } = await supabase.rpc("gateway_regua_read");
  if (error) return null;
  return (data ?? []) as LinhaDaRegua[];
}

const paraRegua = (linhas: LinhaDaRegua[]): AvisoDaRegua[] =>
  linhas.map((l) => ({
    slot: l.slot,
    event: l.event,
    scheduleOffset: l.schedule_offset == null ? null : Number(l.schedule_offset),
    email: l.email,
    sms: l.sms,
    whatsapp: l.whatsapp,
    phoneCall: l.phone_call,
  }));

async function lerPanorama(supabase: SupabaseClient, clinicId: string): Promise<Panorama | null> {
  const { data, error } = await supabase.rpc("gateway_regua_unit_overview", { p_clinic_id: clinicId });
  if (error) return null;
  const p = (Array.isArray(data) ? data[0] : data) as Panorama | null;
  return p ?? null;
}

function AvisoDoWhatsApp() {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/30 p-3 text-sm">
      <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p>
        <strong>WhatsApp:</strong> a mensagem sai de um número oficial do Asaas, não da clínica. Se o pagador responder,
        um assistente do Asaas orienta a procurar a clínica — <strong>a resposta não chega à clínica</strong>. O envio
        só acontece se houver <strong>saldo na conta Asaas da unidade</strong> no momento, e o pagador precisa ter
        celular válido e não ter bloqueado o número.
      </p>
    </div>
  );
}

function ExplicacaoDoCusto() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>
        <strong>E-mail e SMS</strong> são cobrados pela <strong>mensageria</strong>: uma vez por cobrança, não por
        aviso, e só quando a cobrança é paga (descontada na compensação).
      </li>
      <li>
        <strong>WhatsApp e ligação</strong> são cobrados <strong>a cada envio</strong>, paga ou não a cobrança.
      </li>
      <li>Correios não entra na régua.</li>
    </ul>
  );
}

// ---- REDE ----------------------------------------------------------------------

export async function AbaCobrancaDaRede({
  supabase,
  session,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
}) {
  const linhas = await lerRegua(supabase);
  if (!linhas) return <AvisoSemMigracao />;
  const primeira = linhas[0];
  const podeEditar = !!primeira?.can_edit;
  const regua = paraRegua(linhas);
  const unidades = session.clinics
    .filter((c) => c.type === "franchise_unit" && c.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const panoramas = await Promise.all(unidades.map((u) => lerPanorama(supabase, u.id)));
  const ultimaMudanca = [...linhas].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Termo de privacidade</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ligar a régua manda o e-mail e o celular dos pagadores ao Asaas. Antes, o termo de privacidade precisa citar
            o Asaas como operador. O Admin Master declara uma vez, para a rede; sem isso nenhuma unidade liga.
          </p>
        </CardHeader>
        <CardContent>
          {primeira?.privacy_declared_at ? (
            <p className="text-sm">
              ✅ Declarado por <strong>{primeira.privacy_declared_by_name ?? "—"}</strong> em{" "}
              {quando(primeira.privacy_declared_at)}: “{primeira.privacy_note}”
            </p>
          ) : primeira?.can_declare ? (
            <DeclaracaoDoTermo />
          ) : (
            <p className="text-sm text-muted-foreground">Aguardando o Admin Master declarar.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">A régua da rede</CardTitle>
          <p className="text-sm text-muted-foreground">
            Uma régua só, para todas as unidades. Cada unidade apenas liga ou desliga. Os avisos que o Asaas mandaria
            para a própria unidade ficam sempre desligados: o riSZon já avisa a equipe.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReguaDaRede inicial={regua} podeEditar={podeEditar} />
          {ultimaMudanca?.updated_by_name && (
            <p className="text-xs text-muted-foreground">
              Última mudança: {ultimaMudanca.updated_by_name}, {quando(ultimaMudanca.updated_at)}.
            </p>
          )}
          {regua.some((r) => r.whatsapp) && <AvisoDoWhatsApp />}
          <ExplicacaoDoCusto />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Unidades</CardTitle>
          <p className="text-sm text-muted-foreground">Abra a unidade para ligar, desligar e ver o custo estimado.</p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {unidades.map((u, i) => {
              const p = panoramas[i];
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={rotaDaUnidade(u.id, "cobranca")} className="font-medium underline-offset-2 hover:underline">
                    {u.name}
                  </Link>
                  <span
                    className={
                      p?.enabled
                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    }
                  >
                    {p?.enabled ? "Régua ligada" : "Régua desligada"}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

// ---- UNIDADE -------------------------------------------------------------------

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className={alerta && valor > 0 ? "text-xl font-semibold text-amber-600" : "text-xl font-semibold"}>{valor}</div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
    </div>
  );
}

const reais = (c: number | null) => (c == null ? "a conferir" : formatBRL(c));

export async function AbaCobrancaDaUnidade({
  supabase,
  clinicId,
  clinicName,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  clinicName: string;
}) {
  const [linhas, p] = await Promise.all([lerRegua(supabase), lerPanorama(supabase, clinicId)]);
  if (!linhas || !p) return <AvisoSemMigracao />;
  const regua = paraRegua(linhas);
  const est = estimativaDoCusto({
    regua,
    tarifas: {
      mensageriaCents: p.fee_messaging_cents,
      whatsappCents: p.fee_whatsapp_cents,
      ligacaoCents: p.fee_phone_call_cents,
    },
    emitidas30d: Number(p.charges_30d ?? 0),
    pagas30d: Number(p.paid_30d ?? 0),
  });
  const temWhats = regua.some((r) => r.whatsapp);
  const semSaldo = p.enabled && temWhats && p.balance_cents != null && Number(p.balance_cents) <= 0;
  const motivoTravado = !p.privacy_declared
    ? "Para ligar, falta o Admin Master declarar o termo de privacidade (aba Cobrança e comunicação da Rede)."
    : null;

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Régua de avisos em {clinicName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {p.enabled ? (
              <>
                <strong className="text-emerald-700 dark:text-emerald-300">Ligada</strong> desde {quando(p.changed_at)}
                {p.changed_by_name ? `, por ${p.changed_by_name}` : ""}. O Asaas avisa os pagadores conforme a régua da
                rede.
              </>
            ) : (
              <>
                <strong>Desligada.</strong> O Asaas não envia nada aos pagadores desta unidade — nem a confirmação de
                pagamento. O comprovante pode ser enviado pela ficha do paciente.
              </>
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {p.account_status !== "active" && (
            <p className="flex gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {p.account_status
                ? "A conta Asaas da unidade não está ativa: nada é aplicado no Asaas até ela voltar."
                : "A unidade ainda não tem conta Asaas: a régua só vale depois do vínculo."}
            </p>
          )}
          {semSaldo && (
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              A conta Asaas da unidade estava <strong>sem saldo</strong> na última conferência ({quando(p.balance_checked_at)}).
              O WhatsApp só sai com saldo; e-mail e SMS continuam.
            </p>
          )}
          {p.can_edit ? (
            <BotaoDaUnidade clinicId={clinicId} ligada={p.enabled} podeLigar={p.privacy_declared} motivoTravado={motivoTravado} />
          ) : (
            <p className="text-xs text-muted-foreground">Quem liga e desliga é o Admin Master ou o Financeiro da Franqueadora.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Pagadores no Asaas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Quem já teve cobrança emitida por esta unidade. O e-mail e o celular vêm da ficha (ou do responsável
            financeiro). Celular só conta quando é celular de verdade (DDD + 9 + 8 dígitos).
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numero rotulo="pagadores" valor={Number(p.payers)} />
          <Numero rotulo="sem e-mail" valor={Number(p.payers_without_email)} alerta />
          <Numero rotulo="sem celular" valor={Number(p.payers_without_mobile)} alerta />
          <Numero rotulo="pediram para não receber" valor={Number(p.payers_opted_out)} />
          <Numero rotulo="com a régua aplicada" valor={Number(p.payers_on)} />
          <Numero rotulo="esperando aplicar" valor={Number(p.payers_pending)} />
          <Numero rotulo="com erro no Asaas" valor={Number(p.payers_with_error)} alerta />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Custo estimado por mês</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pelas cobranças da unidade nos últimos 30 dias e pelos preços da conta Asaas da unidade
            {p.notification_fees_synced_at ? ` (conferidos em ${quando(p.notification_fees_synced_at)})` : " (ainda não conferidos: use Verificar agora na aba Conta e tarifas)"}.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <div className="font-medium">E-mail e SMS (mensageria)</div>
            {est.mensageria.ligada ? (
              <>
                <div className="text-xl font-semibold">{reais(est.mensageria.totalCents)}</div>
                <div className="text-xs text-muted-foreground">
                  {reais(est.mensageria.precoCents)} por cobrança paga × {est.mensageria.cobrancas} paga(s) em 30 dias.
                  Uma vez por cobrança, descontada na compensação.
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Nenhum aviso por e-mail ou SMS ligado na régua.</div>
            )}
          </div>
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <div className="font-medium">WhatsApp e ligação (por envio)</div>
            <div className="text-xl font-semibold">{reais(est.porDisparo.totalCents)}</div>
            <div className="text-xs text-muted-foreground">
              WhatsApp: {reais(est.porDisparo.whatsapp.precoCents)} × {est.porDisparo.whatsapp.avisos} aviso(s) ×{" "}
              {est.porDisparo.cobrancas} cobrança(s). Ligação: {reais(est.porDisparo.ligacao.precoCents)} ×{" "}
              {est.porDisparo.ligacao.avisos} aviso(s) × {est.porDisparo.cobrancas} cobrança(s). É o teto: os avisos de
              vencida só saem para quem não pagou.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">A régua da rede</CardTitle>
          <p className="text-sm text-muted-foreground">
            A mesma para todas as unidades.{" "}
            {p.can_edit && (
              <Link href={rotaDaRede("cobranca")} className="underline underline-offset-2">
                Alterar na Rede
              </Link>
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReguaDaRede inicial={regua} podeEditar={false} />
          {temWhats && <AvisoDoWhatsApp />}
          <ExplicacaoDoCusto />
        </CardContent>
      </Card>
    </>
  );
}
