"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/roles";
import { AUTH_LEVEL_LABEL } from "@/lib/signatures/modelos-ui";
import type { RisarteSignerMode, SignatureTemplate, TemplateAuthLevel, TemplateBody } from "@/lib/signatures/types";
import { CAMPOS_DO_PACIENTE, camposDesconhecidos, camposPermitidos } from "@/lib/signatures/variables";
import { saveSignatureTemplate } from "../../../actions";

/**
 * O EDITOR DE UM MODELO (ZS2): o texto (preâmbulo, cláusulas, fecho), as
 * regras (autenticação, testemunhas, quem assina pela Risarte) e os selos.
 * O campo `{{…}}` desconhecido é avisado aqui e recusado no servidor.
 */

const EMPTY_BODY: TemplateBody = { preamble: "", sections: [{ title: "", body: "" }], closing: "" };

export function TemplateForm({ template }: { template: SignatureTemplate }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState<TemplateBody>(template.body ?? EMPTY_BODY);
  const [authLevel, setAuthLevel] = useState<TemplateAuthLevel>(template.auth_level);
  const [witnessCount, setWitnessCount] = useState(template.witness_count);
  const [mode, setMode] = useState<RisarteSignerMode>(template.risarte_signer_mode);
  const [role, setRole] = useState<UserRole | "owner">(template.risarte_signer_role ? (template.risarte_signer_role as UserRole) : "owner");
  const [isActive, setIsActive] = useState(template.is_active);
  const [provisional, setProvisional] = useState(template.is_provisional_text);
  const external = template.source !== null;

  const desconhecidos = useMemo(() => camposDesconhecidos(body, template.audience), [body, template.audience]);
  const permitidos = camposPermitidos(template.audience);

  function updateSection(i: number, patch: Partial<TemplateBody["sections"][number]>) {
    setBody((b) => ({ ...b, sections: b.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }
  function moveSection(i: number, dir: -1 | 1) {
    setBody((b) => {
      const s = [...b.sections];
      const j = i + dir;
      if (j < 0 || j >= s.length) return b;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...b, sections: s };
    });
  }

  function submit() {
    const fd = new FormData();
    fd.set("id", template.id);
    fd.set("name", name);
    fd.set("body", JSON.stringify(body));
    fd.set("auth_level", authLevel);
    fd.set("witness_count", String(witnessCount));
    fd.set("risarte_signer_mode", mode);
    fd.set("risarte_signer_role", mode === "role" && role !== "owner" ? role : "");
    fd.set("risarte_signer_user_id", mode === "user" ? (template.risarte_signer_user_id ?? "") : "");
    fd.set("is_active", isActive ? "true" : "false");
    fd.set("is_provisional_text", provisional ? "true" : "false");
    startTransition(async () => {
      const r = await saveSignatureTemplate(fd);
      if (r.ok) {
        toast.success("Modelo salvo.");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regras do modelo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="tpl-name">Nome do documento</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-auth">Autenticação do cliente</Label>
            <select id="tpl-auth" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={authLevel} onChange={(e) => setAuthLevel(e.target.value as TemplateAuthLevel)}>
              {(Object.keys(AUTH_LEVEL_LABEL) as TemplateAuthLevel[]).map((k) => (
                <option key={k} value={k}>
                  {AUTH_LEVEL_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-witness">Testemunhas</Label>
            <select id="tpl-witness" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={witnessCount} onChange={(e) => setWitnessCount(Number(e.target.value))}>
              <option value={0}>Nenhuma</option>
              <option value={1}>1 testemunha</option>
              <option value={2}>2 testemunhas</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-mode">Quem assina pela Risarte</Label>
            <select id="tpl-mode" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as RisarteSignerMode)}>
              <option value="role">Alguém com um papel na unidade</option>
              <option value="sender">Quem envia</option>
              {mode === "user" && <option value="user">Pessoa fixa (cadastrada)</option>}
              <option value="none">Ninguém (sem assinatura da Risarte)</option>
            </select>
          </div>
          {mode === "role" && (
            <div className="space-y-1">
              <Label htmlFor="tpl-role">O papel</Label>
              <select id="tpl-role" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as UserRole | "owner")}>
                <option value="owner">Titular (Admin Principal)</option>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Modelo ativo (aparece na janela de envio)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} /> Texto provisório (marca d&apos;água no PDF)
          </label>
        </CardContent>
      </Card>

      {external ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            O texto deste modelo vem do contrato do Risarte Empresarial (Configurações → Contrato). Aqui só as regras acima.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Texto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="tpl-preamble">Preâmbulo</Label>
              <textarea id="tpl-preamble" className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={body.preamble} onChange={(e) => setBody((b) => ({ ...b, preamble: e.target.value }))} />
            </div>
            {body.sections.map((s, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input value={s.title} placeholder="Título da cláusula" onChange={(e) => updateSection(i, { title: e.target.value })} />
                  <Button type="button" size="sm" variant="ghost" aria-label="Subir" onClick={() => moveSection(i, -1)} disabled={i === 0}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label="Descer" onClick={() => moveSection(i, 1)} disabled={i === body.sections.length - 1}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label="Remover" onClick={() => setBody((b) => ({ ...b, sections: b.sections.filter((_, j) => j !== i) }))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <textarea className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={s.body} onChange={(e) => updateSection(i, { body: e.target.value })} />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setBody((b) => ({ ...b, sections: [...b.sections, { title: "", body: "" }] }))}>
              <Plus className="mr-1 size-4" /> Cláusula
            </Button>
            <div className="space-y-1">
              <Label htmlFor="tpl-closing">Fecho</Label>
              <textarea id="tpl-closing" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={body.closing} onChange={(e) => setBody((b) => ({ ...b, closing: e.target.value }))} />
            </div>
            {desconhecidos.length > 0 && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                Campo que o sistema não conhece: {desconhecidos.map((c) => `{{${c}}}`).join(", ")}. Use só os da lista abaixo.
              </p>
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Campos que o sistema preenche</p>
              <div className="flex flex-wrap gap-1">
                {(template.audience === "patient" ? CAMPOS_DO_PACIENTE.map((c) => ({ chave: c.chave, rotulo: c.rotulo })) : permitidos.map((c) => ({ chave: c, rotulo: c }))).map((c) => (
                  <Badge key={c.chave} variant="outline" className="font-mono text-[10px]" title={c.rotulo}>
                    {`{{${c.chave}}}`}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={isPending || !name.trim() || desconhecidos.length > 0}>
          {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
          Salvar modelo
        </Button>
      </div>
    </div>
  );
}
