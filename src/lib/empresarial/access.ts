import { pode, type SessionContext } from "@/lib/auth";

// ⚠️ DESDE A 1048 (pedido do dono, 16/11/2026) QUEM PODE O QUÊ NO EMPRESARIAL
// VEM DA MATRIZ DE PERMISSÕES (Administração → Permissões, grupo "Ações —
// Empresarial"), e o BANCO pergunta à mesma matriz (`empresarial.pode`).
// Antes os papéis estavam escritos aqui e nas regras do banco, e não havia
// como ver nem mudar. O Admin Master passa sempre (`pode` já faz isso).

/**
 * Gere o programa por inteiro (parte comercial, toda a rede): Admin ou
 * Franqueadora (rede). Espelha `empresarial.is_program_manager()` da RLS.
 *
 * ⚠️ O Consultor RisLife NÃO é gestor (AP95, decisão do dono, 03/11/2026;
 * 1039): ele trabalha só nas empresas e nos leads em que é o responsável. Para
 * deixar o consultor agir numa empresa ou num lead, use
 * `canWorkOnCompanies` — o banco limita às dele.
 */
export function isProgramManager(session: SessionContext): boolean {
  return pode(session, "acao.empresarial.gerir");
}

/**
 * Pode mexer nos dados de uma empresa ou de um lead: o gestor (todas) ou o
 * Consultor RisLife (o banco só deixa as dele — `is_my_company`,
 * `can_access_lead`). As configurações da REDE seguem com `isProgramManager`.
 */
export function canWorkOnCompanies(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

/**
 * CUIDA DO FINANCEIRO DO PROGRAMA (OC-00105, decisão do dono 16/10/2026): o
 * gestor do programa OU o Financeiro da Franqueadora. O Financeiro faz SÓ o
 * financeiro — gerar mensalidade e implantação (também em lote), dar baixa,
 * editar, cancelar, estornar, checar inadimplência e o Acordo de cobrança.
 * Funil, proposta, contrato, termos e configurações seguem com o gestor.
 * Espelha `empresarial.is_program_finance()` (1029) — a tela segue o banco.
 */
export function isProgramFinance(session: SessionContext): boolean {
  if (isProgramManager(session)) return true;
  return pode(session, "acao.empresarial.cobrancas");
}

/**
 * MEXE NAS CONFIGURAÇÕES DO PROGRAMA (as regras da rede: preços e divisão
 * padrão, benefícios, vantagens, modelos). Espelha
 * `empresarial.can_configure_program()` (1048).
 */
export function canConfigureProgram(session: SessionContext): boolean {
  return pode(session, "acao.empresarial.configurar");
}

/**
 * CADASTRA TITULARES E DEPENDENTES (incluir, importar, inativar, reativar).
 * Espelha `empresarial.can_manage_employees()` (1048); o ALCANCE (quais
 * empresas) continua do banco.
 */
export function canManageEmployees(session: SessionContext): boolean {
  return pode(session, "acao.empresarial.titulares");
}

/**
 * Vê o módulo Empresarial: gestores do programa + gestão/atendimento da unidade
 * (que enxergam as empresas com titulares na sua unidade).
 */
export function canViewEmpresarial(session: SessionContext): boolean {
  // Vem da matriz de permissões (0246), editável em /admin/permissoes.
  if (isProgramFinance(session)) return true;
  return pode(session, "modulo.empresarial");
}

/**
 * TRABALHA NA PRÓPRIA CARTEIRA: funil, agenda, propostas, contratos e edição
 * das empresas e leads de que a pessoa é a responsável (permissão
 * `acao.empresarial.carteira`; padrão: o Consultor RisLife). O nome ficou o
 * de antes porque todo uso quer dizer isso; quem decide agora é a matriz.
 * O banco limita às dela (`is_my_company`, `can_access_lead`).
 */
export function isRislifeConsultant(session: SessionContext): boolean {
  return pode(session, "acao.empresarial.carteira");
}
