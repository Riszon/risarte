"use client";

/**
 * CAPTURAR A TELA DO SISTEMA (0257) — pelo próprio navegador.
 *
 * ⚠️ POR QUE A CAPTURA REAL, E NÃO UMA BIBLIOTECA QUE "REDESENHA" A PÁGINA.
 * Decisão do dono (16/09/2026). As bibliotecas que fotografam sem pedir
 * permissão não tiram foto: elas reconstroem a página a partir do código, e a
 * reconstrução erra justamente onde o problema costuma estar — fonte, gráfico,
 * janela aberta, algo desalinhado. Um print que não mostra o defeito é pior que
 * nenhum.
 *
 * O preço é o navegador PERGUNTAR ("Permitir que o sistema veja esta aba?").
 * Isso é do navegador, não dá para pular, e é bom que seja assim: nenhuma
 * página deveria conseguir fotografar a tela de alguém em silêncio.
 *
 * ⚠️ O PAINEL DO RELATO SAI DA FRENTE antes do clique do obturador — senão o
 * print mostraria o formulário em cima do problema. `esconder`/`mostrar` são
 * chamados em volta do instante da foto.
 *
 * NO CELULAR NÃO EXISTE: os navegadores de telefone não oferecem captura de
 * tela para páginas. Lá o botão some e fica o anexo pela galeria.
 */

export function podeCapturarTela(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

export type ResultadoDaCaptura =
  | { ok: true; arquivo: File }
  | { ok: false; motivo: "cancelado" | "indisponivel" | "falhou" };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const proximoQuadro = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * DE ONDE VEM A FOTO (pedido do dono, 17/09/2026: "vai capturar sempre a tela
 * de onde relata o problema").
 *
 * - `esta-aba`: a aba em que a pessoa está — o navegador já oferece ela
 *   primeiro. É o caso do painel da boia e do modo "ir até a tela do problema".
 * - `escolher`: o navegador mostra a lista inteira (abas, janelas, tela
 *   toda), para quem abriu o problema em outra aba ou outro programa.
 */
export type OrigemDaCaptura = "esta-aba" | "escolher";

export async function capturarTela(opcoes: {
  nome: string;
  origem?: OrigemDaCaptura;
  esconder?: () => void;
  mostrar?: () => void;
}): Promise<ResultadoDaCaptura> {
  if (!podeCapturarTela()) return { ok: false, motivo: "indisponivel" };

  let stream: MediaStream;
  try {
    // Precisa ser chamado DIRETO do clique: o navegador exige o gesto.
    const estaAba = (opcoes.origem ?? "esta-aba") === "esta-aba";
    stream = await navigator.mediaDevices.getDisplayMedia(
      (estaAba
        ? {
            video: { displaySurface: "browser" },
            audio: false,
            // Opções do Chrome/Edge que oferecem a aba atual primeiro.
            // Navegador que não conhece simplesmente ignora.
            preferCurrentTab: true,
            selfBrowserSurface: "include",
            surfaceSwitching: "exclude",
          }
        : {
            video: true,
            audio: false,
            // Lista completa, começando pelas outras abas.
            preferCurrentTab: false,
            selfBrowserSurface: "include",
            surfaceSwitching: "include",
          }) as unknown as DisplayMediaStreamOptions
    );
  } catch (e) {
    const nome = e instanceof DOMException ? e.name : "";
    return { ok: false, motivo: nome === "NotAllowedError" ? "cancelado" : "falhou" };
  }

  opcoes.esconder?.();
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();

    // O painel precisa ter sumido de fato, e o vídeo precisa ter o primeiro
    // quadro — sem esperar, a foto sai preta ou com o formulário na frente.
    await proximoQuadro();
    await esperar(350);
    for (let i = 0; i < 20 && video.videoWidth === 0; i++) await esperar(50);
    if (video.videoWidth === 0) return { ok: false, motivo: "falhou" };

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);

    // PNG porque texto em JPEG borra — e o texto é o que se quer ler no print.
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return { ok: false, motivo: "falhou" };
    return { ok: true, arquivo: new File([blob], opcoes.nome, { type: "image/png" }) };
  } catch {
    return { ok: false, motivo: "falhou" };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    opcoes.mostrar?.();
  }
}
