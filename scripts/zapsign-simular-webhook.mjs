// SIMULA O WEBHOOK DA ZAPSIGN (plano ZS0 §13, ZS3). Monta o corpo que a
// ZapSign mandaria para um pacote do banco de TREINO e faz o POST na rota do
// sistema com o segredo — para provar a ordem, a recusa, o vencimento e a
// repetição sem depender do sandbox.
//
//   node scripts/zapsign-simular-webhook.mjs ASS-000013 signed 1
//   node scripts/zapsign-simular-webhook.mjs ASS-000013 signed 2   (o 2º signatário)
//   node scripts/zapsign-simular-webhook.mjs ASS-000013 refused 1 "não concordo"
//   node scripts/zapsign-simular-webhook.mjs ASS-000013 expired
//   node scripts/zapsign-simular-webhook.mjs ASS-000013 viewed 1
//
// Lê o `.env.test.local` (recusa a produção), o pacote e os signatários pela
// chave de serviço, e manda para RISARTE_URL (padrão http://localhost:3100)
// com ZAPSIGN_WEBHOOK_SECRET do próprio `.env.test.local` (ou o argumento
// --segredo). Imprime só situações e contagens.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PRODUCAO = "hvhbijctanrrkxhemlza";
const env = Object.fromEntries(
  readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes(PRODUCAO)) {
  throw new Error("RECUSADO: só o banco de TREINO (.env.test.local)");
}

const args = process.argv.slice(2);
const segredoArg = args.find((a) => a.startsWith("--segredo="))?.slice("--segredo=".length);
const [numero, evento = "signed", posicao = "1", motivo = "Recusado no ensaio"] = args.filter((a) => !a.startsWith("--"));
if (!numero) throw new Error("uso: node scripts/zapsign-simular-webhook.mjs ASS-000013 signed|refused|expired|deleted|viewed [posição] [motivo]");
const base = process.env.RISARTE_URL || "http://localhost:3100";
const segredo = segredoArg || process.env.ZAPSIGN_WEBHOOK_SECRET || env.ZAPSIGN_WEBHOOK_SECRET;
if (!segredo) throw new Error("falta ZAPSIGN_WEBHOOK_SECRET (no .env.test.local, no ambiente ou --segredo=)");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: pkg, error } = await admin
  .from("signature_packages")
  .select("id, number, status, current_stage, zapsign_doc_token, zapsign_open_id, expires_at, created_at")
  .eq("number", numero)
  .maybeSingle();
if (error || !pkg) throw new Error(`pacote ${numero} não encontrado no treino`);
if (!pkg.zapsign_doc_token) throw new Error(`pacote ${numero} ainda não foi enviado (sem token)`);
const { data: signers } = await admin
  .from("signature_signers")
  .select("id, sort_order, order_group, zapsign_signer_token, status, signed_at")
  .eq("package_id", pkg.id)
  .order("sort_order");

const agora = new Date().toISOString();
const idx = Number(posicao) - 1;
const alvo = signers[idx];
const tipo = { signed: "doc_signed", refused: "doc_refused", expired: "doc_expired", deleted: "doc_deleted", viewed: "doc_viewed" }[evento];
if (!tipo) throw new Error("evento inválido: signed | refused | expired | deleted | viewed");
if ((tipo === "doc_signed" || tipo === "doc_refused" || tipo === "doc_viewed") && !alvo) throw new Error(`não há signatário na posição ${posicao}`);

const zapStatus = (s, i) => {
  if (tipo === "doc_signed" && i === idx) return { status: "signed", signed_at: agora };
  if (s.status === "signed") return { status: "signed", signed_at: s.signed_at };
  if (s.status === "link_opened" || (tipo === "doc_viewed" && i === idx)) return { status: "link-opened", signed_at: null };
  return { status: "new", signed_at: null };
};
const todosAssinados = tipo === "doc_signed" && signers.every((s, i) => s.status === "signed" || i === idx);
const body = {
  event_type: tipo,
  token: pkg.zapsign_doc_token,
  open_id: pkg.zapsign_open_id,
  external_id: pkg.id,
  name: `${pkg.number} (ensaio)`,
  status: tipo === "doc_refused" ? "refused" : todosAssinados ? "signed" : "pending",
  signed_file: todosAssinados ? "https://fake.zapsign.invalid/signed.pdf" : null,
  sandbox: true,
  created_at: pkg.created_at,
  last_update_at: agora,
  rejected_reason: tipo === "doc_refused" ? motivo : null,
  signer_who_signed: alvo ? { token: alvo.zapsign_signer_token, status: tipo === "doc_signed" ? "signed" : tipo === "doc_refused" ? "new" : "link-opened", signed_at: tipo === "doc_signed" ? agora : null, external_id: alvo.id } : null,
  signers: signers.map((s, i) => ({ token: s.zapsign_signer_token, external_id: s.id, ...zapStatus(s, i) })),
};

const res = await fetch(`${base}/api/webhooks/zapsign`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-riszon-webhook-secret": segredo },
  body: JSON.stringify(body),
});
const texto = await res.text();
console.log(`POST ${base}/api/webhooks/zapsign → ${res.status} ${texto}`);

const { data: depois } = await admin.from("signature_packages").select("status, current_stage, client_signed_at, completed_at, signed_pdf_path").eq("id", pkg.id).single();
const { data: sig } = await admin.from("signature_signers").select("order_group, status").eq("package_id", pkg.id).order("sort_order");
console.log("pacote:", `${pkg.status}/${pkg.current_stage}`, "→", `${depois.status}/${depois.current_stage}`, depois.completed_at ? "(concluído)" : "", depois.signed_pdf_path ? "(PDF assinado guardado)" : "");
console.log("signatários:", sig.map((s) => `${s.order_group}º ${s.status}`).join(" · "));
