import { describe, expect, it } from "vitest";
import { acoesPermitidas, temAlgumaAcao, type PackageFacts, type PackagePermissions } from "@/lib/signatures/actions-permitidas";
import type { PackageStatus } from "@/lib/signatures/types";

// ZS4: quais ações aparecem num pacote — situação × permissão. Uma regra só
// para o detalhe do pacote e para a aba Documentos da ficha.

const TODAS: PackagePermissions = { view: true, download: true, send: true, cancel: true };
const NENHUMA: PackagePermissions = { view: false, download: false, send: false, cancel: false };
const SO_VE: PackagePermissions = { ...NENHUMA, view: true };
const COORDENADOR: PackagePermissions = { view: true, download: true, send: false, cancel: false };

function fatos(status: PackageStatus, extra: Partial<PackageFacts> = {}): PackageFacts {
  return {
    status,
    hasMergedPdf: true,
    hasSignedPdf: status === "signed",
    wasSent: status !== "draft",
    audience: "patient",
    zapsignEmailsEnabled: false,
    resentAs: null,
    ...extra,
  };
}

describe("pacote aguardando assinatura (sent / partially_signed)", () => {
  for (const status of ["sent", "partially_signed"] as const) {
    it(`${status}: com todas as permissões, visualiza o enviado, baixa cópia, reenvia e cancela`, () => {
      const a = acoesPermitidas(fatos(status), TODAS);
      expect(a.view).toBe("merged");
      expect(a.downloadSigned).toBe(false);
      expect(a.downloadCopy).toBe(true);
      expect(a.resend).toBe(true);
      expect(a.cancel).toBe(true);
      expect(a.cancelBlockedReason).toBeNull();
      expect(a.resendAsNew).toBe(false);
    });
  }

  it("o e-mail da ZapSign só aparece com a configuração ligada", () => {
    expect(acoesPermitidas(fatos("sent"), TODAS).resendByZapsignEmail).toBe(false);
    expect(acoesPermitidas(fatos("sent", { zapsignEmailsEnabled: true }), TODAS).resendByZapsignEmail).toBe(true);
    expect(acoesPermitidas(fatos("sent", { zapsignEmailsEnabled: true }), COORDENADOR).resendByZapsignEmail).toBe(false);
  });
});

describe("pacote ASSINADO", () => {
  it("nunca cancela — o botão some e a tela diz por quê", () => {
    const a = acoesPermitidas(fatos("signed"), TODAS);
    expect(a.cancel).toBe(false);
    expect(a.cancelBlockedReason).toBe("Documento assinado não pode ser cancelado.");
    expect(a.resend).toBe(false);
    expect(a.resendAsNew).toBe(false);
  });

  it("visualiza e baixa o ASSINADO quando ele já chegou", () => {
    const a = acoesPermitidas(fatos("signed"), TODAS);
    expect(a.view).toBe("signed");
    expect(a.downloadSigned).toBe(true);
    expect(a.downloadCopy).toBe(true);
  });

  it("assinado sem o PDF assinado ainda (download pendente): mostra o enviado, não oferece baixar o assinado", () => {
    const a = acoesPermitidas(fatos("signed", { hasSignedPdf: false }), TODAS);
    expect(a.view).toBe("merged");
    expect(a.downloadSigned).toBe(false);
  });
});

describe("recusado, expirado, cancelado", () => {
  for (const status of ["refused", "expired", "cancelled"] as const) {
    it(`${status}: reenvia como novo pacote (uma vez), não cancela nem reenvia o link`, () => {
      const a = acoesPermitidas(fatos(status), TODAS);
      expect(a.resendAsNew).toBe(true);
      expect(a.cancel).toBe(false);
      expect(a.resend).toBe(false);
      expect(a.cancelBlockedReason).toBeNull();
      expect(acoesPermitidas(fatos(status, { resentAs: "ASS-000099" }), TODAS).resendAsNew).toBe(false);
    });
  }

  it("rascunho descartado (nunca enviado) não reenvia como novo nem baixa cópia", () => {
    const a = acoesPermitidas(fatos("cancelled", { wasSent: false }), TODAS);
    expect(a.resendAsNew).toBe(false);
    expect(a.downloadCopy).toBe(false);
  });

  it("empresa ainda não reenvia como novo (o reenvio refaz o envio ao paciente; Empresarial é a ZS5)", () => {
    expect(acoesPermitidas(fatos("expired", { audience: "company" }), TODAS).resendAsNew).toBe(false);
  });
});

describe("cada ação só para quem tem a permissão", () => {
  it("quem só visualiza: o visualizador e mais nada (sem baixar)", () => {
    for (const status of ["sent", "signed", "cancelled"] as const) {
      const a = acoesPermitidas(fatos(status), SO_VE);
      expect(a.view).not.toBe(false);
      expect(a.downloadSigned || a.downloadCopy || a.resend || a.cancel || a.resendAsNew).toBe(false);
    }
  });

  it("o Coordenador (visualizar + baixar, padrão de fábrica): baixa, mas não reenvia nem cancela", () => {
    const enviado = acoesPermitidas(fatos("sent"), COORDENADOR);
    expect(enviado.downloadCopy).toBe(true);
    expect(enviado.resend).toBe(false);
    expect(enviado.cancel).toBe(false);
    expect(enviado.cancelBlockedReason).toBeNull();
    expect(acoesPermitidas(fatos("expired"), COORDENADOR).resendAsNew).toBe(false);
  });

  it("sem nenhuma permissão: nenhuma ação", () => {
    for (const status of ["draft", "sent", "partially_signed", "signed", "refused", "expired", "cancelled"] as const) {
      expect(temAlgumaAcao(acoesPermitidas(fatos(status), NENHUMA))).toBe(false);
    }
  });

  it("rascunho não mostra nada a ninguém (não chegou a ser enviado)", () => {
    const a = acoesPermitidas(fatos("draft"), TODAS);
    expect(a.view).toBe(false);
    expect(a.downloadCopy).toBe(false);
    expect(a.resend).toBe(false);
  });
});
