import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`${specifier.slice(2)}.ts`, projectRoot).href,
        context
      );
    }
    return nextResolve(specifier, context);
  }
});

const { encodeDailyPlanMemo } = await import("../lib/dailyPlan/printMeta.ts");
const {
  MAX_PROGRESS_MEDIA_SCENE_SCOPE,
  createProgressMediaPlanScope,
  isProgressMediaAssetInPlanScope,
  progressMediaCandidateDatabaseFilter
} = await import("../lib/progress/mediaScope.ts");

const planId = "22222222-2222-4222-8222-222222222222";
const scene1Id = "11111111-1111-4111-8111-111111111111";
const scene2Id = "33333333-3333-4333-8333-333333333333";

function timetableScene({
  rowId,
  sceneId,
  sceneNumber,
  selectedCutNumbers
}) {
  return {
    version: 1,
    rowId,
    sourceSceneId: sceneId,
    sourceSnapshot: null,
    ...(selectedCutNumbers === undefined ? {} : { selectedCutNumbers }),
    rowSnapshot: {
      sceneNumber,
      sceneTitle: "",
      description: "",
      startTime: "",
      endTime: "",
      runtimeMinutes: null,
      runtime: "",
      locationId: "",
      locationName: "",
      mainLocation: "",
      subLocation: "",
      dayNight: "",
      storyDay: "",
      shootingOrder: "",
      notes: "",
      subject: "",
      props: "",
      costumeMakeup: "",
      sceneMemo: "",
      totalCuts: 3,
      cuts: []
    }
  };
}

function plan(...timetableScenes) {
  return {
    id: planId,
    episode: "2회",
    memo: encodeDailyPlanMemo({ timetableScenes })
  };
}

function asset(overrides = {}) {
  return {
    dailyPlanId: null,
    sceneId: scene1Id,
    sceneNumber: "1",
    cutNumber: 1,
    episodeNumber: 2,
    ...overrides
  };
}

test("project-global storyboard and overhead metadata stay inside the selected round", () => {
  const selectedPlan = plan(timetableScene({
    rowId: "row-1",
    sceneId: scene1Id,
    sceneNumber: "S#1",
    selectedCutNumbers: [1, 3]
  }));

  assert.equal(isProgressMediaAssetInPlanScope(asset(), selectedPlan), true);
  assert.equal(isProgressMediaAssetInPlanScope(asset({ sceneId: null }), selectedPlan), true);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: null,
    episodeNumber: null
  }), selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({ cutNumber: 2 }), selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({ episodeNumber: 1 }), selectedPlan), true);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: null,
    episodeNumber: 1
  }), selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({ sceneId: scene2Id }), selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: null,
    sceneNumber: "S#2"
  }), selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    dailyPlanId: "44444444-4444-4444-8444-444444444444"
  }), selectedPlan), false);
});

test("round-owned unclassified legacy media is accepted but global unclassified media is not", () => {
  const selectedPlan = plan(timetableScene({
    rowId: "row-1",
    sceneId: scene1Id,
    sceneNumber: "1"
  }));
  const unclassified = {
    sceneId: null,
    sceneNumber: "",
    cutNumber: null,
    episodeNumber: null
  };

  assert.equal(isProgressMediaAssetInPlanScope({
    ...unclassified,
    dailyPlanId: planId
  }, selectedPlan), true);
  assert.equal(isProgressMediaAssetInPlanScope({
    ...unclassified,
    dailyPlanId: null
  }, selectedPlan), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    dailyPlanId: planId,
    sceneId: scene2Id,
    sceneNumber: "99",
    cutNumber: 99,
    episodeNumber: 1
  }), { ...selectedPlan, memo: "legacy memo" }), true);
});

test("duplicate display Scene numbers remain independently addressable by stable Scene ID", () => {
  const selectedPlan = plan(
    timetableScene({
      rowId: "row-a",
      sceneId: scene1Id,
      sceneNumber: "1",
      selectedCutNumbers: [1]
    }),
    timetableScene({
      rowId: "row-b",
      sceneId: scene2Id,
      sceneNumber: "1",
      selectedCutNumbers: [2]
    })
  );
  const selectedScope = createProgressMediaPlanScope(selectedPlan);

  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: scene1Id,
    cutNumber: 1
  }), selectedScope), true);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: scene1Id,
    cutNumber: 2
  }), selectedScope), false);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: scene2Id,
    cutNumber: 2
  }), selectedScope), true);
  assert.equal(progressMediaCandidateDatabaseFilter(selectedScope), [
    `daily_plan_id.eq.${planId}`,
    `and(daily_plan_id.is.null,crop_data->>sceneId.in.(${scene1Id},${scene2Id}))`,
    "and(daily_plan_id.is.null,scene_no.in.(1))",
    "and(daily_plan_id.is.null,crop_data->>sceneNumber.in.(1))"
  ].join(","));
});

test("hyphenated Scene numbers remain string identities in Progress media scope", () => {
  const selectedPlan = plan(
    timetableScene({
      rowId: "row-1-1",
      sceneId: null,
      sceneNumber: "S#1-1",
      selectedCutNumbers: [1]
    }),
    timetableScene({
      rowId: "row-2",
      sceneId: null,
      sceneNumber: "2",
      selectedCutNumbers: [1]
    })
  );
  const selectedScope = createProgressMediaPlanScope(selectedPlan);

  assert.deepEqual([...selectedScope.sceneNumbers], ["1-1", "2"]);
  assert.equal(isProgressMediaAssetInPlanScope(asset({
    sceneId: null,
    sceneNumber: "1-1",
    episodeNumber: 2
  }), selectedScope), true);
  assert.equal(progressMediaCandidateDatabaseFilter(selectedScope), [
    `daily_plan_id.eq.${planId}`,
    "and(daily_plan_id.is.null,scene_no.in.(1-1,2))",
    "and(daily_plan_id.is.null,crop_data->>sceneNumber.in.(1-1,2))"
  ].join(","));
});

test("candidate scope has a fixed safety bound instead of building an unbounded PostgREST expression", () => {
  const timetableScenes = Array.from(
    { length: MAX_PROGRESS_MEDIA_SCENE_SCOPE + 1 },
    (_, index) => timetableScene({
      rowId: `row-${index}`,
      sceneId: null,
      sceneNumber: String(index + 1),
      selectedCutNumbers: [1]
    })
  );
  const selectedScope = createProgressMediaPlanScope(plan(...timetableScenes));

  assert.equal(selectedScope.isWithinCandidateLimit, false);
  assert.equal(selectedScope.sceneNumbers.size, MAX_PROGRESS_MEDIA_SCENE_SCOPE);
});

test("the authenticated and Guest endpoint shares one bounded scoped loader", () => {
  const route = readFileSync(
    new URL("../app/api/projects/[projectId]/reference-assets/route.ts", import.meta.url),
    "utf8"
  );
  const progressBranch = route.slice(
    route.indexOf("if (progressMedia)"),
    route.indexOf("let query = supabase", route.indexOf("if (progressMedia)"))
  );

  assert.match(progressBranch, /UUID_PATTERN\.test\(dailyPlanId\)/u);
  assert.match(progressBranch, /\.or\(progressMediaCandidateDatabaseFilter\(progressPlanScope\)\)/u);
  assert.equal((progressBranch.match(/\.from\("project_reference_assets"\)/gu) ?? []).length, 1);
  assert.equal((progressBranch.match(/\.from\("daily_plans"\)/gu) ?? []).length, 1);
  assert.doesNotMatch(progressBranch, /daily_plan_shots|\.from\("shots"\)|router\.refresh/u);
  assert.match(progressBranch, /if \(!plan\)[\s\S]*?status: 404/u);
  assert.match(progressBranch, /!progressPlanScope\.isWithinCandidateLimit/u);
  assert.match(progressBranch, /isProgressMediaAssetInPlanScope/u);
  assert.match(progressBranch, /const progressPlanScope = createProgressMediaPlanScope/u);
});

test("summary keeps the canonical original identity and prefers a distinct thumbnail", () => {
  const route = readFileSync(
    new URL("../app/api/projects/[projectId]/reference-assets/route.ts", import.meta.url),
    "utf8"
  );
  const summary = route.slice(
    route.indexOf("function toProgressMediaSummary"),
    route.indexOf("function validateFile")
  );
  const representative = route.slice(
    route.indexOf("function selectProgressMediaRepresentatives"),
    route.indexOf("function toProgressMediaSummary")
  );

  assert.match(summary, /progressMediaSummaryDisplayUrl\(originalUrl, thumbnailUrl\)/u);
  assert.match(summary, /publicUrl: originalUrl/u);
  assert.match(summary, /thumbnailUrl: displayUrl/u);
  assert.match(representative, /const sceneKey = cleanText\(crop\.sceneId/u);
});

test("candidate database filters ignore malformed stable IDs from memo", () => {
  const unsafeScope = createProgressMediaPlanScope(plan(timetableScene({
    rowId: "row-unsafe",
    sceneId: "bad),daily_plan_id.not.is.null",
    sceneNumber: "S#12",
    selectedCutNumbers: [1]
  })));
  const filter = progressMediaCandidateDatabaseFilter(unsafeScope);

  assert.doesNotMatch(filter, /bad|not\.is/u);
  assert.match(filter, /scene_no\.in\.\(12\)/u);
});

test("repository storage contract is public and Progress does not invent signed URLs", () => {
  const migration = readFileSync(
    new URL("../supabase/migration_project_reference_assets.sql", import.meta.url),
    "utf8"
  );
  const route = readFileSync(
    new URL("../app/api/projects/[projectId]/reference-assets/route.ts", import.meta.url),
    "utf8"
  );
  const progressBranch = route.slice(
    route.indexOf("if (progressMedia)"),
    route.indexOf("let query = supabase", route.indexOf("if (progressMedia)"))
  );

  assert.match(migration, /'storyboards',[\s\S]*?true,[\s\S]*?52428800/u);
  assert.doesNotMatch(progressBranch, /createSignedUrl|createSignedUrls|getPublicUrl\(/u);
});
