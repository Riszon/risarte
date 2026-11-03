import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CLINIC_TYPE_LABELS, type ClinicType } from "@/lib/roles";
import { ClinicFormDialog } from "./clinic-form-dialog";

export const metadata: Metadata = { title: "Clínicas" };

type ClinicRow = {
  id: string;
  name: string;
  code: string | null;
  type: ClinicType;
  max_rooms: number | null;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_active: boolean;
  legal_name?: string | null;
};

export default async function ClinicsPage() {
  await requireAdminMaster();
  const supabase = await createClient();
  const { data: clinicsBase } = await supabase
    .from("clinics")
    .select(
      "id, name, code, type, max_rooms, cnpj, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, is_active"
    )
    .order("type")
    .order("name")
    .returns<ClinicRow[]>();
  // 0350: a razão social é lida À PARTE — sem a migração, a lista abre igual e
  // o formulário avisa em vez de mandar uma coluna que o banco não conhece.
  const { data: razoes, error: razoesErro } = await supabase
    .from("clinics")
    .select("id, legal_name")
    .returns<{ id: string; legal_name: string | null }[]>();
  const legalNameReady = !razoesErro;
  const razaoPorId = new Map((razoes ?? []).map((r) => [r.id, r.legal_name]));
  const clinics = (clinicsBase ?? []).map((c) => ({ ...c, legal_name: razaoPorId.get(c.id) ?? null }));

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clínicas</h1>
          <p className="text-sm text-muted-foreground">
            Unidades da rede Risarte.
          </p>
        </div>
        <div className="flex gap-2">
          <ClinicFormDialog
            clinicType="franchisor"
            legalNameReady={legalNameReady}
            trigger={<Button variant="outline">Cadastrar Franqueadora</Button>}
          />
          <ClinicFormDialog
            clinicType="franchise_unit"
            legalNameReady={legalNameReady}
            trigger={<Button>Nova Clínica</Button>}
          />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(clinics ?? []).map((clinic) => (
              <TableRow key={clinic.id}>
                <TableCell className="font-medium">
                  {clinic.name}
                  {clinic.code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {clinic.code}
                    </span>
                  )}
                </TableCell>
                <TableCell>{CLINIC_TYPE_LABELS[clinic.type]}</TableCell>
                <TableCell>
                  {clinic.city
                    ? `${clinic.city}${clinic.state ? ` / ${clinic.state}` : ""}`
                    : "—"}
                </TableCell>
                <TableCell>
                  {clinic.is_active ? (
                    <Badge variant="secondary">Ativa</Badge>
                  ) : (
                    <Badge variant="destructive">Inativa</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <ClinicFormDialog
                    clinic={clinic}
                    legalNameReady={legalNameReady}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Editar
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
            {(clinics ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhuma clínica cadastrada. Comece criando a franqueadora.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
