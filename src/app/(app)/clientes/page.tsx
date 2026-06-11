import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Clientes" };

type ClientRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "anonymized";
  created_at: string;
};

const STATUS_LABELS: Record<ClientRow["status"], string> = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
};

export default async function ClientsPage(props: PageProps<"/clientes">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const query = typeof searchParams.q === "string" ? searchParams.q.trim() : "";

  const clinicId = session.activeClinic?.id;
  const canCreate = hasRoleInClinic(session, clinicId, ["receptionist"]);

  let clients: ClientRow[] = [];
  if (clinicId) {
    const supabase = await createClient();
    let request = supabase
      .from("clients")
      .select("id, full_name, phone, email, status, created_at")
      .eq("clinic_id", clinicId)
      .order("full_name")
      .limit(100);
    if (query) {
      request = request.ilike("full_name", `%${query}%`);
    }
    const { data } = await request.returns<ClientRow[]>();
    clients = data ?? [];
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic
              ? `Clientes de ${session.activeClinic.name}.`
              : "Selecione uma clínica no menu lateral."}
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/clientes/novo" />}>
            Novo cliente
          </Button>
        )}
      </div>

      <form method="get" className="flex max-w-sm gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Buscar por nome..."
        />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-medium">
                  {client.full_name}
                </TableCell>
                <TableCell>{client.phone ?? "—"}</TableCell>
                <TableCell>{client.email ?? "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={client.status === "active" ? "secondary" : "outline"}
                  >
                    {STATUS_LABELS[client.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/clientes/${client.id}`} />}
                  >
                    Abrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {query
                    ? "Nenhum cliente encontrado com esse nome."
                    : "Nenhum cliente cadastrado nesta clínica ainda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
