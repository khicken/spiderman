// Usage: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/<x>.ts
// Lets node load src/app/*.ts files whose imports have no extension.
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
