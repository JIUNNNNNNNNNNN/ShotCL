import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progressDataModules = [
  ["lib/data/shots.ts", 9],
  ["lib/data/dailyPlans.ts", 8],
  ["lib/data/shotDiagrams.ts", 3],
  ["lib/data/storyboardFiles.ts", 1]
];

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("Progress data modules load the Supabase browser client only on an async fallback path", () => {
  for (const [pathname, expectedFallbackCalls] of progressDataModules) {
    const source = readSource(pathname);

    assert.doesNotMatch(
      source,
      /import\s+(?:\{[^}]*\}|[^;]+)\s+from\s+["']@\/lib\/supabase\/client["']/u,
      `${pathname} must not statically import the Supabase browser client`
    );
    assert.equal(
      (source.match(/await import\(["']@\/lib\/supabase\/client["']\)/gu) ?? []).length,
      1,
      `${pathname} should define one cached-module dynamic import path`
    );
    assert.match(
      source,
      /async function loadFallbackSupabaseClient\(\) \{\s*const \{ getSupabaseBrowserClient \} = await import\(["']@\/lib\/supabase\/client["']\);\s*return getSupabaseBrowserClient\(\);\s*\}/u,
      `${pathname} must keep the dynamic import inside an async helper`
    );
    assert.equal(
      (source.match(/await loadFallbackSupabaseClient\(\)/gu) ?? []).length,
      expectedFallbackCalls,
      `${pathname} must await every fallback client access`
    );
    assert.equal(
      (source.match(/(?<!await )loadFallbackSupabaseClient\(\)/gu) ?? []).length,
      1,
      `${pathname} must not invoke the loader outside its declaration or an awaited async path`
    );
  }
});
