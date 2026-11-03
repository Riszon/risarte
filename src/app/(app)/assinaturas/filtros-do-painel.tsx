import { FilterForm } from "@/components/filter-form";
import { ATALHOS, ROTULO_DO_ATALHO, type FiltrosDoPainel, type OpcoesDosFiltros } from "@/lib/signatures/painel-dados";

/** Os filtros do painel e da página de relatórios (ZS7): os mesmos, na URL. */
export function Filtros({ f, opcoes, alcance, extra }: { f: FiltrosDoPainel; opcoes: OpcoesDosFiltros; alcance: "rede" | "unidade"; extra?: React.ReactNode }) {
  const sel = "rounded-md border bg-background px-2 py-1.5";
  const campo = (rotulo: string, filho: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      {filho}
    </label>
  );
  return (
    <FilterForm className="flex flex-wrap items-end gap-3 text-sm">
      {campo(
        "Período",
        <select name="periodo" defaultValue={f.atalho} className={sel}>
          {ATALHOS.map((a) => (
            <option key={a} value={a}>
              {ROTULO_DO_ATALHO[a]}
            </option>
          ))}
        </select>
      )}
      {f.atalho === "personalizado" && (
        <>
          {campo("De", <input type="date" name="de" defaultValue={f.periodo.de} className={sel} />)}
          {campo("Até", <input type="date" name="ate" defaultValue={f.periodo.ate} className={sel} />)}
        </>
      )}
      {(alcance === "rede" || opcoes.unidades.length > 1) &&
        campo(
          "Unidade",
          <select name="unidade" defaultValue={f.clinicId ?? ""} className={`${sel} max-w-56`}>
            <option value="">{alcance === "rede" ? "Toda a rede" : "Todas as minhas"}</option>
            {opcoes.unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        )}
      {campo(
        "Público",
        <select name="publico" defaultValue={f.audience ?? ""} className={sel}>
          <option value="">Todos</option>
          <option value="patient">Pacientes</option>
          <option value="company">Empresas</option>
        </select>
      )}
      {campo(
        "Documento",
        <select name="modelo" defaultValue={f.templateId ?? ""} className={`${sel} max-w-56`}>
          <option value="">Todos</option>
          {opcoes.modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      )}
      {opcoes.remetentes.length > 0 &&
        campo(
          "Quem enviou",
          <select name="enviou" defaultValue={f.sentBy ?? ""} className={`${sel} max-w-56`}>
            <option value="">Todos</option>
            {opcoes.remetentes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        )}
      {extra}
    </FilterForm>
  );
}

