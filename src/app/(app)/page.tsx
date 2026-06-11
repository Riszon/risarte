import { getSessionContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, CLINIC_TYPE_LABELS } from "@/lib/roles";

export default async function HomePage() {
  const session = await getSessionContext();

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {session.fullName.split(" ")[0] || "bem-vindo(a)"}!
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic
            ? `Você está trabalhando em: ${session.activeClinic.name}`
            : "Nenhuma clínica cadastrada ainda."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Suas clínicas e funções</CardTitle>
          <CardDescription>
            Use o seletor no menu lateral para trocar de clínica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.isAdminMaster && (
            <p className="mb-3 text-sm text-muted-foreground">
              Você é <Badge className="bg-gold text-gold-foreground">Admin Master</Badge>{" "}
              e tem acesso a todas as clínicas da rede.
            </p>
          )}
          {session.clinics.length > 0 ? (
            <ul className="space-y-2">
              {session.clinics.map((clinic) => (
                <li
                  key={clinic.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{clinic.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CLINIC_TYPE_LABELS[clinic.type]}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(session.rolesByClinic[clinic.id] ?? []).map((role) => (
                      <Badge key={role} variant="secondary">
                        {ROLE_LABELS[role]}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !session.isAdminMaster && (
              <p className="text-sm text-muted-foreground">
                Nenhuma função atribuída ainda. Fale com o administrador.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
