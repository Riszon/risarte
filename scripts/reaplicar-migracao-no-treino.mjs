// Reaplica UMA migração idempotente no banco de TREINO (durante a construção,
// quando a migração já foi gravada em schema_migrations e mudou). Recusa a produção.
//   RISARTE_TREINO_POOLER=1 node scripts/reaplicar-migracao-no-treino.mjs supabase/migrations/4013_....sql
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";
const arq = process.argv[2];
if (!arq) { console.log("Uso: node scripts/reaplicar-migracao-no-treino.mjs <arquivo.sql>"); process.exit(2); }
const c = await connect();
const sql = readFileSync(arq, "utf8");
try {
  const res = await c.query(sql);
  const ult = Array.isArray(res) ? res.at(-1) : res;
  console.log("reaplicada:", arq, "| conferência:", JSON.stringify(ult?.rows?.[0] ?? null));
} catch (e) {
  console.error("ERRO:", e.message, e.position ? `(posição ${e.position})` : "");
  process.exitCode = 1;
} finally {
  await c.end();
}
