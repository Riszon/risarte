// Brazilian input masks. Each function accepts any string, keeps only digits
// and re-applies the canonical format, so pasted/unformatted values are
// normalized the same way on client (as-you-type) and server (before saving).

function digits(value: string, max: number): string {
  return value.replace(/\D/g, "").slice(0, max);
}

export function formatCpf(value: string): string {
  const d = digits(value, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

export function formatCnpj(value: string): string {
  const d = digits(value, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

export function formatPhone(value: string): string {
  const d = digits(value, 11);
  if (d.length <= 10) {
    // Landline: (11) 3333-4444
    return d
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/^(\(\d{2}\) \d{4})(\d)/, "$1-$2");
  }
  // Mobile: (11) 99999-8888
  return d
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/^(\(\d{2}\) \d{5})(\d)/, "$1-$2");
}

export function formatCep(value: string): string {
  const d = digits(value, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}

/**
 * CNPJ válido pelos dígitos verificadores (fornecedores, 0371). Aceita com ou
 * sem máscara; sequências repetidas são inválidas.
 */
export function isValidCnpj(value: string | null | undefined): boolean {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (len: number) => {
    const pesos = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * pesos[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/**
 * CPF válido pelos dígitos verificadores (ZS2). Aceita com ou sem máscara.
 * Sequências repetidas ("111.111.111-11") são inválidas, como na Receita.
 */
export function isValidCpf(value: string | null | undefined): boolean {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
