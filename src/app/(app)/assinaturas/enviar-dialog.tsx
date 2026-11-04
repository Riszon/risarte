"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import {
  carregarContextoDeEnvio,
  concluirEnvio,
  descartarEnvio,
  prepararEnvio,
  type DialogContext,
  type DialogOrigin,
} from "./envio-actions";
import type { PrepareResult, SendResult } from "@/lib/signatures/send";
import { PdfViewer } from "@/components/pdf-viewer";
import { LinksDeAssinatura } from "./links-de-assinatura";
import { AvisoDeDuplicidade, type Duplicidade } from "./aviso-de-duplicidade";

/**
 * A JANELA "ENVIAR PARA ASSINATURA" (plano ZS0 §10), em três passos:
 *   1. o que enviar — kit ou modelos, e PDFs avulsos;
 *   2. quem assina — o cliente (ou o responsável), testemunhas, o
 *      representante da Risarte por modelo, e o que falta;
 *   3. a pré-visualização do PDF e o envio; depois, os links por canal.
 *
 * O estado vive FORA do `Dialog` (ele desmonta ao fechar): fechar no meio do
 * passo 3 descarta o rascunho criado, para não sobrar pacote pendurado.
 */

type Step = 1 | 2 | 3 | 4;

export function EnviarParaAssinaturaDialog({
  clientId,
  clinicId,
  origin,
  label = "Enviar para assinatura",
  size = "sm",
  variant = "outline",
}: {
  clientId: string;
  clinicId: string;
  origin: DialogOrigin;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [ctx, setCtx] = useState<DialogContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [kitId, setKitId] = useState<string | null>(null);
  const [witnessKeys, setWitnessKeys] = useState<string[]>([]);
  const [repKeys, setRepKeys] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [prepared, setPrepared] = useState<Extract<PrepareResult, { ok: true }> | null>(null);
  // AP108: o mesmo documento aberto (bloqueia) ou já assinado (pede confirmação).
  const [duplicidade, setDuplicidade] = useState<Duplicidade | null>(null);
  const [sent, setSent] = useState<Extract<SendResult, { ok: true }> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega o contexto ao abrir (fora de efeito: é uma ação de quem clicou).
  function carregar() {
    setCtx(null);
    setLoadError(null);
    carregarContextoDeEnvio({ clientId, clinicId, origin }).then((r) => {
      if (r.ok) {
        setCtx(r.ctx);
        // Padrão: o primeiro kit; senão, o primeiro modelo.
        const kit = r.ctx.kits[0];
        if (kit) {
          setKitId(kit.id);
          setTemplateIds(kit.templateIds);
        } else if (r.ctx.templates[0]) {
          setTemplateIds([r.ctx.templates[0].id]);
        }
        const reps: Record<string, string> = {};
        for (const t of r.ctx.templates) if (t.representative.candidates[0]) reps[t.id] = t.representative.candidates[0].key;
        setRepKeys(reps);
      } else setLoadError(r.error);
    });
  }

  function reset() {
    setStep(1);
    setDuplicidade(null);
    setPrepared(null);
    setSent(null);
    setAttachments([]);
    setWitnessKeys([]);
  }

  function onOpenChange(next: boolean) {
    if (!next && prepared && !sent) {
      // Fechou com rascunho preparado e não enviado: descarta.
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

  const selectedTemplates = useMemo(
    () => (ctx ? templateIds.map((id) => ctx.templates.find((t) => t.id === id)).filter((t): t is DialogContext["templates"][number] => !!t) : []),
    [ctx, templateIds]
  );
  const witnessesNeeded = Math.max(0, ...selectedTemplates.map((t) => t.witnessCount));
  const strongByAmount = !!ctx && selectedTemplates.some((t) => t.authLevel === "by_amount") && (ctx.treatment?.totalCents ?? 0) > ctx.thresholdCents;
  const strongByTemplate = selectedTemplates.some((t) => t.authLevel === "strong");

  const faltando: string[] = [];
  if (ctx) {
    if (ctx.client.isMinor && !ctx.client.guardianName) faltando.push("O paciente é menor de idade e não tem responsável legal cadastrado.");
    if (!ctx.client.hasCpf) faltando.push(ctx.client.isMinor ? "O responsável legal está sem CPF válido." : "O paciente está sem CPF válido no cadastro.");
    if (!ctx.client.hasContact) faltando.push(ctx.client.isMinor ? "O responsável legal precisa de telefone com DDD ou e-mail." : "O paciente precisa de telefone com DDD ou e-mail.");
    if (witnessKeys.length < witnessesNeeded) faltando.push(witnessesNeeded === 1 ? "Escolha a testemunha." : `Escolha ${witnessesNeeded} testemunhas (${witnessKeys.length} escolhida${witnessKeys.length === 1 ? "" : "s"}).`);
    for (const t of selectedTemplates) {
      if (t.representative.mode === "none") continue;
      if (!repKeys[t.id]) faltando.push(`Falta quem assina pela Risarte em "${t.name}".`);
    }
    for (const k of [...witnessKeys, ...selectedTemplates.map((t) => repKeys[t.id]).filter(Boolean)]) {
      const p = ctx.staff.find((s) => s.key === k);
      if (p && (!p.hasCpf || !p.hasContact)) faltando.push(`${p.name}: falta ${!p.hasCpf ? "CPF válido" : "telefone ou e-mail"} no cadastro da equipe.`);
    }
  }

  function toggleTemplate(id: string) {
    setKitId(null);
    setTemplateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function chooseKit(id: string) {
    const kit = ctx?.kits.find((k) => k.id === id);
    if (!kit) return;
    setKitId(id);
    setTemplateIds(kit.templateIds);
  }

  function preparar(confirmouJaAssinado = false) {
    if (!ctx) return;
    const fd = new FormData();
    if (confirmouJaAssinado) fd.set("confirmou_ja_assinado", "1");
    setDuplicidade(null);
    fd.set("client_id", clientId);
    fd.set("clinic_id", clinicId);
    fd.set("origin_type", origin.type);
    fd.set("origin_id", origin.id ?? "");
    fd.set("template_ids", JSON.stringify(templateIds));
    fd.set("witness_keys", JSON.stringify(witnessKeys));
    fd.set("representative_keys", JSON.stringify(repKeys));
    for (const f of attachments) fd.append("attachments", f);
    startTransition(async () => {
      const r = await prepararEnvio(fd);
      if (r.ok) {
        setDuplicidade(null);
        setPrepared(r);
        setStep(3);
      } else if (r.conflito) {
        setDuplicidade({ tipo: "aberto", ...r.conflito });
      } else if (r.jaAssinado) {
        setDuplicidade({ tipo: "assinado", ...r.jaAssinado });
      } else toast.error(r.error);
    });
  }

  function enviar() {
    if (!prepared) return;
    startTransition(async () => {
      const r = await concluirEnvio({ packageId: prepared.packageId, clientId });
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
            {step === 1 && "Passo 1 de 3 — o que vai no pacote."}
            {step === 2 && "Passo 2 de 3 — quem assina e em que ordem."}
            {step === 3 && "Passo 3 de 3 — confira o PDF e envie."}
            {step === 4 && "Enviado. Agora é entregar o link a cada pessoa."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {loadError && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{loadError}</p>}
          {!ctx && !loadError && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Lendo o cadastro e os modelos…
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
              {ctx.kits.length > 0 && (
                <div className="space-y-2">
                  <Label>Kit</Label>
                  <div className="flex flex-wrap gap-2">
                    {ctx.kits.map((k) => (
                      <Button key={k.id} type="button" size="sm" variant={kitId === k.id ? "default" : "outline"} onClick={() => chooseKit(k.id)}>
                        {kitId === k.id && <Check className="mr-1 size-3.5" />}
                        {k.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Documentos</Label>
                <ul className="space-y-1">
                  {ctx.templates.map((t) => {
                    const on = templateIds.includes(t.id);
                    return (
                      <li key={t.id}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                          <input type="checkbox" className="mt-0.5" checked={on} onChange={() => toggleTemplate(t.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{t.name}</span>
                            {t.isProvisional && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                texto provisório
                              </Badge>
                            )}
                            <span className="block text-xs text-muted-foreground">
                              {t.witnessCount > 0 ? `${t.witnessCount} testemunha${t.witnessCount > 1 ? "s" : ""} · ` : ""}
                              {t.authLevel === "strong" ? "autenticação reforçada" : t.authLevel === "by_amount" ? "autenticação pelo valor" : "assinatura na tela"}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {templateIds.length > 1 && <p className="text-xs text-muted-foreground">Ordem no pacote: {selectedTemplates.map((t) => t.name).join(" → ")}.</p>}
              </div>
              <div className="space-y-2">
                <Label>PDFs avulsos (opcional)</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="block w-full text-sm"
                  onChange={(e) => setAttachments(Array.from(e.target.files ?? []))}
                />
                {attachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {attachments.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(", ")} — até 8 MB cada, 10 MB no pacote inteiro.
                  </p>
                )}
              </div>
              {ctx.treatment && (
                <p className="text-xs text-muted-foreground">
                  Tratamento ligado: {ctx.treatment.procedures} procedimento{ctx.treatment.procedures === 1 ? "" : "s"}, {formatBRL(ctx.treatment.totalCents)}
                  {ctx.treatment.conditions ? ` · ${ctx.treatment.conditions}` : ""}.
                </p>
              )}
            </>
          )}

          {ctx && step === 2 && (
            <>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">1º — Pelo cliente</p>
                <p>
                  {ctx.client.isMinor ? (
                    <>
                      {ctx.client.guardianName ?? <span className="text-destructive">responsável legal não cadastrado</span>}{" "}
                      <span className="text-muted-foreground">(responsável legal — o paciente {ctx.client.name} é menor de idade)</span>
                    </>
                  ) : (
                    ctx.client.name
                  )}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  Autenticação:{" "}
                  {strongByTemplate
                    ? "reforçada (um dos modelos exige)"
                    : strongByAmount
                      ? `reforçada (valor ${formatBRL(ctx.treatment?.totalCents ?? 0)} acima do corte de ${formatBRL(ctx.thresholdCents)})`
                      : "simples (assinatura na tela)"}
                </p>
              </div>

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
                            <span className="text-xs text-muted-foreground">{s.roleLabel}{!s.hasCpf ? " · sem CPF válido" : !s.hasContact ? " · sem contato" : ""}</span>
                          </label>
                        </li>
                      );
                    })}
                    {ctx.staff.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma pessoa da equipe cadastrada nesta unidade.</li>}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <Label>{witnessesNeeded > 0 ? "3º" : "2º"} — Pela Risarte</Label>
                {selectedTemplates.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.representative.mode === "none" ? (
                      <span className="text-xs text-muted-foreground">não leva assinatura da Risarte</span>
                    ) : t.representative.candidates.length === 0 ? (
                      <span className="text-xs text-destructive">ninguém com esse papel na unidade</span>
                    ) : (
                      <select
                        className="rounded-md border bg-background px-2 py-1 text-sm"
                        value={repKeys[t.id] ?? ""}
                        onChange={(e) => setRepKeys((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      >
                        {t.representative.candidates.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} — {c.roleLabel}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>

              {faltando.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <p className="font-medium">O que falta para enviar</p>
                  <ul className="mt-1 list-disc pl-5">
                    {faltando.map((f) => (
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

{ctx && step === 2 && duplicidade && (
            <AvisoDeDuplicidade
              duplicidade={duplicidade}
              clientId={clientId}
              onTentarDeNovo={() => preparar()}
              onEnviarMesmoAssim={() => preparar(true)}
            />
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
              <Button disabled={!ctx || isPending || (templateIds.length === 0 && attachments.length === 0)} onClick={() => setStep(2)}>
                Avançar
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" disabled={isPending} onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button disabled={!ctx || isPending || faltando.length > 0} onClick={() => preparar()}>
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
