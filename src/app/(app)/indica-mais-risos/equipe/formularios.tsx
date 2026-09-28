"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseBRLToCents } from "@/lib/pricing";
import {
  GRUPOS_PREMIO,
  GRUPO_PREMIO_LABEL,
  METRICAS,
  METRICA_LABEL,
  PREMIO_TIPOS,
  PREMIO_TIPO_LABEL,
  validarFaixas,
  type Faixa,
  type GrupoPremio,
  type Metrica,
  type PremioTipo,
} from "@/lib/indica/metas";
import { aprovarApuracao, apurarMeta, criarMeta, encerrarMeta } from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type LinhaFaixa = {
  nome: string;
  gatilho: string;
  premios: Record<GrupoPremio, { tipo: PremioTipo; valor: string; descricao: string }>;
};

const paraLinha = (f: Faixa): LinhaFaixa => ({
  nome: f.nome,
  gatilho: String(f.gatilho),
  premios: Object.fromEntries(
    GRUPOS_PREMIO.map((g) => [
      g,
      {
        tipo: f.premios[g].tipo,
        valor: (f.premios[g].valor_centavos / 100).toFixed(2).replace(".", ","),
        descricao: f.premios[g].descricao ?? "",
      },
    ])
  ) as LinhaFaixa["premios"],
});

function paraFaixa(l: LinhaFaixa): Faixa {
  return {
    nome: l.nome,
    gatilho: Number(l.gatilho.replace(",", ".")),
    premios: Object.fromEntries(
      GRUPOS_PREMIO.map((g) => {
        const p = l.premios[g];
        return [
          g,
          {
            tipo: p.tipo,
            valor_centavos: p.valor.trim() === "" ? 0 : (parseBRLToCents(p.valor) ?? Number.NaN),
            ...(p.descricao.trim() ? { descricao: p.descricao.trim() } : {}),
          },
        ];
      })
    ) as Faixa["premios"],
  };
}

export function NovaMetaDialog({
  unidadeId,
  unidadeNome,
  faixasPadrao,
  travaPadrao,
  mesInicio,
  mesFim,
  campanhas,
}: {
  unidadeId: string;
  unidadeNome: string;
  faixasPadrao: Faixa[];
  travaPadrao: number | null;
  mesInicio: string;
  mesFim: string;
  campanhas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [gravando, gravar] = useTransition();
  const [periodoTipo, setPeriodoTipo] = useState<"mes" | "trimestre" | "campanha">("mes");
  const [inicio, setInicio] = useState(mesInicio);
  const [fim, setFim] = useState(mesFim);
  const [metrica, setMetrica] = useState<Metrica>("conversoes");
  const [campanhaId, setCampanhaId] = useState("");
  const [trava, setTrava] = useState(travaPadrao === null ? "" : String(travaPadrao));
  const [faixas, setFaixas] = useState<LinhaFaixa[]>(faixasPadrao.map(paraLinha));

  const mudar = (i: number, f: (l: LinhaFaixa) => LinhaFaixa) =>
    setFaixas(faixas.map((l, j) => (j === i ? f(l) : l)));

  function salvar() {
    const lidas = faixas.map(paraFaixa);
    const erro = validarFaixas(lidas);
    if (erro) {
      toast.error(erro);
      return;
    }
    gravar(async () => {
      const r = await criarMeta({ unidadeId, periodoTipo, inicio, fim, metrica, campanhaId, trava, faixas: lidas });
      if (r.ok) {
        toast.success("Meta criada e ativa.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm"><Plus className="mr-1 size-4" />Nova meta</Button>} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova meta da equipe — {unidadeNome}</DialogTitle>
          <DialogDescription>
            As faixas já vêm com o modelo da rede: ajuste antes de salvar. Só contam indicações
            CONVERTIDAS (passaram da carência) com fechamento no período.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="periodo-tipo">Período</Label>
              <select id="periodo-tipo" value={periodoTipo} onChange={(e) => setPeriodoTipo(e.target.value as typeof periodoTipo)} className={selectClass}>
                <option value="mes">Mês</option>
                <option value="trimestre">Trimestre</option>
                <option value="campanha">Campanha</option>
              </select>
            </div>
            <div>
              <Label htmlFor="inicio">De</Label>
              <Input id="inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fim">Até</Label>
              <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="metrica">Métrica</Label>
              <select id="metrica" value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)} className={selectClass}>
                {METRICAS.map((m) => (
                  <option key={m} value={m}>{METRICA_LABEL[m]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {periodoTipo === "campanha" && (
              <div>
                <Label htmlFor="campanha">Campanha</Label>
                <select id="campanha" value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)} className={selectClass}>
                  <option value="">Escolha…</option>
                  {campanhas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="trava">Trava de qualidade: comparecimento mínimo (%)</Label>
              <Input id="trava" inputMode="decimal" value={trava} onChange={(e) => setTrava(e.target.value)} placeholder="sem trava" />
              <p className="mt-1 text-xs text-muted-foreground">
                Abaixo disso nenhuma faixa é paga — evita encher o funil de indicação que não vem.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Faixas</p>
            {faixas.map((l, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                  <Input aria-label="Nome da faixa" value={l.nome} onChange={(e) => mudar(i, (x) => ({ ...x, nome: e.target.value }))} />
                  <Input aria-label="Gatilho" inputMode="decimal" value={l.gatilho} onChange={(e) => mudar(i, (x) => ({ ...x, gatilho: e.target.value }))} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Tirar faixa" onClick={() => setFaixas(faixas.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GRUPOS_PREMIO.map((g) => (
                    <div key={g} className="space-y-1">
                      <p className="text-xs text-muted-foreground">{GRUPO_PREMIO_LABEL[g]}</p>
                      <div className="grid grid-cols-2 gap-1">
                        <select
                          aria-label={`Tipo do prêmio — ${GRUPO_PREMIO_LABEL[g]}`}
                          value={l.premios[g].tipo}
                          onChange={(e) => mudar(i, (x) => ({ ...x, premios: { ...x.premios, [g]: { ...x.premios[g], tipo: e.target.value as PremioTipo } } }))}
                          className={selectClass}
                        >
                          {PREMIO_TIPOS.map((t) => (
                            <option key={t} value={t}>{PREMIO_TIPO_LABEL[t]}</option>
                          ))}
                        </select>
                        <Input
                          aria-label={`Valor (R$) — ${GRUPO_PREMIO_LABEL[g]}`}
                          inputMode="decimal"
                          value={l.premios[g].valor}
                          onChange={(e) => mudar(i, (x) => ({ ...x, premios: { ...x.premios, [g]: { ...x.premios[g], valor: e.target.value } } }))}
                        />
                      </div>
                      <Input
                        aria-label={`Observação — ${GRUPO_PREMIO_LABEL[g]}`}
                        placeholder="observação (opcional)"
                        value={l.premios[g].descricao}
                        onChange={(e) => mudar(i, (x) => ({ ...x, premios: { ...x.premios, [g]: { ...x.premios[g], descricao: e.target.value } } }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setFaixas([
                  ...faixas,
                  {
                    nome: `Faixa ${faixas.length + 1}`,
                    gatilho: "",
                    premios: {
                      recepcao_crc: { tipo: "dinheiro", valor: "", descricao: "" },
                      demais: { tipo: "voucher", valor: "", descricao: "" },
                    },
                  },
                ])
              }
            >
              <Plus className="mr-1 size-4" /> Faixa
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Prêmio em dinheiro vira RELATÓRIO para a folha na aprovação — nada vai ao Financeiro até o OK
            do contador.
          </p>
          <div className="flex justify-end">
            <Button onClick={salvar} disabled={gravando}>{gravando ? "Salvando…" : "Criar meta"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BotoesMeta({ id, podeFinal, ativa }: { id: string; podeFinal: boolean; ativa: boolean }) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const fazer = (f: () => Promise<{ ok: true } | { ok: false; error: string }>, sucesso: string) =>
    gravar(async () => {
      const r = await f();
      if (r.ok) {
        toast.success(sucesso);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" disabled={gravando}
        onClick={() => fazer(() => apurarMeta(id, "provisoria"), "Apuração provisória registrada.")}>
        Apurar agora (provisória)
      </Button>
      {podeFinal && (
        <Button size="sm" disabled={gravando}
          onClick={() => fazer(() => apurarMeta(id, "final"), "Apuração final registrada — aguarda aprovação.")}>
          Apuração final
        </Button>
      )}
      {ativa && (
        <Button size="sm" variant="ghost" disabled={gravando}
          onClick={() => fazer(() => encerrarMeta(id), "Meta encerrada.")}>
          Encerrar meta
        </Button>
      )}
    </div>
  );
}

export function AprovarApuracao({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [gravando, gravar] = useTransition();
  const decidir = (aprovar: boolean) =>
    gravar(async () => {
      const r = await aprovarApuracao(id, aprovar, motivo);
      if (r.ok) {
        toast.success(aprovar ? "Apuração aprovada — relatório para a folha pronto." : "Apuração reprovada.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm">Aprovar / reprovar</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apuração final</DialogTitle>
          <DialogDescription>
            Aprovar congela a lista de premiados e os valores. Reprovar exige motivo e permite apurar de novo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="motivo-ap">Motivo (obrigatório para reprovar)</Label>
            <Input id="motivo-ap" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={gravando} onClick={() => decidir(false)}>Reprovar</Button>
            <Button disabled={gravando} onClick={() => decidir(true)}>Aprovar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
