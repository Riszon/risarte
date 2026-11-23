// TEMPORÁRIO: vigia (só leitura) a prova de R$ 10,00 no débito em Cambé.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("hvhbijctanrrkxhemlza")) process.exit(3);
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CB = "65eb5083-40ac-4239-8590-a62b26e1b8b4";
const fim = Date.now() + 3 * 3600e3;
let visto = "";
while (Date.now() < fim) {
  const { data } = await s.from("charges").select("id, status, billing_type, paid_billing_type, paid_debit_signal, value_cents, paid_cents, fee_cents, net_cents, asaas_payment_id").eq("clinic_id", CB);
  const linha = JSON.stringify(data ?? []);
  if (linha !== visto) { console.log(new Date().toLocaleTimeString("pt-BR"), linha); visto = linha; }
  const paga = (data ?? []).find((c) => ["paga", "liquidada"].includes(c.status));
  if (paga) {
    await new Promise((r) => setTimeout(r, 60000)); // dá tempo à correção (aviso + 4 s, ou o cron de 10 min)
    console.log("PAGA:", paga.id);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log("sem pagamento em 3 h");
