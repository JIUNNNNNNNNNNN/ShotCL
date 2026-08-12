import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const basicInfoPath = new URL("../lib/projectBasicInfo.ts", import.meta.url);
const typesPath = new URL("../lib/types.ts", import.meta.url);

test("ProjectActor JSON owns a stable ID without requiring a database column", async () => {
  const [source, types] = await Promise.all([
    readFile(basicInfoPath, "utf8"),
    readFile(typesPath, "utf8")
  ]);

  assert.match(types, /export type ProjectActor = \{[\s\S]*?id: string;[\s\S]*?role: string;[\s\S]*?name: string;/u);
  assert.match(source, /export function createBlankProjectActor\(\): ProjectActor/u);
  assert.match(source, /const requestedId = normalizeActorId\(source\.id\)/u);
  assert.match(source, /requestedId \|\| createActorId\(`legacy-\$\{index\}-\$\{role\}-\$\{name\}`\)/u);
  assert.match(source, /while \(usedIds\.has\(id\)\)/u);
  assert.match(source, /return \{\s*id,\s*role,\s*name\s*\}/u);
});
