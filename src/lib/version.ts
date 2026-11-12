// System version shown in the sidebar so the owner can confirm an update went
// live. Bump with every delivered stage/fix that gets pushed and deployed; set
// the *_MIGRATION to the highest migration the owner must apply for that project.
//
// PARALELO: dois projetos dividem este arquivo (ver "Trabalho em PARALELO" no
// CLAUDE.md). Cada agente edita SÓ as suas duas linhas — nunca as do outro.

// Core (MVP / riSZon) — faixa de migração 0106+ (0–999).
export const APP_VERSION = "0.438.0";
export const LATEST_MIGRATION = "0402";

// Risarte Empresarial (B2B) — faixa de migração 1000+.
export const EMPRESARIAL_VERSION = "0.101.0";
export const EMPRESARIAL_MIGRATION = "1043";

// Indica +Risos (programa de indicação) — faixa de migração 2000+.
export const INDICA_VERSION = "0.9.0";
export const INDICA_MIGRATION = "2011";

// Rita (assistente virtual de SDR) — schema `rita`, faixa de migração 3000+.
// Estado em `docs/sdr/ESTADO.md`.
export const RITA_VERSION = "0.7.0";
export const RITA_MIGRATION = "3006";

// Integração Asaas e Central de Configuração — tabelas `gateway_*` e
// `central_*` no schema `public`, faixa de migração 4000+.
// Estado em `docs/asaas/ESTADO.md`; especificação em `docs/integracao-asaas.md`.
export const ASAAS_VERSION = "0.5.0";
export const ASAAS_MIGRATION = "4006";
