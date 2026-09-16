"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GRAVIDADE_ROTULO,
  MODULOS,
  TIPO_ROTULO,
  moduloDaTela,
} from "@/lib/system-reports";
import { registrarProblema } from "./actions";

const ITENS_TIPO = (Object.keys(TIPO_ROTULO) as (keyof typeof TIPO_ROTULO)[]).map(
  (v) => ({ value: v, label: TIPO_ROTULO[v] })
);
const ITENS_GRAVIDADE = (
  Object.keys(GRAVIDADE_ROTULO) as (keyof typeof GRAVIDADE_ROTULO)[]
).map((v) => ({ value: v, label: GRAVIDADE_ROTULO[v] }));
const ITENS_MODULO = MODULOS.map((m) => ({ value: m.value, label: m.label }));

/**
 * O FORMULÁRIO DE RELATO.
 *
 * Mora em arquivo próprio porque vai ser aberto de dois lugares: a tela de
 * Problemas e, na Parte B, o painel lateral que abre POR CIMA da tela do
 * problema (é lá que a captura de tela precisa estar).
 *
 * O MÓDULO VEM SUGERIDO pela tela de onde a pessoa veio, mas é ela quem
 * confirma: o sistema sabe o endereço, não sabe se o problema é daquela tela
 * ou de outra que ela tinha acabado de usar.
 */
export function FormularioDeRelato({
  telaSugerida,
  digestSugerido,
  versaoAtual,
  aoRegistrar,
  aoCancelar,
}: {
  telaSugerida: string;
  digestSugerido: string;
  versaoAtual: string;
  aoRegistrar: (codigo: string) => void;
  aoCancelar: () => void;
}) {
  const [enviando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const moduloSugerido = moduloDaTela(telaSugerida);

  function enviar(fd: FormData) {
    // Lido na hora do envio, não guardado em estado: o navegador só existe do
    // lado do cliente, e perguntar por ele durante o desenho faria o servidor e
    // o navegador discordarem (a lição do `useNow`).
    fd.set("user_agent", navigator.userAgent);
    iniciar(async () => {
      const r = await registrarProblema(fd);
      if (r.ok && r.code) {
        toast.success(`Registrado como ${r.code}. Você acompanha a resposta por aqui.`);
        formRef.current?.reset();
        aoRegistrar(r.code);
      } else {
        toast.error(r.error ?? "Não foi possível registrar.");
      }
    });
  }

  return (
    <form ref={formRef} action={enviar} className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">
        Você não precisa informar quem é, a função, a unidade nem a versão — o
        sistema já sabe e envia junto (versão {versaoAtual}). Escreva só o que
        aconteceu.
      </p>

      {/* `user_agent` é acrescentado no envio, não aqui. */}
      <input type="hidden" name="error_digest" defaultValue={digestSugerido} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="kind">O que é</Label>
          <Select items={ITENS_TIPO} defaultValue="erro" name="kind">
            <SelectTrigger id="kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITENS_TIPO.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="module">Parte do sistema</Label>
          <Select
            items={ITENS_MODULO}
            defaultValue={moduloSugerido ?? undefined}
            name="module"
            required
          >
            <SelectTrigger id="module" className="w-full">
              <SelectValue placeholder="Escolha…" />
            </SelectTrigger>
            <SelectContent>
              {ITENS_MODULO.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="severity">Quanto atrapalha</Label>
          <Select items={ITENS_GRAVIDADE} defaultValue="media" name="severity">
            <SelectTrigger id="severity" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITENS_GRAVIDADE.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Resumo em uma linha</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={140}
          placeholder="Ex.: a agenda não deixa marcar no sábado"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="screen">Em que tela</Label>
        <Input
          id="screen"
          name="screen"
          defaultValue={telaSugerida}
          maxLength={120}
          placeholder="Ex.: Agenda · Financeiro → Contas a pagar"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="what_happened">O que aconteceu</Label>
        <textarea
          id="what_happened"
          name="what_happened"
          required
          rows={4}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Conte o passo a passo: o que você fez, e o que o sistema respondeu. Se apareceu uma mensagem, copie o texto dela."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expected">O que você esperava que acontecesse</Label>
        <textarea
          id="expected"
          name="expected"
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Opcional — mas é o que separa defeito de regra do sistema."
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Registrando…" : "Registrar"}
        </Button>
        <Button type="button" variant="outline" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
