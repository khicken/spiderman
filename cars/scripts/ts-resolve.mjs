// Lets node run the app's .ts files: extensionless relative imports resolve to .ts.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(spec, ctx, next) {
    if ((spec.startsWith(".") || spec.startsWith("/")) && !/\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL) {
      const u = new URL(spec + ".ts", ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
    }
    return next(spec, ctx);
  },
});
