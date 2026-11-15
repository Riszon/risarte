/**
 * 4017 (19.28.14, 2a) — o desconto da renegociação separado por componente:
 * abate primeiro os JUROS, depois a MULTA, depois o BENEFÍCIO perdido e, por
 * último, o PRINCIPAL. É a mesma ordem da dispensa do recebimento manual (o
 * pagamento cobre principal → benefício → multa → juros, e a dispensa leva o
 * que sobra). O banco faz a mesma conta em `_desconto_por_componente`.
 */
export type Componentes = { principal: number; beneficio: number; multa: number; juros: number };
export type DescontoPorComponente = { juros: number; multa: number; beneficio: number; principal: number };

export function descontoPorComponente(base: Componentes, desconto: number): DescontoPorComponente {
  let resto = Math.max(0, desconto);
  const tira = (v: number) => {
    const x = Math.min(resto, Math.max(0, v));
    resto -= x;
    return x;
  };
  const juros = tira(base.juros);
  const multa = tira(base.multa);
  const beneficio = tira(base.beneficio);
  const principal = tira(base.principal);
  return { juros, multa, beneficio, principal };
}

/** O que a dispensa do recebimento manual deixaria, para o mesmo pagamento (a prova da mesma regra). */
export function dispensaDoRecebimento(base: Componentes, pago: number): DescontoPorComponente {
  let resto = Math.max(0, pago);
  const cobre = (v: number) => {
    const x = Math.min(resto, Math.max(0, v));
    resto -= x;
    return v - x;
  };
  const principal = cobre(base.principal);
  const beneficio = cobre(base.beneficio);
  const multa = cobre(base.multa);
  const juros = cobre(base.juros);
  return { juros, multa, beneficio, principal };
}
