// Gênero — usado no cadastro do cliente e, na Anamnese 2.0, para direcionar
// perguntas por gênero. Identificadores em inglês; rótulos em pt-BR.

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  female: "Feminino",
  male: "Masculino",
  other: "Outro",
  undisclosed: "Prefiro não informar",
};

export function genderLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (GENDER_LABELS as Record<string, string>)[value] ?? value;
}
