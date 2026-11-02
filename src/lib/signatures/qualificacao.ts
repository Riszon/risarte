/**
 * A qualificação de cada signatário como sai no documento e na ZapSign
 * ("Testemunha", "Representante da Risarte"…). Regra pura: serve ao envio
 * (servidor) e às telas.
 */
export function qualificacaoDoTipo(signerType: string): string {
  switch (signerType) {
    case "client":
      return "Paciente";
    case "legal_guardian":
      return "Responsável legal";
    case "witness":
      return "Testemunha";
    case "risarte_representative":
      return "Representante da Risarte";
    case "company_representative":
      return "Representante da empresa";
    default:
      return "Signatário";
  }
}
