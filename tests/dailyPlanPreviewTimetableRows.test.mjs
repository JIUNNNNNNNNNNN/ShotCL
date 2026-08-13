import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyPlanPreviewTimetableRows
} from "../lib/dailyPlan/previewTimetable.ts";
import {
  createDefaultDailyPlanPrintMeta,
  encodeDailyPlanMemo
} from "../lib/dailyPlan/printMeta.ts";

function makePlan(overrides = {}) {
  return {
    memo: "",
    mealTime: "",
    mealTimes: [],
    shootingLocations: [],
    ...overrides
  };
}

function makeScene(rowId, snapshotOverrides = {}, metaOverrides = {}) {
  return {
    version: 1,
    rowId,
    sourceSceneId: null,
    sourceSnapshot: null,
    rowSnapshot: {
      sceneNumber: "",
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
      totalCuts: null,
      cuts: [],
      ...snapshotOverrides
    },
    ...metaOverrides
  };
}

function encodeMeta(overrides) {
  return encodeDailyPlanMemo({
    ...createDefaultDailyPlanPrintMeta(),
    ...overrides
  });
}

test("persisted timetable scenes use natural fallback order and canonical display values", () => {
  const memo = encodeMeta({
    starring: [{
      id: "actor-lead",
      name: "김배우",
      role: "주인공",
      callTime: "",
      callLocation: "",
      notes: ""
    }],
    timetableScenes: [
      makeScene("scene-10", {
        sceneNumber: "10",
        startTime: "2330",
        endTime: "0015",
        mainLocation: "부엌",
        subLocation: "싱크대",
        dayNight: "night",
        shootingOrder: "1-3-2",
        subject: "김배우",
        description: "밤 장면",
        totalCuts: 3,
        cuts: [
          { id: "c1", cutNumber: "1", description: "", memo: "첫 컷 메모" },
          { id: "c2", cutNumber: "2", description: "", memo: "" },
          { id: "c3", cutNumber: "3", description: "", memo: "" }
        ]
      }, {
        selectedCutNumbers: [1, 2, 3]
      }),
      makeScene("scene-2", {
        sceneNumber: "S#2",
        startTime: "0900",
        endTime: "1000",
        runtimeMinutes: 0,
        mainLocation: "안방",
        subLocation: "안방",
        dayNight: "데이",
        totalCuts: 5
      }, {
        totalCutsOverride: 0
      }),
      makeScene("empty-row")
    ]
  });

  const rows = buildDailyPlanPreviewTimetableRows(makePlan({ memo }), [{
    orderIndex: 1,
    sceneNumber: "99",
    cutNumber: "1"
  }]);

  assert.equal(rows.length, 2, "완전히 빈 snapshot 행과 legacy shots는 제외한다");
  assert.deepEqual(rows.map((row) => row.type === "scene" ? row.sceneNumber : row.type), ["S#2", "S#10"]);
  assert.deepEqual(rows[0], {
    type: "scene",
    start: "09:00",
    end: "10:00",
    runtime: "0M",
    location: "안방",
    dayNight: "D",
    sceneNumber: "S#2",
    totalCut: "0",
    cast: "",
    description: "",
    shootingOrder: "",
    notes: ""
  });
  assert.equal(rows[1].runtime, "45M", "자정을 넘는 END도 실제 경과시간으로 계산한다");
  assert.equal(rows[1].location, "부엌 / 싱크대");
  assert.equal(rows[1].dayNight, "N");
  assert.equal(rows[1].totalCut, "3/3", "selectedCutNumbers 프로퍼티가 있으면 N/total을 유지한다");
  assert.equal(rows[1].shootingOrder, "1-3-2", "사용자가 정한 촬영 순서를 재정렬하지 않는다");
  assert.equal(rows[1].cast, "주인공");
  assert.equal(rows[1].notes, "첫 컷 메모");
});

test("explicit timetable order interleaves canonical scenes and schedules without guessing locations", () => {
  const memo = encodeMeta({
    timetableRowOrder: ["event", "scene", "event", "scene"],
    timetableScenes: [
      makeScene("scene-10", { sceneNumber: "10", totalCuts: 1 }),
      makeScene("scene-2", { sceneNumber: "2", totalCuts: 1 })
    ]
  });
  const plan = makePlan({
    memo,
    shootingLocations: [{
      id: "location-a",
      name: "검색 시설명",
      detail: "",
      inputMode: "search",
      roadAddress: "서울 종로구 실제 주소"
    }],
    mealTimes: [
      {
        id: "meal-a",
        startTime: "1215",
        endTime: "1315",
        locationId: "location-a",
        memo: "점심 식사"
      },
      {
        id: "setup-a",
        startTime: "",
        endTime: "",
        runtimeMinutes: 0,
        runtime: "",
        locationId: "missing-location",
        memo: "조명 세팅"
      },
      {
        id: "empty",
        startTime: "",
        endTime: "",
        runtime: "",
        locationId: "",
        memo: "\u00a0\u200b"
      }
    ]
  });

  const rows = buildDailyPlanPreviewTimetableRows(plan);
  assert.deepEqual(rows.map((row) => row.type === "scene" ? row.sceneNumber : row.memo), [
    "점심 식사",
    "S#10",
    "조명 세팅",
    "S#2"
  ]);
  assert.deepEqual(rows[0], {
    type: "additionalSchedule",
    start: "12:15",
    end: "13:15",
    runtime: "1H",
    location: "서울 종로구 실제 주소",
    memo: "점심 식사"
  });
  assert.equal(rows[2].runtime, "0M");
  assert.equal(rows[2].location, "", "삭제된 stable location ID는 UUID나 임의 주소를 노출하지 않는다");
});

test("legacy shots are restored only when versioned timetable scenes are absent", () => {
  const shots = [
    {
      orderIndex: 1,
      sceneNumber: "10",
      sceneTitle: "밤",
      startTime: "2300",
      endTime: "0030",
      locationId: "legacy-location",
      locationName: "부엌",
      subLocation: "식탁",
      dayNight: "N",
      description: "밤 장면",
      subject: "형사",
      sceneMemo: "[[SHOTCL_SHOOTING_ORDER:1-3-2]]",
      memo: "첫 메모",
      cutNumber: "1-3-2"
    },
    {
      orderIndex: 2,
      sceneNumber: "2",
      sceneTitle: "낮",
      startTime: "0900",
      endTime: "1000",
      locationId: "",
      locationName: "안방",
      subLocation: "",
      dayNight: "day",
      description: "낮 장면",
      subject: "",
      sceneMemo: "",
      memo: "",
      cutNumber: "1"
    }
  ];
  const plan = makePlan({
    mealTime: "저녁 식사",
    shootingLocations: [{
      id: "legacy-location",
      name: "지도 시설",
      detail: "서울시 실제 주소",
      inputMode: "manual",
      manualAddress: "서울시 실제 주소"
    }]
  });

  const rows = buildDailyPlanPreviewTimetableRows(plan, shots);
  assert.deepEqual(rows.map((row) => row.type === "scene" ? row.sceneNumber : row.memo), [
    "S#2",
    "S#10",
    "저녁 식사"
  ]);
  assert.equal(rows[1].runtime, "1H30M");
  assert.equal(rows[1].location, "부엌 / 식탁", "촬영 씬에는 실제 주소 대신 극 중 대/소장소만 쓴다");
  assert.equal(rows[1].totalCut, "3");
  assert.equal(rows[1].shootingOrder, "1-3-2");
});
