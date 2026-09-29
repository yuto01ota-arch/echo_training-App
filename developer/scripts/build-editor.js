import { build } from "vite";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
await build({
  configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
});
await cp(
  new URL("../../public/models/", import.meta.url),
  new URL("../dist/models/", import.meta.url),
  { recursive: true },
);

// Public login styling shares the same source as both React applications.
for (const file of ["theme.js", "theme.css"]) {
  await cp(
    new URL(`../../src/${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
}
