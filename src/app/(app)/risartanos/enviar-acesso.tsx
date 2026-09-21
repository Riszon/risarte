"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Mail, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  linkDeEmail,
  linkDoWhatsApp,
  mensagemDeAcesso,
  type UnidadeDaPessoa,
} from "@/lib/mensagem-de-acesso";

/**
 * ENVIAR OS DADOS DE ACESSO (pedido do dono, 21/09/2026).
 *
 * Depois de criar o acesso (ou redefinir a senha), o Admin precisa passar para
 * a pessoa: endereço, login, senha provisória e **em que unidade ela está, com
 * que função** — todas as unidades, quando for mais de uma. Digitar isso à mão
 * a cada contratação é onde se esquece a segunda unidade e se erra a senha.
 *
 * O texto é montado por `mensagemDeAcesso` (pura, com teste). Aqui é só a
 * tela: mostrar, copiar, abrir o WhatsApp ou o e-mail.
 *
 * ⚠️ A SENHA SÓ EXISTE NESTE INSTANTE. Ela não é guardada em lugar nenhum: o
 * banco só tem o embaralhado. Por isso o bloco aparece logo depois de criar o
 * acesso ou redefinir a senha — e, fora desses momentos, a mensagem sai sem
 * senha, dizendo o que fazer.
 */
export function EnviarAcesso({
  nome,
  email,
  senha,
  unidades,
  enderecoDoSistema,
  enderecoDoTreino,
  sistemaLiberado,
  whatsapp,
}: {
  nome: string;
  email: string | null;
  senha?: string | null;
  unidades: UnidadeDaPessoa[];
  enderecoDoSistema?: string | null;
  enderecoDoTreino?: string | null;
  sistemaLiberado: boolean;
  /** O WhatsApp do cadastro — sem ele, o botão do WhatsApp não aparece. */
  whatsapp?: string | null;
}) {
  const [copiado, setCopiado] = useState(false);

  const texto = useMemo(
    () =>
      mensagemDeAcesso({
        nome,
        email: email ?? "",
        senha,
        unidades,
        enderecoDoSistema,
        enderecoDoTreino,
        sistemaLiberado,
      }),
    [nome, email, senha, unidades, enderecoDoSistema, enderecoDoTreino, sistemaLiberado]
  );

  const zap = linkDoWhatsApp(whatsapp, texto);
  const correio = linkDeEmail(email, texto);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success("Mensagem copiada.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sem permissão da área de transferência: o texto está à vista, dá para
      // selecionar e copiar à mão. Melhor dizer isso do que fingir que copiou.
      toast.error("Não consegui copiar. Selecione o texto abaixo e copie.");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Send className="size-4 text-primary" />
          Mensagem para enviar a {nome.split(" ")[0]}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copiar}>
            {copiado ? (
              <Check className="mr-1 size-4" />
            ) : (
              <Copy className="mr-1 size-4" />
            )}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
          {zap && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={zap} target="_blank" rel="noopener noreferrer" />}
            >
              <MessageCircle className="mr-1 size-4" />
              WhatsApp
            </Button>
          )}
          {correio && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={correio} />}
            >
              <Mail className="mr-1 size-4" />
              E-mail
            </Button>
          )}
        </div>
      </div>

      <textarea
        readOnly
        value={texto}
        rows={Math.min(18, texto.split("\n").length + 1)}
        aria-label="Mensagem com os dados de acesso"
        className="w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-relaxed"
      />

      {senha ? (
        <p className="text-xs text-muted-foreground">
          A senha provisória só aparece agora — ela não fica guardada em lugar
          nenhum. <b>Mande a senha por um canal separado</b> do resto da
          mensagem (uma conversa direta, nunca um grupo).
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Esta mensagem sai <b>sem senha</b>: ela só existe no momento em que é
          criada ou redefinida. Use <b>Redefinir senha</b> acima para gerar uma
          nova.
        </p>
      )}
    </div>
  );
}
