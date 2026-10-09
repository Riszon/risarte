import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVISO_ANTES_S,
  destinoDoAcesso,
  deveMandarSinal,
  duracao,
  ipDoPedido,
  lerEstadoDoAcesso,
  lerMotivo,
  navegadorCurto,
  situacaoLocal,
  temposDoAcesso,
  validarTempos,
} from "@/lib/acesso";

// 0287 (dono, 09/10/2026): desconectar por inatividade, um login por dia, e o
// registro de cada acesso. Ao medir antes de construir, apareceu que a trilha
// NUNCA tinha gravado um login — a chamada perdia a corrida para a navegação.

const MIN = 60_000;
const base = {
  agoraMs: 1_000_000_000,
  limiteMin: 60,
  diaDoAcesso: "2026-10-09",
  hoje: "2026-10-09",
  gravando: false,
};

describe("o que a tela faz enquanto o tempo corre", () => {
  it("em uso: nada acontece", () => {
    expect(situacaoLocal({ ...base, ultimaInteracaoMs: base.agoraMs - 10 * MIN })).toEqual({
      tipo: "ok",
      conferirDia: false,
    });
  });

  it("avisa nos últimos dois minutos, com o tempo que falta", () => {
    const s = situacaoLocal({ ...base, ultimaInteracaoMs: base.agoraMs - 59 * MIN });
    expect(s).toEqual({ tipo: "avisar", restamS: 60, conferirDia: false });
    expect(situacaoLocal({ ...base, ultimaInteracaoMs: base.agoraMs - 58 * MIN })).toEqual({
      tipo: "avisar",
      restamS: AVISO_ANTES_S,
      conferirDia: false,
    });
    // um segundo antes da janela do aviso: ainda não avisa
    expect(
      situacaoLocal({ ...base, ultimaInteracaoMs: base.agoraMs - 58 * MIN + 1000 }).tipo
    ).toBe("ok");
  });

  it("no limite, encerra por inatividade", () => {
    expect(situacaoLocal({ ...base, ultimaInteracaoMs: base.agoraMs - 60 * MIN })).toEqual({
      tipo: "encerrar",
      motivo: "inatividade",
    });
  });

  it("o tempo é o da FUNÇÃO: 15 minutos encerra a recepção aos 15", () => {
    expect(
      situacaoLocal({ ...base, limiteMin: 15, ultimaInteracaoMs: base.agoraMs - 15 * MIN }).tipo
    ).toBe("encerrar");
    expect(
      situacaoLocal({ ...base, limiteMin: 15, ultimaInteracaoMs: base.agoraMs - 10 * MIN }).tipo
    ).toBe("ok");
  });

  it("a data mudou NESTE computador: a tela não decide sozinha — pergunta ao banco", () => {
    // Um PC com a data adiantada cairia num ciclo sem fim (desconecta, entra,
    // desconecta) se a tela encerrasse pelo próprio relógio.
    expect(
      situacaoLocal({ ...base, hoje: "2026-10-10", ultimaInteracaoMs: base.agoraMs })
    ).toEqual({ tipo: "ok", conferirDia: true });
    // data ATRASADA também é data diferente: quem sabe é o banco
    expect(
      situacaoLocal({ ...base, hoje: "2026-10-08", ultimaInteracaoMs: base.agoraMs })
    ).toEqual({ tipo: "ok", conferirDia: true });
  });

  it("computador com a data errada continua recebendo o aviso de inatividade", () => {
    expect(
      situacaoLocal({ ...base, hoje: "2026-10-10", ultimaInteracaoMs: base.agoraMs - 59 * MIN })
    ).toEqual({ tipo: "avisar", restamS: 60, conferirDia: true });
  });

  it("a inatividade vale mesmo com a data local diferente (ela não depende do calendário)", () => {
    expect(
      situacaoLocal({ ...base, hoje: "2026-10-10", ultimaInteracaoMs: base.agoraMs - 60 * MIN })
    ).toEqual({ tipo: "encerrar", motivo: "inatividade" });
  });

  it("GRAVAÇÃO EM ANDAMENTO: nem a inatividade nem a virada do dia desconectam", () => {
    expect(
      situacaoLocal({
        ...base,
        gravando: true,
        hoje: "2026-10-10",
        ultimaInteracaoMs: base.agoraMs - 180 * MIN,
      })
    ).toEqual({ tipo: "ok", conferirDia: false });
  });
});

describe("o sinal de atividade", () => {
  const t = 5_000_000;
  it("só vai quando a pessoa MEXEU desde o último sinal", () => {
    expect(deveMandarSinal({ agoraMs: t, ultimoSinalMs: t - 61_000, ultimaInteracaoMs: t - 5_000, gravando: false })).toBe(true);
    // aba aberta, ninguém mexeu: não é "pessoa usando"
    expect(deveMandarSinal({ agoraMs: t, ultimoSinalMs: t - 61_000, ultimaInteracaoMs: t - 90_000, gravando: false })).toBe(false);
  });

  it("no máximo um por minuto", () => {
    expect(deveMandarSinal({ agoraMs: t, ultimoSinalMs: t - 30_000, ultimaInteracaoMs: t - 1_000, gravando: false })).toBe(false);
  });

  it("gravando, vai mesmo sem ninguém mexer", () => {
    expect(deveMandarSinal({ agoraMs: t, ultimoSinalMs: t - 61_000, ultimaInteracaoMs: t - 30 * MIN, gravando: true })).toBe(true);
  });
});

describe("ler a resposta do banco", () => {
  it("resposta boa", () => {
    expect(lerEstadoDoAcesso({ data: { estado: "ok", limite_min: 60, dia: "2026-10-09" }, error: null })).toEqual({
      estado: "ok",
      limiteMin: 60,
      dia: "2026-10-09",
      motivo: null,
    });
  });

  it("⚠️ banco sem a 0287 (erro) ou resposta ilegível = NÃO CONFERIDO, e ninguém é trancado", () => {
    expect(lerEstadoDoAcesso({ data: null, error: { message: "function does not exist" } })).toBeNull();
    expect(lerEstadoDoAcesso(null)).toBeNull();
    expect(lerEstadoDoAcesso({ data: "ok", error: null })).toBeNull();
    expect(lerEstadoDoAcesso({ data: { estado: "qualquer" }, error: null })).toBeNull();
    // e não conferido não manda ninguém embora
    expect(destinoDoAcesso(null)).toBeNull();
  });

  it("para onde vai quem teve o acesso encerrado", () => {
    const e = (estado: string, motivo?: string) =>
      lerEstadoDoAcesso({ data: { estado, motivo, limite_min: 60, dia: "2026-10-09" }, error: null });
    expect(destinoDoAcesso(e("ok"))).toBeNull();
    expect(destinoDoAcesso(e("sem_sessao"))).toBeNull();
    expect(destinoDoAcesso(e("inatividade"))).toBe("/auth/encerrar?motivo=inatividade");
    expect(destinoDoAcesso(e("virada_do_dia"))).toBe("/auth/encerrar?motivo=virada_do_dia");
    expect(destinoDoAcesso(e("encerrada", "virada_do_dia"))).toBe("/auth/encerrar?motivo=virada_do_dia");
    expect(destinoDoAcesso(e("encerrada"))).toBe("/auth/encerrar?motivo=inatividade");
  });

  it("motivo que não existe vira 'saiu' (nada de texto livre no endereço)", () => {
    expect(lerMotivo("inatividade")).toBe("inatividade");
    expect(lerMotivo("<script>")).toBe("saiu");
    expect(lerMotivo(null)).toBe("saiu");
  });

  it("o IP é o primeiro da lista da borda", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(ipDoPedido(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(ipDoPedido(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(ipDoPedido(h({}))).toBeNull();
  });
});

describe("os tempos por função", () => {
  const papeis = ["receptionist", "dentist"];
  it("padrão obrigatório; função em branco volta ao padrão (nulo, não zero)", () => {
    expect(validarTempos({ "*": "60", receptionist: "15", dentist: "" }, papeis)).toEqual({
      ok: true,
      valores: { "*": 60, admin_master: null, receptionist: 15, dentist: null },
    });
    expect(validarTempos({ "*": "", receptionist: "15" }, papeis).ok).toBe(false);
  });

  it("recusa fora de 5–720, quebrado e texto", () => {
    for (const ruim of ["4", "721", "0", "-10", "12.5", "abc"]) {
      expect(validarTempos({ "*": ruim }, papeis).ok, ruim).toBe(false);
    }
    expect(validarTempos({ "*": "5" }, papeis).ok).toBe(true);
    expect(validarTempos({ "*": "720" }, papeis).ok).toBe(true);
  });
});

describe("o que a auditoria mostra", () => {
  it("duração legível", () => {
    expect(duracao(0)).toBe("menos de 1min");
    expect(duracao(59)).toBe("menos de 1min");
    expect(duracao(37 * 60)).toBe("37min");
    expect(duracao(2 * 3600 + 5 * 60)).toBe("2h 05min");
    expect(duracao(null)).toBe("menos de 1min");
  });

  it("acesso ABERTO conta até a última atividade — aba esquecida não vira hora trabalhada", () => {
    const t = temposDoAcesso({
      startedAt: "2026-10-09T12:00:00Z",
      lastActivityAt: "2026-10-09T12:40:00Z",
      endedAt: null,
      activeSeconds: 30 * 60,
    });
    expect(t).toEqual({ totalS: 40 * 60, emUsoS: 30 * 60, paradoS: 10 * 60 });
  });

  it("acesso encerrado conta até o fim; em uso nunca passa do total", () => {
    const t = temposDoAcesso({
      startedAt: "2026-10-09T12:00:00Z",
      lastActivityAt: "2026-10-09T12:10:00Z",
      endedAt: "2026-10-09T13:12:00Z",
      activeSeconds: 99_999,
    });
    expect(t.totalS).toBe(72 * 60);
    expect(t.emUsoS).toBe(72 * 60);
    expect(t.paradoS).toBe(0);
  });

  it("navegador curto", () => {
    expect(
      navegadorCurto("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36")
    ).toBe("Chrome · Windows");
    expect(navegadorCurto("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0")).toBe("Firefox · Windows");
    expect(navegadorCurto("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(navegadorCurto(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — o que não pode voltar.
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "__tests__" ? [] : arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}
const fontes = arquivos(join(RAIZ, "src")).map((c) => ({
  caminho: c.slice(RAIZ.length + 1).replace(/\\/g, "/"),
  texto: readFileSync(c, "utf8"),
}));

describe("régua: o login é registrado ANTES de trocar de tela", () => {
  const form = ler("src/app/login/login-form.tsx");
  const depoisDoLogin = form.slice(form.indexOf("signInWithPassword"));

  it("achou o formulário (não achar = régua cega)", () => {
    expect(form.indexOf("signInWithPassword")).toBeGreaterThan(0);
  });

  it("o registro é esperado (await), e vem antes do router.replace", () => {
    const registro = depoisDoLogin.search(/await Promise\.race\(\[\s*iniciarAcesso\(\)/);
    const navegacao = depoisDoLogin.indexOf('router.replace("/")');
    expect(registro, "await ... iniciarAcesso()").toBeGreaterThan(0);
    expect(navegacao).toBeGreaterThan(registro);
  });

  it("nada de registrar sem esperar (`void` foi como o login sumiu da trilha)", () => {
    expect(form).not.toMatch(/void\s+(iniciarAcesso|recordLogin)\(/);
  });
});

describe("régua: toda saída passa pela rota que registra", () => {
  it("achou as fontes (zero = régua cega)", () => {
    expect(fontes.length).toBeGreaterThan(200);
  });

  it("`signOut` só existe na rota /auth/encerrar", () => {
    const comSignOut = fontes
      .filter((f) => /\.auth\.signOut\(/.test(f.texto))
      .map((f) => f.caminho);
    expect(comSignOut).toEqual(["src/app/auth/encerrar/route.ts"]);
  });

  it("ninguém aponta um <Link> ou o roteador para a rota de saída (o Next pré-carrega e desconectaria sozinho)", () => {
    const culpados = fontes
      .filter(
        (f) =>
          /href=\{?["'`]\/auth\/encerrar/.test(f.texto) ||
          /router\.(push|replace|prefetch)\(\s*["'`]\/auth\/encerrar/.test(f.texto)
      )
      .map((f) => f.caminho);
    expect(culpados).toEqual([]);
  });

  it("a rota registra a saída, encerra só este aparelho e apaga os cookies à mão", () => {
    const rota = ler("src/app/auth/encerrar/route.ts");
    expect(rota).toMatch(/rpc\("access_session_end"/);
    expect(rota).toMatch(/signOut\(\{ scope: "local" \}\)/);
    expect(rota).toMatch(/resposta\.cookies\.delete\(c\.name\)/);
    // a saída é registrada ANTES de derrubar a sessão
    expect(rota.indexOf("access_session_end")).toBeLessThan(rota.indexOf("signOut("));
  });
});

describe("régua: o banco é conferido a cada requisição, e sem resposta ninguém é trancado", () => {
  const auth = ler("src/lib/auth.ts");

  it("a conferência entra no MESMO lote das outras consultas (sem ida a mais)", () => {
    const lote = auth.slice(auth.indexOf("await Promise.all(["), auth.indexOf("]);", auth.indexOf("await Promise.all([")));
    expect(lote).toMatch(/supabase\.rpc\("access_session_check"/);
  });

  it("a decisão passa pelas funções puras (que deixam passar quando não há resposta)", () => {
    expect(auth).toMatch(/const acessoLido = lerEstadoDoAcesso\(respostaDoRegistro\)/);
    expect(auth).toMatch(/const encerrar = destinoDoAcesso\(acessoLido\)/);
  });
});

describe("régua: o monitor da sessão está em todas as cascas e não usa ação de servidor", () => {
  const layout = ler("src/app/(app)/layout.tsx");
  const monitor = ler("src/components/monitor-de-sessao.tsx");

  it("montado nas três cascas (escolha de unidade, modo portal e a normal)", () => {
    expect(layout.match(/\{monitor\}/g)?.length).toBe(3);
  });

  it("o sinal vai direto do navegador para o banco", () => {
    expect(monitor).toMatch(/createClient\(\)\s*\.rpc\("access_session_touch"/);
    expect(monitor).not.toMatch(/from "[^"]*actions"/);
  });

  it("gravação em andamento é lida do mesmo lugar que a faixa 'Gravando'", () => {
    expect(monitor).toMatch(/const gravando = clienteGravando\(\) !== null/);
  });

  it("a aba que grava avisa as OUTRAS abas (senão a aba parada derruba a gravação)", () => {
    // gravando → conta como interação e vai para o localStorage, que as outras leem
    expect(monitor).toMatch(/if \(gravando\) mexeu\(\)/);
  });

  it("virada do dia: a tela pergunta ao banco e só sai se ELE disser", () => {
    expect(monitor).toMatch(/rpc\("access_session_check"\)/);
    expect(monitor).not.toMatch(/sair\("virada_do_dia"\)/);
  });
});
