"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const CHAVE = "risarte_tema";

/**
 * ⚠️ O BOTÃO LÊ O DOCUMENTO, NÃO GUARDA UMA CÓPIA DO ESTADO.
 *
 * A verdade sobre o tema é a marca `.dark` no `<html>` — quem a põe primeiro é
 * o roteiro do `<head>`, antes de o React existir. Um `useState` aqui seria uma
 * SEGUNDA versão da mesma informação, e as duas divergiriam no dia em que
 * qualquer outra coisa mexesse na marca. `useSyncExternalStore` assina a fonte
 * de verdade em vez de copiá-la.
 *
 * No servidor a resposta é sempre "claro": lá não há `document`, e é o roteiro
 * do `<head>` que corrige antes do primeiro quadro.
 */
function assinar(aviso: () => void) {
  const observador = new MutationObserver(aviso);
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observador.disconnect();
}
const estaEscuro = () => document.documentElement.classList.contains("dark");
const noServidor = () => false;

/**
 * O BOTÃO DE CLARO/ESCURO.
 *
 * ⚠️ POR QUE ELE EXISTE NESTA ENTREGA. As cores do modo escuro estavam no
 * `globals.css` desde o começo do projeto e **nada jamais punha a marca `.dark`
 * na página**: não havia botão nem leitura da preferência do sistema. Pintar as
 * três paletas escuras sem isto seria trabalho que ninguém enxerga e que nenhum
 * teste alcança — a mesma armadilha do portão que passa por ausência.
 *
 * A escolha fica no NAVEGADOR de cada pessoa (`localStorage`), não no banco: é
 * preferência de quem está olhando, não dado da clínica. Duas consequências
 * assumidas: quem trocar de computador escolhe de novo, e a escolha não viaja
 * entre produção e treino. Guardá-la no banco custaria uma consulta por clique
 * pelo resto da vida do sistema, para resolver um problema que ninguém tem.
 */
export function BotaoDeTema({ className }: { className?: string }) {
  const escuro = useSyncExternalStore(assinar, estaEscuro, noServidor);

  const alternar = useCallback(() => {
    const novo = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", novo);
    try {
      localStorage.setItem(CHAVE, novo ? "escuro" : "claro");
    } catch {
      /* navegador com armazenamento bloqueado: vale só nesta aba */
    }
    // Não há `setState` aqui de propósito: mexer na marca já avisa o assinante.
  }, []);

  const rotulo = escuro ? "Usar tema claro" : "Usar tema escuro";

  return (
    <button
      type="button"
      onClick={alternar}
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        "grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {escuro ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

/**
 * O roteiro que roda ANTES do primeiro desenho.
 *
 * ⚠️ SEM ISTO A TELA PISCA BRANCO. O navegador desenha o HTML antes de o React
 * acordar; se a marca `.dark` só fosse posta depois, quem usa o tema escuro
 * veria um lampejo claro em toda navegação. É por isso que este trecho é uma
 * `<script>` no `<head>`, e não um efeito de componente.
 *
 * Sem escolha guardada, vale a preferência do sistema operacional da pessoa.
 */
export function RoteiroDoTema() {
  const codigo = `(function(){try{var e=localStorage.getItem("${CHAVE}");var d=e?e==="escuro":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(_){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: codigo }} />;
}
