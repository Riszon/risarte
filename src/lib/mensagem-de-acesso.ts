// A MENSAGEM QUE SE MANDA PARA QUEM ACABOU DE GANHAR ACESSO.
//
// Pedido do dono (21/09/2026): depois de criar o cadastro e o acesso, ter um
// texto pronto para copiar ou mandar por WhatsApp/e-mail, com o endereço do
// sistema, o login, a senha provisória e **as unidades e funções da pessoa** —
// todas elas, quando for mais de uma.
//
// ⚠️ POR QUE ISTO É UMA FUNÇÃO PURA. O texto tem quatro coisas que erram
// sozinhas: a senha (que só existe naquele instante), a lista de unidades (que
// esquece a segunda), o endereço (que muda por ambiente) e o "o que fazer
// agora" (que muda conforme a pessoa já tenha ou não o sistema real liberado).
// Com teste, cada uma dessas quatro fica presa.
//
// ⚠️ E POR QUE A SENHA NÃO VAI NO MESMO CANAL POR PADRÃO: a mensagem diz para
// trocá-la no primeiro acesso, e a tela avisa para mandar a senha por um canal
// separado. Senha em grupo de WhatsApp é senha pública.

export type UnidadeDaPessoa = { unidade: string; funcao: string };

export type DadosDaMensagem = {
  nome: string;
  email: string;
  /** Só existe quando a senha acabou de ser definida (criação ou redefinição). */
  senha?: string | null;
  unidades: UnidadeDaPessoa[];
  /** Endereço do sistema real; vazio quando o Admin ainda não o configurou. */
  enderecoDoSistema?: string | null;
  /** Endereço do treino, quando a pessoa tem o treino liberado. */
  enderecoDoTreino?: string | null;
  /** A pessoa já pode entrar no sistema real? Se não, o caminho é o treino. */
  sistemaLiberado: boolean;
  /** Quem manda assina a mensagem. */
  assinatura?: string | null;
};

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome.trim();
}

/** "Recepcionista · Risarte Cambé" para cada unidade, em linhas. */
function linhasDasUnidades(unidades: UnidadeDaPessoa[]): string[] {
  return unidades.map((u) => `• ${u.unidade} — ${u.funcao}`);
}

export function mensagemDeAcesso(d: DadosDaMensagem): string {
  const partes: string[] = [];
  partes.push(`Oi, ${primeiroNome(d.nome)}! Seu acesso ao riSZon está pronto. 🎉`);
  partes.push("");

  if (d.unidades.length > 0) {
    partes.push(
      d.unidades.length === 1
        ? "ONDE VOCÊ ESTÁ CADASTRADO(A)"
        : "ONDE VOCÊ ESTÁ CADASTRADO(A) (mais de uma unidade)"
    );
    partes.push(...linhasDasUnidades(d.unidades));
    partes.push("");
  }

  partes.push("SEUS DADOS DE ACESSO");
  if (d.sistemaLiberado && d.enderecoDoSistema) {
    partes.push(`• Endereço: ${d.enderecoDoSistema}`);
  }
  partes.push(`• Login: ${d.email}`);
  if (d.senha) {
    partes.push(`• Senha provisória: ${d.senha}`);
  } else {
    partes.push("• Senha: a que você já usa (se esqueceu, me avise que eu redefino)");
  }
  partes.push("");

  if (d.sistemaLiberado) {
    partes.push(
      "No primeiro acesso, troque a senha em Perfil → Minha senha. A senha nova vale também no ambiente de treino."
    );
  } else {
    partes.push(
      "COMECE PELO TREINO: o riSZon Treino é o mesmo sistema, com dados de mentira, para você aprender sem medo de errar."
    );
    if (d.enderecoDoTreino) partes.push(`• Endereço do treino: ${d.enderecoDoTreino}`);
    partes.push(
      "Entre com o mesmo login e a mesma senha. Quando terminar o treinamento, libero o sistema do dia a dia para você."
    );
    partes.push(
      "Troque a senha em Perfil → Minha senha: ela vale nos dois ambientes."
    );
  }

  if (d.sistemaLiberado && d.enderecoDoTreino) {
    partes.push("");
    partes.push(
      `Para treinar sem mexer em dado de verdade, use o riSZon Treino: ${d.enderecoDoTreino} (mesmo login).`
    );
  }

  partes.push("");
  partes.push(
    "Qualquer dúvida, o Manual está dentro do sistema (o ícone de livro, no alto da tela) — e você pode relatar qualquer problema pela boia, ao lado dele."
  );
  if (d.assinatura) {
    partes.push("");
    partes.push(d.assinatura);
  }
  return partes.join("\n");
}

/** O endereço do WhatsApp com a mensagem pronta. Sem número, não há link. */
export function linkDoWhatsApp(telefone: string | null | undefined, texto: string): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  // 55 = Brasil. Número já com país continua como está.
  const completo = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${completo}?text=${encodeURIComponent(texto)}`;
}

/** O endereço de e-mail com assunto e corpo prontos. */
export function linkDeEmail(email: string | null | undefined, texto: string): string | null {
  const limpo = (email ?? "").trim();
  if (!limpo.includes("@")) return null;
  const assunto = encodeURIComponent("Seu acesso ao riSZon");
  return `mailto:${limpo}?subject=${assunto}&body=${encodeURIComponent(texto)}`;
}
