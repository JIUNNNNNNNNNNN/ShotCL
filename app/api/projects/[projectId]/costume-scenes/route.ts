import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };
type ActorSeed = { role: string; name: string };
type BulkItemInput = {
  id?: unknown;
  actorRole?: unknown;
  actorName?: unknown;
  costumeContent?: unknown;
  provider?: unknown;
  hair?: unknown;
  sortOrder?: unknown;
  keepCostumeImagePaths?: unknown;
  keepHairImagePaths?: unknown;
};
type BulkSceneInput = {
  id?: unknown;
  sceneNo?: unknown;
  sceneTitle?: unknown;
  episodeNumbers?: unknown;
  sortOrder?: unknown;
  items?: unknown;
};
type NormalizedBulkItem = {
  id: string;
  actorRole: string;
  actorName: string;
  costumeContent: string;
  provider: string;
  hair: string;
  sortOrder: number;
  keepCostumeImagePaths: string[];
  keepHairImagePaths: string[];
};
type NormalizedBulkScene = {
  id: string;
  sceneNo: string;
  sceneTitle: string;
  episodeNumbers: number[];
  sortOrder: number;
  items: NormalizedBulkItem[];
};

const SCENE_COLUMNS = "id,project_id,scene_no,scene_title,episode_numbers,sort_order,created_at,updated_at";
const ITEM_COLUMNS = "id,project_id,costume_scene_id,scene_no,actor_role,actor_name,costume_content,provider,hair,image_paths,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "의상 자료를 볼 권한이 없습니다." }, { status: 403 });
    }

    const [scenes, totalEpisodes] = await Promise.all([
      readScenes(projectId),
      readProjectTotalEpisodes(projectId)
    ]);
    return NextResponse.json({ ok: true, scenes, totalEpisodes });
  } catch (error) {
    return costumeSceneError(error, "씬별 의상 자료를 불러오지 못했습니다.");
  }
}

/**
 * 화면의 전체 local state를 한 번에 저장합니다.
 * 이미지 바이너리는 기존 costumes POST가 담당하고, 이 요청은 씬/배역/이미지 metadata를 batch 처리합니다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const timings: Record<string, number> = {};
  let step = "validate";
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as {
      scenes?: unknown;
      deletedSceneIds?: unknown;
      deletedItemIds?: unknown;
    };
    const rawScenes = body.scenes;
    if (!Array.isArray(rawScenes) || rawScenes.length > 500) {
      return NextResponse.json({ error: "의상 씬 저장 데이터가 올바르지 않습니다.", step, timings }, { status: 400 });
    }
    const inputScenes = normalizeBulkScenes(rawScenes);
    if (
      inputScenes.length !== rawScenes.length
      || inputScenes.some((scene, index) => (
        scene.items.length !== (
          rawScenes[index]
          && typeof rawScenes[index] === "object"
          && Array.isArray((rawScenes[index] as BulkSceneInput).items)
            ? ((rawScenes[index] as BulkSceneInput).items as unknown[]).length
            : 0
        )
      ))
    ) {
      return NextResponse.json({ error: "의상 씬 또는 배역 저장 데이터가 올바르지 않습니다.", step, timings }, { status: 400 });
    }
    const deletedSceneIds = normalizeUuidArray(body.deletedSceneIds);
    const deletedItemIds = normalizeUuidArray(body.deletedItemIds);
    const validationError = validateBulkScenes(inputScenes);
    if (validationError) {
      return NextResponse.json({ error: validationError, step, timings }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    step = "read_existing";
    const [{ data: existingSceneRows, error: sceneReadError }, { data: existingItemRows, error: itemReadError }] = await timed(
      timings,
      step,
      () => Promise.all([
        supabase
          .from("project_costume_scenes")
          .select(SCENE_COLUMNS)
          .eq("project_id", projectId),
        supabase
          .from("project_costumes")
          .select(ITEM_COLUMNS)
          .eq("project_id", projectId)
          .not("costume_scene_id", "is", null)
      ])
    );
    if (sceneReadError) throw sceneReadError;
    if (itemReadError) throw itemReadError;

    const existingScenes = new Map(
      (existingSceneRows ?? []).map((row) => [String(row.id), row as Record<string, unknown>])
    );
    const existingItems = new Map(
      (existingItemRows ?? []).map((row) => [String(row.id), row as Record<string, unknown>])
    );
    const sceneIdMap = Object.fromEntries(
      inputScenes.map((scene) => [
        scene.id,
        isUuid(scene.id) && existingScenes.has(scene.id) ? scene.id : randomUUID()
      ])
    );
    const itemIdMap = Object.fromEntries(
      inputScenes.flatMap((scene) => scene.items.map((item) => [
        item.id,
        isUuid(item.id) && existingItems.has(item.id) ? item.id : randomUUID()
      ]))
    );

    const sceneRows = inputScenes.map((scene) => ({
      id: sceneIdMap[scene.id],
      project_id: projectId,
      scene_no: scene.sceneNo,
      scene_title: scene.sceneTitle,
      episode_numbers: scene.episodeNumbers,
      sort_order: scene.sortOrder
    }));
    const storagePathsToDelete = new Set<string>();
    const itemRows = inputScenes.flatMap((scene) => scene.items.map((item) => {
      const currentImages = normalizeImages(existingItems.get(item.id)?.image_paths);
      const keepPaths = new Set([
        ...item.keepCostumeImagePaths,
        ...item.keepHairImagePaths
      ]);
      currentImages.forEach((image) => {
        if (!keepPaths.has(image.path)) storagePathsToDelete.add(image.path);
      });
      return {
        id: itemIdMap[item.id],
        project_id: projectId,
        costume_scene_id: sceneIdMap[scene.id],
        scene_no: scene.sceneNo,
        actor_role: item.actorRole,
        actor_name: item.actorName,
        costume_content: item.costumeContent,
        provider: item.provider,
        hair: item.hair,
        character_name: item.actorRole,
        costume_name: item.costumeContent,
        description: "",
        memo: "",
        image_paths: currentImages.filter((image) => keepPaths.has(image.path)),
        sort_order: item.sortOrder
      };
    }));

    step = "upsert_scenes";
    if (sceneRows.length > 0) {
      const { error } = await timed(
        timings,
        step,
        () => supabase.from("project_costume_scenes").upsert(sceneRows, { onConflict: "id" })
      );
      if (error) throw error;
    }

    step = "upsert_items";
    if (itemRows.length > 0) {
      const { error } = await timed(
        timings,
        step,
        () => supabase.from("project_costumes").upsert(itemRows, { onConflict: "id" })
      );
      if (error) throw error;
    }

    const liveItemIds = new Set(Object.values(itemIdMap));
    const itemIdsToDelete = deletedItemIds.filter((id) => existingItems.has(id) && !liveItemIds.has(id));
    itemIdsToDelete.forEach((id) => {
      normalizeImages(existingItems.get(id)?.image_paths).forEach((image) => storagePathsToDelete.add(image.path));
    });
    step = "delete_items";
    if (itemIdsToDelete.length > 0) {
      const { error } = await timed(
        timings,
        step,
        () => supabase.from("project_costumes").delete().eq("project_id", projectId).in("id", itemIdsToDelete)
      );
      if (error) throw error;
    }

    const liveSceneIds = new Set(Object.values(sceneIdMap));
    const sceneIdsToDelete = deletedSceneIds.filter((id) => existingScenes.has(id) && !liveSceneIds.has(id));
    if (sceneIdsToDelete.length > 0) {
      const deletedSceneIdSet = new Set(sceneIdsToDelete);
      existingItems.forEach((item) => {
        if (!deletedSceneIdSet.has(String(item.costume_scene_id ?? ""))) return;
        normalizeImages(item.image_paths).forEach((image) => storagePathsToDelete.add(image.path));
      });
    }
    step = "delete_scenes";
    if (sceneIdsToDelete.length > 0) {
      const { error } = await timed(
        timings,
        step,
        () => supabase.from("project_costume_scenes").delete().eq("project_id", projectId).in("id", sceneIdsToDelete)
      );
      if (error) throw error;
    }

    step = "verify";
    const savedScenes = await timed(timings, step, () => readScenes(projectId));
    const verification = verifyBulkSave(inputScenes, savedScenes, sceneIdMap);
    if (
      verification.expectedSceneCount !== verification.actualSceneCount
      || verification.expectedItemCount !== verification.actualItemCount
      || verification.missingScenes.length > 0
      || verification.itemCountMismatches.length > 0
    ) {
      console.error("[costume-bulk-save:verification]", verification);
      return NextResponse.json({
        ok: false,
        error: `저장 검증 실패: 씬 ${verification.expectedSceneCount}개 중 ${verification.actualSceneCount}개, 배역 ${verification.expectedItemCount}개 중 ${verification.actualItemCount}개가 확인되었습니다.`,
        step,
        scenes: savedScenes,
        sceneIdMap,
        itemIdMap,
        verification,
        timings
      }, { status: 500 });
    }

    // DB 저장과 재조회 검증이 모두 끝난 뒤에만 더 이상 참조하지 않는 파일을 정리합니다.
    step = "cleanup_storage";
    if (storagePathsToDelete.size > 0) {
      const { error } = await timed(
        timings,
        step,
        () => supabase.storage.from("storyboards").remove([...storagePathsToDelete])
      );
      if (error) {
        console.error("[costume-bulk-save:storage-cleanup]", safeError(error));
      }
    }

    return NextResponse.json({
      ok: true,
      status: "saved",
      scenes: savedScenes,
      sceneIdMap,
      itemIdMap,
      verification,
      timings
    });
  } catch (error) {
    const source = safeError(error);
    console.error("[costume-bulk-save]", { step, ...source, timings });
    return NextResponse.json({
      ok: false,
      error: "의상 전체 저장을 완료하지 못했습니다.",
      detail: source.message,
      step,
      timings
    }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 추가는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const sceneNo = cleanText(body.sceneNo, 80);
    const sceneTitle = cleanText(body.sceneTitle, 300);
    const episodeNumbers = normalizeEpisodeNumbers(body.episodeNumbers);
    const actors = normalizeActors(body.actors);
    if (!sceneNo) {
      return NextResponse.json({ error: "씬 번호 또는 씬 이름을 입력해주세요." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: existingScenes, error: existingError } = await supabase
      .from("project_costume_scenes")
      .select("id,scene_no")
      .eq("project_id", projectId);
    if (existingError) throw existingError;
    const sceneKey = normalizeSceneKey(sceneNo);
    if ((existingScenes ?? []).some((scene) => normalizeSceneKey(String(scene.scene_no ?? "")) === sceneKey)) {
      return NextResponse.json({ error: "이미 추가된 씬입니다." }, { status: 409 });
    }

    const { count, error: countError } = await supabase
      .from("project_costume_scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (countError) throw countError;

    const { data: scene, error } = await supabase
      .from("project_costume_scenes")
      .insert({
        project_id: projectId,
        scene_no: sceneNo,
        scene_title: sceneTitle,
        episode_numbers: episodeNumbers,
        sort_order: count ?? 0
      })
      .select(SCENE_COLUMNS)
      .single();
    if (error) throw error;

    if (actors.length > 0) {
      const { error: itemError } = await supabase.from("project_costumes").insert(
        actors.map((actor, index) => ({
          project_id: projectId,
          costume_scene_id: scene.id,
          scene_no: sceneNo,
          actor_role: actor.role,
          actor_name: actor.name,
          costume_content: "",
          provider: "",
          hair: "",
          character_name: actor.role,
          costume_name: "",
          description: "",
          memo: "",
          image_paths: [],
          sort_order: index
        }))
      );
      if (itemError) {
        await supabase.from("project_costume_scenes").delete().eq("id", scene.id).eq("project_id", projectId);
        throw itemError;
      }
    }

    const scenes = await readScenes(projectId);
    return NextResponse.json(
      { ok: true, scene: scenes.find((item) => item.id === String(scene.id ?? "")) },
      { status: 201 }
    );
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 추가하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const id = cleanText(body.id, 100);
    const sceneNo = cleanText(body.sceneNo, 80);
    const sceneTitle = cleanText(body.sceneTitle, 300);
    const episodeNumbers = normalizeEpisodeNumbers(body.episodeNumbers);
    if (!id || !sceneNo) {
      return NextResponse.json({ error: "씬 ID와 씬 번호가 필요합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: otherScenes, error: readError } = await supabase
      .from("project_costume_scenes")
      .select("id,scene_no")
      .eq("project_id", projectId)
      .neq("id", id);
    if (readError) throw readError;
    const sceneKey = normalizeSceneKey(sceneNo);
    if ((otherScenes ?? []).some((scene) => normalizeSceneKey(String(scene.scene_no ?? "")) === sceneKey)) {
      return NextResponse.json({ error: "이미 추가된 씬입니다." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("project_costume_scenes")
      .update({
        scene_no: sceneNo,
        scene_title: sceneTitle,
        episode_numbers: episodeNumbers
      })
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SCENE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "의상 씬을 찾을 수 없습니다." }, { status: 404 });

    const { error: itemError } = await supabase
      .from("project_costumes")
      .update({ scene_no: sceneNo })
      .eq("project_id", projectId)
      .eq("costume_scene_id", id);
    if (itemError) throw itemError;

    return NextResponse.json({ ok: true, scene: { ...mapSceneRow(data), items: [] } });
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "씬 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data: items, error: readError } = await supabase
      .from("project_costumes")
      .select("image_paths")
      .eq("project_id", projectId)
      .eq("costume_scene_id", id);
    if (readError) throw readError;

    const { data, error } = await supabase
      .from("project_costume_scenes")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "의상 씬을 찾을 수 없습니다." }, { status: 404 });

    const paths = (items ?? []).flatMap((item) => normalizeImages(item.image_paths).map((image) => image.path));
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from("storyboards").remove(paths);
      if (storageError) console.error("[costume-scenes:storage-delete]", safeError(storageError));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 삭제하지 못했습니다.");
  }
}

async function readScenes(projectId: string) {
  const supabase = requireProjectAccessDb();
  const [{ data: sceneRows, error: sceneError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase
      .from("project_costume_scenes")
      .select(SCENE_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_costumes")
      .select(ITEM_COLUMNS)
      .eq("project_id", projectId)
      .not("costume_scene_id", "is", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
  ]);
  if (sceneError) throw sceneError;
  if (itemError) throw itemError;
  const itemsByScene = new Map<string, ReturnType<typeof mapCostumeRow>[]>();
  (itemRows ?? []).forEach((row) => {
    const item = mapCostumeRow(row);
    const items = itemsByScene.get(item.costumeSceneId) ?? [];
    items.push(item);
    itemsByScene.set(item.costumeSceneId, items);
  });
  return (sceneRows ?? []).map((row) => {
    const scene = mapSceneRow(row);
    return { ...scene, items: itemsByScene.get(scene.id) ?? [] };
  });
}

async function readProjectTotalEpisodes(projectId: string) {
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase
    .from("project_basic_info")
    .select("total_episodes")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  const totalEpisodes = Number(data?.total_episodes ?? 0);
  return Number.isInteger(totalEpisodes) && totalEpisodes > 0 ? totalEpisodes : 0;
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : "";
}

async function getMaterialRole(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  if (grant) return grant.role;
  return (await canAdministerProject(request, projectId)) ? "admin" : null;
}

function normalizeBulkScenes(value: unknown): NormalizedBulkScene[] {
  if (!Array.isArray(value) || value.length > 500) return [];
  return value.flatMap((entry, sceneIndex) => {
    if (!entry || typeof entry !== "object") return [];
    const scene = entry as BulkSceneInput;
    const rawItems = Array.isArray(scene.items) ? scene.items.slice(0, 5_000) : [];
    const items = rawItems.flatMap((entryItem, itemIndex) => {
      if (!entryItem || typeof entryItem !== "object") return [];
      const item = entryItem as BulkItemInput;
      return [{
        id: cleanText(item.id, 160),
        actorRole: cleanText(item.actorRole, 200),
        actorName: cleanText(item.actorName, 200),
        costumeContent: cleanText(item.costumeContent, 2_000),
        provider: cleanText(item.provider, 200),
        hair: cleanText(item.hair, 1_000),
        sortOrder: toInteger(item.sortOrder, itemIndex),
        keepCostumeImagePaths: normalizePathArray(item.keepCostumeImagePaths),
        keepHairImagePaths: normalizePathArray(item.keepHairImagePaths)
      }];
    });
    return [{
      id: cleanText(scene.id, 160),
      sceneNo: cleanText(scene.sceneNo, 80),
      sceneTitle: cleanText(scene.sceneTitle, 300),
      episodeNumbers: normalizeEpisodeNumbers(scene.episodeNumbers),
      sortOrder: toInteger(scene.sortOrder, sceneIndex),
      items
    }];
  });
}

function validateBulkScenes(scenes: NormalizedBulkScene[]) {
  const sceneIds = new Set<string>();
  const sceneKeys = new Set<string>();
  const itemIds = new Set<string>();
  for (const scene of scenes) {
    if (!scene.id || !scene.sceneNo) return "씬 ID와 씬 번호가 필요합니다.";
    const sceneKey = normalizeSceneKey(scene.sceneNo);
    if (!sceneKey || sceneIds.has(scene.id) || sceneKeys.has(sceneKey)) {
      return `"${scene.sceneNo || "이름 없음"}" 씬의 ID 또는 씬 번호가 중복되었습니다.`;
    }
    sceneIds.add(scene.id);
    sceneKeys.add(sceneKey);
    for (const item of scene.items) {
      if (!item.id || itemIds.has(item.id)) return `"${scene.sceneNo}" 씬의 배역 ID가 중복되었습니다.`;
      if (!item.actorRole && !item.actorName) return `"${scene.sceneNo}" 씬에 배역과 배우 이름이 모두 비어 있는 항목이 있습니다.`;
      itemIds.add(item.id);
    }
  }
  return "";
}

function normalizeUuidArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter(isUuid))).slice(0, 5_000);
}

function normalizePathArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((entry) => cleanText(entry, 1_000)).filter(Boolean)
  )).slice(0, 100);
}

function verifyBulkSave(
  expectedScenes: NormalizedBulkScene[],
  actualScenes: Awaited<ReturnType<typeof readScenes>>,
  sceneIdMap: Record<string, string>
) {
  const actualById = new Map(actualScenes.map((scene) => [scene.id, scene]));
  const missingScenes: string[] = [];
  const itemCountMismatches: string[] = [];
  expectedScenes.forEach((scene) => {
    const actual = actualById.get(sceneIdMap[scene.id]);
    if (!actual) {
      missingScenes.push(scene.sceneNo);
      return;
    }
    if (actual.items.length !== scene.items.length) {
      itemCountMismatches.push(`${scene.sceneNo}: ${scene.items.length}개 → ${actual.items.length}개`);
    }
  });
  return {
    expectedSceneCount: expectedScenes.length,
    actualSceneCount: actualScenes.length,
    expectedItemCount: expectedScenes.reduce((total, scene) => total + scene.items.length, 0),
    actualItemCount: actualScenes.reduce((total, scene) => total + scene.items.length, 0),
    missingScenes,
    itemCountMismatches
  };
}

async function timed<T>(
  timings: Record<string, number>,
  label: string,
  operation: () => PromiseLike<T>
) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    timings[label] = Math.round((performance.now() - started) * 10) / 10;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function normalizeActors(value: unknown): ActorSeed[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const role = cleanText(source.role, 200);
    const name = cleanText(source.name, 200);
    if (!role && !name) return [];
    const key = (role || name).normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ role, name }];
  });
}

function normalizeEpisodeNumbers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((episode) => Number.parseInt(String(episode), 10))
      .filter((episode) => Number.isInteger(episode) && episode > 0 && episode <= 999)
  )).sort((left, right) => left - right);
}

function normalizeSceneKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/^(?:scene|씬|s)#?/i, "")
    .replace(/^#+/, "");
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeImages(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{ path: string; url: string; filename: string; fieldType: "costume" | "hair" }>;
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const path = String(source.path ?? "");
    const url = String(source.url ?? "");
    return path && url ? [{
      path,
      url,
      filename: String(source.filename ?? ""),
      fieldType: source.fieldType === "hair" ? "hair" as const : "costume" as const
    }] : [];
  });
}

function mapSceneRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    sceneNo: String(row.scene_no ?? ""),
    sceneTitle: String(row.scene_title ?? ""),
    episodeNumbers: normalizeEpisodeNumbers(row.episode_numbers),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function mapCostumeRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    costumeSceneId: String(row.costume_scene_id ?? ""),
    sceneNo: String(row.scene_no ?? ""),
    actorRole: String(row.actor_role ?? ""),
    actorName: String(row.actor_name ?? ""),
    costumeContent: String(row.costume_content ?? ""),
    provider: String(row.provider ?? ""),
    hair: String(row.hair ?? ""),
    images: normalizeImages(row.image_paths),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function costumeSceneError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_COSTUME_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  const source = safeError(error);
  console.error("[costume-scenes]", source);
  const missingEpisodeNumbers = (
    source.code === "42703" || source.code === "PGRST204"
  ) && /episode_numbers/i.test(source.message);
  if (missingEpisodeNumbers) {
    return NextResponse.json({
      error: "의상 씬 회차 migration을 먼저 적용해주세요.",
      code: "PROJECT_COSTUME_EPISODES_MIGRATION_REQUIRED",
      detail: source.message
    }, { status: 503 });
  }
  const missingTable = source.code === "42P01"
    || /project_costume_scenes|costume_scene_id|actor_role|costume_content/i.test(source.message)
      && /does not exist|schema cache|could not find/i.test(source.message);
  return NextResponse.json({
    error: missingTable ? "프로젝트 자료 migration을 먼저 적용해주세요." : message,
    code: missingTable ? "PROJECT_REFERENCE_MIGRATION_REQUIRED" : "PROJECT_COSTUME_SCENE_ERROR",
    detail: source.message
  }, { status: missingTable ? 503 : 500 });
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: String(error) };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error"
  };
}
