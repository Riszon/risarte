"use server";

import { logAudit } from "@/lib/audit";
import { loadPresentationData } from "./presentation-data";
import type { PresentationData } from "./presentation-view";

// API pública do Gamma (Generate API). A geração é assíncrona: POST devolve um
// generationId; consulta-se o status até "completed", que traz o gammaUrl.
const GAMMA_BASE = "https://public-api.gamma.app/v1.0";

export type GammaGenerateResult =
  | { ok: true; generationId: string }
  | { ok: false; error: string };

export type GammaStatusResult = {
  status: "pending" | "completed" | "error";
  gammaUrl: string | null;
};

/** Monta o texto (markdown) enviado ao Gamma, um card por bloco (--- separa).
 * As fotos entram embutidas como `![](url)`; o Gamma baixa cada imagem no
 * momento da geração e a hospeda no próprio CDN — por isso o link assinado
 * (validade curta) é suficiente e nada de paciente fica exposto depois. */
function buildInputText(
  d: PresentationData,
  photos: PresentationData["photos"]
): string {
  const cards: string[] = [];

  const capaSub = [
    d.clinicName,
    d.dateLabel,
    d.pillarLabel ? `Pilar: ${d.pillarLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  cards.push(`# Plano de Tratamento — ${d.clientName}\n\n${capaSub}`);

  if (d.diagnosis || d.considerations.length > 0) {
    let s = "## Diagnóstico e condição\n";
    if (d.diagnosis) s += `\n${d.diagnosis}\n`;
    if (d.considerations.length > 0) {
      s += "\n" + d.considerations.map((c) => `- ${c}`).join("\n");
    }
    cards.push(s);
  }

  if (d.objectives) {
    cards.push(`## Objetivos do tratamento\n\n${d.objectives}`);
  }

  // Fotos e exames do paciente, embutidas para o Gamma usar como imagens.
  if (photos.length > 0) {
    let s = "## Imagens e exames\n";
    for (const p of photos) {
      const alt = (p.name ?? "Imagem clínica").replace(/[[\]()]/g, " ").trim();
      s += `\n![${alt || "Imagem clínica"}](${p.url})`;
    }
    cards.push(s);
  }

  if (d.sessionGroups.length > 0) {
    let s = "## Plano de tratamento — sessão por sessão\n";
    for (const g of d.sessionGroups) {
      s += `\n### ${g.quantity > 1 ? `${g.quantity}× ` : ""}${g.procedure}\n`;
      if (g.repeatNote) s += `${g.repeatNote}\n`;
      g.sessions.forEach((se, i) => {
        s += `${i + 1}. ${se.label}${se.minutesLabel ? ` · ${se.minutesLabel}` : ""}\n`;
      });
    }
    cards.push(s);
  }

  if (d.option) {
    let s = "## Proposta e investimento\n";
    for (const it of d.option.items) {
      const extra = [it.sessionsLabel, it.minutesLabel].filter(Boolean).join(" · ");
      s += `\n- ${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.description}${
        extra ? ` (${extra})` : ""
      }${it.priceLabel ? ` — ${it.priceLabel}` : ""}`;
    }
    if (d.option.summaryLabel) s += `\n\n${d.option.summaryLabel}`;
    if (d.option.totalLabel) s += `\n\n**Total: ${d.option.totalLabel}**`;
    cards.push(s);
  }

  if (d.planningNotes) {
    cards.push(`## Considerações do planejamento\n\n${d.planningNotes}`);
  }

  cards.push(
    "## Próximos passos\n\n" +
      "1. Apresentação e aceite da proposta.\n" +
      "2. Assinatura dos documentos e confirmação do pagamento.\n" +
      "3. Agendamento do início do tratamento com a recepção.\n" +
      "4. Execução das sessões e acompanhamento."
  );

  return cards.join("\n\n---\n\n");
}

/** Gera o deck no Gamma a partir do plano aprovado. Retorna o generationId.
 * `photoIds` limita quais fotos entram no deck (padrão: todas). */
export async function generateGammaDeck(
  clientId: string,
  photoIds?: string[]
): Promise<GammaGenerateResult> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "A integração com o Gamma ainda não está configurada (chave ausente).",
    };
  }

  const loaded = await loadPresentationData(clientId);
  if (!loaded.ok) {
    return {
      ok: false,
      error:
        loaded.reason === "forbidden"
          ? "Você não tem permissão para esta apresentação."
          : "Cliente não encontrado.",
    };
  }
  if (!loaded.hasApprovedPlan) {
    return { ok: false, error: "O plano precisa estar aprovado." };
  }

  // Fotos escolhidas (padrão: todas). Preserva a ordem original.
  const includedPhotos = photoIds
    ? loaded.data.photos.filter((p) => photoIds.includes(p.id))
    : loaded.data.photos;
  const withPhotos = includedPhotos.length > 0;

  let res: Response;
  try {
    res = await fetch(`${GAMMA_BASE}/generations`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText: buildInputText(loaded.data, includedPhotos),
        format: "presentation",
        textMode: "preserve",
        cardSplit: "inputTextBreaks",
        // Com fotos: 'webAllImages' + instrução mantém SÓ as nossas imagens
        // (o 'noImages' apagava as fotos embutidas). Sem fotos: 'noImages'.
        imageOptions: { source: withPhotos ? "webAllImages" : "noImages" },
        ...(withPhotos
          ? {
              additionalInstructions:
                "Use SOMENTE as imagens fornecidas via markdown no texto. " +
                "Não gere nem busque outras imagens; cards sem imagem devem " +
                "permanecer sem imagem.",
            }
          : {}),
        textOptions: { language: "pt-br" },
      }),
    });
  } catch (e) {
    console.error("Gamma generate fetch failed:", e);
    return { ok: false, error: "Não foi possível falar com o Gamma agora." };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Gamma generate failed:", res.status, body);
    return {
      ok: false,
      error: "O Gamma recusou a geração. Tente novamente em instantes.",
    };
  }

  const json = (await res.json().catch(() => null)) as {
    generationId?: string;
  } | null;
  if (!json?.generationId) {
    return { ok: false, error: "Resposta inesperada do Gamma." };
  }

  await logAudit({
    action: "export",
    entityType: "presentation",
    entityId: clientId,
    clinicId: loaded.clinicId,
    details: { gamma: true, photos: includedPhotos.length },
  });

  return { ok: true, generationId: json.generationId };
}

/** Consulta o status de uma geração do Gamma (para o polling do navegador). */
export async function getGammaStatus(
  generationId: string
): Promise<GammaStatusResult> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) return { status: "error", gammaUrl: null };
  try {
    const res = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!res.ok) return { status: "error", gammaUrl: null };
    const json = (await res.json()) as {
      status?: string;
      gammaUrl?: string;
    };
    if (json.status === "completed" && json.gammaUrl) {
      return { status: "completed", gammaUrl: json.gammaUrl };
    }
    return { status: "pending", gammaUrl: null };
  } catch {
    return { status: "error", gammaUrl: null };
  }
}
