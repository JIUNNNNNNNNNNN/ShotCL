import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestRole,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { ProjectArchiveFolderInspection } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };
type DbClient = ReturnType<typeof requireProjectAccessDb>;
type FolderRow = Record<string, unknown> & {
  id: unknown;
  project_id: unknown;
  name: unknown;
  sort_order: unknown;
};

const SELECT_COLUMNS = "id,project_id,name,sort_order,created_at,updated_at";
const STORAGE_BUCKET = "storyboards";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "아카이브 폴더를 볼 권한이 없습니다." }, { status: 403 });
    }
    const { data, error } = await requireProjectAccessDb()
      .from("project_archive_folders")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, folders: (data ?? []).map(mapFolder) });
  } catch (error) {
    return folderError(error, "아카이브 폴더를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 작업은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as {
      operation?: unknown;
      ids?: unknown;
      assetIds?: unknown;
      name?: unknown;
      sortOrder?: unknown;
    };
    const supabase = requireProjectAccessDb();
    if (body.operation === "inspect_delete") {
      const ids = normalizeIds(body.ids);
      if (ids.length === 0) {
        return NextResponse.json({ error: "확인할 폴더를 선택해주세요." }, { status: 400 });
      }
      const inspection = await inspectFolderSelection(
        supabase,
        projectId,
        ids,
        normalizeIds(body.assetIds)
      );
      return NextResponse.json({ ok: true, inspection });
    }

    const name = normalizeFolderPath(body.name);
    if (!name) return NextResponse.json({ error: "폴더 이름을 입력해주세요." }, { status: 400 });
    const { data, error } = await supabase
      .from("project_archive_folders")
      .insert({
        project_id: projectId,
        name,
        sort_order: toInteger(body.sortOrder)
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, folder: mapFolder(data) }, { status: 201 });
  } catch (error) {
    return folderError(error, "폴더를 만들지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as {
      operation?: unknown;
      ids?: unknown;
      assetIds?: unknown;
      destinationFolderId?: unknown;
      id?: unknown;
      rootPath?: unknown;
      name?: unknown;
      sortOrder?: unknown;
    };
    const supabase = requireProjectAccessDb();
    if (body.operation === "rename_tree") {
      const id = cleanText(body.id, 100) || null;
      const rootPath = normalizeFolderPath(body.rootPath);
      const name = normalizeFolderPath(body.name);
      if ((!id && !rootPath) || !name) {
        return NextResponse.json({ error: "폴더 식별값과 새 이름이 필요합니다." }, { status: 400 });
      }
      const result = await renameFolderTree(supabase, projectId, id, rootPath, name);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.operation === "move_selection") {
      const folderIds = normalizeIds(body.ids);
      const assetIds = normalizeIds(body.assetIds);
      if (folderIds.length === 0 && assetIds.length === 0) {
        return NextResponse.json({ error: "이동할 자료나 폴더를 선택해주세요." }, { status: 400 });
      }
      const destinationFolderId = cleanText(body.destinationFolderId, 100) || null;
      const result = await moveArchiveSelection(
        supabase,
        projectId,
        folderIds,
        assetIds,
        destinationFolderId
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.operation === "move_many") {
      const ids = normalizeIds(body.ids);
      if (ids.length === 0) {
        return NextResponse.json({ error: "이동할 폴더를 선택해주세요." }, { status: 400 });
      }
      const destinationFolderId = cleanText(body.destinationFolderId, 100) || null;
      const result = await moveFolderTrees(supabase, projectId, ids, destinationFolderId);
      return NextResponse.json({ ok: true, ...result });
    }

    const id = cleanText(body.id, 100);
    const name = normalizeFolderPath(body.name);
    if (!id || !name) return NextResponse.json({ error: "폴더 ID와 이름이 필요합니다." }, { status: 400 });
    const payload: Record<string, unknown> = { name };
    if (body.sortOrder !== undefined) payload.sort_order = toInteger(body.sortOrder);
    const { data, error } = await supabase
      .from("project_archive_folders")
      .update(payload)
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, folder: mapFolder(data) });
  } catch (error) {
    return folderError(error, "폴더를 변경하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as {
      ids?: unknown;
      assetIds?: unknown;
      confirmed?: unknown;
    };
    const ids = normalizeIds(body.ids);
    const queryId = cleanText(request.nextUrl.searchParams.get("id"), 100);
    const supabase = requireProjectAccessDb();

    // 기존 단일 빈 폴더 삭제 계약을 유지합니다.
    if (ids.length === 0 && queryId) {
      const inspection = await inspectFolderSelection(supabase, projectId, [queryId]);
      if (inspection.assetCount > 0 || inspection.descendantFolderCount > 0) {
        return NextResponse.json(
          { error: "폴더 안의 자료와 하위 폴더를 먼저 다른 위치로 이동해주세요.", inspection },
          { status: 409 }
        );
      }
      const { error } = await supabase
        .from("project_archive_folders")
        .delete()
        .eq("id", queryId)
        .eq("project_id", projectId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: "삭제할 폴더를 선택해주세요." }, { status: 400 });
    }
    const inspection = await inspectFolderSelection(
      supabase,
      projectId,
      ids,
      normalizeIds(body.assetIds)
    );
    if (body.confirmed !== true) {
      return NextResponse.json({
        error: [
          `하위 폴더 ${inspection.descendantFolderCount}개`,
          `파일 ${inspection.assetCount}개가 함께 삭제됩니다.`,
          inspection.linkedAssetCount > 0
            ? `진행도에 연결된 파일 ${inspection.linkedAssetCount}개도 연결 해제됩니다.`
            : ""
        ].filter(Boolean).join(" "),
        inspection
      }, { status: 409 });
    }

    const deletion = await deleteFolderTrees(supabase, projectId, inspection);
    return NextResponse.json({ ok: true, inspection, ...deletion });
  } catch (error) {
    return folderError(error, "폴더를 삭제하지 못했습니다.");
  }
}

async function renameFolderTree(
  supabase: DbClient,
  projectId: string,
  id: string | null,
  rootPath: string,
  nextRootPath: string
) {
  const folders = await readFolders(supabase, projectId);
  const root = id ? folders.find((folder) => String(folder.id) === id) : null;
  const previousRootPath = root
    ? normalizeFolderPath(root.name)
    : normalizeFolderPath(rootPath);
  if (
    !previousRootPath
    || !folders.some((folder) => isPathWithin(normalizeFolderPath(folder.name), previousRootPath))
  ) {
    throw new FolderOperationError("이름을 바꿀 폴더를 찾을 수 없습니다.", 404);
  }
  const normalizedNextRootPath = normalizeFolderPath(nextRootPath);
  const changes = new Map<string, string>();
  for (const folder of folders) {
    const path = normalizeFolderPath(folder.name);
    if (!isPathWithin(path, previousRootPath)) continue;
    changes.set(
      String(folder.id),
      replaceFolderPathPrefix(path, previousRootPath, normalizedNextRootPath)
    );
  }

  const nextPathOwner = new Map<string, string>();
  for (const folder of folders) {
    const folderId = String(folder.id);
    const path = changes.get(folderId) ?? normalizeFolderPath(folder.name);
    const key = path.toLocaleLowerCase("ko-KR");
    const owner = nextPathOwner.get(key);
    if (owner && owner !== folderId) {
      throw new FolderOperationError("같은 위치에 동일한 이름의 폴더가 있습니다.", 409);
    }
    nextPathOwner.set(key, folderId);
  }

  const changedRows = folders.filter((folder) => {
    const nextName = changes.get(String(folder.id));
    return nextName && nextName !== normalizeFolderPath(folder.name);
  });
  if (changedRows.length === 0) {
    return { folders: root ? [mapFolder(root)] : [] };
  }
  const payload = changedRows.map((folder) => ({
    id: String(folder.id),
    project_id: projectId,
    name: changes.get(String(folder.id)),
    sort_order: toInteger(folder.sort_order)
  }));
  const rollbackPayload = changedRows.map((folder) => ({
    id: String(folder.id),
    project_id: projectId,
    name: normalizeFolderPath(folder.name),
    sort_order: toInteger(folder.sort_order)
  }));
  const { data, error } = await supabase
    .from("project_archive_folders")
    .upsert(payload, { onConflict: "id" })
    .select(SELECT_COLUMNS);
  if (error) {
    const rollback = await supabase
      .from("project_archive_folders")
      .upsert(rollbackPayload, { onConflict: "id" });
    throw new FolderOperationError(
      "폴더 이름을 변경하지 못했습니다.",
      500,
      `${safeError(error).message}${rollback.error ? ` · rollback: ${safeError(rollback.error).message}` : ""}`
    );
  }
  return { folders: (data ?? []).map(mapFolder) };
}

async function moveArchiveSelection(
  supabase: DbClient,
  projectId: string,
  folderIds: string[],
  assetIds: string[],
  destinationFolderId: string | null
) {
  const folderSnapshot = await readFolders(supabase, projectId);
  const destination = destinationFolderId
    ? folderSnapshot.find((folder) => String(folder.id) === destinationFolderId)
    : null;
  if (destinationFolderId && !destination) {
    throw new FolderOperationError("대상 폴더를 찾을 수 없습니다.", 404);
  }

  const { data: assetSnapshot, error: assetReadError } = assetIds.length > 0
    ? await supabase
      .from("project_reference_assets")
      .select("id,crop_data,updated_at")
      .eq("project_id", projectId)
      .in("id", assetIds)
    : { data: [], error: null };
  if (assetReadError) throw assetReadError;
  if ((assetSnapshot ?? []).length !== assetIds.length) {
    throw new FolderOperationError("이동할 자료 중 일부를 찾을 수 없습니다.", 404);
  }

  const folderById = new Map(folderSnapshot.map((folder) => [String(folder.id), folder]));
  const selectedFolders = folderIds
    .map((id) => folderById.get(id))
    .filter((folder): folder is FolderRow => Boolean(folder));
  if (selectedFolders.length !== folderIds.length) {
    throw new FolderOperationError("이동할 폴더 중 일부를 찾을 수 없습니다.", 404);
  }
  const selectedRoots = dedupeSelectedRoots(selectedFolders);
  const selectedRootPaths = selectedRoots.map((folder) => normalizeFolderPath(folder.name));
  const selectedTreeFolderIds = new Set(
    folderSnapshot
      .filter((folder) => selectedRootPaths.some((rootPath) => (
        isPathWithin(normalizeFolderPath(folder.name), rootPath)
      )))
      .map((folder) => String(folder.id))
  );
  // 부모 폴더와 그 안의 파일이 함께 선택돼도 파일은 폴더 관계를 유지해야 합니다.
  const directAssetSnapshot = (assetSnapshot ?? []).filter((asset) => {
    const folderId = cleanText(objectValue(asset.crop_data).folderId, 100);
    return !selectedTreeFolderIds.has(folderId);
  });

  const folderResult = folderIds.length > 0
    ? await moveFolderTrees(supabase, projectId, folderIds, destinationFolderId)
    : { movedRootIds: [] as string[], folders: [] as ReturnType<typeof mapFolder>[] };
  const movedAssets: Array<{
    id: string;
    cropData: Record<string, unknown>;
    writtenUpdatedAt: string;
  }> = [];
  try {
    for (const asset of directAssetSnapshot) {
      const cropData = objectValue(asset.crop_data);
      let update = supabase
        .from("project_reference_assets")
        .update({ crop_data: { ...cropData, folderId: destinationFolderId } })
        .eq("id", asset.id)
        .eq("project_id", projectId);
      const originalUpdatedAt = cleanText(asset.updated_at, 100);
      if (originalUpdatedAt) update = update.eq("updated_at", originalUpdatedAt);
      const { data, error } = await update.select("id,updated_at").maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new FolderOperationError(
          "다른 사용자가 자료를 수정했습니다. 새로고침 후 다시 이동해주세요.",
          409
        );
      }
      movedAssets.push({
        id: String(asset.id),
        cropData,
        writtenUpdatedAt: cleanText(data.updated_at, 100)
      });
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (movedAssets.length > 0) {
      for (const asset of movedAssets) {
        let rollbackQuery = supabase
          .from("project_reference_assets")
          .update({ crop_data: asset.cropData })
          .eq("id", asset.id)
          .eq("project_id", projectId);
        if (asset.writtenUpdatedAt) {
          rollbackQuery = rollbackQuery.eq("updated_at", asset.writtenUpdatedAt);
        }
        const { data: rollbackData, error: rollbackError } = await rollbackQuery
          .select("id")
          .maybeSingle();
        if (rollbackError) rollbackErrors.push(`asset rollback: ${safeError(rollbackError).message}`);
        else if (!rollbackData) rollbackErrors.push(`asset rollback: ${asset.id} was changed concurrently`);
      }
    }
    if (folderResult.folders.length > 0) {
      for (const movedFolder of folderResult.folders) {
        const originalFolder = folderById.get(movedFolder.id);
        if (!originalFolder) continue;
        let rollbackQuery = supabase
          .from("project_archive_folders")
          .update({
            name: normalizeFolderPath(originalFolder.name),
            sort_order: toInteger(originalFolder.sort_order)
          })
          .eq("id", movedFolder.id)
          .eq("project_id", projectId);
        if (movedFolder.updatedAt) {
          rollbackQuery = rollbackQuery.eq("updated_at", movedFolder.updatedAt);
        }
        const { data: rollbackData, error: rollbackError } = await rollbackQuery
          .select("id")
          .maybeSingle();
        if (rollbackError) rollbackErrors.push(`folder rollback: ${safeError(rollbackError).message}`);
        else if (!rollbackData) rollbackErrors.push(`folder rollback: ${movedFolder.id} was changed concurrently`);
      }
    }
    throw new FolderOperationError(
      "자료와 폴더를 함께 이동하지 못했습니다.",
      error instanceof FolderOperationError ? error.status : 500,
      [safeError(error).message, ...rollbackErrors].join(" · ")
    );
  }
  return {
    ...folderResult,
    movedAssetIds: directAssetSnapshot.map((asset) => String(asset.id)),
    destinationFolderId
  };
}

async function moveFolderTrees(
  supabase: DbClient,
  projectId: string,
  ids: string[],
  destinationFolderId: string | null
) {
  const folders = await readFolders(supabase, projectId);
  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  const selected = ids.map((id) => byId.get(id)).filter((folder): folder is FolderRow => Boolean(folder));
  if (selected.length !== ids.length) {
    throw new FolderOperationError("이동할 폴더 중 일부를 찾을 수 없습니다.", 404);
  }
  const roots = dedupeSelectedRoots(selected);
  const destination = destinationFolderId ? byId.get(destinationFolderId) : null;
  if (destinationFolderId && !destination) {
    throw new FolderOperationError("대상 폴더를 찾을 수 없습니다.", 404);
  }
  const destinationPath = destination ? normalizeFolderPath(destination.name) : "";

  const changes = new Map<string, string>();
  for (const root of roots) {
    const rootPath = normalizeFolderPath(root.name);
    if (destinationPath && isPathWithin(destinationPath, rootPath)) {
      throw new FolderOperationError("폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.", 409);
    }
    const nextRootPath = joinFolderPath(destinationPath, folderBaseName(rootPath));
    for (const folder of folders) {
      const path = normalizeFolderPath(folder.name);
      if (!isPathWithin(path, rootPath)) continue;
      changes.set(String(folder.id), replaceFolderPathPrefix(path, rootPath, nextRootPath));
    }
  }

  const nextPathOwner = new Map<string, string>();
  for (const folder of folders) {
    const id = String(folder.id);
    const path = changes.get(id) ?? normalizeFolderPath(folder.name);
    const key = path.toLocaleLowerCase("ko-KR");
    const owner = nextPathOwner.get(key);
    if (owner && owner !== id) {
      throw new FolderOperationError("대상 폴더에 같은 이름의 폴더가 이미 있습니다.", 409);
    }
    nextPathOwner.set(key, id);
  }

  const changedRows = folders.filter((folder) => {
    const nextName = changes.get(String(folder.id));
    return nextName && nextName !== normalizeFolderPath(folder.name);
  });
  if (changedRows.length === 0) {
    return { movedRootIds: roots.map((folder) => String(folder.id)), folders: [] };
  }
  const payload = changedRows.map((folder) => ({
    id: String(folder.id),
    project_id: projectId,
    name: changes.get(String(folder.id)),
    sort_order: toInteger(folder.sort_order)
  }));
  const rollbackPayload = changedRows.map((folder) => ({
    id: String(folder.id),
    project_id: projectId,
    name: normalizeFolderPath(folder.name),
    sort_order: toInteger(folder.sort_order)
  }));
  const { data, error } = await supabase
    .from("project_archive_folders")
    .upsert(payload, { onConflict: "id" })
    .select(SELECT_COLUMNS);
  if (error) {
    const rollback = await supabase
      .from("project_archive_folders")
      .upsert(rollbackPayload, { onConflict: "id" });
    throw new FolderOperationError(
      "폴더 이동을 완료하지 못했습니다.",
      500,
      `${safeError(error).message}${rollback.error ? ` · rollback: ${safeError(rollback.error).message}` : ""}`
    );
  }
  return {
    movedRootIds: roots.map((folder) => String(folder.id)),
    folders: (data ?? []).map(mapFolder)
  };
}

async function inspectFolderSelection(
  supabase: DbClient,
  projectId: string,
  ids: string[],
  additionalAssetIds: string[] = []
): Promise<ProjectArchiveFolderInspection> {
  const folders = await readFolders(supabase, projectId);
  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  const selected = ids.map((id) => byId.get(id)).filter((folder): folder is FolderRow => Boolean(folder));
  if (selected.length !== ids.length) {
    throw new FolderOperationError("선택한 폴더 중 일부를 찾을 수 없습니다.", 404);
  }
  const roots = dedupeSelectedRoots(selected);
  const rootPaths = roots.map((folder) => normalizeFolderPath(folder.name));
  const affectedFolders = folders.filter((folder) => {
    const path = normalizeFolderPath(folder.name);
    return rootPaths.some((rootPath) => isPathWithin(path, rootPath));
  });
  const folderIds = affectedFolders.map((folder) => String(folder.id));
  const { data: assetRows, error: assetError } = await supabase
    .from("project_reference_assets")
    .select("id,crop_data")
    .eq("project_id", projectId);
  if (assetError) throw assetError;
  const folderIdSet = new Set(folderIds);
  const projectAssetIds = new Set((assetRows ?? []).map((asset) => String(asset.id)));
  const invalidAdditionalAsset = additionalAssetIds.find((id) => !projectAssetIds.has(id));
  if (invalidAdditionalAsset) {
    throw new FolderOperationError("선택한 파일 중 일부를 찾을 수 없습니다.", 404);
  }
  const assetIds = [...new Set([
    ...(assetRows ?? []).flatMap((asset) => {
    const crop = objectValue(asset.crop_data);
    return folderIdSet.has(cleanText(crop.folderId, 100)) ? [String(asset.id)] : [];
    }),
    ...additionalAssetIds
  ])];
  const linkedAssetIds = await readLinkedReferenceAssetIds(supabase, projectId);
  return {
    selectedRootIds: roots.map((folder) => String(folder.id)),
    folderIds,
    assetIds,
    selectedFolderCount: roots.length,
    descendantFolderCount: Math.max(0, affectedFolders.length - roots.length),
    assetCount: assetIds.length,
    linkedAssetCount: assetIds.filter((id) => linkedAssetIds.has(id)).length
  };
}

async function deleteFolderTrees(
  supabase: DbClient,
  projectId: string,
  inspection: ProjectArchiveFolderInspection
) {
  const { data: assetRows, error: assetReadError } = inspection.assetIds.length > 0
    ? await supabase
      .from("project_reference_assets")
      .select("*")
      .eq("project_id", projectId)
      .in("id", inspection.assetIds)
    : { data: [], error: null };
  if (assetReadError) throw assetReadError;
  if ((assetRows ?? []).length !== inspection.assetIds.length) {
    throw new FolderOperationError(
      "삭제 대상 자료가 변경되었습니다. 삭제 내용을 다시 확인해주세요.",
      409
    );
  }
  const { data: folderRows, error: folderReadError } = inspection.folderIds.length > 0
    ? await supabase
      .from("project_archive_folders")
      .select("id")
      .eq("project_id", projectId)
      .in("id", inspection.folderIds)
    : { data: [], error: null };
  if (folderReadError) throw folderReadError;
  if ((folderRows ?? []).length !== inspection.folderIds.length) {
    throw new FolderOperationError(
      "삭제 대상 폴더가 변경되었습니다. 삭제 내용을 다시 확인해주세요.",
      409
    );
  }
  const { data: linkRows, error: linkReadError } = await supabase
    .from("shot_diagrams")
    .select("*")
    .eq("project_id", projectId)
    .eq("diagram_type", "overhead")
    .like("shot_ref", "media-link:%");
  if (linkReadError && linkReadError.code !== "42P01") throw linkReadError;
  const assetIdSet = new Set(inspection.assetIds);
  const affectedLinks = (linkRows ?? []).filter((row) => {
    const data = objectValue(row.data);
    return data.kind === "media_link"
      && data.source === "reference"
      && assetIdSet.has(cleanText(data.assetId, 100));
  });
  const linkIds = affectedLinks.map((row) => String(row.id));
  const rollbackErrors: string[] = [];

  try {
    if (linkIds.length > 0) {
      const { error } = await supabase.from("shot_diagrams").delete().in("id", linkIds);
      if (error) throw error;
    }
    if (inspection.assetIds.length > 0) {
      const { error } = await supabase
        .from("project_reference_assets")
        .delete()
        .eq("project_id", projectId)
        .in("id", inspection.assetIds);
      if (error) throw error;
    }
    const { error } = await supabase
      .from("project_archive_folders")
      .delete()
      .eq("project_id", projectId)
      .in("id", inspection.folderIds);
    if (error) throw error;
  } catch (error) {
    if ((assetRows ?? []).length > 0) {
      const rollback = await supabase
        .from("project_reference_assets")
        .upsert(assetRows ?? [], { onConflict: "id" });
      if (rollback.error) rollbackErrors.push(`asset rollback: ${safeError(rollback.error).message}`);
    }
    if (affectedLinks.length > 0) {
      const rollback = await supabase.from("shot_diagrams").upsert(affectedLinks, { onConflict: "id" });
      if (rollback.error) rollbackErrors.push(`link rollback: ${safeError(rollback.error).message}`);
    }
    throw new FolderOperationError(
      "폴더 삭제를 완료하지 못했습니다.",
      500,
      [safeError(error).message, ...rollbackErrors].join(" · ")
    );
  }

  const storagePaths = (assetRows ?? []).flatMap((asset) => {
    const crop = objectValue(asset.crop_data);
    return [
      cleanText(asset.storage_path, 1_000),
      cleanText(crop.thumbnailPath, 1_000)
    ].filter(Boolean);
  });
  let storageCleanupWarning = "";
  for (const paths of chunk(storagePaths, 100)) {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) {
      storageCleanupWarning = "DB 삭제는 완료됐지만 일부 Storage 파일을 정리하지 못했습니다.";
      console.error("[archive-folders:storage-delete]", safeError(error));
    }
  }
  return {
    deletedFolderCount: inspection.folderIds.length,
    deletedAssetCount: inspection.assetIds.length,
    storageCleanupWarning
  };
}

async function readFolders(supabase: DbClient, projectId: string): Promise<FolderRow[]> {
  const { data, error } = await supabase
    .from("project_archive_folders")
    .select(SELECT_COLUMNS)
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []) as FolderRow[];
}

async function readLinkedReferenceAssetIds(supabase: DbClient, projectId: string) {
  const { data, error } = await supabase
    .from("shot_diagrams")
    .select("data")
    .eq("project_id", projectId)
    .eq("diagram_type", "overhead")
    .like("shot_ref", "media-link:%");
  if (error) {
    if (error.code === "42P01") return new Set<string>();
    throw error;
  }
  return new Set((data ?? []).flatMap((row) => {
    const source = objectValue(row.data);
    return source.kind === "media_link" && source.source === "reference"
      ? [cleanText(source.assetId, 100)].filter(Boolean)
      : [];
  }));
}

function dedupeSelectedRoots(folders: FolderRow[]) {
  return [...folders]
    .sort((left, right) => normalizeFolderPath(left.name).length - normalizeFolderPath(right.name).length)
    .filter((folder, index, values) => {
      const path = normalizeFolderPath(folder.name);
      return !values.slice(0, index).some((candidate) => (
        isPathWithin(path, normalizeFolderPath(candidate.name))
      ));
    });
}

function normalizeFolderPath(value: unknown) {
  return cleanText(value, 1_000)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 500);
}

function joinFolderPath(parent: string, child: string) {
  return normalizeFolderPath(parent ? `${parent}/${child}` : child);
}

function folderBaseName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function isPathWithin(path: string, rootPath: string) {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

function replaceFolderPathPrefix(path: string, oldRoot: string, nextRoot: string) {
  return path === oldRoot ? nextRoot : `${nextRoot}${path.slice(oldRoot.length)}`;
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : "";
}

async function getMaterialRole(request: NextRequest, projectId: string) {
  return getProjectRequestRole(request, projectId);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanText(entry, 100)).filter(Boolean))].slice(0, 500);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function chunk<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function mapFolder(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    name: String(row.name ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

class FolderOperationError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly detail = ""
  ) {
    super(message);
    this.name = "FolderOperationError";
  }
}

function folderError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_ARCHIVE_FOLDER_UNAVAILABLE" }, { status: 503 });
  }
  if (error instanceof FolderOperationError) {
    return NextResponse.json({
      error: error.message,
      ...(error.detail ? { detail: error.detail } : {})
    }, { status: error.status });
  }
  const source = safeError(error);
  console.error("[archive-folders]", source);
  const missingTable = source.code === "42P01"
    || /project_archive_folders/i.test(source.message) && /does not exist|schema cache/i.test(source.message);
  const duplicate = source.code === "23505";
  return NextResponse.json({
    error: missingTable
      ? "아카이브 폴더 migration을 먼저 적용해주세요."
      : duplicate
        ? "같은 이름의 폴더가 이미 있습니다."
        : message,
    detail: source.message
  }, { status: missingTable ? 503 : duplicate ? 409 : 500 });
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: String(error) };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error"
  };
}
