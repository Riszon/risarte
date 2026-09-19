import { FlaskConical, LifeBuoy, Repeat, ShieldAlert, Users } from "lucide-react";

/**
 * COMO USAR O riSZon TREINO — sempre no Início do treino (pedido do dono,
 * 19/09/2026).
 *
 * O recado principal é o que o dono pediu: fique à vontade, teste os limites,
 * e o treino não acaba com o treinamento inicial — ele fica sempre disponível
 * para tirar dúvida. Junto, dois avisos que evitam problema de verdade: dado
 * de paciente REAL não entra aqui (LGPD), e a equipe/acessos são cópia do real.
 *
 * É um `<details>` aberto: quem já leu recolhe com um clique, sem precisar de
 * guardar preferência em lugar nenhum.
 */
export function ComoUsarOTreino() {
  return (
    <details
      open
      className="group rounded-xl border border-gold/50 bg-gold/5 p-5 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="size-5 text-gold-tinta" />
          Este é o riSZon Treino — aqui é para testar
        </span>
        <span className="text-xs text-muted-foreground group-open:hidden">
          mostrar
        </span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">
          recolher
        </span>
      </summary>

      <p className="mt-3 text-sm leading-relaxed">
        É o <b>mesmo sistema</b> que a Risarte usa no dia a dia, com as mesmas
        telas e as mesmas regras — só que com <b>dados de mentira</b>. Nada do
        que você fizer aqui chega ao sistema real, a um paciente ou ao caixa de
        uma unidade.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3">
          <FlaskConical className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
          <p className="text-sm leading-relaxed">
            <b>Fique à vontade — e teste os limites.</b> Cadastre pacientes
            inventados, agende, remarque, faça a avaliação, monte o plano, feche
            a venda, dê baixa, cancele. Tente o caminho errado de propósito para
            ver o que o sistema responde. Errar aqui é o jeito de não errar lá.
          </p>
        </div>
        <div className="flex gap-3">
          <Repeat className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
          <p className="text-sm leading-relaxed">
            <b>Ele fica sempre disponível.</b> Não é só para o treinamento
            inicial: depois de liberado no sistema real, volte aqui sempre que
            tiver dúvida. Antes de fazer algo novo no real, faça primeiro aqui.
          </p>
        </div>
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p className="text-sm leading-relaxed">
            <b>Nunca use dados de pacientes reais.</b> Nome, CPF, telefone,
            fotos e exames de verdade são dados de saúde protegidos pela LGPD e
            não podem entrar aqui. Invente tudo.
          </p>
        </div>
        <div className="flex gap-3">
          <Users className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
          <p className="text-sm leading-relaxed">
            <b>A equipe vem do sistema real.</b> Os Risartanos, os acessos e as
            permissões são uma cópia de lá, só para consulta. Sua senha também:
            troque no Perfil do sistema real e ela passa a valer aqui.
          </p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <LifeBuoy className="mt-0.5 size-4 shrink-0" />
        A faixa amarela no alto da tela está sempre lá para lembrar onde você
        está. Se ela sumir, você está no sistema real.
      </p>
    </details>
  );
}
