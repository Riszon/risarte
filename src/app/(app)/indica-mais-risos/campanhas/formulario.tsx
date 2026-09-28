"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import { addDaysIso } from "@/lib/dates";
import {
  lerRegras,
  marcosEmTexto,
  reducaoDeRegras,
  resumoRegras,
  type ModeloCampanha,
  type PublicoCampanha,
  type RegrasCampanha,
} from "@/lib/indica/campanhas";
import { salvarCampanha, simularCampanha, type DadosCampanha, type Simulacao } from "./actions";
import type { Opcao } from "./opcoes";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const textareaClass = "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";

export type CampanhaInicial = {
  id: string;
  nome: string;
  descricao: string | null;
  modelo: string | null;
  escopo: "rede" | "unidades";
  unidades: string[];
  inicioInput: string;
  fimInput: string;
  regras: RegrasCampanha;
  publico: PublicoCampanha;
  especialidade: string | null;
  orcamento_max_centavos: number | null;
  beneficio_indicado: { descricao?: string } | null;
  regulamento_md: string | null;
  /** Já começou: o banco só aceita ampliar. */
  comecou: boolean;
};

const reais = (c: number | null | undefined) =>
  c ? (c / 100).toFixed(2).replace(".", ",") : "";

/** Soma dias a um valor de `datetime-local` sem passar pelo fuso da máquina. */
function somarDias(input: string, dias: number): string {
  const [data, hora = "00:00"] = input.split("T");
  return `${addDaysIso(data, dias)}T${hora}`;
}

function Marcaveis({
  nome,
  opcoes,
  marcados,
  onChange,
  disabled,
}: {
  nome: string;
  opcoes: Opcao[];
  marcados: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {opcoes.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={nome}
            value={o.id}
            disabled={disabled}
            checked={marcados.includes(o.id)}
            onChange={(e) => onChange(e.target.checked ? [...marcados, o.id] : marcados.filter((x) => x !== o.id))}
          />
          {o.nome}
        </label>
      ))}
    </div>
  );
}

export function FormularioCampanha({
  inicial,
  opcoes,
  agoraInput,
}: {
  inicial?: CampanhaInicial;
  opcoes: {
    franqueadora: boolean;
    modelos: ModeloCampanha[];
    niveis: Opcao[];
    especialidades: string[];
    empresas: Opcao[];
    unidades: Opcao[];
  };
  agoraInput: string;
}) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const [simulando, simular] = useTransition();
  const bloqueado = inicial?.comecou ?? false;

  const [modelo, setModelo] = useState(inicial?.modelo ?? "");
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [escopo, setEscopo] = useState<"rede" | "unidades">(
    inicial?.escopo ?? (opcoes.franqueadora ? "rede" : "unidades")
  );
  const [unidades, setUnidades] = useState<string[]>(
    inicial?.unidades ?? (opcoes.unidades.length === 1 ? [opcoes.unidades[0].id] : [])
  );
  const [inicio, setInicio] = useState(inicial?.inicioInput ?? agoraInput);
  const [fim, setFim] = useState(inicial?.fimInput ?? somarDias(agoraInput, 30));
  const [mult, setMult] = useState(inicial?.regras.multiplicador ? String(inicial.regras.multiplicador).replace(".", ",") : "");
  const [extra, setExtra] = useState({
    registro: String(inicial?.regras.pontos_extra?.registro ?? ""),
    comparecimento: String(inicial?.regras.pontos_extra?.comparecimento ?? ""),
    fechamento: String(inicial?.regras.pontos_extra?.fechamento ?? ""),
  });
  const [marcos, setMarcos] = useState(marcosEmTexto(inicial?.regras.marcos));
  const [niveis, setNiveis] = useState<string[]>(inicial?.publico.niveis ?? []);
  const [especialidades, setEspecialidades] = useState<string[]>(inicial?.publico.especialidades ?? []);
  const [empresas, setEmpresas] = useState<string[]>(inicial?.publico.empresas ?? []);
  const [alvo, setAlvo] = useState(inicial?.especialidade ?? "");
  const [orcamento, setOrcamento] = useState(reais(inicial?.orcamento_max_centavos));
  const [beneficio, setBeneficio] = useState(inicial?.beneficio_indicado?.descricao ?? "");
  const [regulamento, setRegulamento] = useState(inicial?.regulamento_md ?? "");
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  function aplicarModelo(m: ModeloCampanha) {
    setModelo(m.codigo);
    if (!nome.trim()) setNome(m.nome);
    if (!descricao.trim()) setDescricao(m.descricao);
    setMult(m.regras.multiplicador ? String(m.regras.multiplicador).replace(".", ",") : "");
    setExtra({
      registro: String(m.regras.pontos_extra?.registro ?? ""),
      comparecimento: String(m.regras.pontos_extra?.comparecimento ?? ""),
      fechamento: String(m.regras.pontos_extra?.fechamento ?? ""),
    });
    setMarcos(marcosEmTexto(m.regras.marcos));
    setFim(somarDias(inicio, m.dias));
    setSimulacao(null);
  }

  const dados = (): DadosCampanha => ({
    nome,
    descricao,
    modelo,
    escopo,
    unidades,
    inicio,
    fim,
    regras: { multiplicador: mult, ...extra, marcos },
    publico: { niveis, especialidades, empresas },
    especialidade: alvo,
    orcamento,
    beneficioIndicado: beneficio,
    regulamento,
  });

  const lidas = lerRegras({ multiplicador: mult, ...extra, marcos });
  const reduziu = bloqueado && inicial && lidas.ok ? reducaoDeRegras(inicial.regras, lidas.valor) : null;

  function onSimular() {
    simular(async () => {
      const r = await simularCampanha(dados());
      if (r.ok) setSimulacao(r.simulacao);
      else toast.error(r.error);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reduziu) {
      toast.error(`Campanha em andamento não pode reduzir ${reduziu}. Encerre e crie outra.`);
      return;
    }
    gravar(async () => {
      const r = await salvarCampanha(dados(), inicial?.id);
      if (r.ok) {
        toast.success(inicial ? "Campanha atualizada (nova versão)." : "Rascunho criado. Confira e publique.");
        router.push(`/indica-mais-risos/campanhas/${r.id}`);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!inicial && opcoes.modelos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4" /> 1. Comece por um modelo (ou preencha do zero)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {opcoes.modelos.map((m) => (
              <button
                key={m.codigo}
                type="button"
                onClick={() => aplicarModelo(m)}
                className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted ${modelo === m.codigo ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="block text-sm font-medium">{m.nome}</span>
                <span className="block text-xs text-muted-foreground">{m.descricao}</span>
                <span className="mt-1 block text-xs">{resumoRegras(m.regras).join(" · ")} · {m.dias} dias</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {bloqueado && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          A campanha já começou: dá para <strong>ampliar</strong> a vantagem, estender o fim, mudar o
          orçamento e o regulamento. Público, unidades e começo ficam como estão — quem entrou, entrou
          com a regra dele.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">2. Nome, onde e quando</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="nome">Nome *</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="escopo">Abrangência</Label>
              <select id="escopo" value={escopo} disabled={bloqueado || !opcoes.franqueadora}
                onChange={(e) => setEscopo(e.target.value as "rede" | "unidades")} className={selectClass}>
                {opcoes.franqueadora && <option value="rede">Rede toda</option>}
                <option value="unidades">Unidades escolhidas</option>
              </select>
            </div>
            <div>
              <Label htmlFor="inicio">Começa em *</Label>
              <Input id="inicio" type="datetime-local" value={inicio} disabled={bloqueado} onChange={(e) => setInicio(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="fim">Termina em *</Label>
              <Input id="fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} required />
            </div>
          </div>
          {escopo === "unidades" && (
            <fieldset>
              <legend className="text-sm font-medium">Unidades</legend>
              <Marcaveis nome="unidades" opcoes={opcoes.unidades} marcados={unidades} onChange={setUnidades} disabled={bloqueado} />
            </fieldset>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">3. A vantagem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="mult">Multiplicador</Label>
              <Input id="mult" inputMode="decimal" placeholder="ex.: 2" value={mult} onChange={(e) => setMult(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="x-registro">+ no registro</Label>
              <Input id="x-registro" inputMode="numeric" value={extra.registro} onChange={(e) => setExtra({ ...extra, registro: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="x-comparecimento">+ no comparecimento</Label>
              <Input id="x-comparecimento" inputMode="numeric" value={extra.comparecimento} onChange={(e) => setExtra({ ...extra, comparecimento: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="x-fechamento">+ no fechamento</Label>
              <Input id="x-fechamento" inputMode="numeric" value={extra.fechamento} onChange={(e) => setExtra({ ...extra, fechamento: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="marcos">Bônus por marco (conversões:bônus)</Label>
            <Input id="marcos" placeholder="ex.: 3:300, 5:600" value={marcos} onChange={(e) => setMarcos(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              O bônus cai quando o Embaixador chega à N-ª conversão DENTRO da campanha.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            O multiplicador não soma com o do nível: vale o maior. Se houver mais de uma campanha para o
            mesmo Embaixador, entra sozinha a mais vantajosa.
          </p>
          {lidas.ok ? (
            <p className="text-sm">{resumoRegras(lidas.valor).join(" · ")}</p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-300">{lidas.error}</p>
          )}
          {reduziu && <p className="text-sm text-destructive">Não dá para reduzir {reduziu} de campanha em andamento.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">4. Para quem (nada marcado = todos)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Níveis do Embaixador</legend>
            <Marcaveis nome="niveis" opcoes={opcoes.niveis} marcados={niveis} onChange={setNiveis} disabled={bloqueado} />
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Tratamento que o Embaixador fechou (especialidade)</legend>
            <Marcaveis
              nome="especialidades"
              opcoes={opcoes.especialidades.map((e) => ({ id: e, nome: e }))}
              marcados={especialidades}
              onChange={setEspecialidades}
              disabled={bloqueado}
            />
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Empresa do Risarte Empresarial</legend>
            {opcoes.empresas.length > 0 ? (
              <Marcaveis nome="empresas" opcoes={opcoes.empresas} marcados={empresas} onChange={setEmpresas} disabled={bloqueado} />
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma empresa ativa visível para você.</p>
            )}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="alvo">Especialidade-alvo do fechamento (opcional)</Label>
              <select id="alvo" value={alvo} disabled={bloqueado} onChange={(e) => setAlvo(e.target.value)} className={selectClass}>
                <option value="">Qualquer tratamento</option>
                {opcoes.especialidades.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Com alvo, a vantagem no FECHAMENTO só vale se a venda do indicado tiver essa especialidade.
              </p>
            </div>
            <div>
              <Label htmlFor="beneficio">Benefício ao indicado (texto do convite)</Label>
              <Input id="beneficio" value={beneficio} onChange={(e) => setBeneficio(e.target.value)}
                placeholder="ex.: avaliação com brinde de boas-vindas" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">5. Orçamento, custo e regulamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="orcamento">Orçamento máximo (R$)</Label>
              <Input id="orcamento" inputMode="decimal" placeholder="sem teto" value={orcamento} onChange={(e) => setOrcamento(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                Avisa ao passar do % configurado; em 100% a campanha deixa de entrar em indicações novas.
              </p>
            </div>
            <div className="flex items-end">
              <Button type="button" variant="outline" onClick={onSimular} disabled={simulando}>
                <Calculator className="mr-1 size-4" /> {simulando ? "Simulando…" : "Simular custo pelo histórico"}
              </Button>
            </div>
          </div>
          {simulacao && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p>
                Pelo histórico de {simulacao.historico_dias} dias ({simulacao.historico_indicacoes} indicações;
                comparecimento {simulacao.taxa_comparecimento ?? "—"}%, fechamento {simulacao.taxa_fechamento ?? "—"}%),
                o período deve ter cerca de <strong>{String(simulacao.previstas.indicacoes).replace(".", ",")}</strong> indicações,{" "}
                {String(simulacao.previstas.comparecimentos).replace(".", ",")} comparecimentos e{" "}
                {String(simulacao.previstas.fechamentos).replace(".", ",")} fechamentos.
              </p>
              <p className="mt-1">
                Riso Coins: {simulacao.riso_coins_sem_campanha} sem campanha → <strong>{simulacao.riso_coins_com_campanha}</strong> com
                campanha. Custo extra estimado: <strong>{formatBRL(simulacao.custo_extra_centavos)}</strong> (total{" "}
                {formatBRL(simulacao.custo_total_centavos)}).
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Estimativa pela média: não conta bônus de marco, bônus sobre valor fechado nem o efeito da própria
                campanha em trazer mais indicações.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="regulamento">Regulamento da campanha</Label>
            <textarea id="regulamento" value={regulamento} onChange={(e) => setRegulamento(e.target.value)} className={textareaClass} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Voltar</Button>
        <Button type="submit" disabled={gravando || Boolean(reduziu)}>
          {gravando ? "Salvando…" : inicial ? "Salvar alterações" : "Criar rascunho"}
        </Button>
      </div>
    </form>
  );
}
