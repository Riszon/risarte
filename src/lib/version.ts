// System version shown in the sidebar so the owner can confirm an update went
// live. Bump with every delivered stage/fix that gets pushed and deployed; set
// the *_MIGRATION to the highest migration the owner must apply for that project.
//
// PARALELO: dois projetos dividem este arquivo (ver "Trabalho em PARALELO" no
// CLAUDE.md). Cada agente edita SÃ“ as suas duas linhas â€” nunca as do outro.

// Core (MVP / riSZon) â€” faixa de migraÃ§Ã£o 0106+ (0â€“999).
export const APP_VERSION = "0.224.0";
export const LATEST_MIGRATION = "0245";

// Risarte Empresarial (B2B) â€” faixa de migraÃ§Ã£o 1000+.
export const EMPRESARIAL_VERSION = "0.42.0";
export const EMPRESARIAL_MIGRATION = "1005";
