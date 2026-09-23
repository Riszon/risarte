import { describe, expect, it } from "vitest";
import { LEAD_STAGES } from "@/lib/empresarial/constants";
import {
  ETAPAS_DA_FICHA,
  etapaInicial,
  situacaoDasEtapas,
  type DadosDasEtapas,
} from "@/lib/empresarial/etapas-do-funil";

const vazio: DadosDasEtapas = {
  faltaProposta: [],
  faltaContrato: [],
  apresentacaoPersonalizada: false,
  envios: 0,
  propostaEnviada: false,
  contratoAssinadoEm: null,
  implantacaoPagaEm: null,
  conferido: false,
  passosFeitos: 0,
  passosTotal: 0,
};

describe("em qual aba a ficha abre", () => {
  it("TODA fase tem resposta — nenhuma cai no vazio", () => {
    // Fase nova no banco sem entrada aqui abriria a ficha em `undefined` e a
    // tela não mostraria aba nenhuma. É por isso que o teste varre a lista.
    for (const fase of LEAD_STAGES) {
      expect(ETAPAS_DA_FICHA).toContain(etapaInicial(fase));
    }
  });

  it("abre no trabalho de agora, não no começo de tudo", () => {
    expect(etapaInicial("CAPTURE")).toBe("levantamento");
    // Reunião marcada: o que se faz é preparar a apresentação.
    expect(etapaInicial("MEETING_SCHEDULED")).toBe("apresentacao");
    // Apresentou: registra o que ouviu e monta a proposta.
    expect(etapaInicial("PRESENTED")).toBe("levantamento");
    expect(etapaInicial("PROPOSAL_SENT")).toBe("envio");
    expect(etapaInicial("FOLLOW_UP")).toBe("envio");
    expect(etapaInicial("IMPLEMENTATION")).toBe("fechamento");
  });

  it("empresa perdida abre no fechamento, onde está o desfecho", () => {
    // No levantamento ela pareceria ter campo a preencher.
    expect(etapaInicial("CLOSED_LOST")).toBe("fechamento");
  });
});

describe("o que cada aba diz de si mesma", () => {
  it("conta os campos que faltam SEM contar duas vezes o mesmo", () => {
    // `faltaParaProposta` e `faltaParaContrato` se sobrepõem de propósito —
    // somar as duas listas diria "falta 3" onde faltam 2 campos.
    const s = situacaoDasEtapas({
      ...vazio,
      faltaProposta: ["colaboradores", "razão social"],
      faltaContrato: ["razão social"],
    });
    expect(s.levantamento).toEqual({ estado: "falta", resumo: "falta 2 campos" });
  });

  it("um campo só fala no singular", () => {
    const s = situacaoDasEtapas({ ...vazio, faltaProposta: ["CNPJ"] });
    expect(s.levantamento.resumo).toBe("falta 1 campo");
  });

  it("levantamento completo é 'pronto', não 'feito'", () => {
    // Preencher não é ter fechado nada: "feito" é reservado para ato com data.
    expect(situacaoDasEtapas(vazio).levantamento).toEqual({
      estado: "pronto",
      resumo: "completo",
    });
  });

  it("envio: nada enviado pesa mais do que envio sem a proposta", () => {
    expect(situacaoDasEtapas(vazio).envio.estado).toBe("falta");
    const soApresentacao = situacaoDasEtapas({ ...vazio, envios: 2 });
    expect(soApresentacao.envio).toEqual({ estado: "pronto", resumo: "2 envios" });
    const comProposta = situacaoDasEtapas({
      ...vazio,
      envios: 2,
      propostaEnviada: true,
    });
    expect(comProposta.envio).toEqual({ estado: "feito", resumo: "proposta enviada" });
  });

  it("fechamento: implantação paga mas passos pela metade NÃO é 'feito'", () => {
    // Dizer "concluída" com passo em aberto é a tela mentindo — e é
    // exatamente a sensação de "parece completo e não está" do relato.
    const meio = situacaoDasEtapas({
      ...vazio,
      contratoAssinadoEm: "2026-09-01",
      implantacaoPagaEm: "2026-09-02",
      passosFeitos: 2,
      passosTotal: 5,
    });
    expect(meio.fechamento).toEqual({ estado: "pronto", resumo: "implantação 2/5" });

    const fim = situacaoDasEtapas({
      ...vazio,
      contratoAssinadoEm: "2026-09-01",
      implantacaoPagaEm: "2026-09-02",
      passosFeitos: 5,
      passosTotal: 5,
    });
    expect(fim.fechamento).toEqual({
      estado: "feito",
      resumo: "implantação concluída",
    });
  });

  it("fechamento em aberto diz isso, e contrato assinado aparece antes da conferência", () => {
    expect(situacaoDasEtapas(vazio).fechamento).toEqual({
      estado: "falta",
      resumo: "em aberto",
    });
    const assinado = situacaoDasEtapas({ ...vazio, contratoAssinadoEm: "2026-09-01" });
    expect(assinado.fechamento.resumo).toBe("contrato assinado");
  });

  it("apresentação distingue o modelo da rede da versão desta empresa", () => {
    expect(situacaoDasEtapas(vazio).apresentacao.resumo).toBe("modelo da rede");
    const propria = situacaoDasEtapas({ ...vazio, apresentacaoPersonalizada: true });
    expect(propria.apresentacao).toEqual({ estado: "feito", resumo: "personalizada" });
  });
});
