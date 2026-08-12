import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildProjectWorkspaceSummaryByPlan } from "../lib/projectWorkspaceSummary.ts";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

const projectPages = [
  "app/projects/[id]/basic-info/page.tsx",
  "app/projects/[id]/daily-plans/[dailyPlanId]/page.tsx",
  "app/projects/[id]/daily-plans/new/page.tsx",
  "app/projects/[id]/edit/page.tsx",
  "app/projects/[id]/scenario/page.tsx",
  "app/projects/[id]/scene-list/page.tsx",
  "app/projects/[id]/staff-list/page.tsx",
  "app/projects/[id]/storyboard-overhead/page.tsx"
];

test("workspace summary seed matches list semantics for cuts, scenes, and progress", () => {
  const summaries = buildProjectWorkspaceSummaryByPlan(
    [
      { daily_plan_id: "plan-1", scene_number: "1" },
      { daily_plan_id: "plan-1", scene_number: " 1 " },
      { daily_plan_id: "plan-1", scene_number: "2" },
      { daily_plan_id: "plan-1", scene_number: "" },
      { daily_plan_id: "plan-2", scene_number: "3" },
      { daily_plan_id: "", scene_number: "ignored" }
    ],
    new Map([
      ["plan-1", { totalCutCount: 3, processedCutCount: 2 }],
      ["plan-3", { totalCutCount: 1, processedCutCount: 1 }]
    ])
  );

  assert.deepEqual(summaries.get("plan-1"), {
    shotCount: 4,
    progressTotal: 3,
    progressCompleted: 2,
    sceneNumbers: ["1", "2"]
  });
  assert.deepEqual(summaries.get("plan-2"), {
    shotCount: 1,
    progressTotal: 0,
    progressCompleted: 0,
    sceneNumbers: ["3"]
  });
  assert.deepEqual(summaries.get("plan-3"), {
    shotCount: 0,
    progressTotal: 1,
    progressCompleted: 1,
    sceneNumbers: []
  });
  assert.equal(summaries.has(""), false);
});

test("server-validated project snapshot seeds one persistent project workspace", () => {
  const layout = readSource("app/projects/[id]/layout.tsx");
  const gate = readSource("components/ProjectAccessGate.tsx");
  const workspace = readSource("components/ProjectWorkspaceContext.tsx");

  assert.match(layout, /loadInitialProjectWorkspace\([\s\S]*?access\.project[\s\S]*?\)/u);
  assert.match(layout, /accessProject\s*\?\s*Promise\.resolve\(\{ data: accessProject, error: null \}\)\s*:\s*supabase/u);
  assert.match(layout, /getAccountAccessPreferenceScope\(accountUserId\)/u);
  assert.match(gate, /<ProjectWorkspaceProvider[\s\S]*?key=\{projectId\}[\s\S]*?initialWorkspace=\{initialWorkspace\}/u);

  assert.match(workspace, /useState<Project \| null>\(initialWorkspace\.project\)/u);
  assert.match(workspace, /useState<DailyPlanListItem\[\]>\(initialWorkspace\.dailyPlans\)/u);
  assert.doesNotMatch(workspace, /\bgetProject\s*\(/u);
  assert.doesNotMatch(workspace, /\bloadWorkspace\b/u);
  assert.equal((workspace.match(/\blistDailyPlans\s*\(\s*projectId\s*\)/gu) ?? []).length, 1);
});

test("project child pages reuse the layout project while keeping page-specific loaders", () => {
  for (const pathname of projectPages) {
    const source = readSource(pathname);
    assert.match(source, /useProjectWorkspace/u, pathname);
    assert.doesNotMatch(source, /\bgetProject\s*\(/u, pathname);
  }

  assert.match(readSource(projectPages[1]), /getDailyPlanWithShots/u);
  assert.match(readSource(projectPages[5]), /getProjectSceneList/u);
  assert.match(readSource(projectPages[6]), /listProjectStaffMembers/u);
  assert.match(readSource(projectPages[7]), /loadOverheadArchiveWorkspace/u);
});

test("remembered navigation and anonymous invite redemption avoid client router hops", () => {
  const main = readSource("app/page.tsx");
  const invite = readSource("app/invite/[token]/route.ts");

  assert.doesNotMatch(main, /\bverifyProjectAccess\b/u);
  assert.match(main, /pushProjectRoute\(/u);
  assert.match(invite, /NextResponse\.redirect\(new URL\(destination, request\.url\), 307\)/u);
  assert.match(invite, /setProjectGuestInviteCookie\(response, token\)/u);
  assert.doesNotMatch(invite, /\buseEffect\b|\buseRouter\b|router\.replace/u);
});
