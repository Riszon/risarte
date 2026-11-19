import { connect } from "./test-db.mjs";
const c = await connect();
const t = await c.query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'access_sess%'`);
console.log(t.rows);
if (t.rows[0]) {
  const r = await c.query(`select s.*, p.email from public.${t.rows[0].table_name} s left join public.profiles p on p.id = s.user_id order by s.started_at desc nulls last limit 5`).catch(e=>({rows:[e.message]}));
  console.log(r.rows.map(x => typeof x === 'string' ? x : ({email:x.email, started:x.started_at, ended:x.ended_at, reason:x.end_reason, ua:String(x.user_agent).slice(0,40)})));
}
await c.end();
