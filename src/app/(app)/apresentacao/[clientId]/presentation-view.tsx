"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PresentationOptionItem = {
  description: string;
  quantity: number;
  sessionsLabel: string | null;
  minutesLabel: string | null;
  priceLabel: string | null;
};

export type PresentationData = {
  clientName: string;
  clientCode: string | null;
  clinicName: string | null;
  pillarLabel: string | null;
  dateLabel: string;
  diagnosis: string | null;
  considerations: string[];
  photos: { id: string; url: string; name: string | null }[];
  option: {
    title: string;
    items: PresentationOptionItem[];
    totalLabel: string | null;
    summaryLabel: string | null;
  } | null;
};

// Próximas etapas padrão da Jornada Risarte após a aprovação do plano.
const NEXT_STEPS = [
  "Apresentação e aceite da proposta pelo cliente.",
  "Assinatura dos documentos e confirmação do pagamento.",
  "Agendamento do início do tratamento com a recepção.",
  "Execução das sessões e acompanhamento.",
];

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #apresentacao, #apresentacao * { visibility: visible !important; }
  #apresentacao { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .no-print { display: none !important; }
  .slide { break-inside: avoid; page-break-inside: avoid; }
}
`;

function Slide({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="slide rounded-lg border bg-card p-6 shadow-sm">
      {title && (
        <h2 className="mb-3 border-b pb-2 text-lg font-semibold text-primary">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function PresentationView({ data }: { data: PresentationData }) {
  const router = useRouter();
  const [zoom, setZoom] = useState<number | null>(null);

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 size-4" />
          Voltar
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 size-4" />
          Baixar PDF
        </Button>
      </div>

      <div id="apresentacao" className="space-y-4">
        {/* Capa */}
        <section className="slide rounded-lg border bg-primary p-8 text-primary-foreground shadow-sm">
          <p className="text-sm uppercase tracking-wide opacity-80">
            Plano de Tratamento · Risarte Odontologia
          </p>
          <h1 className="mt-2 text-3xl font-bold">{data.clientName}</h1>
          <p className="mt-1 text-sm opacity-90">
            {data.clientCode && (
              <span className="font-mono">{data.clientCode}</span>
            )}
            {data.clinicName && <> · {data.clinicName}</>}
            <> · {data.dateLabel}</>
          </p>
          {data.pillarLabel && (
            <span className="mt-3 inline-block rounded-full bg-gold px-3 py-1 text-sm font-semibold text-primary">
              Pilar: {data.pillarLabel}
            </span>
          )}
        </section>

        {/* Queixa / condição clínica */}
        {(data.diagnosis || data.considerations.length > 0) && (
          <Slide title="Queixa e condição clínica">
            {data.diagnosis && (
              <p className="whitespace-pre-wrap text-sm">{data.diagnosis}</p>
            )}
            {data.considerations.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {data.considerations.map((c, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Slide>
        )}

        {/* Fotos e exames */}
        {data.photos.length > 0 && (
          <Slide title="Imagens e exames">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setZoom(i)}
                  className="overflow-hidden rounded border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.name ?? "imagem clínica"}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </Slide>
        )}

        {/* Proposta */}
        {data.option ? (
          <Slide title="Proposta de tratamento">
            <ul className="space-y-2">
              {data.option.items.map((it, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <span className="font-medium">
                    {it.quantity > 1 ? `${it.quantity}× ` : ""}
                    {it.description}
                    {(it.sessionsLabel || it.minutesLabel) && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (
                        {[it.sessionsLabel, it.minutesLabel]
                          .filter(Boolean)
                          .join(" · ")}
                        )
                      </span>
                    )}
                  </span>
                  {it.priceLabel && (
                    <span className="tabular-nums">{it.priceLabel}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
              {data.option.summaryLabel && (
                <span className="text-sm text-muted-foreground">
                  {data.option.summaryLabel}
                </span>
              )}
              {data.option.totalLabel && (
                <span className="text-lg font-bold text-primary">
                  Total: {data.option.totalLabel}
                </span>
              )}
            </div>
          </Slide>
        ) : (
          <Slide title="Proposta de tratamento">
            <p className="text-sm text-muted-foreground">
              O plano ainda não tem uma opção aprovada para apresentar.
            </p>
          </Slide>
        )}

        {/* Próximas etapas */}
        <Slide title="Próximas etapas">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {NEXT_STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Slide>
      </div>

      {/* Ampliar foto (somente na tela) */}
      {zoom !== null && data.photos[zoom] && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setZoom(null)}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.photos[zoom].url}
            alt={data.photos[zoom].name ?? "imagem"}
            className="max-h-[85vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
