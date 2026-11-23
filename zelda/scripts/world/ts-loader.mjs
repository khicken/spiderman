// Resolve hook: lets node import the game's extensionless "./x" TypeScript imports. Used by world-check.ts.
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[a-z]+$/.test(spec)) {
    try { return await next(spec + ".ts", ctx); } catch { /* fall through */ }
  }
  return next(spec, ctx);
}
