"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileSignature, FileText, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import { formatCpf, formatPhone, isValidCpf } from "@/lib/masks";
import { normalizar } from "@/lib/busca";
import type { PrepareResult, SendResult } from "@/lib/signatures/send";
import { PdfViewer } from "@/components/pdf-viewer";
import { descartarEnvio } from "./envio-actions";
import {
  carregarContextoDaEmpresa,
  concluirEnvioDaEmpresa,
  prepararEnvioDaEmpresa,
  type EmpresaDialogContext,
} from "./envio-empresa-actions";
import { LinksDeAssinatura } from "./links-de-assinatura";

/**
 * A JANELA "ENVIAR PARA ASSINATURA" DA EMPRESA (ZS5, plano ZS0 §4.6), no
 * formato da do paciente:
 *   1. o que vai — o contrato de adesão (montado com a proposta salva, sempre
 *      o primeiro) e os anexos NA ORDEM escolhida: PDFs do computador e
 *      arquivos já guardados na aba Documentos da empresa. Tudo vira UM
 *      documento na ZapSign (capa com índice, rubrica em toda página, uma
 *      assinatura de cada pessoa no fim) — e quem assina pela empresa;
 *   2. testemunhas e quem assina pela Risarte;
 *   3. a pré-visualização e o envio; depois, os links por canal.
 *
 * Decisões do dono (02/11/2026): campo em branco no contrato BLOQUEIA; aviso
 * não bloqueia, mas pede a confirmação de que foi lido; o nome de quem assina
 * pela Risarte diferente do que o texto cita gera aviso.
 *
 * O estado vive FORA do `Dialog`: fechar com o rascunho preparado e não
 * enviado o descarta (vira cancelado; pacote nunca se apaga).
 */

type Step = 1 | 2 | 3 | 4;
type Origin = { type: "commercial_lead" | "company"; id: string };

/** Um anexo na lista do pacote, na ordem em que vai entrar. */
type Anexo =
  | { key: string; origem: "computador"; nome: string; file: File }
  | { key: string; origem: "guardado"; nome: string; tipo: string; arquivoId: string };

const comoNome = (s: string) => normalizar(s).replace(/\s+/g, " ").trim();

export function EnviarEmpresaParaAssinaturaDialog({
  origin,
  label = "Enviar para assinatura",
  size = "sm",
  variant = "default",
}: {
  origin: Origin;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [ctx, setCtx] = useState<EmpresaDialogContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incluirContrato, setIncluirContrato] = useState(false);
  const [avisosLidos, setAvisosLidos] = useState(false);
  const [rep, setRep] = useState({ name: "", cpf: "", email: "", phone: "" });
  const [witnessKeys, setWitnessKeys] = useState<string[]>([]);
  const [repKey, setRepKey] = useState<string>("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [prepared, setPrepared] = useState<Extract<PrepareResult, { ok: true }> | null>(null);
  const [sent, setSent] = useState<Extract<SendResult, { ok: true }> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function carregar() {
    setCtx(null);
    setLoadError(null);
    carregarContextoDaEmpresa({ origin }).then((r) => {
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setCtx(r.ctx);
      setIncluirContrato(r.ctx.contrato.disponivel);
      setRep({
        name: r.ctx.representante.name,
        cpf: r.ctx.representante.cpf ? formatCpf(r.ctx.representante.cpf) : "",
        email: r.ctx.representante.email,
        phone: r.ctx.representante.phone ? formatPhone(r.ctx.representante.phone) : "",
      });
      setRepKey(r.ctx.risarte.candidates[0]?.key ?? "");
    });
  }

  function reset() {
    setStep(1);
    setPrepared(null);
    setSent(null);
    setAnexos([]);
    setWitnessKeys([]);
    setAvisosLidos(false);
  }

  function onOpenChange(next: boolean) {
    if (!next && prepared && !sent) {
      const id = prepared.packageId;
      startTransition(async () => {
        await descartarEnvio({ packageId: id });
      });
    }
    if (!next) {
      if (sent) router.refresh();
      reset();
    }
    setOpen(next);
    if (next) carregar();
  }

  const witnessesNeeded = ctx?.template.witnessCount ?? 0;
  const contrato = ctx?.contrato;
  const faltandoPasso1: string[] = [];
  const faltandoPasso2: string[] = [];
  if (ctx) {
    if (!incluirContrato && anexos.length === 0) faltandoPasso1.push("Escolha o contrato de adesão ou inclua ao menos um documento.");
    if (anexos.length > 10) faltandoPasso1.push("No máximo 10 anexos por pacote.");
    if (incluirContrato && contrato?.disponivel && contrato.faltando.length > 0) {
      faltandoPasso1.push("O contrato tem campos em branco (lista abaixo): complete a proposta antes de enviar.");
    }
    if (incluirContrato && contrato?.disponivel && contrato.avisos.length > 0 && !avisosLidos) {
      faltandoPasso1.push("Confirme que leu os avisos do contrato.");
    }
    if (!rep.name.trim()) faltandoPasso1.push("Falta o nome de quem assina pela empresa.");
    if (!isValidCpf(rep.cpf)) faltandoPasso1.push("O CPF de quem assina pela empresa não é válido.");
    if (!(rep.phone.replace(/\D/g, "").length >= 10 || rep.email.trim())) {
      faltandoPasso1.push("Quem assina pela empresa precisa de telefone com DDD ou e-mail.");
    }

    if (witnessKeys.length < witnessesNeeded) {
      faltandoPasso2.push(witnessesNeeded === 1 ? "Escolha a testemunha." : `Escolha ${witnessesNeeded} testemunhas (${witnessKeys.length} escolhida${witnessKeys.length === 1 ? "" : "s"}).`);
    }
    if (ctx.risarte.mode !== "none" && !repKey) faltandoPasso2.push("Falta quem assina pela Risarte.");
    for (const k of [...witnessKeys, repKey].filter(Boolean)) {
      const p = ctx.staff.find((s) => s.key === k);
      if (p && (!p.hasCpf || !p.hasContact)) faltandoPasso2.push(`${p.name}: falta ${!p.hasCpf ? "CPF válido" : "telefone ou e-mail"} no cadastro da equipe.`);
    }
  }
  const escolhidoRisarte = ctx?.risarte.candidates.find((c) => c.key === repKey) ?? null;
  const nomeDiferente =
    !!ctx?.contratadaRepName &&
    !!escolhidoRisarte &&
    incluirContrato &&
    comoNome(ctx.contratadaRepName) !== comoNome(escolhidoRisarte.name);

  function mover(i: number, delta: -1 | 1) {
    setAnexos((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const lista = [...prev];
      [lista[i], lista[j]] = [lista[j], lista[i]];
      return lista;
    });
  }

  function preparar() {
    const fd = new FormData();
    fd.set("origin_type", origin.type);
    fd.set("origin_id", origin.id);
    fd.set("incluir_contrato", incluirContrato ? "1" : "0");
    fd.set("avisos_lidos", avisosLidos ? "1" : "0");
    fd.set("rep_name", rep.name);
    fd.set("rep_cpf", rep.cpf);
    fd.set("rep_email", rep.email);
    fd.set("rep_phone", rep.phone);
    fd.set("witness_keys", JSON.stringify(witnessKeys));
    fd.set("representative_key", repKey);
    // Os arquivos do computador vão em "attachments"; a ordem de TODOS os
    // anexos (computador e guardados) vai em "anexos_ordem".
    const ordem: ({ origem: "computador"; indice: number } | { origem: "guardado"; id: string })[] = [];
    let indice = 0;
    for (const a of anexos) {
      if (a.origem === "computador") {
        fd.append("attachments", a.file);
        ordem.push({ origem: "computador", indice: indice++ });
      } else ordem.push({ origem: "guardado", id: a.arquivoId });
    }
    fd.set("anexos_ordem", JSON.stringify(ordem));
    startTransition(async () => {
      const r = await prepararEnvioDaEmpresa(fd);
      if (r.ok) {
        setPrepared(r);
        setStep(3);
      } else toast.error(r.error);
    });
  }

  function enviar() {
    if (!prepared) return;
    startTransition(async () => {
      const r = await concluirEnvioDaEmpresa({ packageId: prepared.packageId, origin, incluiuContrato: incluirContrato, temAnexos: anexos.length > 0 });
      if (r.ok) {
        setSent(r);
        setStep(4);
        toast.success(`Pacote ${r.number} enviado.`);
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size={size} variant={variant}>
            <FileSignature className="mr-1 size-3.5" />
            {label}
          </Button>
        }
      />
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar para assinatura digital</DialogTitle>
          <DialogDescription>
            {step === 1 && "Passo 1 de 3 — o que vai e quem assina pela empresa."}
            {step === 2 && "Passo 2 de 3 — testemunhas e quem assina pela Risarte."}
            {step === 3 && "Passo 3 de 3 — confira o PDF e envie."}
            {step === 4 && "Enviado. Agora é entregar o link a cada pessoa."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {loadError && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{loadError}</p>}
          {!ctx && !loadError && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Lendo a proposta e o contrato…
            </p>
          )}

          {ctx && step === 1 && (
            <>
              {!ctx.zapsign.configured && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  A ZapSign não está configurada neste ambiente. Dá para montar o pacote, mas o envio vai recusar até o Admin cadastrar o token.
                </p>
              )}
              {ctx.zapsign.fake && (
                <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
                  Ambiente de teste: a ZapSign é simulada — ninguém recebe nada e os links não abrem.
                </p>
              )}
              <p className="text-sm">
                Empresa: <span className="font-medium">{ctx.companyName}</span>
              </p>

              <div className="space-y-2">
                <Label>Documentos</Label>
                {ctx.contrato.disponivel ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                    <input type="checkbox" className="mt-0.5" checked={incluirContrato} onChange={(e) => setIncluirContrato(e.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{ctx.contrato.titulo}</span>
                      <span className="block text-xs text-muted-foreground">
                        Montado com a proposta salva e a data de hoje, com o Anexo I. {ctx.template.witnessCount > 0 ? `${ctx.template.witnessCount} testemunha${ctx.template.witnessCount > 1 ? "s" : ""}.` : ""}
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="rounded-md border p-2 text-xs text-muted-foreground">{ctx.contrato.motivo}</p>
                )}
                {incluirContrato && ctx.contrato.disponivel && ctx.contrato.faltando.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <p className="font-medium text-destructive">O contrato sairia com estas linhas em branco — complete a proposta antes:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {ctx.contrato.faltando.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {incluirContrato && ctx.contrato.disponivel && ctx.contrato.avisos.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-medium">Leia antes de enviar — onde a proposta não cabe no texto do modelo:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {ctx.contrato.avisos.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2">
                      <input type="checkbox" checked={avisosLidos} onChange={(e) => setAvisosLidos(e.target.checked)} />
                      Li os avisos e o texto está certo para esta empresa.
                    </label>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Documentos do pacote</Label>
                <p className="text-xs text-muted-foreground">
                  Tudo vira <strong>um documento só</strong> na ZapSign: capa com o índice, rubrica em todas as páginas
                  e cada pessoa assina uma vez, no fim. O contrato de adesão vai primeiro; os outros, na ordem abaixo.
                </p>
                {anexos.length > 0 && (
                  <ol className="space-y-1">
                    {anexos.map((a, i) => (
                      <li key={a.key} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                        <span className="w-5 text-right text-xs text-muted-foreground">{(incluirContrato ? 2 : 1) + i}º</span>
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {a.nome}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {a.origem === "computador" ? `· do computador (${(a.file.size / 1024 / 1024).toFixed(1)} MB)` : `· ${a.tipo}, da aba Documentos`}
                          </span>
                        </span>
                        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Descer" disabled={i === anexos.length - 1} onClick={() => mover(i, 1)}>
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Tirar do pacote" onClick={() => setAnexos((prev) => prev.filter((x) => x.key !== a.key))}>
                          <X className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="space-y-1">
                  <p className="text-xs font-medium">Incluir do computador (PDF, até 8 MB cada, 10 MB no pacote)</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="block w-full text-sm"
                    onChange={(e) => {
                      const novos = Array.from(e.target.files ?? []).map((file, j) => ({
                        key: `pc:${Date.now()}:${j}:${file.name}`,
                        origem: "computador" as const,
                        nome: file.name.replace(/\.pdf$/i, ""),
                        file,
                      }));
                      setAnexos((prev) => [...prev, ...novos]);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium">Incluir da aba Documentos da empresa</p>
                  {!ctx.temEmpresa ? (
                    <p className="text-xs text-muted-foreground">A empresa ainda não foi cadastrada: os documentos guardados aparecem aqui depois do fechamento.</p>
                  ) : ctx.arquivosGuardados.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum PDF guardado na aba Documentos desta empresa.</p>
                  ) : (
                    <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                      {ctx.arquivosGuardados.map((g) => {
                        const ja = anexos.some((a) => a.origem === "guardado" && a.arquivoId === g.id);
                        return (
                          <li key={g.id}>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={ja}
                                onChange={() =>
                                  setAnexos((prev) =>
                                    ja
                                      ? prev.filter((a) => !(a.origem === "guardado" && a.arquivoId === g.id))
                                      : [...prev, { key: `doc:${g.id}`, origem: "guardado", nome: g.nome.replace(/\.pdf$/i, ""), tipo: g.tipo, arquivoId: g.id }]
                                  )
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">{g.nome}</span>
                              <span className="text-xs text-muted-foreground">{g.tipo}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">1º — Pela empresa</p>
                <p className="text-xs text-muted-foreground">
                  Veio do responsável da proposta{ctx.representante.role ? ` (${ctx.representante.role})` : ""}. Corrigir aqui vale só para este envio.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="rep-name">Nome</Label>
                    <Input id="rep-name" value={rep.name} onChange={(e) => setRep((r) => ({ ...r, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rep-cpf">CPF</Label>
                    <Input id="rep-cpf" inputMode="numeric" value={rep.cpf} onChange={(e) => setRep((r) => ({ ...r, cpf: formatCpf(e.target.value) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rep-phone">Celular (WhatsApp)</Label>
                    <Input id="rep-phone" inputMode="tel" value={rep.phone} onChange={(e) => setRep((r) => ({ ...r, phone: formatPhone(e.target.value) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rep-email">E-mail</Label>
                    <Input id="rep-email" type="email" value={rep.email} onChange={(e) => setRep((r) => ({ ...r, email: e.target.value }))} />
                  </div>
                </div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  Autenticação: {ctx.template.authLevel === "strong" ? "reforçada (o modelo exige)" : "simples (assinatura na tela)"}
                </p>
              </div>

              {faltandoPasso1.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
                  {faltandoPasso1.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {ctx && step === 2 && (
            <>
              {witnessesNeeded > 0 && (
                <div className="space-y-2">
                  <Label>
                    2º — Testemunhas ({witnessKeys.length} de {witnessesNeeded})
                  </Label>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {ctx.staff.map((s) => {
                      const on = witnessKeys.includes(s.key);
                      const disabled = !on && witnessKeys.length >= witnessesNeeded;
                      return (
                        <li key={s.key}>
                          <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={disabled}
                              onChange={() => setWitnessKeys((prev) => (on ? prev.filter((k) => k !== s.key) : [...prev, s.key]))}
                            />
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {s.roleLabel}
                              {!s.hasCpf ? " · sem CPF válido" : !s.hasContact ? " · sem contato" : ""}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                    {ctx.staff.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma pessoa da equipe cadastrada na Franqueadora.</li>}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <Label>{witnessesNeeded > 0 ? "3º" : "2º"} — Pela Risarte</Label>
                {ctx.risarte.mode === "none" ? (
                  <p className="text-xs text-muted-foreground">O modelo não leva assinatura da Risarte.</p>
                ) : ctx.risarte.candidates.length === 0 ? (
                  <p className="text-xs text-destructive">Ninguém com o papel definido no modelo (Assinaturas → Configurações → Modelos).</p>
                ) : (
                  <select className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={repKey} onChange={(e) => setRepKey(e.target.value)}>
                    {ctx.risarte.candidates.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name} — {c.roleLabel}
                      </option>
                    ))}
                  </select>
                )}
                {nomeDiferente && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    O texto do contrato diz que a Risarte é representada por <strong>{ctx.contratadaRepName}</strong>, mas quem vai assinar é{" "}
                    <strong>{escolhidoRisarte?.name}</strong>. Confira em Risarte Empresarial → Configurações → Contrato antes de enviar.
                  </p>
                )}
              </div>

              {faltandoPasso2.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <p className="font-medium">O que falta para enviar</p>
                  <ul className="mt-1 list-disc pl-5">
                    {faltandoPasso2.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                O link vale {ctx.expiryDays} dias. Cada pessoa só recebe a vez depois que a anterior assinou.
              </p>
            </>
          )}

          {ctx && step === 3 && prepared && (
            <>
              <p className="text-sm">
                Pacote <span className="font-mono font-medium">{prepared.number}</span> · {prepared.pageCount} página{prepared.pageCount === 1 ? "" : "s"} · válido até{" "}
                {formatBrDate(prepared.expiresAt)} · autenticação {prepared.authReason}.
              </p>
              <div className="h-[52vh]">
                <PdfViewer url={prepared.previewUrl} />
              </div>
              <ul className="text-xs text-muted-foreground">
                {prepared.signers.map((s, i) => (
                  <li key={i}>
                    {s.order_group}º — {s.name} ({s.qualification})
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 4 && sent && (
            <LinksDeAssinatura
              links={sent.links.map((l, i) => ({
                key: String(i),
                name: l.name,
                qualification: l.qualification,
                orderGroup: l.order_group,
                notYet: l.order_group !== 1,
                signUrl: l.signUrl,
                phone: l.phone,
                message: l.message,
              }))}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button disabled={!ctx || isPending || faltandoPasso1.length > 0} onClick={() => setStep(2)}>
                Avançar
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" disabled={isPending} onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button disabled={!ctx || isPending || faltandoPasso2.length > 0} onClick={preparar}>
                {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                Gerar a pré-visualização
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  const id = prepared?.packageId;
                  setPrepared(null);
                  setStep(2);
                  if (id) startTransition(async () => void (await descartarEnvio({ packageId: id })));
                }}
              >
                Voltar
              </Button>
              <Button disabled={isPending || !ctx?.zapsign.configured} onClick={enviar}>
                {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                Enviar para assinatura
              </Button>
            </>
          )}
          {step === 4 && <Button onClick={() => onOpenChange(false)}>Concluir</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
