import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
export function loadModule(entry, globals = {}, overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (!existsSync(`${file}.ts`)) file = resolve(file, "index");
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(`${file}.ts`, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        exports,
        ...globals,
        require: (name) =>
          overrides[name] ?? load(resolve(dirname(file), name)),
      },
      { filename: file },
    );
    return exports;
  }
  return load(resolve("src", entry));
}
