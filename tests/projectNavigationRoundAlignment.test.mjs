import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navigationSource = await readFile(
  new URL("../components/ProjectNavigation.tsx", import.meta.url),
  "utf8"
);
const globalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function extractRoundNavigationLink() {
  const start = navigationSource.indexOf("function RoundNavigationLink(");
  const end = navigationSource.indexOf("function PlanContextMenu(", start);
  assert.notEqual(start, -1, "RoundNavigationLink must remain in the canonical project navigation");
  assert.notEqual(end, -1, "RoundNavigationLink source boundary must remain available");
  return navigationSource.slice(start, end);
}

test("round links structurally center the label and date without state-specific geometry", () => {
  const roundLink = extractRoundNavigationLink();

  assert.match(
    roundLink,
    /project-navigation__round-link box-border flex min-w-0 items-center/u
  );
  assert.match(roundLink, /<span className="flex w-full min-w-0 items-center gap-1\.5">/u);
  assert.match(
    roundLink,
    /active \? "border-field-primary bg-field-primary-soft text-field-primary" : "border-transparent/u
  );
  assert.doesNotMatch(roundLink, /(?:translateY|top:|margin-top|mt-\[|-mt-)/u);
});

test("round links keep one border-box height and gap across panel and drawer modes", () => {
  const baseRule = globalCss.match(/\.project-navigation__round-link \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? "";

  assert.match(baseRule, /box-sizing:\s*border-box;/u);
  assert.match(baseRule, /min-height:\s*44px;/u);
  assert.match(baseRule, /padding:\s*7px 8px;/u);
  assert.match(globalCss, /\.project-navigation__round-list \{[\s\S]*?gap:\s*2px;[\s\S]*?padding:\s*5px;/u);
  assert.match(
    globalCss,
    /\.project-shell__navigation-drawer \.project-navigation__round-link \{[\s\S]*?min-height:\s*44px;[\s\S]*?padding:\s*6px 8px;/u
  );
  assert.doesNotMatch(
    globalCss,
    /\.project-shell\[data-project-shell-mode="persistent"\] \.project-navigation__round-link > span\s*\{[\s\S]*?flex-direction:\s*column/u
  );
});
