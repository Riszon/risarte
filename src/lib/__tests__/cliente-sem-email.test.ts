import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingClientFields, type ClientRegistrationFields } from "@/lib/clients";

// OC-00025 (0435): "Cliente sem e-mail", igual ao "Cliente sem CPF". O
// cadastro completo continua obrigatório; o CEP também (decisão do dono,
// 26/11/2026).

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

const completo = (): ClientRegistrationFields => ({
  fullName: "Maria",
  cpf: "000.000.000-00",
  noCpf: false,
  birthDate: "1940-01-01",
  phone: "(43) 99999-9999",
  email: null,
  noEmail: true,
  zipCode: "86000-000",
  address: "Rua A",
  addressNumber: "1",
  neighborhood: "Centro",
  city: "Londrina",
  state: "PR",
});

describe("OC-00025 — cliente sem e-mail", () => {
  it("marcado, o e-mail não falta; desmarcado, falta", () => {
    expect(missingClientFields(completo())).toEqual([]);
    expect(missingClientFields({ ...completo(), noEmail: false })).toContain("E-mail");
  });

  it("o CEP continua obrigatório mesmo sem e-mail", () => {
    expect(missingClientFields({ ...completo(), zipCode: null })).toContain("CEP");
  });

  it("o banco conta a marcação e a desfaz quando há e-mail (0435)", () => {
    const sql = ler("supabase", "migrations", "0435_cliente_sem_email.sql");
    expect(sql).toContain("and (new.no_email or coalesce(btrim(new.email), '') <> '')");
    expect(sql).toMatch(/if coalesce\(btrim\(new\.email\), ''\) <> '' then\s+new\.no_email := false;/);
    expect(sql).toContain("and coalesce(btrim(new.zip_code), '') <> ''");
  });

  it("o servidor aceita sem e-mail só com a marcação", () => {
    const t = ler("src", "app", "(app)", "prontuarios", "actions.ts");
    expect(t).toMatch(/const noEmail = !email && formData\.get\("no_email"\) === "true";/);
    expect(t).not.toContain('["email", "E-mail"],');
    expect(t).toContain("no_email: noEmail,");
  });

  it("a agenda e a ficha leem a marcação", () => {
    expect(ler("src", "app", "(app)", "agenda", "actions.ts")).toContain("noEmail: row.no_email,");
    expect(ler("src", "app", "(app)", "prontuarios", "[id]", "page.tsx")).toContain("noEmail: client.no_email,");
  });
});
