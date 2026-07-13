// System version shown in the sidebar so the owner can confirm an update went
// live. Bump with every delivered stage/fix that gets pushed and deployed; set
// the *_MIGRATION to the highest migration the owner must apply for that project.
//
// PARALELO: dois projetos dividem este arquivo (ver "Trabalho em PARALELO" no
// CLAUDE.md). Cada agente edita SÓ as suas duas linhas — nunca as do outro.

// Core (MVP / riSZon) — faixa de migração 0106+ (0–999).
export const APP_VERSION = "0.55.0";
export const LATEST_MIGRATION = "0122";

// Risarte Empresarial (B2B) — faixa de migração 1000+.
export const EMPRESARIAL_VERSION = "0.34.1";
export const EMPRESARIAL_MIGRATION = "0104";
