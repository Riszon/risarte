"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Gift, Trash2, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SOCIAL_TRIGGER_LABELS, type PaymentModel } from "@/lib/empresarial/constants";
import {
  CONDICAO_ROTULO,
  participaDoSocial,
  rotuloDaMeta,
  type ConquistaDaMeta,
  type MetaSocial,
} from "@/lib/empresarial/riso-social";
import { formatBrDate } from "@/lib/dates";
import { formatCpf } from "@/lib/masks";
import { MetasDoSocial, metasParaLinhas, type LinhaDeMeta } from "../metas-do-social";
import {
  aprovarIndicacao,
  generateSocialToken,
  markSocialTokenUsed,
  recusarIndicacao,
  registrarIndicacao,
  removeSocialToken,
  salvarMetasDaEmpresa,
  vincularClienteDaIndicacao,
} from "./social-actions";

export type SocialTokenView = {
  id: string;
  triggerType: string;
  /** "Meta 2" — a posição da meta que rendeu a ficha, quando ela ainda existe. */
  metaNumero: number | null;
  isPool: boolean;
  status: "AVAILABLE" | "ASSIGNED" | "USED";
  /** O nome da pessoa indicada que usa esta ficha, quando há. */
  beneficiaryName: string | null;
};

export type IndicacaoView = {
  id: string;
  nome: string;
  telefone: string | null;
  cpf: string | null;
  motivo: string | null;
  status: "IN_REVIEW" | "APPROVED" | "REJECTED";
  motivoDaDecisao: string | null;
  tokenId: string | null;
  vinculado: boolean;
  criadaEm: string;
};

export type SocialView = {
  paymentModel: PaymentModel;
  participa: boolean;
  metas: MetaSocial[];
  /** Falso quando a medida falhou — o painel diz que não mediu, nunca mostra zero. */
  medido: boolean;
  painel: (ConquistaDaMeta & { liberadas: number; aLiberar: number })[];
  tokens: SocialTokenView[];
  indicacoes: IndicacaoView[];
};

const STATUS_FICHA: Record<SocialTokenView["status"], string> = {
  AVAILABLE: "Livre",
  ASSIGNED: "Com indicação",
  USED: "Tratamento iniciado",
};

const STATUS_INDICACAO: Record<IndicacaoView["status"], string> = {
  IN_REVIEW: "Em análise",
  APPROVED: "Aprovada",
  REJECTED: "Recusada",
};

/**
 * O RISO+ SOCIAL DA EMPRESA (1034, dono em 26/10/2026).
 *
 * De cima para baixo, a ordem do trabalho: as METAS combinadas; o PAINEL do
 * que cada meta conquistou e do que já foi liberado (o gestor libera); as
 * INDICAÇÕES da empresa (registrar, analisar, vincular ao cliente); e as
 * FICHAS liberadas.
 */
export function SocialTab({
  companyId,
  social,
  podeEditar,
}: {
  companyId: string;
  social: SocialView;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [linhas, setLinhas] = useState<LinhaDeMeta[]>(metasParaLinhas(social.metas));
  const [participa, setParticipa] = useState(social.participa);
  const [editandoMetas, setEditandoMetas] = useState(false);

  const modeloPermite = participaDoSocial(social.paymentModel);
  const ativo = modeloPermite && social.participa;
  const livres = social.tokens.filter((t) => t.status === "AVAILABLE").length;

  function run(acao: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- participação e metas ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riso+ Social — metas da empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!modeloPermite ? (
            <p className="text-sm text-muted-foreground">
              Modelo <strong>“titular paga”</strong>: a empresa não participa do
              Riso+ Social. O pré-requisito é a empresa pagar a mensalidade dos
              colaboradores, integral ou parcialmente.
            </p>
          ) : !editandoMetas ? (
            <>
              <p className="text-sm text-muted-foreground">
                {!social.participa
                  ? "Combinado na proposta: esta empresa não participa."
                  : social.paymentModel === "COMPANY_PAYS"
                    ? "Modelo integral: cada ficha indica um beneficiário próprio."
                    : "Modelo parcial: as fichas entram no pool coletivo da rede."}
              </p>
              {social.participa &&
                (social.metas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma meta combinada.</p>
                ) : (
                  <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                    {social.metas.map((m) => (
                      <li key={m.id}>{rotuloDaMeta(m)}</li>
                    ))}
                  </ol>
                ))}
              {podeEditar && (
                <Button size="sm" variant="outline" onClick={() => setEditandoMetas(true)}>
                  Editar participação e metas
                </Button>
              )}
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  const r = await salvarMetasDaEmpresa(companyId, fd);
                  if (r.ok) {
                    toast.success("Metas salvas.");
                    setEditandoMetas(false);
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                });
              }}
              className="space-y-3"
            >
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="social_participates"
                  checked={participa}
                  onChange={(e) => setParticipa(e.target.checked)}
                  className="size-4"
                />
                Esta empresa participa do Riso+ Social
              </label>
              {participa && <MetasDoSocial linhas={linhas} aoMudar={setLinhas} />}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  Salvar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditandoMetas(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ---- o painel: conquistadas × liberadas ---- */}
      {ativo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">O que as metas conquistaram</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!social.medido ? (
              <p className="text-sm text-destructive">
                Não foi possível medir as metas agora. Nada foi liberado — tente
                de novo em instantes.
              </p>
            ) : social.painel.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sem metas, nada é conquistado automaticamente. A ficha avulsa,
                abaixo, continua disponível.
              </p>
            ) : (
              social.painel.map((p, i) => (
                <div key={p.meta.id} className="space-y-1.5 rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-56 flex-1">
                      <p className="text-sm font-medium">
                        Meta {i + 1}{" "}
                        <Badge variant={p.cumpre ? "secondary" : "outline"}>
                          {p.cumpre ? "Cumprida" : "Ainda não"}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.meta.indicacoes}{" "}
                        {p.meta.indicacoes === 1 ? "indicação" : "indicações"} · {p.periodo}
                      </p>
                    </div>
                    <p className="text-xs">
                      Conquistou <strong>{p.conquistadas}</strong> · liberadas{" "}
                      <strong>{p.liberadas}</strong>
                      {p.meta.renovaMeses != null ? " neste período" : ""}
                    </p>
                    {podeEditar && (
                      <Button
                        size="sm"
                        disabled={isPending || p.aLiberar === 0}
                        onClick={() =>
                          run(() => generateSocialToken(companyId, p.meta.id), "Ficha liberada.")
                        }
                      >
                        <Gift className="mr-1 size-3.5" />
                        {p.aLiberar > 0 ? `Liberar (${p.aLiberar})` : "Nada a liberar"}
                      </Button>
                    )}
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {p.condicoes.map((c) => (
                      <li key={c.condicao.tipo} className="flex items-start gap-1.5">
                        {c.cumpre ? (
                          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                        )}
                        <span>
                          <strong>{CONDICAO_ROTULO[c.condicao.tipo]}:</strong> {c.situacao}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {podeEditar && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
                <span className="text-muted-foreground">Fora das metas (exceção combinada):</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={isPending}
                  onClick={() => run(() => generateSocialToken(companyId, null), "Ficha avulsa liberada.")}
                >
                  Liberar ficha avulsa
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- as indicações ---- */}
      {ativo && (
        <Indicacoes
          companyId={companyId}
          indicacoes={social.indicacoes}
          fichasLivres={livres}
          podeEditar={podeEditar}
        />
      )}

      {/* ---- as fichas ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fichas liberadas</CardTitle>
        </CardHeader>
        <CardContent>
          {social.tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ficha liberada ainda.</p>
          ) : (
            <div className="space-y-2">
              {social.tokens.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
                >
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {t.triggerType === "GOAL"
                      ? t.metaNumero
                        ? `Meta ${t.metaNumero}`
                        : "Meta (já retirada)"
                      : (SOCIAL_TRIGGER_LABELS[t.triggerType as keyof typeof SOCIAL_TRIGGER_LABELS] ??
                        t.triggerType)}
                    <Badge variant={t.status === "USED" ? "outline" : "secondary"}>
                      {STATUS_FICHA[t.status]}
                    </Badge>
                    {t.isPool && <Badge variant="outline">Pool coletivo</Badge>}
                    {t.beneficiaryName && (
                      <span className="text-xs text-muted-foreground">— {t.beneficiaryName}</span>
                    )}
                  </p>
                  {podeEditar && (
                    <div className="flex items-center gap-1">
                      {t.status === "ASSIGNED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={isPending}
                          onClick={() =>
                            run(() => markSocialTokenUsed(companyId, t.id), "Tratamento iniciado.")
                          }
                        >
                          Tratamento iniciado
                        </Button>
                      )}
                      {t.status === "AVAILABLE" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive"
                          aria-label="Remover ficha livre"
                          disabled={isPending}
                          onClick={() => run(() => removeSocialToken(companyId, t.id), "Ficha removida.")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** As indicações: registrar, aprovar (usa ficha livre), recusar, vincular. */
function Indicacoes({
  companyId,
  indicacoes,
  fichasLivres,
  podeEditar,
}: {
  companyId: string;
  indicacoes: IndicacaoView[];
  fichasLivres: number;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [registrando, setRegistrando] = useState(false);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");

  function run(acao: () => Promise<{ ok: boolean; error?: string }>, ok: string, depois?: () => void) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(ok);
        depois?.();
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Indicações de pessoas carentes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A empresa indica; a equipe analisa. Aprovar usa uma ficha liberada e
          livre ({fichasLivres} agora). Aprovada, a pessoa é cadastrada como
          cliente pela recepção, do jeito de sempre, e vinculada aqui pelo CPF.
        </p>

        {podeEditar &&
          (registrando ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(() => registrarIndicacao(companyId, fd), "Indicação registrada.", () =>
                  setRegistrando(false)
                );
              }}
              className="grid gap-2 rounded-md border p-2 sm:grid-cols-2"
            >
              <Input name="full_name" required placeholder="Nome de quem foi indicado" className="h-8" />
              <Input name="phone" placeholder="Telefone" className="h-8" />
              <Input name="cpf" placeholder="CPF (opcional)" className="h-8" />
              <Input name="reason" placeholder="Por que precisa (resumo)" className="h-8" />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  Registrar indicação
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRegistrando(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setRegistrando(true)}>
              <UserPlus className="mr-1 size-3.5" />
              Nova indicação
            </Button>
          ))}

        {indicacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma indicação ainda.</p>
        ) : (
          <ul className="space-y-2">
            {indicacoes.map((i) => (
              <li key={i.id} className="space-y-1 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-sm font-medium">{i.nome}</p>
                  <Badge variant={i.status === "REJECTED" ? "outline" : "secondary"}>
                    {STATUS_INDICACAO[i.status]}
                  </Badge>
                  {i.status === "APPROVED" && (
                    <Badge variant="outline">{i.vinculado ? "Cliente vinculado" : "Falta vincular"}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Indicada em {formatBrDate(i.criadaEm)}
                  {i.telefone ? ` · ${i.telefone}` : ""}
                  {i.cpf ? ` · CPF ${i.cpf}` : ""}
                  {i.motivo ? ` · ${i.motivo}` : ""}
                </p>
                {i.motivoDaDecisao && (
                  <p className="text-xs">Motivo da recusa: {i.motivoDaDecisao}</p>
                )}

                {podeEditar && i.status === "IN_REVIEW" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isPending || fichasLivres === 0}
                      onClick={() => run(() => aprovarIndicacao(companyId, i.id), "Indicação aprovada.")}
                    >
                      {fichasLivres === 0 ? "Sem ficha livre para aprovar" : "Aprovar (usa 1 ficha)"}
                    </Button>
                    {recusando === i.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          run(() => recusarIndicacao(companyId, i.id, fd), "Indicação recusada.", () =>
                            setRecusando(null)
                          );
                        }}
                        className="flex flex-wrap items-center gap-1"
                      >
                        <Input name="decision_note" required placeholder="Motivo da recusa" className="h-7 w-56 text-xs" />
                        <Button type="submit" size="sm" variant="destructive" className="h-7 text-xs" disabled={isPending}>
                          Recusar
                        </Button>
                      </form>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRecusando(i.id)}>
                        Recusar…
                      </Button>
                    )}
                  </div>
                )}

                {podeEditar && i.status === "APPROVED" && !i.vinculado && (
                  vinculando === i.id ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Input
                        value={cpf}
                        onChange={(e) => setCpf(formatCpf(e.target.value))}
                        placeholder="CPF do cliente cadastrado"
                        className="h-7 w-48 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isPending || cpf.replace(/\D/g, "").length !== 11}
                        onClick={() =>
                          run(() => vincularClienteDaIndicacao(companyId, i.id, cpf), "Cliente vinculado.", () => {
                            setVinculando(null);
                            setCpf("");
                          })
                        }
                      >
                        Vincular
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setVinculando(i.id);
                        setCpf(i.cpf ?? "");
                      }}
                    >
                      Vincular ao cliente pelo CPF
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
