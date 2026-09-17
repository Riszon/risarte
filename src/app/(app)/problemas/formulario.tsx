"use client";

import { useId, useRef, useState, useTransition } from "react";
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
import {
  SeletorDeAnexos,
  avisarEnvio,
  enviarAnexos,
  type AnexoPendente,
} from "./anexos";

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
 * Mora em arquivo próprio porque é aberto de dois lugares: a tela de Problemas
 * e o painel lateral da boia, que abre POR CIMA da tela do problema (é lá que
 * a captura de tela precisa estar). Por isso as colunas seguem a largura do
 * PRÓPRIO formulário (`@container`), não a da janela, e os ids dos campos são
 * únicos — os dois podem estar na mesma página.
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
  esconder,
  mostrar,
  silencioso = false,
}: {
  telaSugerida: string;
  digestSugerido: string;
  versaoAtual: string;
  aoRegistrar: (codigo: string) => void;
  aoCancelar: () => void;
  /** O painel lateral sai da frente durante a captura de tela. */
  esconder?: () => void;
  mostrar?: () => void;
  /** Quem abriu o formulário dá o próprio aviso de sucesso (o painel dá um com link). */
  silencioso?: boolean;
}) {
  const [enviando, iniciar] = useTransition();
  const [anexos, setAnexos] = useState<AnexoPendente[]>([]);
  const [etapa, setEtapa] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const campo = (nome: string) => `${uid}-${nome}`;
  const moduloSugerido = moduloDaTela(telaSugerida);

  function enviar(fd: FormData) {
    // Lido na hora do envio, não guardado em estado: o navegador só existe do
    // lado do cliente, e perguntar por ele durante o desenho faria o servidor e
    // o navegador discordarem (a lição do `useNow`).
    fd.set("user_agent", navigator.userAgent);
    iniciar(async () => {
      setEtapa("Registrando…");
      const r = await registrarProblema(fd);
      if (r.ok && r.code) {
        // O relato vem antes dos anexos: é o id dele que dá o endereço do
        // arquivo. Se um anexo falhar, o relato continua registrado — o texto
        // da pessoa não se perde por causa de um print.
        if (anexos.length > 0 && r.id) {
          setEtapa(`Enviando ${anexos.length === 1 ? "o anexo" : `${anexos.length} anexos`}…`);
          avisarEnvio(await enviarAnexos(r.id, null, anexos));
          setAnexos([]);
        }
        setEtapa(null);
        if (!silencioso) {
          toast.success(`Registrado como ${r.code}. Você acompanha a resposta por aqui.`);
        }
        formRef.current?.reset();
        aoRegistrar(r.code);
      } else {
        setEtapa(null);
        toast.error(r.error ?? "Não foi possível registrar.");
      }
    });
  }

  return (
    <form ref={formRef} action={enviar} className="@container space-y-4 rounded-lg border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">
        Você não precisa informar quem é, a função, a unidade nem a versão — o
        sistema já sabe e envia junto (versão {versaoAtual}). Escreva só o que
        aconteceu.
      </p>

      {/* `user_agent` é acrescentado no envio, não aqui. */}
      <input type="hidden" name="error_digest" defaultValue={digestSugerido} />

      <div className="grid gap-4 @xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={campo("kind")}>O que é</Label>
          <Select items={ITENS_TIPO} defaultValue="erro" name="kind">
            <SelectTrigger id={campo("kind")} className="w-full">
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
          <Label htmlFor={campo("module")}>Parte do sistema</Label>
          <Select
            items={ITENS_MODULO}
            defaultValue={moduloSugerido ?? undefined}
            name="module"
            required
          >
            <SelectTrigger id={campo("module")} className="w-full">
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
          <Label htmlFor={campo("severity")}>Quanto atrapalha</Label>
          <Select items={ITENS_GRAVIDADE} defaultValue="media" name="severity">
            <SelectTrigger id={campo("severity")} className="w-full">
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
        <Label htmlFor={campo("title")}>Resumo em uma linha</Label>
        <Input
          id={campo("title")}
          name="title"
          required
          maxLength={140}
          placeholder="Ex.: a agenda não deixa marcar no sábado"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={campo("screen")}>Em que tela</Label>
        <Input
          id={campo("screen")}
          name="screen"
          defaultValue={telaSugerida}
          maxLength={120}
          placeholder="Ex.: Agenda · Financeiro → Contas a pagar"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={campo("what_happened")}>O que aconteceu</Label>
        <textarea
          id={campo("what_happened")}
          name="what_happened"
          required
          rows={4}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Conte o passo a passo: o que você fez, e o que o sistema respondeu. Se apareceu uma mensagem, copie o texto dela."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={campo("expected")}>O que você esperava que acontecesse</Label>
        <textarea
          id={campo("expected")}
          name="expected"
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Opcional — mas é o que separa defeito de regra do sistema."
        />
      </div>

      <div className="space-y-1.5">
        <Label>Mostrar o problema</Label>
        <SeletorDeAnexos
          pendentes={anexos}
          aoMudar={setAnexos}
          esconder={esconder}
          mostrar={mostrar}
          desabilitado={enviando}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? (etapa ?? "Registrando…") : "Registrar"}
        </Button>
        <Button type="button" variant="outline" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
