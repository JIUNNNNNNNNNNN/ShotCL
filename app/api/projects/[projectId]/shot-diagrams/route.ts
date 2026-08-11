import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";
import {
  areShotOverheadSpaceSnapshotsEqual,
  extractShotOverheadSpaceSnapshot,
  normalizeShotOverheadSpacePreset,
  resolveShotOverheadSpaceLocation,
  SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID,
  SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND,
  SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX,
  type ShotOverheadSpaceLocation,
  type ShotOverheadSpacePreset
} from "@/lib/shotOverheadSpacePresets";
import type { ShotMediaLink } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };
type SpacePresetMutationBody = {
  sceneId?: unknown;
  data?: unknown;
  presetId?: unknown;
  expectedUpdatedAt?: unknown;
};

const DIAGRAM_TYPE = "overhead";
const ARCHIVE_DAILY_PLAN_ID = "__project_archive__";
const ARCHIVE_REF_PREFIX = "archive:";
const LINK_REF_PREFIX = "media-link:";
const ARCHIVE_DATA_KIND = "overhead_archive";
const LINK_DATA_KIND = "media_link";
const SELECT_COLUMNS = "id,project_id,daily_plan_id,shot_ref,diagram_type,data,created_at,updated_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });

    const role = await getDiagramAccessRole(request, projectId);
    if (!role) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 403 });

    if (request.nextUrl.searchParams.get("archive") === "1") {
      const supabase = requireProjectAccessDb();
      const { data, error } = await supabase
        .from("shot_diagrams")
        .select(SELECT_COLUMNS)
        .eq("project_id", projectId)
        .eq("diagram_type", DIAGRAM_TYPE)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return NextResponse.json({
        ok: true,
        archives: (data ?? []).flatMap(mapArchiveRow),
        spacePresets: (data ?? []).flatMap(mapSpacePresetRow)
      });
    }

    const dailyPlanId = normalizeKeyPart(request.nextUrl.searchParams.get("dailyPlanId"));
    const shotRef = normalizeKeyPart(request.nextUrl.searchParams.get("shotRef"));
    if (!dailyPlanId) {
      return NextResponse.json({ error: "회차 식별값이 필요합니다." }, { status: 400 });
    }
    // Presets are project templates, never a daily-plan diagram collection.
    // They are exposed only through the access-checked archive workspace shape.
    if (dailyPlanId === SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID) {
      return NextResponse.json({ error: "회차 식별값이 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    if (request.nextUrl.searchParams.get("links") === "1") {
      const { data: linkRows, error: linkError } = await supabase
        .from("shot_diagrams")
        .select("shot_ref,diagram_type,data")
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .eq("diagram_type", DIAGRAM_TYPE)
        .like("shot_ref", `${LINK_REF_PREFIX}%`);
      if (linkError) throw linkError;
      const links = await resolveMediaLinks(supabase, projectId, linkRows ?? []);
      return NextResponse.json({ ok: true, links });
    }

    if (!shotRef) {
      const { data, error } = await supabase
        .from("shot_diagrams")
        .select("shot_ref,data")
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .eq("diagram_type", DIAGRAM_TYPE);
      if (error) throw error;

      return NextResponse.json({
        ok: true,
        diagrams: (data ?? []).map((row) => ({
          shotRef: row.shot_ref,
          diagram: normalizeShotOverheadDiagram(row.data)
        }))
      });
    }

    const { data, error } = await supabase
      .from("shot_diagrams")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .eq("shot_ref", shotRef)
      .eq("diagram_type", DIAGRAM_TYPE)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      diagram: data ? normalizeShotOverheadDiagram(data.data) : null
    });
  } catch (error) {
    return diagramErrorResponse(error, "부감도를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });

    const role = await getDiagramAccessRole(request, projectId);
    if (role !== "admin") return NextResponse.json({ error: "부감도는 Key staff만 저장할 수 있습니다." }, { status: 403 });

    const body = (await request.json()) as {
      operation?: unknown;
      dailyPlanId?: unknown;
      shotRef?: unknown;
      data?: unknown;
      archiveId?: unknown;
      title?: unknown;
      memo?: unknown;
      sceneId?: unknown;
      sceneNo?: unknown;
      cutNo?: unknown;
      presetId?: unknown;
      expectedUpdatedAt?: unknown;
      mediaType?: unknown;
      assetId?: unknown;
      source?: unknown;
    };
    const operation = normalizeKeyPart(body.operation);
    if (operation === "save_space_preset") {
      return saveSpacePreset(projectId, body);
    }
    if (operation === "save_archive") {
      const archiveId = toArchiveRef(normalizeKeyPart(body.archiveId) || randomUUID());
      const diagram = normalizeShotOverheadDiagram(body.data);
      if (!diagram) return NextResponse.json({ error: "부감도 데이터 형식이 올바르지 않습니다." }, { status: 400 });
      const sceneId = normalizeOptionalUuid(body.sceneId);
      if (normalizeKeyPart(body.sceneId) && !sceneId) {
        return NextResponse.json({ error: "씬 식별값이 올바르지 않습니다." }, { status: 400 });
      }
      const supabase = requireProjectAccessDb();
      let sceneNo = normalizeShortText(body.sceneNo, 100);
      if (sceneId) {
        const scene = await loadProjectSceneRow(supabase, projectId, sceneId);
        if (!scene) {
          return NextResponse.json(
            { error: "선택한 씬을 찾을 수 없습니다.", code: "SHOT_DIAGRAM_SCENE_NOT_FOUND" },
            { status: 404 }
          );
        }
        sceneNo = normalizeShortText(scene.scene_no, 100);
      }
      const archiveData = {
        kind: ARCHIVE_DATA_KIND,
        title: normalizeShortText(body.title, 240) || "부감도",
        memo: normalizeShortText(body.memo, 1_000),
        sceneId,
        sceneNo,
        cutNo: normalizeShortText(body.cutNo, 100),
        diagram
      };
      const { data, error } = await supabase
        .from("shot_diagrams")
        .upsert(
          {
            project_id: projectId,
            daily_plan_id: ARCHIVE_DAILY_PLAN_ID,
            shot_ref: archiveId,
            diagram_type: DIAGRAM_TYPE,
            data: archiveData,
            updated_at: new Date().toISOString()
          },
          { onConflict: "project_id,daily_plan_id,shot_ref,diagram_type" }
        )
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, archive: mapArchiveRow(data)[0] });
    }

    if (operation === "save_link") {
      const dailyPlanId = normalizeKeyPart(body.dailyPlanId);
      const shotRef = normalizeKeyPart(body.shotRef);
      const mediaType = body.mediaType === "storyboard" ? "storyboard" : body.mediaType === "overhead" ? "overhead" : "";
      const assetId = normalizeKeyPart(body.assetId);
      const source = body.source === "diagram" ? "diagram" : "reference";
      if (!dailyPlanId || !shotRef || !mediaType) {
        return NextResponse.json({ error: "회차, 컷, 자료 종류가 필요합니다." }, { status: 400 });
      }
      if (dailyPlanId === SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID) {
        return NextResponse.json({ error: "회차 식별값이 올바르지 않습니다." }, { status: 400 });
      }
      const linkRef = toMediaLinkRef(mediaType, shotRef);
      const supabase = requireProjectAccessDb();
      if (!assetId) {
        const { error } = await supabase
          .from("shot_diagrams")
          .delete()
          .eq("project_id", projectId)
          .eq("daily_plan_id", dailyPlanId)
          .eq("shot_ref", linkRef)
          .eq("diagram_type", DIAGRAM_TYPE);
        if (error) throw error;
        return NextResponse.json({ ok: true, status: "unlinked" });
      }
      if (source === "diagram" && mediaType !== "overhead") {
        return NextResponse.json({ error: "직접 만든 도면은 부감도에만 연결할 수 있습니다." }, { status: 400 });
      }
      const legacyDiagramId = source === "diagram" && assetId.startsWith("legacy:")
        ? assetId.slice("legacy:".length)
        : "";
      const sourceQuery = source === "diagram"
        ? legacyDiagramId
          ? supabase
              .from("shot_diagrams")
              .select("id")
              .eq("project_id", projectId)
              .eq("diagram_type", DIAGRAM_TYPE)
              .eq("id", legacyDiagramId)
              .maybeSingle()
          : supabase
            .from("shot_diagrams")
            .select("shot_ref")
            .eq("project_id", projectId)
            .eq("daily_plan_id", ARCHIVE_DAILY_PLAN_ID)
            .eq("diagram_type", DIAGRAM_TYPE)
            .eq("shot_ref", toArchiveRef(assetId))
            .maybeSingle()
        : supabase
            .from("project_reference_assets")
            .select("id")
            .eq("project_id", projectId)
            .eq("asset_type", mediaType)
            .eq("id", assetId)
            .maybeSingle();
      const { data: sourceAsset, error: sourceError } = await sourceQuery;
      if (sourceError) throw sourceError;
      if (!sourceAsset) return NextResponse.json({ error: "선택한 아카이브 자료를 찾을 수 없습니다." }, { status: 404 });
      const { error } = await supabase
        .from("shot_diagrams")
        .upsert(
          {
            project_id: projectId,
            daily_plan_id: dailyPlanId,
            shot_ref: linkRef,
            diagram_type: DIAGRAM_TYPE,
            data: { kind: LINK_DATA_KIND, shotRef, mediaType, assetId: source === "diagram" && !assetId.startsWith("legacy:") ? toArchiveRef(assetId) : assetId, source },
            updated_at: new Date().toISOString()
          },
          { onConflict: "project_id,daily_plan_id,shot_ref,diagram_type" }
        );
      if (error) throw error;
      return NextResponse.json({ ok: true, status: "linked" });
    }

    const dailyPlanId = normalizeKeyPart(body.dailyPlanId);
    const shotRef = normalizeKeyPart(body.shotRef);
    const diagram = normalizeShotOverheadDiagram(body.data);
    if (!dailyPlanId || !shotRef) {
      return NextResponse.json({ error: "회차와 컷 식별값이 필요합니다." }, { status: 400 });
    }
    if (
      dailyPlanId === SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID
      || shotRef.startsWith(SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX)
    ) {
      return NextResponse.json({ error: "회차 또는 컷 식별값이 올바르지 않습니다." }, { status: 400 });
    }
    if (!diagram) return NextResponse.json({ error: "부감도 데이터 형식이 올바르지 않습니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("shot_diagrams")
      .upsert(
        {
          project_id: projectId,
          daily_plan_id: dailyPlanId,
          shot_ref: shotRef,
          diagram_type: DIAGRAM_TYPE,
          data: diagram,
          updated_at: new Date().toISOString()
        },
        { onConflict: "project_id,daily_plan_id,shot_ref,diagram_type" }
      )
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      status: "saved",
      diagram: normalizeShotOverheadDiagram(data.data)
    });
  } catch (error) {
    return diagramErrorResponse(error, "부감도를 저장하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getDiagramAccessRole(request, projectId);
    if (role !== "admin") return NextResponse.json({ error: "부감도 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json().catch(() => ({})) as {
          operation?: unknown;
          archiveIds?: unknown;
          presetId?: unknown;
          expectedUpdatedAt?: unknown;
        }
      : {};
    if (normalizeKeyPart(body.operation) === "delete_space_preset") {
      return deleteSpacePreset(projectId, body);
    }
    const requestedArchiveIds = Array.isArray(body.archiveIds)
      ? body.archiveIds
      : request.nextUrl.searchParams.getAll("archiveId");
    const archiveIds = [...new Set(requestedArchiveIds.map(normalizeKeyPart).filter(Boolean))].slice(0, 250);
    if (archiveIds.length === 0) return NextResponse.json({ error: "부감도 자료 ID가 필요합니다." }, { status: 400 });
    const archiveRefs = archiveIds.map(toArchiveRef);
    const supabase = requireProjectAccessDb();
    if (archiveRefs.length === 1) {
      const { error: linkError } = await supabase
        .from("shot_diagrams")
        .delete()
        .eq("project_id", projectId)
        .eq("diagram_type", DIAGRAM_TYPE)
        .contains("data", { kind: LINK_DATA_KIND, assetId: archiveRefs[0], source: "diagram" });
      if (linkError) throw linkError;
    } else {
      const { data: linkedRows, error: linkLookupError } = await supabase
        .from("shot_diagrams")
        .select("id,data")
        .eq("project_id", projectId)
        .eq("diagram_type", DIAGRAM_TYPE)
        .contains("data", { kind: LINK_DATA_KIND, source: "diagram" });
      if (linkLookupError) throw linkLookupError;
      const archiveRefSet = new Set(archiveRefs);
      const linkedRowIds = (linkedRows ?? []).flatMap((row) => {
        const data = row.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? row.data as Record<string, unknown>
          : {};
        return typeof row.id === "string" && archiveRefSet.has(normalizeKeyPart(data.assetId))
          ? [row.id]
          : [];
      });
      if (linkedRowIds.length > 0) {
        const { error: linkError } = await supabase
          .from("shot_diagrams")
          .delete()
          .eq("project_id", projectId)
          .in("id", linkedRowIds);
        if (linkError) throw linkError;
      }
    }
    const { error } = await supabase
      .from("shot_diagrams")
      .delete()
      .eq("project_id", projectId)
      .eq("daily_plan_id", ARCHIVE_DAILY_PLAN_ID)
      .in("shot_ref", archiveRefs)
      .eq("diagram_type", DIAGRAM_TYPE);
    if (error) throw error;
    return NextResponse.json({ ok: true, deleted: archiveIds.length });
  } catch (error) {
    return diagramErrorResponse(error, "부감도 자료를 삭제하지 못했습니다.");
  }
}

async function saveSpacePreset(
  projectId: string,
  body: SpacePresetMutationBody
) {
  const sceneId = normalizeOptionalUuid(body.sceneId);
  if (!sceneId) {
    return NextResponse.json(
      { error: "공간 프리셋을 저장할 씬을 선택해주세요.", code: "SPACE_PRESET_SCENE_REQUIRED" },
      { status: 400 }
    );
  }
  const diagram = normalizeShotOverheadDiagram(body.data);
  const snapshot = diagram ? extractShotOverheadSpaceSnapshot(diagram) : null;
  if (!snapshot) {
    return NextResponse.json(
      { error: "저장할 공간이 없습니다.", code: "SPACE_PRESET_EMPTY" },
      { status: 400 }
    );
  }
  const expected = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
  if (!expected.ok) {
    return NextResponse.json({ error: expected.error }, { status: 400 });
  }

  const supabase = requireProjectAccessDb();
  const sceneLocation = await resolveProjectSceneSpaceLocation(
    supabase,
    projectId,
    sceneId
  );
  if (sceneLocation instanceof NextResponse) return sceneLocation;

  const presetRef = toSpacePresetRef(sceneLocation.key);
  const presetData = {
    kind: SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND,
    version: 1,
    location: sceneLocation,
    snapshot
  };
  if (expected.value === null) {
    const { data, error } = await supabase
      .from("shot_diagrams")
      .insert({
        project_id: projectId,
        daily_plan_id: SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID,
        shot_ref: presetRef,
        diagram_type: DIAGRAM_TYPE,
        data: presetData
      })
      .select(SELECT_COLUMNS)
      .single();
    if (!error) {
      return NextResponse.json({
        ok: true,
        status: "created",
        spacePreset: mapSpacePresetRow(data)[0]
      });
    }
    if (!isDatabaseErrorCode(error, "23505")) throw error;

    // A response can be lost after the insert commits. Repeating the same
    // create is an idempotent success, while a different snapshot is a conflict.
    const existing = await loadSpacePresetRow(supabase, projectId, presetRef);
    if (
      existing
      && existing.location.key === sceneLocation.key
      && areShotOverheadSpaceSnapshotsEqual(existing.snapshot, snapshot)
    ) {
      return NextResponse.json({ ok: true, status: "unchanged", spacePreset: existing });
    }
    return spacePresetConflictResponse();
  }

  const { data, error } = await supabase
    .from("shot_diagrams")
    .update({ data: presetData })
    .eq("project_id", projectId)
    .eq("daily_plan_id", SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID)
    .eq("shot_ref", presetRef)
    .eq("diagram_type", DIAGRAM_TYPE)
    .contains("data", { kind: SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND })
    .eq("updated_at", expected.value)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  const updated = data ? mapSpacePresetRow(data)[0] : null;
  if (updated) {
    return NextResponse.json({ ok: true, status: "updated", spacePreset: updated });
  }

  // The first update may have committed even if its response was lost. Only
  // the exact same canonical snapshot may turn a stale CAS retry into success.
  const existing = await loadSpacePresetRow(supabase, projectId, presetRef);
  if (
    existing
    && existing.location.key === sceneLocation.key
    && areShotOverheadSpaceSnapshotsEqual(existing.snapshot, snapshot)
  ) {
    return NextResponse.json({ ok: true, status: "unchanged", spacePreset: existing });
  }
  return spacePresetConflictResponse();
}

async function deleteSpacePreset(
  projectId: string,
  body: SpacePresetMutationBody
) {
  const presetId = normalizeSpacePresetId(body.presetId);
  if (!presetId) {
    return NextResponse.json(
      { error: "공간 프리셋 식별값이 올바르지 않습니다." },
      { status: 400 }
    );
  }
  const expected = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
  if (!expected.ok || expected.value === null) {
    return NextResponse.json(
      { error: expected.ok ? "공간 프리셋 삭제 기준값이 필요합니다." : expected.error },
      { status: 400 }
    );
  }
  const supabase = requireProjectAccessDb();
  const query = supabase
    .from("shot_diagrams")
    .delete()
    .eq("project_id", projectId)
    .eq("daily_plan_id", SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID)
    .eq("shot_ref", presetId)
    .eq("diagram_type", DIAGRAM_TYPE)
    .contains("data", { kind: SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND })
    .eq("updated_at", expected.value);
  const { data, error } = await query.select(SELECT_COLUMNS).maybeSingle();
  if (error) throw error;
  if (data) {
    return NextResponse.json({ ok: true, status: "deleted", presetId });
  }
  const existing = await loadSpacePresetRow(supabase, projectId, presetId);
  if (existing) return spacePresetConflictResponse();
  return NextResponse.json({ ok: true, status: "unchanged", presetId });
}

async function resolveProjectSceneSpaceLocation(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  sceneId: string
): Promise<ShotOverheadSpaceLocation | NextResponse> {
  const data = await loadProjectSceneRow(supabase, projectId, sceneId);
  if (!data) {
    return NextResponse.json(
      { error: "선택한 씬을 찾을 수 없습니다.", code: "SPACE_PRESET_SCENE_NOT_FOUND" },
      { status: 404 }
    );
  }
  const location = resolveShotOverheadSpaceLocation({
    mainLocation: data.main_location,
    subLocation: data.sub_location
  });
  if (!location) {
    return NextResponse.json(
      { error: "씬리스트에 소장소를 먼저 입력해주세요.", code: "SPACE_PRESET_SUB_LOCATION_REQUIRED" },
      { status: 400 }
    );
  }
  return location;
}

async function loadProjectSceneRow(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  sceneId: string
) {
  const { data, error } = await supabase
    .from("project_scene_items")
    .select("scene_no,main_location,sub_location")
    .eq("project_id", projectId)
    .eq("id", sceneId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadSpacePresetRow(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  presetRef: string
) {
  const { data, error } = await supabase
    .from("shot_diagrams")
    .select(SELECT_COLUMNS)
    .eq("project_id", projectId)
    .eq("daily_plan_id", SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID)
    .eq("shot_ref", presetRef)
    .eq("diagram_type", DIAGRAM_TYPE)
    .contains("data", { kind: SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND })
    .maybeSingle();
  if (error) throw error;
  return data ? mapSpacePresetRow(data)[0] ?? null : null;
}

function spacePresetConflictResponse() {
  return NextResponse.json(
    {
      error: "다른 사용자가 공간 프리셋을 변경했습니다. 최신 상태를 불러온 뒤 다시 시도해주세요.",
      code: "SPACE_PRESET_CONFLICT"
    },
    { status: 409 }
  );
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

async function getDiagramAccessRole(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  if (grant) return grant.role;
  return (await canAdministerProject(request, projectId)) ? "admin" : null;
}

function normalizeKeyPart(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeShortText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeOptionalUuid(value: unknown) {
  const normalized = normalizeKeyPart(value).toLocaleLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSpacePresetId(value: unknown) {
  const normalized = normalizeKeyPart(value);
  const digest = normalized.slice(SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX.length);
  return normalized.startsWith(SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX)
    && /^[0-9a-f]{64}$/i.test(digest)
    ? normalized.toLocaleLowerCase()
    : "";
}

function toSpacePresetRef(locationKey: string) {
  const digest = createHash("sha256").update(locationKey, "utf8").digest("hex");
  return `${SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX}${digest}`;
}

function normalizeExpectedUpdatedAt(value: unknown):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "공간 프리셋 수정 기준값이 올바르지 않습니다." };
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || Number.isNaN(Date.parse(normalized))) {
    return { ok: false, error: "공간 프리셋 수정 기준값이 올바르지 않습니다." };
  }
  return { ok: true, value: normalized };
}

function isDatabaseErrorCode(error: unknown, code: string) {
  return Boolean(
    error
    && typeof error === "object"
    && String((error as { code?: unknown }).code ?? "") === code
  );
}

function mapArchiveRow(row: Record<string, unknown>) {
  const source = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
  if (
    source.kind === LINK_DATA_KIND
    || source.kind === SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND
    || row.daily_plan_id === SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID
    || String(row.shot_ref ?? "").startsWith(SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX)
  ) return [];
  const archive = source.kind === ARCHIVE_DATA_KIND
    && row.daily_plan_id === ARCHIVE_DAILY_PLAN_ID
    && String(row.shot_ref ?? "").startsWith(ARCHIVE_REF_PREFIX);
  const legacy = !archive;
  const diagram = normalizeShotOverheadDiagram(archive ? source.diagram : row.data);
  if (!diagram) return [];
  return [{
    id: legacy ? `legacy:${String(row.id ?? "")}` : String(row.shot_ref ?? ""),
    projectId: String(row.project_id ?? ""),
    title: legacy ? "기존 컷 부감도" : normalizeShortText(source.title, 240) || "부감도",
    memo: normalizeShortText(source.memo, 1_000),
    sceneId: archive ? normalizeOptionalUuid(source.sceneId) : null,
    sceneNo: normalizeShortText(source.sceneNo, 100),
    cutNo: normalizeShortText(source.cutNo, 100),
    diagram,
    legacy,
    sourceDailyPlanId: legacy ? String(row.daily_plan_id ?? "") : "",
    sourceShotRef: legacy ? String(row.shot_ref ?? "") : "",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  }];
}

function mapSpacePresetRow(row: Record<string, unknown>): ShotOverheadSpacePreset[] {
  const source = row.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : {};
  if (
    source.kind !== SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND
    || source.version !== 1
    || row.daily_plan_id !== SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID
    || !normalizeSpacePresetId(row.shot_ref)
  ) return [];
  const preset = normalizeShotOverheadSpacePreset({
    id: row.shot_ref,
    projectId: row.project_id,
    location: source.location,
    snapshot: source.snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
  return preset && preset.id === toSpacePresetRef(preset.location.key)
    ? [preset]
    : [];
}

async function resolveMediaLinks(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  rows: Array<{ shot_ref?: unknown; diagram_type?: unknown; data?: unknown }>
) {
  const normalized = rows.flatMap((row) => {
    const value = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
    if (value.kind !== LINK_DATA_KIND) return [];
    const assetId = normalizeKeyPart(value.assetId);
    const source = value.source === "diagram" ? "diagram" : "reference";
    const mediaType = value.mediaType === "storyboard" ? "storyboard" : value.mediaType === "overhead" ? "overhead" : "";
    const shotRef = normalizeKeyPart(value.shotRef);
    return assetId && mediaType && shotRef ? [{ assetId, source, mediaType, shotRef }] : [];
  });
  const referenceIds = [...new Set(normalized.filter((item) => item.source === "reference").map((item) => item.assetId))];
  const diagramIds = [...new Set(normalized.filter((item) => item.source === "diagram").map((item) => item.assetId))];
  const archiveDiagramIds = diagramIds.filter((id) => !id.startsWith("legacy:"));
  const legacyDiagramIds = diagramIds.filter((id) => id.startsWith("legacy:")).map((id) => id.slice("legacy:".length));
  const [referenceResult, archiveDiagramResult, legacyDiagramResult] = await Promise.all([
    referenceIds.length
      ? supabase
          .from("project_reference_assets")
          .select("id,asset_type,filename,public_url")
          .eq("project_id", projectId)
          .in("id", referenceIds)
      : Promise.resolve({ data: [], error: null }),
    archiveDiagramIds.length
      ? supabase
          .from("shot_diagrams")
          .select(SELECT_COLUMNS)
          .eq("project_id", projectId)
          .eq("daily_plan_id", ARCHIVE_DAILY_PLAN_ID)
          .eq("diagram_type", DIAGRAM_TYPE)
          .in("shot_ref", archiveDiagramIds)
      : Promise.resolve({ data: [], error: null }),
    legacyDiagramIds.length
      ? supabase
          .from("shot_diagrams")
          .select(SELECT_COLUMNS)
          .eq("project_id", projectId)
          .eq("diagram_type", DIAGRAM_TYPE)
          .in("id", legacyDiagramIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (referenceResult.error) throw referenceResult.error;
  if (archiveDiagramResult.error) throw archiveDiagramResult.error;
  if (legacyDiagramResult.error) throw legacyDiagramResult.error;
  const references = new Map((referenceResult.data ?? []).map((row) => [String(row.id), row]));
  const diagrams = new Map([
    ...(archiveDiagramResult.data ?? []),
    ...(legacyDiagramResult.data ?? [])
  ].flatMap((row) => {
    const archive = mapArchiveRow(row)[0];
    return archive ? [[archive.id, archive] as const] : [];
  }));
  const resolved: ShotMediaLink[] = [];
  normalized.forEach((link) => {
    if (link.source === "diagram") {
      const archive = diagrams.get(link.assetId);
      if (archive) resolved.push({
        ...link,
        source: "diagram",
        mediaType: link.mediaType as ShotMediaLink["mediaType"],
        publicUrl: null,
        filename: archive.title,
        diagram: archive.diagram
      });
      return;
    }
    const asset = references.get(link.assetId);
    if (!asset || asset.asset_type !== link.mediaType) return;
    resolved.push({
      ...link,
      source: "reference",
      mediaType: link.mediaType as ShotMediaLink["mediaType"],
      publicUrl: String(asset.public_url ?? ""),
      filename: String(asset.filename ?? ""),
      diagram: null
    });
  });
  return resolved;
}

function toArchiveRef(value: string) {
  return value.startsWith(ARCHIVE_REF_PREFIX)
    ? value.slice(0, 500)
    : `${ARCHIVE_REF_PREFIX}${value}`.slice(0, 500);
}

function toMediaLinkRef(mediaType: "overhead" | "storyboard", shotRef: string) {
  return `${LINK_REF_PREFIX}${mediaType}:${shotRef}`.slice(0, 500);
}

function diagramErrorResponse(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "SHOT_DIAGRAM_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  console.error("[shot-diagrams]", getSafeDatabaseError(error));
  return NextResponse.json({ error: message, code: "SHOT_DIAGRAM_STORAGE_ERROR" }, { status: 500 });
}

function getSafeDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return { message: String(error) };
  const source = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return {
    code: typeof source.code === "string" ? source.code : undefined,
    message: typeof source.message === "string" ? source.message : "Unknown database error",
    details: typeof source.details === "string" ? source.details : undefined,
    hint: typeof source.hint === "string" ? source.hint : undefined
  };
}
