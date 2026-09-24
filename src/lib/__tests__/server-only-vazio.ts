// Fica no lugar do pacote `server-only` durante os testes (ver
// vitest.config.ts). Vazio de propósito: o pacote de verdade só existe para
// levantar erro se código de servidor for empacotado para o navegador, e essa
// trava continua valendo no build do Next.
export {};
