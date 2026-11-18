"use client";

/**
 * ASA7 (4022, spec 21.2 e 21.7) — as telas das peças do piloto: as marcas da
 * prontidão da conta (débito, permissões da chave e a sonda), o levantamento,
 * o interruptor de produção com a prontidão da rede, a cópia de outra unidade
 * e as divergências com o Asaas.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { CAPACIDADES_POR_ID } from "@/lib/permissions";
import {
  anexarConfirmacaoDoAsaas,
  copiarDeOutraUnidade,
  declararDebitoDesabilitado,
  declararPermissoesDaChave,
  ignorarDivergenciaComOAsaas,
  levantarAgora,
  ligarProducao,
  previaDaCopia,
  sondarChaveAgora,
  type Levantamento,
  type LeituraDasDivergencias,
  type Producao,
  type Resultado,
} from "@/app/(app)/central/pecas-do-piloto-actions";

const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const rodar = (f: () => Promise<Resultado>, ok: string, depois?: () => void) =>
    iniciar(async () => {
      const r = await f();
      if (!r.ok) return void toast.error(r.error ?? "Não foi possível concluir.");
      if (r.aviso) toast.warning(r.aviso, { duration: 12_000 });
      else toast.success(ok);
      depois?.();
      router.refresh();
    });
  return { pendente, rodar };
}

const Marca = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className="flex items-start gap-2">
    <span className={ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{ok ? "✓" : "•"}</span>
    <span>{children}</span>
  </li>
);

// ---- a conta: débito, chave e levantamento ---------------------------------------------------

export function PilotoDaConta({
  accountId,
  producao,
  ehFranqueadora,
  admin,
  ativa,
  debitoEm,
  permissoesEm,
  sondaEm,
  sondaOk,
  sondaDetalhe,
  levantamentos,
}: {
  accountId: string;
  producao: boolean;
  ehFranqueadora: boolean;
  admin: boolean;
  ativa: boolean;
  debitoEm: string | null;
  permissoesEm: string | null;
  sondaEm: string | null;
  sondaOk: boolean | null;
  sondaDetalhe: Record<string, string> | null;
  levantamentos: Levantamento[];
}) {
  const { pendente, rodar } = useAcao();
  const ultimo = levantamentos[0] ?? null;
  return (
    <div className="space-y-4 text-sm">
      <ul className="space-y-1.5">
        {!ehFranqueadora && (
          <Marca ok={debitoEm !== null}>
            Débito desabilitado no painel do Asaas (Minha conta › Configurações › Configurações do sistema)
            {debitoEm ? ` — marcado em ${quando(debitoEm)}.` : " — o Asaas não informa pela API: o Admin Master marca depois de desabilitar."}
          </Marca>
        )}
        <Marca ok={!producao || (permissoesEm !== null && sondaOk === true)}>
          Chave com as permissões mínimas (sem transferência, Pix enviado nem pagamento de contas)
          {!producao
            ? " — no sandbox não se aplica."
            : permissoesEm
              ? ` — marcado em ${quando(permissoesEm)}; conferido pelo riSZon em ${quando(sondaEm)}: ${sondaOk ? "as três leituras proibidas foram recusadas." : "a chave respondeu ao que não devia."}`
              : " — falta o Admin Master marcar; depois o riSZon confere sozinho."}
          {sondaDetalhe && (
            <span className="block text-xs text-muted-foreground">
              {Object.entries(sondaDetalhe).map(([k, v]) => `${k}: ${v === "recusada" ? "recusada" : v === "respondeu" ? "RESPONDEU" : "sem resposta"}`).join(" · ")}
            </span>
          )}
        </Marca>
        {!ehFranqueadora && (
          <Marca ok={!!ultimo?.ok}>
            Levantamento do que já existe no Asaas desta conta
            {ultimo ? ` — ${ultimo.ok ? "feito" : "falhou"} em ${quando(ultimo.em)}${ultimo.por ? `, por ${ultimo.por}` : ""}.` : " — ainda não feito (obrigatório antes de ligar a unidade)."}
          </Marca>
        )}
      </ul>

      {admin && ativa && (
        <div className="flex flex-wrap gap-2">
          {!ehFranqueadora && debitoEm === null && (
            <Button size="sm" variant="outline" disabled={pendente} onClick={() => rodar(() => declararDebitoDesabilitado(accountId), "Marcado.")}>
              Marcar: o débito está desabilitado
            </Button>
          )}
          {producao && permissoesEm === null && (
            <Button
              size="sm"
              variant="outline"
              disabled={pendente}
              onClick={() => {
                if (!window.confirm("Confirma que a chave de produção foi criada com SÓ as permissões mínimas (spec 21.7)? O riSZon confere em seguida.")) return;
                rodar(() => declararPermissoesDaChave(accountId), "Marcado e conferido.");
              }}
            >
              Marcar: a chave tem as permissões mínimas
            </Button>
          )}
          {producao && permissoesEm !== null && (
            <Button size="sm" variant="outline" disabled={pendente} onClick={() => rodar(() => sondarChaveAgora(accountId), "Chave conferida: as três leituras proibidas foram recusadas.")}>
              Conferir a chave agora
            </Button>
          )}
          {!ehFranqueadora && (
            <Button size="sm" variant="outline" disabled={pendente} onClick={() => rodar(() => levantarAgora(accountId), "Levantamento feito.")}>
              {pendente ? "Aguarde…" : ultimo ? "Levantar de novo" : "Levantar o que já existe no Asaas"}
            </Button>
          )}
        </div>
      )}

      {ultimo?.ok && (
        <div className="rounded-md border p-3">
          <p className="font-medium">No Asaas desta conta, sem o riSZon (só leitura)</p>
          <ul className="mt-1 space-y-0.5">
            <li>Cobranças em aberto (aguardando ou vencidas): <strong>{ultimo.cobrancas}</strong> · {formatBRL(ultimo.cobrancas_cents)}</li>
            <li>Parcelamentos: <strong>{ultimo.parcelamentos}</strong></li>
            <li>Assinaturas ativas: <strong>{ultimo.assinaturas}</strong></li>
          </ul>
          {ultimo.erro && <p className="mt-1 text-xs text-muted-foreground">{ultimo.erro}</p>}
          {ultimo.amostra.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">As mais antigas ({ultimo.amostra.length})</summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {ultimo.amostra.map((a) => (
                  <li key={a.id}>
                    {a.vencimento ?? "—"} · {a.valor != null ? formatBRL(Math.round(a.valor * 100)) : "—"} · {a.forma ?? "—"} · {a.situacao ?? "—"}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Elas entram no riSZon pela reemissão da cobrança externa e, as assinaturas, pela troca das assinaturas antigas (as duas ainda por construir).</p>
        </div>
      )}
    </div>
  );
}

// ---- a rede: o interruptor de produção -------------------------------------------------------

const ITEM_DA_REDE: Record<string, string> = {
  confirmacao_asaas: "A confirmação por escrito do Asaas sobre o uso da chave da unidade pela franqueadora (documento anexado)",
  saldo_minimo: "O saldo mínimo da franqueadora definido (Central › Rede › Taxas da franquia)",
  permissoes_cobranca: "Cobranças na matriz de permissões: ver, emitir e cancelar para o Gerente; ver e emitir para a Recepção",
  termo_privacidade: "O termo de privacidade publicado (a declaração da régua)",
  migracoes: "Todas as migrações do Asaas na produção",
};

export function InterruptorDeProducao({ producao }: { producao: Producao }) {
  const { pendente, rodar } = useAcao();
  const [motivo, setMotivo] = useState("");
  const falta = producao.prontidao.filter((p) => !p.ok);
  const podeLigar = producao.pode_mudar && !producao.ligada && falta.length === 0;
  return (
    <div className="space-y-4 text-sm">
      <p>
        Situação: <strong>{producao.ligada ? "LIGADO — contas de produção aceitas" : "DESLIGADO — o banco recusa conta de produção"}</strong>
        {producao.mudou_em && (
          <span className="text-muted-foreground"> · mudou em {quando(producao.mudou_em)}{producao.mudou_por ? ` por ${producao.mudou_por}` : ""}: “{producao.motivo}”</span>
        )}
      </p>
      <p className="text-muted-foreground">Ligar não liga nenhuma unidade: cada uma continua precisando da própria conta de produção, da prontidão completa e do “Pronta para cobrar”.</p>

      <div>
        <p className="font-medium">A prontidão da rede</p>
        <ul className="mt-1 space-y-1.5">
          {producao.prontidao.map((p) => (
            <Marca key={p.item} ok={p.ok}>
              {ITEM_DA_REDE[p.item] ?? p.item}
              {p.item === "confirmacao_asaas" && typeof p.detalhe.arquivo === "string" && p.detalhe.arquivo && ` — ${p.detalhe.arquivo}, anexado em ${quando(String(p.detalhe.em ?? ""))}.`}
              {p.item === "permissoes_cobranca" && Array.isArray(p.detalhe.faltam) && p.detalhe.faltam.length > 0 && (
                <span className="block text-xs text-muted-foreground">Falta: {(p.detalhe.faltam as string[]).map(nomeDaMarca).join("; ")}</span>
              )}
            </Marca>
          ))}
        </ul>
      </div>

      {producao.pode_mudar && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            rodar(() => anexarConfirmacaoDoAsaas(fd), "Documento anexado.", () => (e.target as HTMLFormElement).reset());
          }}
        >
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Confirmação do Asaas (PDF, PNG ou JPG; até 10 MB)</span>
            <Input type="file" name="arquivo" accept="application/pdf,image/png,image/jpeg" required className="h-9" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pendente}>
            Anexar
          </Button>
        </form>
      )}

      <details>
        <summary className="cursor-pointer font-medium">As migrações do Asaas ({producao.migracoes.filter((m) => m.na_producao).length}/{producao.migracoes.length} neste banco)</summary>
        <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
          {producao.migracoes.map((m) => (
            <li key={m.codigo} className={m.na_producao ? "" : "font-medium text-amber-800 dark:text-amber-300"}>
              {m.codigo} · {m.nome} — {m.na_producao ? "neste banco" : "FALTA"}
            </li>
          ))}
        </ul>
      </details>

      {producao.pode_mudar && (
        <div className="space-y-2 rounded-md border p-3">
          <label className="block space-y-1">
            <span className="font-medium">Motivo</span>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que ligar ou desligar (fica na auditoria)" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {!producao.ligada ? (
              <>
                <Button
                  size="sm"
                  disabled={pendente || !podeLigar || motivo.trim().length < 5}
                  onClick={() => {
                    if (!window.confirm("Ligar a produção do Asaas? A partir daí o banco aceita contas de produção. Nenhuma unidade é ligada.")) return;
                    rodar(() => ligarProducao(true, motivo), "Produção ligada.", () => setMotivo(""));
                  }}
                >
                  Ligar a produção
                </Button>
                {falta.length > 0 && <span className="text-xs text-muted-foreground">Falta a prontidão da rede: {falta.length} item(ns).</span>}
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pendente || motivo.trim().length < 5}
                onClick={() => {
                  if (!window.confirm("Desligar a produção? O banco volta a recusar conta de produção nova.")) return;
                  rodar(() => ligarProducao(false, motivo), "Produção desligada.", () => setMotivo(""));
                }}
              >
                Desligar a produção
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- copiar de outra unidade --------------------------------------------------------------------

type Previa = {
  origem: string;
  destino: string;
  comercial: { regras_origem: Record<string, unknown> | null; regras_destino: Record<string, unknown> | null; acompanhamento_origem: Record<string, unknown> | null; acompanhamento_destino: Record<string, unknown> | null };
  financeiro: { origem: Record<string, unknown> | null; destino: Record<string, unknown> | null };
  nunca: string[];
};

const valores = (o: Record<string, unknown> | null) =>
  o ? Object.entries(o).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : "usa o padrão da rede";

export function CopiarDeOutraUnidade({ destinoId, unidades }: { destinoId: string; unidades: { id: string; name: string }[] }) {
  const { pendente, rodar } = useAcao();
  const [origem, setOrigem] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [blocos, setBlocos] = useState<string[]>([]);
  const [, iniciar] = useTransition();
  const ver = (id: string) =>
    iniciar(async () => {
      setOrigem(id);
      setPrevia(null);
      if (!id) return;
      const r = await previaDaCopia(destinoId, id);
      if (!r.ok) return void toast.error(r.error);
      setPrevia(r.previa as unknown as Previa);
    });
  const alterna = (b: string) => setBlocos((x) => (x.includes(b) ? x.filter((y) => y !== b) : [...x, b]));
  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="font-medium">Copiar de</span>
        <select value={origem} onChange={(e) => ver(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="">Escolha a unidade de origem…</option>
          {unidades.filter((u) => u.id !== destinoId).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </label>
      {previa && (
        <>
          <div className="space-y-2">
            <label className="flex items-start gap-2 rounded-md border p-2">
              <input type="checkbox" checked={blocos.includes("comercial")} onChange={() => alterna("comercial")} className="mt-1" />
              <span>
                <strong>Comercial</strong> (regras e acompanhamento)
                <span className="block text-xs text-muted-foreground">De {previa.origem}: {valores(previa.comercial.regras_origem)} | {valores(previa.comercial.acompanhamento_origem)}</span>
                <span className="block text-xs text-muted-foreground">Hoje em {previa.destino}: {valores(previa.comercial.regras_destino)} | {valores(previa.comercial.acompanhamento_destino)}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-2">
              <input type="checkbox" checked={blocos.includes("financeiro")} onChange={() => alterna("financeiro")} className="mt-1" />
              <span>
                <strong>Financeiro</strong> (inclui a multa e os juros da unidade)
                <span className="block text-xs text-muted-foreground">De {previa.origem}: {valores(previa.financeiro.origem)}</span>
                <span className="block text-xs text-muted-foreground">Hoje em {previa.destino}: {valores(previa.financeiro.destino)}</span>
              </span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Nunca é copiado: {previa.nunca.join(", ")}. A régua não entra porque vale para a rede inteira. A maquininha não entra porque as adquirentes e as taxas são do contrato de cada unidade.</p>
          <Button
            size="sm"
            disabled={pendente || blocos.length === 0}
            onClick={() => {
              if (!window.confirm(`Copiar ${blocos.join(" e ")} de ${previa.origem} para ${previa.destino}? O que ${previa.destino} tem hoje nesses blocos é substituído.`)) return;
              rodar(() => copiarDeOutraUnidade(destinoId, origem, blocos), "Copiado. O histórico registra a cópia.", () => { setPrevia(null); setOrigem(""); setBlocos([]); });
            }}
          >
            Copiar
          </Button>
        </>
      )}
    </div>
  );
}

// ---- as divergências com o Asaas (Painel de cobranças) -------------------------------------------

/** "acao.cobranca.ver · Gerente" → "Cobranças: ver · Gerente" (o nome da tela). */
function nomeDaMarca(m: string): string {
  const [cap, papel] = m.split(" · ");
  return `${CAPACIDADES_POR_ID.get(cap)?.rotulo ?? cap}${papel ? ` · ${papel}` : ""}`;
}

const SITUACAO_ASAAS: Record<string, string> = {
  PENDING: "aguardando pagamento", OVERDUE: "vencida", RECEIVED: "recebida", CONFIRMED: "confirmada",
  RECEIVED_IN_CASH: "recebida em dinheiro", REFUNDED: "estornada", DELETED: "apagada", AWAITING_RISK_ANALYSIS: "em análise",
};

/** O detalhe da divergência em palavras: sem nomes técnicos nem "null". */
function detalheLegivel(d: Record<string, unknown> | null): string {
  if (!d) return "";
  const partes: string[] = [];
  if (typeof d.asaas === "string") partes.push(`no Asaas: ${SITUACAO_ASAAS[d.asaas] ?? d.asaas.toLowerCase()}`);
  if (typeof d.riszon === "string") partes.push(`no riSZon: ${d.riszon}`);
  if (typeof d.valor_asaas === "number") partes.push(`valor no Asaas: ${formatBRL(d.valor_asaas)}`);
  if (typeof d.valor_riszon === "number") partes.push(`no riSZon: ${formatBRL(d.valor_riszon)}`);
  if (typeof d.criada === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.criada)) partes.push(`criada em ${d.criada.slice(8, 10)}/${d.criada.slice(5, 7)}/${d.criada.slice(0, 4)}`);
  if (typeof d.referencia === "string" && d.referencia) partes.push(`referência: ${d.referencia}`);
  return partes.length ? `(${partes.join("; ")})` : "";
}

const TIPO: Record<string, { rotulo: string; caminho: string }> = {
  paga_no_asaas: { rotulo: "Paga no Asaas, aberta no riSZon", caminho: "O aviso do pagamento não chegou. Reprocesse o aviso em Central › Conta e tarifas, ou confira no painel do Asaas." },
  situacao_diferente: { rotulo: "Situação diferente", caminho: "Confira a cobrança no painel do Asaas e na ficha do paciente." },
  valor_diferente: { rotulo: "Valor diferente", caminho: "O valor no Asaas não é o do riSZon. Confira se a cobrança foi alterada no painel." },
  cancelada_so_no_asaas: { rotulo: "Cancelada só no Asaas", caminho: "Foi apagada no painel do Asaas. Cancele no riSZon ou emita de novo." },
  cancelada_so_no_riszon: { rotulo: "Cancelada só no riSZon", caminho: "Ainda vale no Asaas: o paciente pode pagar. Cancele no painel do Asaas." },
  sem_no_asaas: { rotulo: "Não existe no Asaas", caminho: "O Asaas não acha esta cobrança. Confira no painel e emita de novo se precisar." },
  fora_do_riszon: { rotulo: "Criada fora do riSZon", caminho: "Cobrança feita direto no painel do Asaas. Confira no painel se ela é mesmo de fora; se for da unidade, ela entra pela reemissão da cobrança externa." },
};

export function DivergenciasComOAsaas({ leitura }: { leitura: LeituraDasDivergencias }) {
  const { pendente, rodar } = useAcao();
  const abertas = leitura.divergencias.filter((d) => d.status === "aberta");
  const ignoradas = leitura.divergencias.filter((d) => d.status === "ignorada");
  const linha = (d: LeituraDasDivergencias["divergencias"][number]) => (
    <li key={d.id} className="space-y-0.5 rounded-md border p-2">
      <p>
        <strong>{TIPO[d.tipo]?.rotulo ?? d.tipo}</strong> · {d.clinica ?? "—"} · {d.valor != null ? formatBRL(d.valor) : "—"}
        <span className="text-xs text-muted-foreground"> · desde {quando(d.desde)} · Asaas {d.asaas ?? "—"}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {TIPO[d.tipo]?.caminho} {detalheLegivel(d.detalhe)}
      </p>
      {d.status === "ignorada" && <p className="text-xs">Ignorada por {d.ignorada_por ?? "—"} em {quando(d.ignorada_em)}: “{d.motivo}”</p>}
      <span className="flex flex-wrap gap-2">
        {d.cliente && (
          <Link href={`/prontuarios/${d.cliente}?aba=financeiro`} className="text-xs underline">
            Ver a ficha
          </Link>
        )}
        {leitura.pode_ignorar && d.status === "aberta" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={pendente}
            onClick={() => {
              const m = window.prompt("Por que ignorar esta divergência? (fica na auditoria)");
              if (m && m.trim().length >= 5) rodar(() => ignorarDivergenciaComOAsaas(d.id, m.trim()), "Ignorada.");
            }}
          >
            Ignorar
          </Button>
        )}
      </span>
    </li>
  );
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Toda noite o riSZon confere com o Asaas as cobranças dos últimos 3 dias e, aos domingos, todas as em aberto. Cada divergência fecha sozinha quando o problema some. Nada é baixado sozinho.
      </p>
      {abertas.length === 0 ? <p>Nenhuma divergência aberta.</p> : <ul className="space-y-2">{abertas.map(linha)}</ul>}
      {ignoradas.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Ignoradas ({ignoradas.length})</summary>
          <ul className="mt-2 space-y-2">{ignoradas.map(linha)}</ul>
        </details>
      )}
      {leitura.rodadas.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">As últimas conferências</summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {leitura.rodadas.map((r, i) => (
              <li key={i}>
                {quando(r.em)} · {r.conta} · {r.tipo} · {r.conferidas} conferidas · {r.chamadas} chamadas · {r.novas} novas · {r.abertas} abertas{r.erro ? ` · erro: ${r.erro}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
