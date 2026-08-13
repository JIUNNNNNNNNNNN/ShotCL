import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDailyPlanReadDocumentModel
} from "../lib/dailyPlan/readDocument.ts";
import {
  createDefaultDailyPlanPrintMeta,
  encodeDailyPlanMemo
} from "../lib/dailyPlan/printMeta.ts";

const viewPath = new URL("../components/DailyPlanReadOnlyView.tsx", import.meta.url);
const documentPath = new URL("../components/DailyPlanDocument.tsx", import.meta.url);
const stylesPath = new URL("../components/DailyPlanReadOnlyView.module.css", import.meta.url);

function makeScene() {
  return {
    version: 1,
    rowId: "scene-1",
    sourceSceneId: null,
    sourceSnapshot: null,
    selectedCutNumbers: [1, 3],
    rowSnapshot: {
      sceneNumber: "1",
      sceneTitle: "",
      description: "아침 장면",
      startTime: "0900",
      endTime: "1000",
      runtimeMinutes: null,
      runtime: "",
      locationId: "location-a",
      locationName: "",
      mainLocation: "안방",
      subLocation: "유리의 방",
      dayNight: "D",
      storyDay: "",
      shootingOrder: "1-3",
      notes: "",
      subject: "주인공",
      props: "",
      costumeMakeup: "",
      sceneMemo: "",
      totalCuts: 3,
      cuts: [
        { id: "cut-1", cutNumber: "1", description: "", memo: "" },
        { id: "cut-2", cutNumber: "2", description: "", memo: "" },
        { id: "cut-3", cutNumber: "3", description: "", memo: "" }
      ]
    }
  };
}

function makePlan() {
  const meta = {
    ...createDefaultDailyPlanPrintMeta(),
    day: "3",
    sunrise: "0615",
    sunset: "1910",
    timetableScenes: [makeScene()],
    timetableRowOrder: ["event", "scene"],
    memoText: "촬영 메모",
    starring: [{
      id: "actor-a",
      name: "김배우",
      role: "주인공",
      callTime: "0730",
      callLocation: "옛 주소",
      callLocationId: "location-a",
      notes: "분장 먼저"
    }],
    teams: [{
      id: "team-a",
      team: "촬영팀",
      name: "",
      total: "2",
      callTime: "0700",
      callLocation: "옛 주소",
      callLocationId: "location-a",
      notes: "장비 확인"
    }]
  };
  return {
    id: "plan-a",
    projectId: "project-a",
    title: "하루장의 개구리",
    sourceType: "web_editor",
    sourceFileName: "",
    shootingDate: "2026-08-17",
    episode: "3",
    director: "감독",
    dop: "촬영감독",
    assistantDirector: "조감독",
    production: "프로듀서",
    callTime: "0730",
    shootStartTime: "0900",
    shootEndTime: "1800",
    meetingLocation: "",
    shootingLocation: "",
    shootingLocations: [{
      id: "location-a",
      name: "스튜디오",
      detail: "",
      roadAddress: "서울 종로구 실제 주소",
      selectedMajorLocations: [{ key: "scene-main-location:a", name: "안방" }]
    }],
    mealTime: "",
    mealTimes: [{
      id: "meal-a",
      startTime: "0800",
      endTime: "0830",
      runtimeMinutes: null,
      runtime: "",
      locationId: "location-a",
      memo: "아침 식사"
    }],
    safetyNotice: "안전 공지",
    memo: encodeDailyPlanMemo(meta),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
}

test("persisted read model supplies every full document section from one scoped plan", () => {
  const model = buildDailyPlanReadDocumentModel(makePlan());

  assert.equal(model.plan.callTime, "07:30");
  assert.equal(model.meta.day, "3");
  assert.equal(model.meta.sunrise, "06:15");
  assert.equal(model.meta.memoText, "촬영 메모");
  assert.equal(model.plan.safetyNotice, "안전 공지");
  assert.equal(model.meta.starring[0].callTime, "07:30");
  assert.equal(model.meta.starring[0].callLocation, "서울 종로구 실제 주소");
  assert.equal(model.meta.teams[0].callTime, "07:00");
  assert.equal(model.meta.teams[0].callLocation, "서울 종로구 실제 주소");
  assert.deepEqual(model.timetableRows.map((row) => row.type === "scene" ? row.sceneNumber : row.memo), [
    "아침 식사",
    "S#1"
  ]);
  const scene = model.timetableRows[1];
  assert.equal(scene.location, "안방 / 유리의 방");
  assert.equal(scene.totalCut, "2/3");
  assert.equal(scene.shootingOrder, "1-3");
  assert.equal(model.totalCutCount, 2);
});

test("read-only view mounts the canonical portrait document without editor or mutation bundles", async () => {
  const [view, document, styles] = await Promise.all([
    readFile(viewPath, "utf8"),
    readFile(documentPath, "utf8"),
    readFile(stylesPath, "utf8")
  ]);

  assert.match(view, /import \{ DailyPlanDocument \}/u);
  assert.match(view, /buildDailyPlanReadDocumentModel\(plan, shots\)/u);
  assert.match(view, /<DailyPlanDocument[\s\S]*orientation="portrait"[\s\S]*pageLayout="single"/u);
  assert.match(document, /<DailyPlanTimetable[\s\S]*rows=\{timetableRows\}/u);
  assert.doesNotMatch(view, /DailyPlanEditor|useAutosave|autosave|<input|<select|<textarea|<button|onClick|onChange/u);
  assert.doesNotMatch(view, /dailyPlanPdf|jsPDF|jspdf|html2canvas|pdfjs|Dnd|drag|context-menu/u);
  assert.match(styles, /\.root :global\(\.daily-plan-document--portrait\)[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%/u);
  assert.match(styles, /overflow-x:\s*hidden/u);
});
