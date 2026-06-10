import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SetupNotice() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-primary">
            Risarte Odontologia — Configuração pendente
          </CardTitle>
          <CardDescription>
            O sistema ainda não está conectado ao banco de dados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Falta criar o arquivo <code className="font-mono">.env.local</code>{" "}
            com as chaves do projeto Supabase (veja o guia{" "}
            <code className="font-mono">docs/GUIA-SUPABASE.md</code>).
          </p>
          <p>
            Depois de criar o arquivo, reinicie o servidor e recarregue esta
            página.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
