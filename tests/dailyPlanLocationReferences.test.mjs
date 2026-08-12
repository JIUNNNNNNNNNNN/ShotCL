import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyPlanLocationOptions,
  getDailyPlanLocationOutputAddress,
  getDailyPlanLocationReferenceAddress,
  resolveDailyPlanLocationReference,
  resolveEffectiveGatheringLocation
} from "../lib/dailyPlan/locationReferences.ts";

function location(id, address, patch = {}) {
  return {
    id,
    name: "",
    detail: "",
    inputMode: "search",
    roadAddress: address,
    address: "",
    manualAddress: "",
    selectedMajorLocations: [],
    ...patch
  };
}

test("canonical options expose only compact labels while values remain stable IDs", () => {
  const locations = [
    location("A", "서울 종로구 111"),
    location("blank", ""),
    location("B", "서울 마포구 222")
  ];
  const before = structuredClone(locations);

  assert.deepEqual(
    buildDailyPlanLocationOptions(locations).map(({ id, value, label, address }) => ({ id, value, label, address })),
    [
      { id: "A", value: "A", label: "장소1", address: "서울 종로구 111" },
      { id: "B", value: "B", label: "장소2", address: "서울 마포구 222" }
    ]
  );
  assert.deepEqual(locations, before);
});

test("address resolution follows stored input mode and safe legacy fallbacks", () => {
  assert.equal(getDailyPlanLocationOutputAddress(location("A", "도로명", {
    address: "지번",
    manualAddress: "직접",
    inputMode: "search"
  })), "도로명");
  assert.equal(getDailyPlanLocationOutputAddress(location("A", "도로명", {
    address: "지번",
    manualAddress: "직접",
    inputMode: "manual"
  })), "직접");
  assert.equal(getDailyPlanLocationOutputAddress(location("A", "", {
    inputMode: "none",
    detail: "상세 주소"
  })), "상세 주소");
});

test("stable references follow address edits and preserve the same place through reorder", () => {
  const original = [location("A", "서울 종로구 111"), location("B", "서울 마포구 222")];
  assert.equal(getDailyPlanLocationReferenceAddress({ locations: original, locationId: "A" }), "서울 종로구 111");

  const editedAndReordered = [location("B", "서울 마포구 222"), location("A", "서울 종로구 333")];
  const resolution = resolveDailyPlanLocationReference({ locations: editedAndReordered, locationId: "A" });
  assert.equal(resolution.kind, "location");
  assert.equal(resolution.label, "장소2");
  assert.equal(resolution.address, "서울 종로구 333");
});

test("missing stable IDs fail closed without exposing cached labels or UUIDs", () => {
  for (const id of ["loc_deleted", "67d7702b-592f-4afb-a250-bfa74f5031d6"]) {
    const result = resolveDailyPlanLocationReference({
      locations: [location("A", "서울 종로구")],
      locationId: id,
      legacyText: "장소1"
    });
    assert.equal(result.kind, "orphan");
    assert.equal(result.address, "");
    assert.equal(result.label, "");
  }
});

test("legacy free text stays readable and ordinal labels are never guessed by array index", () => {
  const locations = [location("A", "서울 종로구"), location("B", "서울 마포구")];
  assert.equal(getDailyPlanLocationReferenceAddress({ locations, legacyText: "서울 마포구" }), "서울 마포구");
  assert.equal(getDailyPlanLocationReferenceAddress({ locations, legacyText: "옛 집합장소" }), "옛 집합장소");
  assert.deepEqual(
    resolveDailyPlanLocationReference({ locations, legacyText: "장소1" }),
    {
      kind: "legacy",
      option: null,
      locationId: "",
      label: "장소1",
      address: "장소1",
      legacyText: "장소1"
    }
  );

  const duplicateAddresses = [location("A", "같은 주소"), location("B", "같은 주소")];
  assert.equal(
    resolveDailyPlanLocationReference({ locations: duplicateAddresses, legacyText: "같은 주소" }).kind,
    "legacy"
  );
});

test("gathering location uses explicit stable selection before the derived first-location fallback", () => {
  const noExplicit = [location("A", "주소 A"), location("B", "주소 B")];
  assert.equal(resolveEffectiveGatheringLocation(noExplicit)?.id, "A");

  const explicitSecond = [location("A", "주소 A"), location("B", "주소 B", { isPrimary: true })];
  assert.equal(resolveEffectiveGatheringLocation(explicitSecond)?.id, "B");
  assert.equal(resolveEffectiveGatheringLocation([...explicitSecond].reverse())?.id, "B");
  assert.equal(resolveEffectiveGatheringLocation([]), null);
});
