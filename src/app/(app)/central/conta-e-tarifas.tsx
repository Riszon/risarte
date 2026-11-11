import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionContext } from "@/lib/auth";
import {
  ESTADO_DA_CONTA,
  MODALIDADE_DA_TARIFA,
  diasSemUsoDaChave,
  podeVincularContaPelaTela,
  situacaoNoAsaas,
} from "@/lib/central/central";
import { carregarTarifas, type ContaDaCentral, type TarifaDaCentral } from "@/lib/central/dados";
import { formatBrDateTime, formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { BotaoDeAcao, ChaveForm, DesativarForm, TermoForm } from "./conta-client";

/**
 * A ABA "CONTA E TARIFAS" de uma unidade (ou da franqueadora, no nível Rede).
 *
 * Cinco estados: sem cadastro → termo pendente → aguardando a chave → ativa →
 * com erro. A chave de API é campo só de gravação: daqui só sai "gravada em…"
 * e "último uso em…".
 */
export async function ContaETarifas({
  supabase,
  session,
  clinicId,
  clinicName,
  conta,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
  clinicId: string;
  clinicName: string;
  conta: ContaDaCentral | null;
}) {
  const admin = session.isAdminMaster;

  if (!conta) {
    return (
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Conta Asaas — {clinicName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Esta unidade ainda não tem conta Asaas cadastrada no riSZon. O cadastro nasce como conta de TESTE
            (sandbox): as contas reais só entram quando a integração for liberada para produção.
          </p>
        </CardHeader>
        <CardContent>
          {admin ? (
            <BotaoDeAcao acao="abrir" alvo={clinicId} rotulo="Abrir o cadastro da conta" sucesso="Cadastro aberto." variante="default" />
          ) : (
            <p className="text-sm text-muted-foreground">O Admin Master abre o cadastro da conta.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const podeChave = podeVincularContaPelaTela(session, conta.clinicId);
  const ehUnidade = conta.ownerType === "unit";
  const termoOk = !ehUnidade || conta.termRegisteredAt !== null;
  const estado = ESTADO_DA_CONTA[conta.status] ?? ESTADO_DA_CONTA.awaiting_key;
  const semUso = diasSemUsoDaChave(conta.apiKeyLastUsedAt);
  const tarifas = conta.temChave ? await carregarTarifas(supabase, conta.id) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Conta Asaas — {conta.label}</CardTitle>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", estado.tom)}>{estado.rotulo}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {conta.environment === "sandbox" ? "TESTE (sandbox) — nenhum dinheiro de verdade" : "Produção"}
            </span>
          </div>
          {conta.status === "error" && (
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              A última verificação falhou{conta.lastCheckError ? ` (${conta.lastCheckError})` : ""}. A unidade não está
              pronta para cobrar até a conta ser conferida: confira a chave no painel do Asaas e use Verificar agora, ou
              troque a chave.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {/* ---- Termo de autorização (só conta de unidade) ---- */}
          {ehUnidade && (
            <section className="space-y-2">
              <h3 className="font-medium">Termo de autorização do franqueado</h3>
              {conta.termRegisteredAt ? (
                <p className="text-muted-foreground">
                  Assinado em {formatIsoDateBr(conta.termSignedOn)} por {conta.termSignedByName}. Registrado em{" "}
                  {formatBrDateTime(conta.termRegisteredAt)}.{conta.termNote ? ` Observação: ${conta.termNote}` : ""}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Ainda não registrado. É o documento em que a unidade autoriza a franqueadora a operar a conta Asaas
                  dela pelo riSZon e a receber os repasses por split. Sem ele, só o Admin Master grava a chave, e a
                  unidade não fica pronta para cobrar.
                </p>
              )}
              {admin && (
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {conta.termRegisteredAt ? "Registrar de novo (substitui o anterior)" : "Registrar o termo"}
                  </summary>
                  <div className="mt-3">
                    <TermoForm accountId={conta.id} hoje={todayInBrazil()} />
                  </div>
                </details>
              )}
            </section>
          )}

          {/* ---- A chave ---- */}
          <section className="space-y-2">
            <h3 className="font-medium">Chave de API</h3>
            {conta.temChave ? (
              <p className="text-muted-foreground">
                Chave gravada em {quando(conta.apiKeySavedAt)}.{" "}
                {conta.apiKeyLastUsedAt ? `Último uso em ${formatBrDateTime(conta.apiKeyLastUsedAt)}.` : "Ainda não usada."}{" "}
                A chave não é exibida.
              </p>
            ) : (
              <p className="text-muted-foreground">Nenhuma chave gravada.</p>
            )}
            {semUso !== null && (
              <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                A chave está há {semUso} dias sem uso. O Asaas desativa a chave aos 90 dias e a expira aos 180. Use
                Verificar agora.
              </p>
            )}
            {podeChave && termoOk && (
              <details className="rounded-lg border p-3" open={!conta.temChave}>
                <summary className="cursor-pointer text-sm font-medium">
                  {conta.temChave ? "Trocar a chave" : "Gravar a chave"}
                </summary>
                <div className="mt-3">
                  <ChaveForm accountId={conta.id} troca={conta.temChave} />
                </div>
              </details>
            )}
            {podeChave && !termoOk && admin && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Gravar a chave (Admin Master, antes do termo)</summary>
                <div className="mt-3">
                  <ChaveForm accountId={conta.id} troca={conta.temChave} />
                </div>
              </details>
            )}
            {!podeChave && !conta.temChave && (
              <p className="text-muted-foreground">
                Quem grava a chave é o Admin Master — ou o Gerente da unidade, depois do termo registrado e da permissão
                liberada.
              </p>
            )}
          </section>

          {/* ---- O que o Asaas respondeu ---- */}
          {conta.temChave && (
            <section className="space-y-2">
              <h3 className="font-medium">A conta no Asaas</h3>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Linha rotulo="Titular">{conta.accountName ?? "—"}</Linha>
                <Linha rotulo="CNPJ">{conta.cnpj ?? "—"}</Linha>
                <Linha rotulo="Carteira (walletId)">
                  <span className="break-all font-mono text-xs">{conta.walletId ?? "—"}</span>
                </Linha>
                <Linha rotulo="Situação geral">{situacaoNoAsaas(conta.accountStatus?.general)}</Linha>
                <Linha rotulo="Dados comerciais">{situacaoNoAsaas(conta.accountStatus?.commercialInfo)}</Linha>
                <Linha rotulo="Conta bancária">{situacaoNoAsaas(conta.accountStatus?.bankAccountInfo)}</Linha>
                <Linha rotulo="Documentos">{situacaoNoAsaas(conta.accountStatus?.documentation)}</Linha>
                <Linha rotulo="Dados comerciais valem até">
                  {conta.commercialInfoExpiresOn ? formatIsoDateBr(conta.commercialInfoExpiresOn) : "—"}
                </Linha>
              </dl>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <BotaoDeAcao acao="verificar" alvo={conta.id} rotulo="Verificar agora" sucesso="Conta verificada." />
                <span className="text-xs text-muted-foreground">
                  {conta.lastCheckAt
                    ? `Última verificação em ${formatBrDateTime(conta.lastCheckAt)}${conta.lastCheckOk === false ? " — falhou" : ""}. `
                    : ""}
                  O riSZon verifica cada conta sozinho uma vez por semana.
                </span>
              </div>
            </section>
          )}

          {/* ---- Webhook ---- */}
          {conta.temChave && (
            <section className="space-y-2">
              <h3 className="font-medium">Webhook (o aviso de pagamento)</h3>
              {conta.temWebhook ? (
                <p className="text-muted-foreground">
                  Criado em {quando(conta.webhookCreatedAt)}.{" "}
                  {conta.webhookLastEventAt
                    ? `Último evento recebido em ${formatBrDateTime(conta.webhookLastEventAt)}.`
                    : "Nenhum evento recebido ainda."}
                </p>
              ) : (
                <p className="text-amber-800 dark:text-amber-200">
                  Ainda não foi criado. Sem ele, o riSZon não fica sabendo dos pagamentos.
                </p>
              )}
              {podeChave && (
                <BotaoDeAcao
                  acao="webhook"
                  alvo={conta.id}
                  rotulo={conta.temWebhook ? "Recriar o webhook" : "Criar o webhook"}
                  sucesso="Webhook criado no Asaas."
                />
              )}
            </section>
          )}

          {/* ---- Itens que vêm do painel do Asaas ---- */}
          {conta.temChave && (
            <section className="space-y-2">
              <h3 className="font-medium">Conferências do painel do Asaas</h3>
              <ul className="space-y-1.5">
                <Conferencia ok={conta.pixKeyActive === true} pendente={conta.pixKeyActive === null}>
                  Chave Pix cadastrada na conta
                  {conta.pixKeyActive === false && " — cadastre uma chave Pix no painel do Asaas; sem ela, o QR Code vale só até o fim do dia."}
                </Conferencia>
                <Conferencia ok={conta.anticipationAutoEnabled === false} pendente={conta.anticipationAutoEnabled === null}>
                  Antecipação automática desligada
                  {conta.anticipationAutoEnabled === true && " — está LIGADA: ela reduz o repasse do split. Desligue no painel do Asaas."}
                  {conta.anticipationAutoEnabled === null && " — o Asaas ainda não respondeu a esta consulta."}
                </Conferencia>
                <Conferencia ok={conta.splitConfirmedAt !== null || conta.splitDeclaredAt !== null} pendente={false}>
                  Split habilitado no painel (Integrações › Segurança › Habilitar Split)
                  {conta.splitConfirmedAt
                    ? " — confirmado pelo primeiro split aceito."
                    : conta.splitDeclaredAt
                      ? ` — declarado em ${formatBrDateTime(conta.splitDeclaredAt)}.`
                      : " — o Asaas não informa isto pela API: o Admin Master declara depois de habilitar no painel."}
                </Conferencia>
              </ul>
              {admin && !conta.splitConfirmedAt && (
                <BotaoDeAcao
                  acao="split"
                  alvo={conta.id}
                  valor={conta.splitDeclaredAt === null}
                  rotulo={conta.splitDeclaredAt === null ? "Declarar: o split está habilitado" : "Desfazer a declaração do split"}
                  sucesso="Declaração gravada."
                />
              )}
            </section>
          )}

          {admin && conta.status !== "disabled" && (
            <section className="border-t pt-3">
              <DesativarForm accountId={conta.id} />
            </section>
          )}
        </CardContent>
      </Card>

      {conta.temChave && <Tarifas tarifas={tarifas} sincronizadaEm={conta.feesSyncedAt} />}
    </div>
  );
}

/** Data e hora no Brasil, ou o aviso de que não foi registrada. */
const quando = (v: string | null) => (v ? formatBrDateTime(v) : "data não registrada");

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{rotulo}:</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Conferencia({ ok, pendente, children }: { ok: boolean; pendente: boolean; children: React.ReactNode }) {
  const Icone = ok ? CheckCircle2 : pendente ? CircleDashed : AlertTriangle;
  return (
    <li className="flex items-start gap-1.5">
      <Icone
        className={cn(
          "mt-0.5 size-4 shrink-0",
          ok ? "text-emerald-600 dark:text-emerald-400" : pendente ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
        )}
      />
      <span>{children}</span>
    </li>
  );
}

function faixa(t: TarifaDaCentral): string {
  if (t.modality !== "credito_parcelado") return "";
  return t.minInstallments === t.maxInstallments ? ` ${t.minInstallments}x` : ` de ${t.minInstallments}x a ${t.maxInstallments}x`;
}

function valorDaTarifa(t: TarifaDaCentral): string {
  const partes: string[] = [];
  if (t.feePercent > 0) partes.push(`${String(t.feePercent).replace(".", ",")}%`);
  if (t.fixedFeeCents > 0) partes.push(formatBRL(t.fixedFeeCents));
  if (partes.length === 0) partes.push("sem tarifa");
  let texto = partes.join(" + ");
  if (t.minFeeCents !== null || t.maxFeeCents !== null) {
    const limites = [
      t.minFeeCents !== null ? `mínimo ${formatBRL(t.minFeeCents)}` : null,
      t.maxFeeCents !== null ? `máximo ${formatBRL(t.maxFeeCents)}` : null,
    ].filter(Boolean);
    texto += ` (${limites.join(", ")})`;
  }
  return texto;
}

function vigencia(t: TarifaDaCentral, hoje: string): string {
  if (t.validFrom > hoje) return `a partir de ${formatIsoDateBr(t.validFrom)}`;
  if (t.validTo) return `promocional, até ${formatIsoDateBr(t.validTo)}`;
  return "em vigor";
}

function Tarifas({ tarifas, sincronizadaEm }: { tarifas: TarifaDaCentral[]; sincronizadaEm: string | null }) {
  const hoje = todayInBrazil();
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Tarifas do Asaas por meio de pagamento</CardTitle>
        <p className="text-sm text-muted-foreground">
          Vêm da consulta ao Asaas e são as mesmas que a baixa usa para lançar a taxa no financeiro.{" "}
          {sincronizadaEm ? `Última consulta em ${formatBrDateTime(sincronizadaEm)}.` : "Ainda não consultadas."} Tarifa
          que muda fecha a vigência da anterior; nada é sobrescrito.
        </p>
      </CardHeader>
      <CardContent>
        {tarifas.length === 0 ? (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Nenhuma tarifa cadastrada para esta conta. Use Verificar agora para buscar no Asaas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Meio de pagamento</th>
                  <th className="py-1.5 pr-3 font-medium">Tarifa</th>
                  <th className="py-1.5 pr-3 font-medium">Cai em</th>
                  <th className="py-1.5 pr-3 font-medium">Vigência</th>
                  <th className="py-1.5 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {tarifas.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      {MODALIDADE_DA_TARIFA[t.modality] ?? t.modality}
                      {faixa(t)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {valorDaTarifa(t)}
                      {t.freeMonthlyCount ? ` · ${t.freeMonthlyCount} grátis por mês` : ""}
                    </td>
                    <td className="py-1.5 pr-3">{t.settlementDays === 0 ? "na hora" : `${t.settlementDays} dia(s)`}</td>
                    <td className="py-1.5 pr-3">{vigencia(t, hoje)}</td>
                    <td className="py-1.5">{t.source === "gateway" ? "Asaas" : "digitada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
