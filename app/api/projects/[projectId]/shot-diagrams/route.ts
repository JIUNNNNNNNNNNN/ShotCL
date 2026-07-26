import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";
import type { ShotMediaLink } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };

const DIAGRAM_TYPE = "overhead";
const ARCHIVE_DAILY_PLAN_ID = "__project_archive__";
const ARCHIVE_REF_PREFIX = "archive:";
const LINK_REF_PREFIX = "media-link:";
const ARCHIVE_DATA_KIND = "overhead_archive";
const LINK_DATA_KIND = "media_link";
const SELECT_COLUMNS = "id,project_id,daily_plan_id,shot_ref,diagram_type,data,created_at,updated_at";

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
        archives: (data ?? []).flatMap(mapArchiveRow)
      });
    }

    const dailyPlanId = normalizeKeyPart(request.nextUrl.searchParams.get("dailyPlanId"));
    const shotRef = normalizeKeyPart(request.nextUrl.searchParams.get("shotRef"));
    if (!dailyPlanId) {
      return NextResponse.json({ error: "회차 식별값이 필요합니다." }, { status: 400 });
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
      sceneNo?: unknown;
      cutNo?: unknown;
      mediaType?: unknown;
      assetId?: unknown;
      source?: unknown;
    };
    const operation = normalizeKeyPart(body.operation);
    if (operation === "save_archive") {
      const archiveId = toArchiveRef(normalizeKeyPart(body.archiveId) || randomUUID());
      const diagram = normalizeShotOverheadDiagram(body.data);
      if (!diagram) return NextResponse.json({ error: "부감도 데이터 형식이 올바르지 않습니다." }, { status: 400 });
      const archiveData = {
        kind: ARCHIVE_DATA_KIND,
        title: normalizeShortText(body.title, 240) || "부감도",
        memo: normalizeShortText(body.memo, 1_000),
        sceneNo: normalizeShortText(body.sceneNo, 100),
        cutNo: normalizeShortText(body.cutNo, 100),
        diagram
      };
      const supabase = requireProjectAccessDb();
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
    const archiveId = normalizeKeyPart(request.nextUrl.searchParams.get("archiveId"));
    if (!archiveId) return NextResponse.json({ error: "부감도 자료 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { error: linkError } = await supabase
      .from("shot_diagrams")
      .delete()
      .eq("project_id", projectId)
      .eq("diagram_type", DIAGRAM_TYPE)
      .contains("data", { kind: LINK_DATA_KIND, assetId: toArchiveRef(archiveId), source: "diagram" });
    if (linkError) throw linkError;
    const { error } = await supabase
      .from("shot_diagrams")
      .delete()
      .eq("project_id", projectId)
      .eq("daily_plan_id", ARCHIVE_DAILY_PLAN_ID)
      .eq("shot_ref", toArchiveRef(archiveId))
      .eq("diagram_type", DIAGRAM_TYPE);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return diagramErrorResponse(error, "부감도 자료를 삭제하지 못했습니다.");
  }
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

function mapArchiveRow(row: Record<string, unknown>) {
  const source = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
  if (source.kind === LINK_DATA_KIND) return [];
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
