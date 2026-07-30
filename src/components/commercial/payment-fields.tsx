"use client";

import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/commercial";

/** Formato do pagamento — a pergunta única das duas telas. */
export type PayMode = "avista" | "parcelado" | "entrada";

const MODES: { value: PayMode; label: string }[] = [
  { value: "avista", label: "À vista" },
  { value: "parcelado", label: "Parcelado" },
  { value: "entrada", label: "Entrada + parcelas" },
];

const fieldClass =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const labelClass = "text-[11px] font-medium text-muted-foreground";

/**
 * J6: os CAMPOS DO PAGAMENTO — uma pergunta ("como o cliente vai pagar?") e só
 * os campos daquele formato. Componente único usado na **venda direta** e no
 * **cockpit do consultor**: as duas telas mudam juntas e não podem divergir de
 * comportamento (foi o que o dono pediu ao cobrar paridade).
 *
 * Totalmente controlado: quem guarda o estado é a tela.
 */
export function PaymentFields({
  payMode,
  onPayModeChange,
  downReais,
  onDownReaisChange,
  installments,
  onInstallmentsChange,
  maxInstallments,
  method,
  onMethodChange,
  methodOptions,
  firstDue,
  onFirstDueChange,
  disabled,
}: {
  payMode: PayMode;
  onPayModeChange: (mode: PayMode) => void;
  downReais: string;
  onDownReaisChange: (value: string) => void;
  installments: string;
  onInstallmentsChange: (value: string) => void;
  maxInstallments: number;
  method: PaymentMethod | "";
  onMethodChange: (value: PaymentMethod | "") => void;
  methodOptions: PaymentMethod[];
  firstDue: string;
  onFirstDueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const isCash = payMode === "avista";
  const options = Array.from(
    { length: Math.max(1, maxInstallments) },
    (_, i) => i + 1
  ).filter((n) => n > 1);

  return (
    <div className="space-y-2.5">
      <div
        role="radiogroup"
        aria-label="Como o cliente vai pagar?"
        className="flex flex-wrap gap-1.5"
      >
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={payMode === value}
            disabled={disabled}
            onClick={() => onPayModeChange(value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
              payMode === value
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "border-border hover:bg-muted",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {payMode === "entrada" && (
          <label className="block">
            <span className={labelClass}>Entrada (R$)</span>
            <input
              value={downReais}
              onChange={(e) => onDownReaisChange(e.target.value)}
              disabled={disabled}
              inputMode="decimal"
              placeholder="0,00"
              className={fieldClass}
            />
          </label>
        )}
        {!isCash && (
          <label className="block">
            <span className={labelClass}>Parcelas</span>
            <select
              value={installments}
              onChange={(e) => onInstallmentsChange(e.target.value)}
              disabled={disabled}
              className={fieldClass}
            >
              {options.map((n) => (
                <option key={n} value={String(n)}>
                  {n}×
                </option>
              ))}
            </select>
            <span className="text-[10px] text-muted-foreground">
              até {maxInstallments}×
            </span>
          </label>
        )}
        <label className="block">
          <span className={labelClass}>Forma de pagamento</span>
          <select
            value={method}
            onChange={(e) =>
              onMethodChange(e.target.value as PaymentMethod | "")
            }
            disabled={disabled}
            className={fieldClass}
          >
            <option value="">Escolher...</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {isCash && (
            <span className="text-[10px] text-muted-foreground">
              à vista: PIX ou depósito
            </span>
          )}
        </label>
        {!isCash && (
          <label className="block">
            <span className={labelClass}>1º vencimento</span>
            <input
              type="date"
              value={firstDue}
              onChange={(e) => onFirstDueChange(e.target.value)}
              disabled={disabled}
              className={fieldClass}
            />
          </label>
        )}
      </div>
    </div>
  );
}
