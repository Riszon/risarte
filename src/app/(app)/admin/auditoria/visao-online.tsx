import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lerTodasAsPaginas } from "@/lib/paginar";
import {
  SITUACAO_EXPLICA,
  SITUACAO_ROTULO,
  detalheDaPessoa,
  lerPresenca,
  lerResumo,
  nomeDaTela,
  porSituacao,
  rotuloDasFuncoes,
  type PessoaNaPresenca,
  type Situacao,
} from "@/lib/quem-esta-online";
import { enderecoDaVisao, hora, type Banco } from "./comum";
import { AtualizarSozinho } from "./atualizar-sozinho";

// QUEM ESTÁ ONLINE, na Auditoria (0291). A lista inteira: online, ausentes,
// quem entrou hoje e não está conectado, e quem ainda não entrou.
//
// Desenhada no servidor, como as outras visões; um pedaço mínimo no navegador
// (`AtualizarSozinho`) pede a página de novo a cada minuto.

const COR: Record<Situacao, string> = {
  online: "bg-emerald-500",
  ausente: "bg-amber-500",
  saiu: "bg-muted-foreground/40",
  nao_entrou: "bg-muted-foreground/20",
};

const VAZIO: Record<Situacao, string> = {
  online: "Ninguém online agora.",
  ausente: "Ninguém ausente.",
  saiu: "Ninguém entrou e saiu hoje.",
  nao_entrou: "Todo mundo que tem acesso já entrou hoje.",
};

/**
 * Lê a lista INTEIRA, em páginas: a API corta a resposta em 1.000 linhas
 * (AP35), e "quem não entrou hoje" é uma linha por pessoa com acesso.
 * Devolve `null` quando não conseguiu ler — nunca uma lista pela metade.
 */
export async function lerQuemEstaOnline(
  supabase: Banco
): Promise<PessoaNaPresenca[] | null> {
  const lido = await lerTodasAsPaginas<unknown>((de, ate) =>
    supabase.rpc("presence_now", { p_grupo: null }).range(de, ate)
  );
  if (!lido.ok) {
    console.error("quem está online:", lido.error.message);
    return null;
  }
  return lerPresenca(lido.linhas);
}

/**
 * O quadro "Agora", no alto do Painel de uso: os quatro números e o caminho
 * para a lista. O painel responde "como o sistema vem sendo usado"; este
 * quadro responde "e neste instante?".
 *
 * Sem resposta do banco (migração 0291 por rodar), não desenha nada: um "0
 * online" ali seria a tela afirmando o que não mediu.
 */
export async function AgoraNoSistema({ supabase }: { supabase: Banco }) {
  const { data, error } = await supabase.rpc("presence_summary");
  const resumo = error ? null : lerResumo(data);
  if (!resumo) return null;
  const numeros: [string, number, string][] = [
    ["online", resumo.online, "text-emerald-700 dark:text-emerald-400"],
    [resumo.ausentes === 1 ? "ausente" : "ausentes", resumo.ausentes, "text-amber-700 dark:text-amber-400"],
    [resumo.sairam === 1 ? "entrou e saiu hoje" : "entraram e saíram hoje", resumo.sairam, ""],
    [resumo.naoEntraram === 1 ? "não entrou hoje" : "não entraram hoje", resumo.naoEntraram, ""],
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-sm font-medium">Agora</p>
        {numeros.map(([rotulo, n, cor]) => (
          <p key={rotulo} className="text-sm text-muted-foreground">
            <span className={`text-lg font-semibold tabular-nums text-foreground ${cor}`}>
              {n}
            </span>{" "}
            {rotulo}
          </p>
        ))}
      </div>
      <Link
        href={enderecoDaVisao("online")}
        className="text-sm underline underline-offset-2"
      >
        Ver quem
      </Link>
    </div>
  );
}

export async function VisaoOnline({ supabase }: { supabase: Banco }) {
  const pessoas = await lerQuemEstaOnline(supabase);
  const agora = new Date();

  if (pessoas === null) {
    return (
      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
        Não foi possível ler quem está online. Esta visão depende da{" "}
        <strong>migração 0291</strong> — confirme se ela foi aplicada neste
        banco. Nada aqui quer dizer que não há ninguém online.
      </p>
    );
  }

  const grupos = porSituacao(pessoas);
  const ordem: Situacao[] = ["online", "ausente", "saiu", "nao_entrou"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {ordem.map((s) => (
            <div key={s} className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground uppercase">
                {SITUACAO_ROTULO[s]}
              </p>
              <p className="text-xl font-semibold tabular-nums">{grupos[s].length}</p>
            </div>
          ))}
        </div>
        <AtualizarSozinho lidoAs={hora(agora.toISOString(), true)} />
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Online</strong> é quem mexeu no sistema nos últimos 5 minutos.{" "}
        <strong>Ausente</strong> é quem está com o sistema aberto e parado há
        mais tempo que isso. A tela manda o sinal de atividade no máximo uma vez
        por minuto, então a última atividade pode estar até um minuto atrás do
        que aconteceu. O Chat usa a mesma regra dos 5 minutos, mas conta também
        o movimento do mouse — por isso a bolinha de lá pode, por instantes,
        discordar desta lista.
      </p>

      {ordem.map((s) => (
        <Card key={s}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span aria-hidden className={`size-2.5 rounded-full ${COR[s]}`} />
              {SITUACAO_ROTULO[s]}
              <Badge variant="secondary">{grupos[s].length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{SITUACAO_EXPLICA[s]}</p>
          </CardHeader>
          <CardContent>
            {grupos[s].length === 0 ? (
              <p className="text-sm text-muted-foreground">{VAZIO[s]}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Pessoa</th>
                      <th className="py-1.5 pr-3 font-medium">Função e unidade</th>
                      {(s === "online" || s === "ausente") && (
                        <th className="py-1.5 pr-3 font-medium">Em qual tela</th>
                      )}
                      {s !== "nao_entrou" && (
                        <th className="py-1.5 font-medium">Hoje</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {grupos[s].map((p) => (
                      <tr key={p.id} className="border-b align-top last:border-0">
                        <td className="py-1.5 pr-3 font-medium">{p.nome}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {rotuloDasFuncoes(p)}
                        </td>
                        {(s === "online" || s === "ausente") && (
                          <td className="py-1.5 pr-3">
                            {nomeDaTela(p.tela) ?? (
                              <span className="text-muted-foreground">não informada</span>
                            )}
                          </td>
                        )}
                        {s !== "nao_entrou" && (
                          <td className="py-1.5 text-muted-foreground">
                            {detalheDaPessoa(p, agora.getTime())}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
