"use client";

import { useEffect } from "react";

/**
 * A ABA DIZ QUE AMBIENTE ELA É.
 *
 * Os atalhos do Início apontam para uma aba COM NOME (`risarte-treino`,
 * `risarte-sistema`…). O navegador só reaproveita uma aba existente se ela
 * tiver aquele nome — e a aba onde a pessoa entrou pelo endereço, ou pelos
 * favoritos, não tem nome nenhum. Este componente batiza a aba ao carregar,
 * então o atalho de VOLTA encontra a aba de origem em vez de abrir mais uma.
 *
 * ⚠️ O navegador APAGA o nome ao navegar para outro endereço (proteção contra
 * rastreamento entre sites), e é por isso que cada ambiente batiza a sua a cada
 * carregamento, em vez de alguém batizar a do outro.
 */
export function NomeDaAba({ nome }: { nome: string }) {
  useEffect(() => {
    if (window.name !== nome) window.name = nome;
  }, [nome]);
  return null;
}
