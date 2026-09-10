/**
 * O TOPO DOS DOCUMENTOS DO RISARTE EMPRESARIAL — ficha, relatório e extrato.
 *
 * Pedido do dono (10/09/2026): *"inserir a logomarca do Risarte Empresarial nos
 * relatórios gerados"*. Antes havia só a frase "Risarte Empresarial — …" em
 * letra pequena; um documento que sai da empresa e chega ao cliente precisa da
 * assinatura, não de uma legenda.
 *
 * ⚠️ A VARIANTE É A NORMAL, NÃO A DO AMBIENTE. Na tela o Empresarial vive sobre
 * o bordô e usa a assinatura monocromática; **no papel o fundo é branco**, e
 * ali vale a arte original — marinho com EMPRESARIAL em bordô. Usar a versão
 * clara aqui imprimiria off-white sobre branco: nada.
 *
 * ⚠️ E É UM COMPONENTE, não a mesma marcação em três arquivos. Os três
 * documentos já tinham divergido no texto do cabeçalho; com a logomarca no meio
 * a chance de divergirem de novo só aumentaria.
 */
export function TopoDoRelatorio({
  tipo,
  children,
}: {
  /** O que este documento é: "ficha da empresa", "relatório detalhado"… */
  tipo: string;
  /** Nome da empresa, CNPJ, data — o que já existia no cabeçalho. */
  children: React.ReactNode;
}) {
  return (
    <header className="avoid-break border-b pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marca/empresarial-horizontal.svg"
          alt="Risarte Empresarial"
          className="h-7 w-auto"
        />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {tipo}
        </p>
      </div>
      <div className="mt-3">{children}</div>
    </header>
  );
}
