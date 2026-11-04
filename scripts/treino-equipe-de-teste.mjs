// FICHAS DE RISARTANO PARA AS CONTAS DE TESTE DO TREINO (AP91, 03/11/2026).
//
// A assinatura digital exige CPF válido de quem assina pela Risarte e das
// testemunhas. No treino o cadastro da equipe é CÓPIA da produção (0260): as
// únicas pessoas com CPF válido são pessoas REAIS, e ensaiar o contrato de
// adesão (2 testemunhas + o representante) usaria o nome e o contato delas.
//
// Este script dá às contas de teste (`…@example.com`, nome "… de Teste") uma
// ficha de Risartano com CPF de teste válido e o e-mail da própria conta
// (domínio reservado: nada é entregue a ninguém). Desde a 0356, também RG e
// nacionalidade de teste: o contrato de adesão cita quem assina pela Risarte
// (o consultor responsável) com eles, e no treino a ficha não se edita.
//
//   node scripts/treino-equipe-de-teste.mjs              → só mostra o que faria
//   node scripts/treino-equipe-de-teste.mjs --confirmar  → grava
//
// O QUE ELE NUNCA FAZ:
//   - rodar na produção (a trava de `test-db.mjs`, e confere `is_mirror_db()`);
//   - mexer na ficha de pessoa real (só conta @example.com com nome "de Teste";
//     a `rede@example.com` tem o nome de uma pessoa real e fica de fora);
//   - apagar qualquer coisa.
//
// A cópia da produção não desfaz isto: ela copia pessoa por pessoa da
// produção e não apaga ficha que só existe no treino. O código da ficha leva
// `-TREINO` para nunca colidir com um código que a produção venha a criar.

import { connect } from "./test-db.mjs";

const confirmar = process.argv.includes("--confirmar");

function verificador(digitos) {
  const peso = digitos.length + 1;
  const soma = digitos.reduce((s, d, i) => s + d * (peso - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** A mesma regra de `isValidCpf` (src/lib/masks.ts). */
function cpfValido(cpf) {
  const d = String(cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const n = [...d].map(Number);
  return verificador(n.slice(0, 9)) === n[9] && verificador(n.slice(0, 10)) === n[10];
}

/** Igual a `gerarCpfDeTeste` (src/lib/cpf-de-teste.ts). */
function gerarCpf() {
  for (;;) {
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (base.every((d) => d === base[0])) continue;
    const d1 = verificador(base);
    const d2 = verificador([...base, d1]);
    const n = [...base, d1, d2].join("");
    if (!cpfValido(n)) continue;
    return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  }
}

const db = await connect();
try {
  const [{ espelho }] = (await db.query("select public.is_mirror_db() as espelho")).rows;
  if (!espelho) throw new Error("RECUSADO: este banco não é o treino (is_mirror_db() = false).");

  // Contas de teste com função: a ficha nasce na unidade da função (a
  // Franqueadora primeiro, que é onde ficam testemunhas e representantes).
  const contas = (
    await db.query(`
      select p.id, p.email, p.full_name,
             (array_agg(r.clinic_id order by (cl.type = 'franchisor') desc, cl.name))[1] as clinic_id
        from public.profiles p
        join public.user_clinic_roles_all r on r.user_id = p.id
        join public.clinics cl on cl.id = r.clinic_id
       where p.email like '%@example.com'
         and p.full_name ilike '% de Teste'
         and p.is_active
       group by p.id, p.email, p.full_name
       order by p.email`)
  ).rows;
  if (contas.length === 0) throw new Error("Nenhuma conta de teste achada: não medi nada.");

  // CPFs já usados (equipe e clientes): o novo não pode repetir nenhum, senão
  // o gatilho ligaria a ficha a um cliente do treino.
  const usados = new Set(
    (
      await db.query(`
        select public.cpf_digits(cpf) d from public.staff_members where cpf is not null
        union
        select public.cpf_digits(cpf) from public.clients where cpf is not null`)
    ).rows.map((r) => r.d)
  );
  const novoCpf = () => {
    for (;;) {
      const cpf = gerarCpf();
      const d = cpf.replace(/\D/g, "");
      if (!usados.has(d)) {
        usados.add(d);
        return cpf;
      }
    }
  };

  // 0356: RG e nacionalidade na ficha (o contrato de adesão os cita).
  const comDocumentos = await db.query("select rg, nationality from public.staff_members limit 1").then(
    () => true,
    () => false
  );
  const rgDeTeste = () => `TESTE-${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

  let criar = 0;
  let corrigir = 0;
  let prontas = 0;
  let documentos = 0;
  if (confirmar) await db.query("begin");
  for (const c of contas) {
    const ficha = (
      await db.query(
        `select id, code, cpf${comDocumentos ? ", rg, nationality" : ""} from public.staff_members where user_id = $1 order by created_at limit 1`,
        [c.id]
      )
    ).rows[0];
    if (ficha && comDocumentos && String(ficha.code ?? "").endsWith("-TREINO") && (!ficha.rg || !ficha.nationality)) {
      documentos++;
      console.log(`  ~ ${c.email} — RG e nacionalidade de teste`);
      if (confirmar) {
        await db.query(
          `update public.staff_members set rg = coalesce(rg, $1), nationality = coalesce(nationality, 'brasileira') where id = $2`,
          [rgDeTeste(), ficha.id]
        );
      }
    }
    if (ficha && cpfValido(ficha.cpf)) {
      prontas++;
      console.log(`  ✓ ${c.email} — já tem ficha com CPF válido (${ficha.code})`);
      continue;
    }
    if (ficha) {
      if (!String(ficha.code ?? "").endsWith("-TREINO")) {
        console.log(`  · ${c.email} — ficha ${ficha.code} não é de teste; não mexo`);
        continue;
      }
      corrigir++;
      console.log(`  ~ ${c.email} — ficha ${ficha.code} ganha CPF de teste`);
      if (confirmar) await db.query(`update public.staff_members set cpf = $1 where id = $2`, [novoCpf(), ficha.id]);
      continue;
    }
    criar++;
    const codigo = `TST-${c.email.split("@")[0].toUpperCase()}-TREINO`;
    console.log(`  + ${c.email} — ficha nova ${codigo}`);
    if (confirmar) {
      await db.query(
        comDocumentos
          ? `insert into public.staff_members (clinic_id, user_id, full_name, cpf, email, code, is_active, rg, nationality)
             values ($1, $2, $3, $4, $5, $6, true, $7, 'brasileira')`
          : `insert into public.staff_members (clinic_id, user_id, full_name, cpf, email, code, is_active)
             values ($1, $2, $3, $4, $5, $6, true)`,
        comDocumentos
          ? [c.clinic_id, c.id, c.full_name, novoCpf(), c.email, codigo, rgDeTeste()]
          : [c.clinic_id, c.id, c.full_name, novoCpf(), c.email, codigo]
      );
    }
  }
  if (confirmar) await db.query("commit");

  console.log(
    `\n${contas.length} contas de teste: ${prontas} já prontas, ${criar} fichas novas, ${corrigir} com CPF corrigido, ${documentos} com RG e nacionalidade.`
  );
  if (!confirmar && criar + corrigir + documentos > 0) console.log("Nada foi gravado. Para gravar: --confirmar");
} catch (e) {
  if (confirmar) await db.query("rollback").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
