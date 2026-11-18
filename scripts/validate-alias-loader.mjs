import path from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const mapped = specifier.startsWith("@/") ? specifier.slice(2) : specifier;
  const base = specifier.startsWith("@/")
    ? pathToFileURL(path.join(process.cwd(), "src", mapped)).href
    : specifier.startsWith(".") && context.parentURL
      ? new URL(specifier, context.parentURL).href
      : specifier;
  try {
    return await nextResolve(base, context);
  } catch (error) {
    if (base.startsWith("file:") && !path.extname(base)) return nextResolve(`${base}.ts`, context);
    throw error;
  }
}
