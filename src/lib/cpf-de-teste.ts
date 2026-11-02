import { isValidCpf } from "@/lib/masks";

// CPF DE TESTE, SÓ PARA O TREINO (pedido do dono, 02/11/2026).
//
// A assinatura digital exige CPF válido pelos dígitos verificadores, como na
// produção. No treino a equipe cadastra pacientes fictícios, e um número
// inventado quase nunca passa. Aqui se gera um que passa: nove dígitos ao acaso
// e os dois verificadores calculados. A regra do envio não muda em nenhum
// ambiente.
//
// ⚠️ Um número válido pode pertencer a alguém de verdade: é só para paciente
// fictício do treino, nunca para dado real.

function verificador(digitos: number[]): number {
  const peso = digitos.length + 1;
  const soma = digitos.reduce((s, d, i) => s + d * (peso - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** CPF válido, formatado (000.000.000-00). `aleatorio` existe para o teste. */
export function gerarCpfDeTeste(aleatorio: () => number = Math.random): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => Math.floor(aleatorio() * 10) % 10);
    if (base.every((d) => d === base[0])) continue;
    const d1 = verificador(base);
    const d2 = verificador([...base, d1]);
    const n = [...base, d1, d2].join("");
    if (!isValidCpf(n)) continue;
    return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  }
}
