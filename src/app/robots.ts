import type { MetadataRoute } from "next";

/**
 * ASA4, 1B (4015; spec 19.26.3): a lista pública dos boletos da forma 2 fica fora
 * dos buscadores (a página também diz `noindex` e o servidor manda `X-Robots-Tag`).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: ["/boletos/"] }] };
}
