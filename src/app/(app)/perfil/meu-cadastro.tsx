import { IdCard } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBrDate } from "@/lib/dates";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import {
  CONTRACT_LABELS,
  GENDER_LABELS,
  MARITAL_LABELS,
  STAFF_PHOTO_BUCKET,
  type ContractType,
  type Gender,
  type MaritalStatus,
} from "@/lib/staff";

/**
 * MEU CADASTRO — o que a Risarte tem sobre mim (21/09/2026).
 *
 * Pedido do dono: *"deve aparecer no meu perfil com os dados que foi preenchido
 * no cadastro"*. Até aqui o Perfil mostrava só nome, telefone e as funções do
 * ACESSO — nada da ficha. Quem quisesse conferir o próprio endereço ou a
 * função prevista dependia de perguntar a alguém.
 *
 * ⚠️ SÓ LEITURA, e é de propósito: a ficha é cadastro de RH. Deixar a pessoa
 * editar o próprio CPF ou a própria unidade transformaria o cadastro em
 * autodeclaração. O que ela corrige sozinha (nome de tratamento e telefone de
 * contato) continua no formulário acima.
 *
 * ⚠️ É O PRÓPRIO DADO DA PESSOA: a consulta filtra por `user_id = eu`, e a RLS
 * de `staff_members` responde de novo. Ninguém vê a ficha de outro por aqui.
 */
type FichaDoPerfil = {
  code: string | null;
  full_name: string;
  preferred_name: string | null;
  cpf: string | null;
  birth_date: string | null;
  gender: string | null;
  marital_status: string | null;
  spouse_name: string | null;
  whatsapp: string | null;
  email: string | null;
  zip_code: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  contract_type: string | null;
  role_title: string | null;
  specialties: string[] | null;
  photo_path: string | null;
  is_active: boolean;
  clinics: { name: string } | null;
};

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b py-1.5 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  );
}

export async function MeuCadastro({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data: ficha } = await supabase
    .from("staff_members")
    .select(
      "code, full_name, preferred_name, cpf, birth_date, gender, marital_status, spouse_name, whatsapp, email, zip_code, address, address_number, complement, neighborhood, city, state, contract_type, role_title, specialties, photo_path, is_active, clinics ( name )"
    )
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle<FichaDoPerfil>();

  // Sem ficha: a pessoa tem login e ainda não foi cadastrada. Dizer isso é
  // melhor que esconder o bloco — ela saberá o que pedir a quem.
  if (!ficha) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IdCard className="size-4 text-gold-tinta" />
            Meu cadastro
          </CardTitle>
          <CardDescription>
            Você ainda não tem ficha de Risartano. Fale com a gestão da sua
            unidade para completarem o seu cadastro.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let fotoUrl: string | null = null;
  if (ficha.photo_path) {
    const { data } = await supabase.storage
      .from(STAFF_PHOTO_BUCKET)
      .createSignedUrl(ficha.photo_path, 3600);
    fotoUrl = data?.signedUrl ?? null;
  }

  const funcao =
    ficha.role_title && ficha.role_title in ROLE_LABELS
      ? ROLE_LABELS[ficha.role_title as UserRole]
      : ficha.role_title;

  const endereco = [
    [ficha.address, ficha.address_number].filter(Boolean).join(", "),
    ficha.complement,
    ficha.neighborhood,
    [ficha.city, ficha.state].filter(Boolean).join(" - "),
    ficha.zip_code,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IdCard className="size-4 text-gold-tinta" />
          Meu cadastro
        </CardTitle>
        <CardDescription>
          O que a Risarte tem no seu cadastro. Encontrou algo errado? Fale com a
          gestão da sua unidade — só ela corrige estes dados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fotoUrl}
              alt=""
              className="size-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
              {(ficha.preferred_name || ficha.full_name).slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            {ficha.code && (
              <p className="font-mono text-xs text-gold-tinta">{ficha.code}</p>
            )}
            <p className="text-sm font-medium">
              {ficha.preferred_name || ficha.full_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {[funcao, ficha.clinics?.name].filter(Boolean).join(" · ") ||
                "sem função no cadastro"}
              {!ficha.is_active && " · fora da equipe"}
            </p>
          </div>
        </div>

        <dl>
          <Linha rotulo="Nome completo" valor={ficha.full_name} />
          <Linha rotulo="Unidade do cadastro" valor={ficha.clinics?.name ?? null} />
          <Linha rotulo="Função na unidade" valor={funcao} />
          <Linha
            rotulo="Regime de contrato"
            valor={
              ficha.contract_type
                ? CONTRACT_LABELS[ficha.contract_type as ContractType]
                : null
            }
          />
          <Linha
            rotulo="Especialidades"
            valor={ficha.specialties?.length ? ficha.specialties.join(", ") : null}
          />
          <Linha rotulo="CPF" valor={ficha.cpf} />
          <Linha
            rotulo="Nascimento"
            valor={
              ficha.birth_date
                ? formatBrDate(`${ficha.birth_date}T12:00:00-03:00`)
                : null
            }
          />
          <Linha
            rotulo="Gênero"
            valor={ficha.gender ? GENDER_LABELS[ficha.gender as Gender] : null}
          />
          <Linha
            rotulo="Estado civil"
            valor={
              ficha.marital_status
                ? MARITAL_LABELS[ficha.marital_status as MaritalStatus]
                : null
            }
          />
          <Linha rotulo="Cônjuge" valor={ficha.spouse_name} />
          <Linha rotulo="WhatsApp" valor={ficha.whatsapp} />
          <Linha rotulo="E-mail do cadastro" valor={ficha.email} />
          <Linha rotulo="Endereço" valor={endereco || null} />
        </dl>
      </CardContent>
    </Card>
  );
}
