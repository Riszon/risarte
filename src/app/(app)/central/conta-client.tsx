"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { camposDaAlteracao, quemFez, rotuloDaTabela, type Alteracao, type Autor } from "@/lib/auditoria-alteracoes";
import { formatBrDateTime } from "@/lib/dates";
import {
  abrirCadastroDaConta,
  carregarHistorico,
  criarWebhook,
  declararSplit,
  desativarConta,
  gravarChave,
  marcarPronta,
  registrarTermo,
  verificarAgora,
  type LinhaDoHistorico,
  type Resultado,
} from "./actions";

/** Roda uma ação, mostra o resultado e recarrega a tela. */
function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  function rodar(acao: () => Promise<Resultado>, sucesso: string, depois?: () => void) {
    iniciar(async () => {
      const r = await acao();
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível concluir.");
        return;
      }
      if (r.aviso) toast.warning(r.aviso, { duration: 12_000 });
      else toast.success(sucesso);
      depois?.();
      router.refresh();
    });
  }
  return { pendente, rodar };
}

/** Um botão que chama uma ação simples. */
export function BotaoDeAcao({
  acao,
  alvo,
  valor,
  rotulo,
  sucesso,
  variante = "outline",
}: {
  acao: "abrir" | "verificar" | "webhook" | "split" | "pronta";
  alvo: string;
  valor?: boolean;
  rotulo: string;
  sucesso: string;
  variante?: "outline" | "default" | "ghost";
}) {
  const { pendente, rodar } = useAcao();
  const chamar = () => {
    if (acao === "abrir") return abrirCadastroDaConta(alvo);
    if (acao === "verificar") return verificarAgora(alvo);
    if (acao === "webhook") return criarWebhook(alvo);
    if (acao === "split") return declararSplit(alvo, valor === true);
    return marcarPronta(alvo, valor === true);
  };
  return (
    <Button type="button" size="sm" variant={variante} disabled={pendente} onClick={() => rodar(chamar, sucesso)}>
      {pendente ? "Aguarde…" : rotulo}
    </Button>
  );
}

/** O termo de autorização do franqueado: data, quem assinou e observação. */
export function TermoForm({ accountId, hoje }: { accountId: string; hoje: string }) {
  const { pendente, rodar } = useAcao();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_1fr]"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        rodar(() => registrarTermo(fd), "Termo registrado.");
      }}
    >
      <input type="hidden" name="account_id" value={accountId} />
      <div className="space-y-1">
        <Label htmlFor={`termo-data-${accountId}`}>Assinado em</Label>
        <Input id={`termo-data-${accountId}`} name="signed_on" type="date" max={hoje} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`termo-nome-${accountId}`}>Quem assinou (franqueado)</Label>
        <Input id={`termo-nome-${accountId}`} name="signed_by_name" required minLength={3} maxLength={120} autoComplete="off" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`termo-obs-${accountId}`}>Observação (opcional)</Label>
        <Input id={`termo-obs-${accountId}`} name="note" maxLength={500} autoComplete="off" placeholder="Ex.: aditivo ao contrato de franquia, cláusula 12" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pendente}>
          {pendente ? "Gravando…" : "Registrar o termo"}
        </Button>
      </div>
    </form>
  );
}

/**
 * A CHAVE DE API — campo só de gravação. Nunca recebe valor do servidor, não
 * guarda em estado depois de enviar e é apagado mesmo quando dá erro: a chave
 * não fica parada na tela.
 */
export function ChaveForm({ accountId, troca }: { accountId: string; troca: boolean }) {
  const { pendente, rodar } = useAcao();
  return (
    <form
      className="space-y-2"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        form.reset();
        rodar(() => gravarChave(fd), "Chave validada e gravada. Tarifas e webhook conferidos.");
      }}
    >
      <input type="hidden" name="account_id" value={accountId} />
      <div className="space-y-1">
        <Label htmlFor={`chave-${accountId}`}>{troca ? "Nova chave de API do Asaas" : "Chave de API do Asaas"}</Label>
        <Input
          id={`chave-${accountId}`}
          name="api_key"
          type="password"
          required
          minLength={20}
          autoComplete="off"
          spellCheck={false}
          placeholder="$aact_…"
        />
        <p className="text-xs text-muted-foreground">
          Gerada no painel do Asaas desta conta, em Integrações › Chaves de API. Cole aqui direto: a chave nunca deve
          passar por WhatsApp, e-mail ou chat. Depois de gravada, ela não é mais exibida.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pendente}>
        {pendente ? "Validando no Asaas…" : troca ? "Trocar a chave" : "Validar e gravar a chave"}
      </Button>
    </form>
  );
}

/** Desativar a conta: pede o motivo e avisa o que acontece. */
export function DesativarForm({ accountId }: { accountId: string }) {
  const { pendente, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setAberto(true)}>
        Desativar esta conta…
      </Button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-destructive/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        rodar(() => desativarConta(fd), "Conta desativada. A chave foi apagada.", () => setAberto(false));
      }}
    >
      <input type="hidden" name="account_id" value={accountId} />
      <p className="text-sm">
        Desativar apaga a chave e o token guardados, remove o webhook no Asaas e tira a unidade de &ldquo;pronta para
        cobrar&rdquo;. O cadastro e o histórico ficam. Para voltar, será preciso abrir um novo cadastro e colar a chave
        de novo.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`motivo-${accountId}`}>Por quê?</Label>
        <Input id={`motivo-${accountId}`} name="reason" required minLength={5} maxLength={300} autoComplete="off" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pendente}>
          {pendente ? "Desativando…" : "Desativar a conta"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** O histórico da aba: quem mudou o quê e quando. Abre só quando a pessoa pede. */
export function HistoricoDaAba({ aba, clinicId }: { aba: string; clinicId: string | null }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setAberto((v) => !v)}>
        <History className="mr-1 size-3.5" />
        {aberto ? "Fechar o histórico" : "Histórico de alterações"}
      </Button>
      {aberto && <Linhas aba={aba} clinicId={clinicId} />}
    </div>
  );
}

function Linhas({ aba, clinicId }: { aba: string; clinicId: string | null }) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string | null; linhas: LinhaDoHistorico[] }>({
    carregando: true,
    erro: null,
    linhas: [],
  });

  useEffect(() => {
    let vivo = true;
    carregarHistorico(aba, clinicId).then((r) => {
      if (vivo) setEstado({ carregando: false, erro: r.ok ? null : (r.error ?? "Erro."), linhas: r.rows });
    });
    return () => {
      vivo = false;
    };
  }, [aba, clinicId]);

  if (estado.carregando) return <p className="py-2 text-xs text-muted-foreground">Carregando o histórico…</p>;
  if (estado.erro) return <p className="py-2 text-xs text-destructive">{estado.erro}</p>;
  if (estado.linhas.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">Nenhuma alteração registrada nesta aba.</p>;
  }

  const nomes = {
    usuarios: new Map(
      estado.linhas.filter((l) => l.userId && l.userName).map((l) => [l.userId as string, l.userName as string])
    ),
    unidades: new Map<string, string>(),
  };

  return (
    <ol className="mt-1 space-y-1.5 text-xs">
      {estado.linhas.map((l) => {
        const a: Alteracao = {
          id: l.id,
          occurred_at: l.occurredAt,
          user_id: l.userId,
          actor: l.actor as Autor,
          auth_session_id: null,
          schema_name: "public",
          table_name: l.tableName,
          op: l.op,
          row_id: null,
          row_label: null,
          clinic_id: null,
          client_id: null,
          changes: l.changes ?? {},
          tx: null,
        };
        const campos = camposDaAlteracao(a, nomes).slice(0, 8);
        const verbo = l.op === "I" ? "Criou" : l.op === "D" ? "Apagou" : "Alterou";
        return (
          <li key={l.id} className="rounded-md border px-2.5 py-1.5">
            <p>
              <span className="font-medium">
                {verbo} · {rotuloDaTabela("public", l.tableName)}
              </span>{" "}
              <span className="text-muted-foreground">
                — {quemFez(a, nomes)} · {formatBrDateTime(l.occurredAt)}
              </span>
            </p>
            {l.op === "U" && campos.length > 0 && (
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {campos.map((c) => (
                  <li key={c.campo}>
                    {c.rotulo}: {c.antes} → {c.depois}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
