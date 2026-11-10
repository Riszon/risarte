"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Campo de busca cujo valor inicial vem do ENDEREÇO (`?q=`), dentro de um
 * `FilterForm`.
 *
 * ⚠️ POR QUE EXISTE (AP78). Com `defaultValue={busca}` num `<Input>` de
 * servidor, buscar muda o endereço, a página volta com outro `defaultValue`, e
 * o Base UI reclama no console a cada busca ("changing the default value state
 * of an uncontrolled FieldControl"). Erro que sempre aparece é erro que ninguém
 * lê. Aqui o campo é controlado: guarda o que a pessoa digita e só acompanha o
 * endereço quando ELE muda (voltar no navegador, limpar filtros).
 */
export function CampoDeBusca({
  valorDoEndereco,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange"> & {
  valorDoEndereco: string;
}) {
  const [valor, setValor] = useState(valorDoEndereco);
  const [doEndereco, setDoEndereco] = useState(valorDoEndereco);
  if (valorDoEndereco !== doEndereco) {
    setDoEndereco(valorDoEndereco);
    setValor(valorDoEndereco);
  }
  return (
    <Input
      type="search"
      {...props}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
    />
  );
}
