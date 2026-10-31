"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDateTime } from "@/lib/dates";
import {
  MESSAGE_FIELDS,
  formatRecipients,
  unknownMessageFields,
  type SignatureSettings,
} from "@/lib/signatures/settings";
import { saveSignatureSettings } from "../actions";

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function SignatureSettingsForm({ settings }: { settings: SignatureSettings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState(settings.default_message);
  const desconhecidos = unknownMessageFields(message);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveSignatureSettings(fd);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Configurações salvas.");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Prazos e autenticação</CardTitle>
          <p className="text-sm text-muted-foreground">
            Acima do valor de corte, o cliente assina com selfie e código (autenticação reforçada). Abaixo, só a
            assinatura na tela.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="strong_auth_threshold">Corte da autenticação reforçada (R$)</Label>
            <Input id="strong_auth_threshold" name="strong_auth_threshold" inputMode="decimal" defaultValue={reais(settings.strong_auth_threshold_cents)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="patient_expiry_days">Validade do link — paciente (dias)</Label>
            <Input id="patient_expiry_days" name="patient_expiry_days" type="number" min={1} max={90} defaultValue={settings.patient_expiry_days} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="company_expiry_days">Validade do link — empresa (dias)</Label>
            <Input id="company_expiry_days" name="company_expiry_days" type="number" min={1} max={90} defaultValue={settings.company_expiry_days} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reconcile_after_hours">Conferir na ZapSign após (horas sem notícia)</Label>
            <Input id="reconcile_after_hours" name="reconcile_after_hours" type="number" min={1} max={168} defaultValue={settings.reconcile_after_hours} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reminder_days">Lembrar quem enviou nos dias</Label>
            <Input id="reminder_days" name="reminder_days" defaultValue={settings.reminder_days.join(", ")} placeholder="2, 5" />
            <p className="text-xs text-muted-foreground">Dias depois do envio, separados por vírgula.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="waiting_buckets_days">Faixas de espera do painel (dias)</Label>
            <Input id="waiting_buckets_days" name="waiting_buckets_days" defaultValue={settings.waiting_buckets_days.join(", ")} placeholder="2, 5, 7" />
            <p className="text-xs text-muted-foreground">Três números: até o 1º, até o 2º, até o 3º, e acima.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Plano ZapSign</CardTitle>
          <p className="text-sm text-muted-foreground">
            A ZapSign cobra cada documento ao ser criado (um pacote = um documento). O riSZon conta o consumo do
            mês e avisa os Admins ao chegar no percentual de alerta.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="zapsign_plan_name">Nome do plano</Label>
            <Input id="zapsign_plan_name" name="zapsign_plan_name" defaultValue={settings.zapsign_plan_name ?? ""} placeholder="Ex.: API Essencial" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zapsign_monthly_limit">Documentos por mês no plano</Label>
            <Input id="zapsign_monthly_limit" name="zapsign_monthly_limit" type="number" min={0} defaultValue={settings.zapsign_monthly_limit ?? ""} placeholder="Em branco = sem limite conhecido" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zapsign_alert_percent">Avisar ao atingir (%)</Label>
            <Input id="zapsign_alert_percent" name="zapsign_alert_percent" type="number" min={1} max={100} defaultValue={settings.zapsign_alert_percent} />
          </div>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" name="zapsign_emails_enabled" defaultChecked={settings.zapsign_emails_enabled} className="size-4" />
            A ZapSign manda e-mail aos signatários
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
            Desligado, quem envia manda o link pelo WhatsApp ou copia o link (padrão). Ligado, a ZapSign também avisa
            por e-mail quem tem e-mail cadastrado.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Mensagem padrão do link</CardTitle>
          <p className="text-sm text-muted-foreground">
            O texto que vai no WhatsApp junto com o link. Campos:{" "}
            {MESSAGE_FIELDS.map((f) => (
              <code key={f} className="mr-1 rounded bg-muted px-1">{`{{${f}}}`}</code>
            ))}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            id="default_message"
            name="default_message"
            className={textareaClass}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />
          {desconhecidos.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Campo que não existe: {desconhecidos.map((f) => `{{${f}}}`).join(", ")}. Ele sairia por escrito na
              mensagem.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Relatório mensal</CardTitle>
          <p className="text-sm text-muted-foreground">
            Quem recebe por e-mail, no dia 1º, o relatório do mês anterior. Uma pessoa por linha:{" "}
            <code className="rounded bg-muted px-1">Nome &lt;email@dominio.com&gt;</code> ou só o e-mail.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            id="monthly_report_recipients"
            name="monthly_report_recipients"
            className={textareaClass}
            defaultValue={formatRecipients(settings.monthly_report_recipients)}
            rows={3}
            placeholder={"Jeferson <jeferson@risarte.com.br>"}
          />
          <p className="text-xs text-muted-foreground">
            O envio por e-mail depende do serviço de e-mail estar configurado (etapa seguinte). Até lá a lista fica
            guardada.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Última alteração: {formatBrDateTime(settings.updated_at)}
        </p>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>
    </form>
  );
}
