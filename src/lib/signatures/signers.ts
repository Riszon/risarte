import { ehMenorDeIdade } from "@/lib/idade";
import type { OrderGroup, SignatureTemplate, SignerDraft, StaffSignerOption } from "./types";

/**
 * QUEM ASSINA, EM QUE ORDEM (plano ZS0 §7). Regra pura, testada em
 * `assinaturas-signatarios.test.ts`.
 *
 * Grupo 1 = o cliente (ou o responsável legal, se menor); grupo 2 = as
 * testemunhas; grupo 3 = os representantes da Risarte, um por modelo que pede,
 * sem repetir a mesma pessoa. Pessoa repetida (mesmo CPF, ou mesmo usuário)
 * entra uma vez só.
 */

export type ClientForSigning = {
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
};

export type GuardianForSigning = {
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  relationship: string | null;
};

export const QUALIFICACAO = {
  client: "Paciente",
  legal_guardian: "Responsável legal",
  witness: "Testemunha",
  risarte_representative: "Representante da Risarte",
  company_representative: "Representante da empresa",
} as const;

export type SignersResult = {
  signers: SignerDraft[];
  /** O que impede o envio, nas palavras da tela. Vazio = pode seguir. */
  blockers: string[];
  /** Quem assina pelo lado do cliente. */
  clientSide: "client" | "legal_guardian";
  witnessesNeeded: number;
};

export function montarSignatarios(input: {
  client: ClientForSigning;
  guardians: GuardianForSigning[];
  /** Hoje, 'aaaa-mm-dd' no Brasil (`todayInBrazil()`). */
  todayIso: string;
  templates: Pick<
    SignatureTemplate,
    "name" | "witness_count" | "risarte_signer_mode" | "risarte_signer_role" | "risarte_signer_user_id"
  >[];
  /** As testemunhas escolhidas na janela (já resolvidas em pessoa). */
  witnesses: StaffSignerOption[];
  /** O representante escolhido para cada modelo (índice = o do modelo); nulo = não resolvido. */
  representatives: (StaffSignerOption | null)[];
}): SignersResult {
  const blockers: string[] = [];
  const signers: SignerDraft[] = [];
  let order = 0;

  let clientSide: SignersResult["clientSide"] = "client";
  if (!input.client.birthDate) {
    blockers.push("O paciente não tem data de nascimento cadastrada: sem ela não dá para saber quem assina.");
  }
  const menor = ehMenorDeIdade(input.client.birthDate ?? "", input.todayIso);
  if (menor) {
    clientSide = "legal_guardian";
    const g = input.guardians[0];
    if (!g) {
      blockers.push("O paciente é menor de idade e não tem responsável legal cadastrado.");
    } else {
      signers.push({
        sort_order: order++,
        order_group: 1,
        signer_type: "legal_guardian",
        name: g.name,
        cpf: limparCpf(g.cpf),
        email: limparEmail(g.email),
        phone: g.phone,
        user_id: null,
        staff_member_id: null,
        qualification: QUALIFICACAO.legal_guardian,
      });
    }
  } else {
    signers.push({
      sort_order: order++,
      order_group: 1,
      signer_type: "client",
      name: input.client.name,
      cpf: limparCpf(input.client.cpf),
      email: limparEmail(input.client.email),
      phone: input.client.phone,
      user_id: null,
      staff_member_id: null,
      qualification: QUALIFICACAO.client,
    });
  }

  const resto = testemunhasERisarte({ signers, order, templates: input.templates, witnesses: input.witnesses, representatives: input.representatives });
  blockers.push(...resto.blockers);
  return { signers, blockers, clientSide, witnessesNeeded: resto.witnessesNeeded };
}

/**
 * QUEM ASSINA PELA EMPRESA (ZS5, plano ZS0 §4.6). Grupo 1 = o representante
 * legal da empresa (o responsável da proposta, ou o que quem envia corrigir na
 * janela); grupos 2 e 3 = as mesmas regras do paciente (testemunhas e
 * Risarte). Não há menor de idade nem responsável legal aqui.
 */
export function montarSignatariosDaEmpresa(input: {
  representante: { name: string | null; cpf: string | null; email: string | null; phone: string | null };
  templates: Pick<
    SignatureTemplate,
    "name" | "witness_count" | "risarte_signer_mode" | "risarte_signer_role" | "risarte_signer_user_id"
  >[];
  witnesses: StaffSignerOption[];
  representatives: (StaffSignerOption | null)[];
}): Omit<SignersResult, "clientSide"> {
  const blockers: string[] = [];
  const signers: SignerDraft[] = [];
  const nome = (input.representante.name ?? "").trim();
  if (!nome) {
    blockers.push("Falta o nome de quem assina pela empresa.");
  } else {
    signers.push({
      sort_order: 0,
      order_group: 1,
      signer_type: "company_representative",
      name: nome,
      cpf: limparCpf(input.representante.cpf),
      email: limparEmail(input.representante.email),
      phone: input.representante.phone,
      user_id: null,
      staff_member_id: null,
      qualification: QUALIFICACAO.company_representative,
    });
  }
  const resto = testemunhasERisarte({ signers, order: signers.length, templates: input.templates, witnesses: input.witnesses, representatives: input.representatives });
  blockers.push(...resto.blockers);
  return { signers, blockers, witnessesNeeded: resto.witnessesNeeded };
}

function testemunhasERisarte(input: {
  signers: SignerDraft[];
  order: number;
  templates: Pick<SignatureTemplate, "name" | "witness_count" | "risarte_signer_mode">[];
  witnesses: StaffSignerOption[];
  representatives: (StaffSignerOption | null)[];
}): { blockers: string[]; witnessesNeeded: number } {
  const { signers } = input;
  let order = input.order;
  const blockers: string[] = [];
  const witnessesNeeded = Math.max(0, ...input.templates.map((t) => t.witness_count));
  const vistas = new Set<string>();
  for (const w of input.witnesses) {
    const chave = chaveDaPessoa(w);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    signers.push(pessoaDoSistema(w, order++, 2, "witness", QUALIFICACAO.witness));
  }
  const testemunhas = signers.filter((s) => s.order_group === 2).length;
  if (testemunhas < witnessesNeeded) {
    blockers.push(
      witnessesNeeded === 1
        ? "Falta escolher a testemunha."
        : `Faltam testemunhas: o pacote pede ${witnessesNeeded} e tem ${testemunhas}.`
    );
  }

  input.templates.forEach((t, i) => {
    if (t.risarte_signer_mode === "none") return;
    const rep = input.representatives[i] ?? null;
    if (!rep) {
      blockers.push(`Falta definir quem assina pela Risarte no modelo "${t.name}".`);
      return;
    }
    const chave = chaveDaPessoa(rep);
    if (vistas.has(chave)) {
      // A mesma pessoa já assina como testemunha ou por outro modelo: não repete.
      const jaRisarte = signers.some((s) => s.order_group === 3 && chaveDaPessoa(s) === chave);
      if (jaRisarte) return;
      if (signers.some((s) => s.order_group === 2 && chaveDaPessoa(s) === chave)) {
        blockers.push(`${rep.name} não pode ser testemunha e representante da Risarte no mesmo pacote.`);
        return;
      }
    }
    vistas.add(chave);
    signers.push(pessoaDoSistema(rep, order++, 3, "risarte_representative", QUALIFICACAO.risarte_representative));
  });

  // O cliente não pode ser testemunha nem representante de si mesmo.
  const cliente = signers.find((s) => s.order_group === 1);
  if (cliente?.cpf) {
    const repetido = signers.find((s) => s.order_group !== 1 && s.cpf && s.cpf === cliente.cpf);
    if (repetido) blockers.push(`${repetido.name} tem o mesmo CPF de quem assina pelo cliente.`);
  }

  return { blockers, witnessesNeeded };
}

function pessoaDoSistema(
  p: StaffSignerOption,
  sort_order: number,
  order_group: OrderGroup,
  signer_type: SignerDraft["signer_type"],
  qualification: string
): SignerDraft {
  return {
    sort_order,
    order_group,
    signer_type,
    name: p.name,
    cpf: limparCpf(p.cpf),
    email: limparEmail(p.email),
    phone: p.phone,
    user_id: p.user_id,
    staff_member_id: p.staff_member_id,
    qualification,
  };
}

function chaveDaPessoa(p: { cpf: string | null; user_id?: string | null; staff_member_id?: string | null; name: string }): string {
  const cpf = limparCpf(p.cpf);
  if (cpf) return `cpf:${cpf}`;
  if (p.user_id) return `user:${p.user_id}`;
  if (p.staff_member_id) return `staff:${p.staff_member_id}`;
  return `name:${p.name.trim().toLowerCase()}`;
}

export function limparCpf(cpf: string | null | undefined): string | null {
  const d = (cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

function limparEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

/**
 * Resolve quem assina pela Risarte num modelo, a partir das pessoas
 * disponíveis: por papel (lista — a tela escolhe; padrão a primeira), quem
 * envia, uma pessoa fixa, ou ninguém.
 */
export function candidatosDoRepresentante(input: {
  template: Pick<SignatureTemplate, "risarte_signer_mode" | "risarte_signer_role" | "risarte_signer_user_id">;
  sender: StaffSignerOption;
  staff: StaffSignerOption[];
  /** Pessoas por papel na unidade emissora (e na Franqueadora, quando o papel é de lá). */
  byRole: Record<string, StaffSignerOption[]>;
}): StaffSignerOption[] {
  const t = input.template;
  switch (t.risarte_signer_mode) {
    case "none":
      return [];
    case "sender":
      return [input.sender];
    case "user":
      return input.staff.filter((s) => s.user_id && s.user_id === t.risarte_signer_user_id);
    case "role":
      return t.risarte_signer_role ? (input.byRole[t.risarte_signer_role] ?? []) : [];
  }
}
