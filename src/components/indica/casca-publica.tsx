import { RisarteMark } from "@/components/risarte-logo";

/**
 * A moldura das páginas públicas do Indica +Risos (convite, aceite, portal).
 * Pensadas para o CELULAR: é por onde o link chega (WhatsApp).
 *
 * Ética odontológica (CFO-196/2019): nada de preço, desconto ou "gratuito" em
 * texto público — o benefício do indicado é conversa da unidade, 1:1.
 */
export function CascaPublica({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
        <RisarteMark className="size-7 text-gold" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-wide">RISARTE ODONTOLOGIA</p>
          <p className="text-[11px] opacity-80">Indica +Risos</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-6">{children}</main>
      <footer className="px-4 py-4 text-center text-[11px] text-muted-foreground">
        Seus dados são usados só para a Risarte entrar em contato com você (LGPD).
      </footer>
    </div>
  );
}
