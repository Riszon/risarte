import { pedacos } from "@/lib/textos-automaticos";

/**
 * Desenha um texto com `**negrito**` (ver `textos-automaticos.ts`). Existe para
 * os textos automáticos serem DADO num lugar só e poderem ser mostrados tanto
 * na tela da pessoa quanto na tela de consulta do Admin.
 */
export function ComNegrito({ texto }: { texto: string }) {
  return (
    <>
      {pedacos(texto).map((p, i) =>
        p.forte ? <b key={i}>{p.texto}</b> : <span key={i}>{p.texto}</span>
      )}
    </>
  );
}
