"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ESCOPOS,
  ESCOPO_AJUDA,
  ESCOPO_ROTULO,
  GATILHOS,
  GATILHO_AJUDA,
  GATILHO_ROTULO,
  MODOS_DE_GRUPO,
  MODO_AJUDA,
  MODO_ROTULO,
  type ConfiguracaoDoPortao,
  type Escopo,
  type ModoDeGrupo,
  type ParticipanteDoGrupo,
} from "@/lib/certificacao";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { salvarPortao } from "./actions";

/** Uma opção de escolha única, com a frase que explica o que ela faz. */
function Opcao({
  name,
  value,
  rotulo,
  ajuda,
  defaultChecked,
  onChange,
}: {
  name: string;
  value: string;
  rotulo: string;
  ajuda: string;
  defaultChecked: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border border-input p-3 hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        onChange={(e) => e.currentTarget.checked && onChange?.(value)}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">{rotulo}</span>
        <span className="block text-sm text-muted-foreground">{ajuda}</span>
      </span>
    </label>
  );
}

/**
 * Os dois eixos do documento — e, quando a liberação é COLETIVA, a lista de
 * quem participa (0272).
 *
 * ⚠️ A lista aparece só no modo coletivo, porque é só nele que ela significa
 * alguma coisa. Mostrá-la sempre faria o Admin montar um grupo que não está
 * valendo e achar que estava.
 */
export function PortaoEditor({
  atual,
  cargosElegiveis: cargos,
  pessoas,
  cargosNoGrupo,
  pessoasNoGrupo,
}: {
  atual: ConfiguracaoDoPortao;
  cargosElegiveis: readonly UserRole[];
  pessoas: ParticipanteDoGrupo[];
  cargosNoGrupo: string[];
  pessoasNoGrupo: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [escopo, setEscopo] = useState<Escopo>(atual.release_scope);
  const [modo, setModo] = useState<ModoDeGrupo>(atual.cohort_mode);

  const coletiva = escopo === "coletiva";
  const marcados = modo === "papeis" ? cargosNoGrupo.length : pessoasNoGrupo.length;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarPortao(formData);
      if (r.ok) {
        toast.success("Regras de liberação salvas.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Como a liberação acontece</CardTitle>
        <CardDescription>
          Duas escolhas independentes: de quem depende a liberação, e o que
          acontece quando a missão é cumprida.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                De quem depende a liberação
              </legend>
              {ESCOPOS.map((op) => (
                <Opcao
                  key={op}
                  name="release_scope"
                  value={op}
                  rotulo={ESCOPO_ROTULO[op]}
                  ajuda={ESCOPO_AJUDA[op]}
                  defaultChecked={atual.release_scope === op}
                  onChange={(v) => setEscopo(v as Escopo)}
                />
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                O que acontece ao cumprir
              </legend>
              {GATILHOS.map((op) => (
                <Opcao
                  key={op}
                  name="release_trigger"
                  value={op}
                  rotulo={GATILHO_ROTULO[op]}
                  ajuda={GATILHO_AJUDA[op]}
                  defaultChecked={atual.release_trigger === op}
                />
              ))}
            </fieldset>
          </div>

          {coletiva && (
            <div className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <div>
                <h3 className="text-sm font-medium">
                  Quem participa do teste coletivo
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  A liberação da unidade espera <strong>estas pessoas</strong>.
                  Quem não estiver aqui não trava ninguém — e é isso que evita
                  que alguém de férias segure a unidade inteira.
                </p>
              </div>

              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Como escolher os participantes</legend>
                {MODOS_DE_GRUPO.map((op) => (
                  <Opcao
                    key={op}
                    name="cohort_mode"
                    value={op}
                    rotulo={MODO_ROTULO[op]}
                    ajuda={MODO_AJUDA[op]}
                    defaultChecked={atual.cohort_mode === op}
                    onChange={(v) => setModo(v as ModoDeGrupo)}
                  />
                ))}
              </fieldset>

              {modo === "papeis" ? (
                cargos.length === 0 ? (
                  <p className="rounded-md bg-amber-500/10 p-3 text-sm">
                    Nenhum cargo pode ser escolhido ainda:{" "}
                    <strong>só entra no grupo o cargo que tem missão</strong>.
                    Defina as metas abaixo primeiro — cargo sem meta nasceria
                    aprovado e não mediria nada.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {cargos.map((papel) => (
                      <label
                        key={papel}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
                      >
                        <input
                          type="checkbox"
                          name="cohort_roles"
                          value={papel}
                          defaultChecked={cargosNoGrupo.includes(papel)}
                          className="size-4 shrink-0 accent-primary"
                        />
                        {ROLE_LABELS[papel]}
                      </label>
                    ))}
                  </div>
                )
              ) : pessoas.length === 0 ? (
                <p className="rounded-md bg-amber-500/10 p-3 text-sm">
                  Nenhum Risartano ativo para escolher.
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-input p-2">
                  {pessoas.map((p) => (
                    <label
                      key={p.user_id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40 has-[:checked]:bg-accent/60"
                    >
                      <input
                        type="checkbox"
                        name="cohort_members"
                        value={p.user_id}
                        defaultChecked={pessoasNoGrupo.includes(p.user_id)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {p.full_name ?? "(sem nome)"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {marcados === 0 && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  ⚠️ Nenhum participante marcado. Grupo vazio{" "}
                  <strong>não significa &quot;todo mundo&quot;</strong> — significa
                  configuração incompleta, e a liberação coletiva não vai
                  acontecer até alguém ser escolhido.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar regras"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
