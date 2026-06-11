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
