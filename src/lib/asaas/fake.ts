/**
 * O ASAAS DE MENTIRA (`ASAAS_ENV=fake`, ver `isAsaasFake` em `env.ts`).
 *
 * Responde o que a API responderia para as chamadas da ASA0 — carteira, dados
 * e situação da conta, tarifas, chave Pix, antecipação e webhook — e da ASA1
 * (clientes e cobranças, guardados na memória do processo), sem rede.
 * Serve ao servidor local de teste e ao E2E. Nenhuma conta é tocada.
 *
 * Uma chave que contenha `recusada` devolve 401, para a tela poder mostrar o
 * caminho da chave errada.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "RateLimit-Remaining": "24000" } });

export const fakeAsaasFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/^\/v3/, "").replace(/\/+$/, "");
  const key = String((init?.headers as Record<string, string> | undefined)?.access_token ?? "");

  if (key.includes("recusada")) {
    return json(401, { errors: [{ code: "invalid_access_token", description: "fake" }] });
  }

  if (method === "GET" && path === "/wallets") {
    return json(200, { data: [{ id: "fake-wallet-0000-0000-0000-000000000001" }] });
  }
  if (method === "GET" && path === "/myAccount/commercialInfo") {
    return json(200, {
      status: "APPROVED",
      personType: "JURIDICA",
      cpfCnpj: "00000000000191",
      name: "Conta de Mentira Ltda",
      commercialInfoExpiration: { isExpired: false, scheduledDate: "2027-11-10" },
    });
  }
  if (method === "GET" && path === "/myAccount/status") {
    return json(200, { id: "fake-account-1", commercialInfo: "APPROVED", bankAccountInfo: "APPROVED", documentation: "APPROVED", general: "APPROVED" });
  }
  if (method === "GET" && path === "/myAccount/fees") {
    return json(200, {
      payment: {
        bankSlip: { defaultValue: 1.99, discountValue: 0.99, expirationDate: "2099-01-31 00:00:00", daysToReceive: 1 },
        creditCard: {
          operationValue: 0.49,
          oneInstallmentPercentage: 2.99,
          upToSixInstallmentsPercentage: 3.49,
          upToTwelveInstallmentsPercentage: 3.99,
          upToTwentyOneInstallmentsPercentage: 4.29,
          daysToReceive: 32,
        },
        debitCard: { operationValue: 0.35, defaultPercentage: 1.89, daysToReceive: 3 },
        pix: { fixedFeeValue: 1.99, percentageFee: null, monthlyCreditsWithoutFee: 30 },
      },
    });
  }
  if (method === "GET" && path === "/pix/addressKeys") {
    return json(200, { data: [{ id: "fake-key", type: "EVP", status: "ACTIVE" }] });
  }
  if (method === "GET" && path === "/anticipations/configurations") {
    return json(200, { creditCardAutomaticEnabled: false });
  }
  if (method === "GET" && path === "/webhooks") {
    return json(200, { data: [] });
  }
  if (method === "POST" && path === "/webhooks") {
    return json(200, { id: `fake-webhook-${Date.now().toString(36)}`, enabled: true, interrupted: false, hasAuthToken: true });
  }
  if (method === "DELETE" && path.startsWith("/webhooks/")) {
    return json(200, { deleted: true });
  }
  // ---- clientes e cobranças (ASA1) — guardados na memória do processo ----
  if (method === "GET" && path === "/customers") {
    const cpf = url.searchParams.get("cpfCnpj") ?? "";
    const achado = FAKE_CUSTOMERS.get(cpf);
    return json(200, { data: achado ? [{ id: achado, cpfCnpj: cpf, deleted: false }] : [] });
  }
  if (method === "POST" && path === "/customers") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { cpfCnpj?: string };
    const id = `cus_fake${(FAKE_CUSTOMERS.size + 1).toString().padStart(6, "0")}`;
    FAKE_CUSTOMERS.set(String(body.cpfCnpj ?? ""), id);
    return json(200, { id, cpfCnpj: body.cpfCnpj, deleted: false });
  }
  if (method === "GET" && path === "/payments") {
    const ref = url.searchParams.get("externalReference") ?? "";
    return json(200, { data: [...FAKE_PAYMENTS.values()].filter((p) => p.externalReference === ref && !p.deleted) });
  }
  if (method === "POST" && path === "/payments") {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const id = `pay_fake${(FAKE_PAYMENTS.size + 1).toString().padStart(6, "0")}`;
    const p = {
      id,
      status: "PENDING",
      value: body.value,
      dueDate: body.dueDate,
      billingType: body.billingType,
      externalReference: body.externalReference,
      invoiceUrl: `https://sandbox.asaas.com/i/${id}`,
      bankSlipUrl: body.billingType === "BOLETO" ? `https://sandbox.asaas.com/b/pdf/${id}` : null,
      deleted: false,
    };
    FAKE_PAYMENTS.set(id, p);
    return json(200, p);
  }
  const pag = /^\/payments\/([^/]+)(\/[a-zA-Z]+)?$/.exec(path);
  if (pag) {
    const p = FAKE_PAYMENTS.get(pag[1]);
    if (!p) return json(404, { errors: [{ code: "not_found", description: "fake" }] });
    if (method === "GET" && !pag[2]) return json(200, p);
    if (method === "GET" && pag[2] === "/pixQrCode") return json(200, { payload: `00020126fake${p.id}`, encodedImage: "" });
    if (method === "GET" && pag[2] === "/identificationField") return json(200, { identificationField: "00190000090000000000000000000000000000000000000" });
    if (method === "DELETE" && !pag[2]) {
      if (p.status !== "PENDING" && p.status !== "OVERDUE") {
        return json(400, { errors: [{ code: "invalid_action", description: "fake" }] });
      }
      p.deleted = true;
      return json(200, { deleted: true, id: p.id });
    }
  }
  return json(404, { errors: [{ code: "not_found", description: "fake" }] });
};

type FakePayment = {
  id: string;
  status: string;
  value: unknown;
  dueDate: unknown;
  billingType: unknown;
  externalReference: unknown;
  invoiceUrl: string;
  bankSlipUrl: string | null;
  deleted: boolean;
};
const FAKE_CUSTOMERS = new Map<string, string>();
const FAKE_PAYMENTS = new Map<string, FakePayment>();

/** Para os testes: esvazia o Asaas de mentira e marca uma cobrança como paga. */
export function limparAsaasDeMentira() {
  FAKE_CUSTOMERS.clear();
  FAKE_PAYMENTS.clear();
}
export function pagarNoAsaasDeMentira(id: string) {
  const p = FAKE_PAYMENTS.get(id);
  if (p) p.status = "RECEIVED";
}
