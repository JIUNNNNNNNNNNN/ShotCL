import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { validateSceneCutCountInput } from "@/lib/sceneCutCount";
import {
  parseSceneListCellMerges,
  SCENE_LIST_REORDER_MERGE_ERROR,
  validateSceneListCellMerges,
  validateSceneListReorderWithMerges
} from "@/lib/sceneListMergeModel";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import type { ProjectSceneMergeColumn } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };

type SceneItemInput = {
  id?: unknown;
  sceneNo?: unknown;
  mainLocation?: unknown;
  subLocation?: unknown;
  dayLabel?: unknown;
  dayNight?: unknown;
  interiorExterior?: unknown;
  sceneContent?: unknown;
  characters?: unknown;
  characterNotes?: unknown;
  actorCells?: unknown;
  props?: unknown;
  cutCount?: unknown;
  sortOrder?: unknown;
};

const SCENE_COLUMNS = [
  "id",
  "project_id",
  "scene_no",
  "main_location",
  "sub_location",
  "day_label",
  "day_night",
  "interior_exterior",
  "scene_content",
  "characters",
  "character_notes",
  "actor_cells",
  "props",
  "cut_count",
  "sort_order",
  "created_at",
  "updated_at"
].join(",");

const restoreCellColumnName: Record<ProjectSceneMergeColumn, string> = {
  location: "main_location",
  subLocation: "sub_location",
  day: "day_label",
  time: "day_night",
  intExt: "interior_exterior"
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const scope = await requireReadScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;

    const [
      { data: rows, error },
      { data: note, error: noteError },
      { data: basicInfo, error: basicInfoError }
    ] = await Promise.all([
      supabase
        .from("project_scene_items")
        .select(SCENE_COLUMNS)
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("project_scene_notes")
        .select("scenario_reference,cell_merges,updated_at")
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase
        .from("project_basic_info")
        .select("actors")
        .eq("project_id", projectId)
        .maybeSingle()
    ]);
    if (error) throw error;
    if (noteError) throw noteError;
    if (basicInfoError) {
      console.error("[project-scene-list] actor roles", {
        code: basicInfoError.code,
        message: basicInfoError.message
      });
    }

    return NextResponse.json({
      items: rows ?? [],
      scenarioReference: note?.scenario_reference ?? "",
      cellMerges: note?.cell_merges ?? null,
      cellMergesMaterialized: Array.isArray(note?.cell_merges),
      cellMergesUpdatedAt: note?.updated_at ?? null,
      actorRoles: extractActorRoles(basicInfo?.actors)
    });
  } catch (error) {
    return sceneListError(error, "씬리스트를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const scope = await requireWriteScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as {
      items?: SceneItemInput[];
      scenarioReference?: unknown;
      cellMerges?: unknown;
      cellMergesMaterialized?: unknown;
      expectedUpdatedAt?: unknown;
    };

    if (!Array.isArray(body.items) || body.items.length > 1000) {
      return NextResponse.json({ error: "씬리스트 데이터가 올바르지 않습니다." }, { status: 400 });
    }
    if (body.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return NextResponse.json({ error: "씬 행 입력값이 올바르지 않습니다." }, { status: 400 });
    }

    const invalidCutIndex = body.items.findIndex(
      (item) => Boolean(validateSceneCutCountInput(item.cutCount).error)
    );
    if (invalidCutIndex >= 0) {
      return NextResponse.json(
        {
          error: `${invalidCutIndex + 1}행 ${validateSceneCutCountInput(
            body.items[invalidCutIndex].cutCount
          ).error}`
        },
        { status: 400 }
      );
    }

    const rows = body.items.map((item, index) => normalizeItem(item, projectId, index));
    if (rows.some((item) => !item)) {
      return NextResponse.json({ error: "씬 행 ID 또는 입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const normalizedRows = rows as NonNullable<(typeof rows)[number]>[];
    const ids = normalizedRows.map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "중복된 씬 행이 있습니다." }, { status: 400 });
    }

    if (ids.length > 0) {
      const { data: idRows, error: idError } = await supabase
        .from("project_scene_items")
        .select("id,project_id")
        .in("id", ids);
      if (idError) throw idError;
      if ((idRows ?? []).some((row) => row.project_id !== projectId)) {
        return NextResponse.json(
          { error: "다른 프로젝트의 씬 행은 수정할 수 없습니다." },
          { status: 409 }
        );
      }
    }

    const [existingRowsResult, currentNoteResult] = await Promise.all([
      supabase
        .from("project_scene_items")
        .select(SCENE_COLUMNS)
        .eq("project_id", projectId),
      supabase
        .from("project_scene_notes")
        .select("cell_merges,updated_at")
        .eq("project_id", projectId)
        .maybeSingle()
    ]);
    if (existingRowsResult.error) throw existingRowsResult.error;
    if (currentNoteResult.error) throw currentNoteResult.error;

    const typedExistingRows = (existingRowsResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    const existingRowsById = new Map(
      typedExistingRows.map((row) => [
        String(row.id),
        row
      ])
    );
    const changedRows = normalizedRows.filter((row) => (
      hasSceneRowChanged(existingRowsById.get(row.id), row)
    ));
    const submittedIds = new Set(ids);
    const deletedIds = typedExistingRows
      .map((row) => String(row.id))
      .filter((id) => !submittedIds.has(id));
    if (body.cellMergesMaterialized !== true && deletedIds.length > 0) {
      const storedMerges = parseSceneListCellMerges(currentNoteResult.data?.cell_merges);
      if (storedMerges.errors.length > 0 || storedMerges.merges.some((merge) => (
        merge.sceneIds.some((sceneId) => deletedIds.includes(sceneId))
      ))) {
        return NextResponse.json(
          { error: "다른 사용자가 씬리스트 병합 상태를 변경했습니다. 페이지를 다시 불러온 뒤 시도해주세요." },
          { status: 409 }
        );
      }
    }

    const scenarioReference = normalizeText(body.scenarioReference, 50000);
    let savedNote: { scenario_reference: unknown; cell_merges: unknown; updated_at: unknown } | null = null;
    if (body.cellMergesMaterialized === true) {
      if (!Array.isArray(body.cellMerges)) {
        return NextResponse.json({ error: "셀 병합 정보는 배열이어야 합니다." }, { status: 400 });
      }
      const parsedMerges = parseSceneListCellMerges(body.cellMerges);
      if (parsedMerges.errors.length > 0) {
        return NextResponse.json({ error: parsedMerges.errors[0].message }, { status: 400 });
      }
      const mergeValidation = validateSceneListCellMerges(ids, parsedMerges.merges);
      if (!mergeValidation.ok) {
        return NextResponse.json(
          { error: mergeValidation.errors[0]?.message || "셀 병합 범위가 올바르지 않습니다." },
          { status: 400 }
        );
      }
      const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
      if (!expectedUpdatedAt.ok) {
        return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
      }
      const currentUpdatedAt = currentNoteResult.data?.updated_at
        ? String(currentNoteResult.data.updated_at)
        : null;
      if (expectedUpdatedAt.value !== currentUpdatedAt) {
        return NextResponse.json(
          { error: "다른 사용자가 씬리스트 병합 상태를 변경했습니다. 페이지를 다시 불러온 뒤 시도해주세요." },
          { status: 409 }
        );
      }
      if (currentUpdatedAt) {
        const { data, error } = await supabase
          .from("project_scene_notes")
          .update({
            scenario_reference: scenarioReference,
            cell_merges: mergeValidation.validMerges
          })
          .eq("project_id", projectId)
          .eq("updated_at", currentUpdatedAt)
          .select("scenario_reference,cell_merges,updated_at")
          .maybeSingle();
        if (error) throw error;
        savedNote = data;
      } else {
        const { data, error } = await supabase
          .from("project_scene_notes")
          .insert({
            project_id: projectId,
            scenario_reference: scenarioReference,
            cell_merges: mergeValidation.validMerges
          })
          .select("scenario_reference,cell_merges,updated_at")
          .single();
        if (error?.code === "23505") {
          return NextResponse.json(
            { error: "다른 사용자가 씬리스트 병합 상태를 변경했습니다. 페이지를 다시 불러온 뒤 시도해주세요." },
            { status: 409 }
          );
        }
        if (error) throw error;
        savedNote = data;
      }
      if (!savedNote) {
        return NextResponse.json(
          { error: "다른 사용자가 씬리스트 병합 상태를 변경했습니다. 페이지를 다시 불러온 뒤 시도해주세요." },
          { status: 409 }
        );
      }
    } else {
      const { data, error } = await supabase
        .from("project_scene_notes")
        .upsert(
          { project_id: projectId, scenario_reference: scenarioReference },
          { onConflict: "project_id" }
        )
        .select("scenario_reference,cell_merges,updated_at")
        .single();
      if (error) throw error;
      savedNote = data;
    }

    if (changedRows.length > 0) {
      const { error } = await supabase
        .from("project_scene_items")
        .upsert(changedRows, { onConflict: "id" });
      if (error) throw error;
    }

    if (deletedIds.length > 0) {
      const { error } = await supabase
        .from("project_scene_items")
        .delete()
        .eq("project_id", projectId)
        .in("id", deletedIds);
      if (error) throw error;
    }

    const { data: savedRows, error: savedError } = await supabase
      .from("project_scene_items")
      .select(SCENE_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (savedError) throw savedError;

    return NextResponse.json({
      items: savedRows ?? [],
      scenarioReference,
      cellMerges: savedNote?.cell_merges ?? null,
      cellMergesMaterialized: Array.isArray(savedNote?.cell_merges),
      cellMergesUpdatedAt: savedNote?.updated_at ?? null
    });
  } catch (error) {
    return sceneListError(error, "씬리스트를 저장하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const scope = await requireWriteScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "delete-item") {
      const itemId = String(body.itemId ?? "").trim();
      if (!isValidDatabaseProjectId(itemId)) {
        return NextResponse.json({ error: "삭제할 씬 ID가 올바르지 않습니다." }, { status: 400 });
      }
      const [{ data: item, error: itemError }, { data: note, error: noteError }] = await Promise.all([
        supabase.from("project_scene_items").select(SCENE_COLUMNS).eq("project_id", projectId).eq("id", itemId).maybeSingle(),
        supabase.from("project_scene_notes").select("cell_merges,updated_at").eq("project_id", projectId).maybeSingle()
      ]);
      if (itemError) throw itemError;
      if (noteError) throw noteError;
      if (!item) return NextResponse.json({ error: "씬을 찾을 수 없습니다." }, { status: 404 });
      const itemRow = item as unknown as Record<string, unknown>;
      const noteRow = note as unknown as Record<string, unknown> | null;
      const parsed = parseSceneListCellMerges(noteRow?.cell_merges);
      if (parsed.errors.length > 0) {
        return NextResponse.json(
          { error: "저장된 셀 병합 범위가 올바르지 않습니다." },
          { status: 409 }
        );
      }
      const removedMerges = parsed.merges.filter((merge) => merge.sceneIds.includes(itemId));
      const remainingMerges = parsed.merges.filter((merge) => !merge.sceneIds.includes(itemId));
      const receipt = createProjectDeleteReceipt({
        projectId,
        kind: "scene-list-item",
        payload: { item: itemRow, removedMerges }
      });
      const { data: deletedItem, error: deleteError } = await supabase
        .from("project_scene_items")
        .delete()
        .eq("project_id", projectId)
        .eq("id", itemId)
        .eq("updated_at", String(itemRow.updated_at ?? ""))
        .select(SCENE_COLUMNS)
        .maybeSingle();
      if (deleteError) throw deleteError;
      if (!deletedItem) {
        return NextResponse.json(
          { error: "씬이 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요." },
          { status: 409 }
        );
      }
      let cellMergesUpdatedAt = noteRow?.updated_at ? String(noteRow.updated_at) : null;
      if (noteRow && removedMerges.length > 0) {
        const { data: savedNote, error: mergeError } = await supabase
          .from("project_scene_notes")
          .update({ cell_merges: remainingMerges })
          .eq("project_id", projectId)
          .eq("updated_at", String(noteRow.updated_at ?? ""))
          .select("updated_at")
          .maybeSingle();
        if (mergeError || !savedNote) {
          const { error: rollbackError } = await supabase
            .from("project_scene_items")
            .upsert(deletedItem as unknown as Record<string, unknown>, { onConflict: "id", ignoreDuplicates: true });
          if (rollbackError) {
            return NextResponse.json(
              { error: "씬 삭제를 취소하지 못했습니다. 목록을 다시 확인해주세요." },
              { status: 500 }
            );
          }
          if (mergeError) throw mergeError;
          return NextResponse.json(
            { error: "셀 병합 상태가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요." },
            { status: 409 }
          );
        }
        cellMergesUpdatedAt = String(savedNote.updated_at ?? "") || null;
      }
      return NextResponse.json({ ok: true, receipt, deletedId: itemId, cellMergesUpdatedAt });
    }

    if (body.action === "restore-item") {
      const snapshot = parseSceneItemDeleteReceipt(projectId, body.receipt);
      const { data: inserted, error: restoreError } = await supabase
        .from("project_scene_items")
        .upsert(snapshot.item, { onConflict: "id", ignoreDuplicates: true })
        .select(SCENE_COLUMNS)
        .maybeSingle();
      if (restoreError) throw restoreError;
      const { data: restoredItem, error: restoredItemError } = inserted
        ? { data: inserted, error: null }
        : await supabase
          .from("project_scene_items")
          .select(SCENE_COLUMNS)
          .eq("project_id", projectId)
          .eq("id", String(snapshot.item.id))
          .maybeSingle();
      if (restoredItemError) throw restoredItemError;
      if (!restoredItem) {
        return NextResponse.json({ error: "씬을 복원하지 못했습니다." }, { status: 409 });
      }
      const { data: sceneRows, error: sceneRowsError } = await supabase
        .from("project_scene_items")
        .select("id,sort_order,created_at")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at");
      if (sceneRowsError) throw sceneRowsError;
      const availableSceneIds = new Set((sceneRows ?? []).map((row) => String(row.id)));
      const { data: note, error: noteError } = await supabase
        .from("project_scene_notes")
        .select("cell_merges,updated_at")
        .eq("project_id", projectId)
        .maybeSingle();
      if (noteError) throw noteError;
      const existingMerges = parseSceneListCellMerges(note?.cell_merges).merges;
      const requestedMerges = snapshot.removedMerges.filter((merge) => (
        merge.sceneIds.every((sceneId) => availableSceneIds.has(sceneId))
      ));
      const mergeById = new Map([...existingMerges, ...requestedMerges].map((merge) => [merge.id, merge]));
      let cellMergesUpdatedAt = note?.updated_at ? String(note.updated_at) : null;
      if (requestedMerges.length > 0) {
        const validation = validateSceneListCellMerges(
          (sceneRows ?? []).map((row) => String(row.id)),
          [...mergeById.values()]
        );
        if (!validation.ok) {
          if (inserted) await rollbackRestoredSceneItem(supabase, projectId, inserted as unknown as Record<string, unknown>);
          return NextResponse.json(
            { error: "현재 셀 병합 상태와 삭제된 씬의 병합 상태를 함께 복원할 수 없습니다." },
            { status: 409 }
          );
        }
        if (note) {
          const { data: savedNote, error: mergeError } = await supabase
            .from("project_scene_notes")
            .update({ cell_merges: validation.validMerges })
            .eq("project_id", projectId)
            .eq("updated_at", String(note.updated_at ?? ""))
            .select("updated_at")
            .maybeSingle();
          if (mergeError || !savedNote) {
            if (inserted) await rollbackRestoredSceneItem(supabase, projectId, inserted as unknown as Record<string, unknown>);
            if (mergeError) throw mergeError;
            return NextResponse.json(
              { error: "셀 병합 상태가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요." },
              { status: 409 }
            );
          }
          cellMergesUpdatedAt = String(savedNote.updated_at ?? "") || null;
        } else {
          const { data: insertedNote, error: mergeError } = await supabase
            .from("project_scene_notes")
            .insert({ project_id: projectId, cell_merges: validation.validMerges })
            .select("updated_at")
            .single();
          if (mergeError) {
            if (inserted) await rollbackRestoredSceneItem(supabase, projectId, inserted as unknown as Record<string, unknown>);
            if (mergeError.code === "23505") {
              return NextResponse.json(
                { error: "셀 병합 상태가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요." },
                { status: 409 }
              );
            }
            throw mergeError;
          }
          cellMergesUpdatedAt = String(insertedNote.updated_at ?? "") || null;
        }
      }
      return NextResponse.json({
        ok: true,
        restoredId: String(snapshot.item.id),
        item: restoredItem,
        cellMergesUpdatedAt
      });
    }

    if (body.action === "finalize-deleted-item") {
      parseSceneItemDeleteReceipt(projectId, body.receipt);
      return NextResponse.json({ ok: true, finalized: true });
    }

    if (body.action === "update-reference") {
      const scenarioReference = normalizeText(body.scenarioReference, 50_000);
      const expectedUpdatedAt = normalizeNullableExpectedUpdatedAt(body.expectedUpdatedAt);
      if (!expectedUpdatedAt.ok) {
        return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
      }
      if (!expectedUpdatedAt.value) {
        const { data: inserted, error: insertError } = await supabase
          .from("project_scene_notes")
          .insert({ project_id: projectId, scenario_reference: scenarioReference })
          .select("scenario_reference,updated_at")
          .single();
        if (insertError?.code === "23505") {
          const { data: latest, error: latestError } = await supabase
            .from("project_scene_notes")
            .select("scenario_reference,updated_at")
            .eq("project_id", projectId)
            .maybeSingle();
          if (latestError) throw latestError;
          return sceneReferenceConflict(latest);
        }
        if (insertError) throw insertError;
        return NextResponse.json({
          ok: true,
          scenarioReference: inserted.scenario_reference ?? "",
          cellMergesUpdatedAt: inserted.updated_at ?? null
        });
      }
      const { data: saved, error: saveError } = await supabase
        .from("project_scene_notes")
        .update({ scenario_reference: scenarioReference })
        .eq("project_id", projectId)
        .eq("updated_at", expectedUpdatedAt.value)
        .select("scenario_reference,updated_at")
        .maybeSingle();
      if (saveError) throw saveError;
      if (!saved) {
        const { data: latest, error: latestError } = await supabase
          .from("project_scene_notes")
          .select("scenario_reference,updated_at")
          .eq("project_id", projectId)
          .maybeSingle();
        if (latestError) throw latestError;
        return sceneReferenceConflict(latest);
      }
      return NextResponse.json({
        ok: true,
        scenarioReference: saved.scenario_reference ?? "",
        cellMergesUpdatedAt: saved.updated_at ?? null
      });
    }

    if (body.action === "update-item") {
      if (!body.item || typeof body.item !== "object" || Array.isArray(body.item)) {
        return NextResponse.json({ error: "자동 저장할 씬 입력값이 올바르지 않습니다." }, { status: 400 });
      }
      const input = body.item as SceneItemInput;
      const id = normalizeText(input.id, 36);
      if (!isUuid(id)) {
        return NextResponse.json({ error: "씬 행 ID가 올바르지 않습니다." }, { status: 400 });
      }
      const expectedUpdatedAt = normalizeRowExpectedUpdatedAt(body.expectedUpdatedAt);
      if (!expectedUpdatedAt.ok) {
        return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
      }
      const normalizedPatch = normalizeSceneItemPatch(input);
      if (!normalizedPatch.ok) {
        return NextResponse.json({ error: normalizedPatch.error }, { status: 400 });
      }
      const { data: saved, error: saveError } = await supabase
        .from("project_scene_items")
        .update(normalizedPatch.fields)
        .eq("project_id", projectId)
        .eq("id", id)
        .eq("updated_at", expectedUpdatedAt.value)
        .select(SCENE_COLUMNS)
        .maybeSingle();
      if (saveError) throw saveError;
      if (!saved) {
        const { data: latest, error: latestError } = await supabase
          .from("project_scene_items")
          .select(SCENE_COLUMNS)
          .eq("project_id", projectId)
          .eq("id", id)
          .maybeSingle();
        if (latestError) throw latestError;
        if (!latest) {
          return NextResponse.json({ error: "자동 저장할 씬을 찾을 수 없습니다." }, { status: 404 });
        }
        return NextResponse.json(
          { error: "씬 행이 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.", item: latest },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true, item: saved });
    }

    if (body.action === "cell-merges") {
      const [rowsResult, noteResult] = await Promise.all([
        supabase
          .from("project_scene_items")
          .select("id")
          .eq("project_id", projectId)
          .order("sort_order")
          .order("created_at"),
        supabase
          .from("project_scene_notes")
          .select("cell_merges,updated_at")
          .eq("project_id", projectId)
          .maybeSingle()
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (noteResult.error) throw noteResult.error;

      const orderedIds = (rowsResult.data ?? []).map((row) => String(row.id));
      if (!Array.isArray(body.cellMerges)) {
        return NextResponse.json(
          { error: "셀 병합 정보는 배열이어야 합니다." },
          { status: 400 }
        );
      }
      const parsedMerges = parseSceneListCellMerges(body.cellMerges);
      if (parsedMerges.errors.length > 0) {
        return NextResponse.json(
          { error: parsedMerges.errors[0].message },
          { status: 400 }
        );
      }
      const validation = validateSceneListCellMerges(orderedIds, parsedMerges.merges);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.errors[0]?.message || "셀 병합 범위가 올바르지 않습니다." },
          { status: 400 }
        );
      }

      const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
      if (!expectedUpdatedAt.ok) {
        return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
      }
      const currentUpdatedAt = noteResult.data?.updated_at
        ? String(noteResult.data.updated_at)
        : null;
      if (expectedUpdatedAt.value !== currentUpdatedAt) {
        return sceneListMergeConflict(
          noteResult.data?.cell_merges,
          currentUpdatedAt
        );
      }

      let note: { cell_merges: unknown; updated_at: unknown } | null = null;
      if (currentUpdatedAt) {
        const { data, error } = await supabase
          .from("project_scene_notes")
          .update({ cell_merges: validation.validMerges })
          .eq("project_id", projectId)
          .eq("updated_at", currentUpdatedAt)
          .select("cell_merges,updated_at")
          .maybeSingle();
        if (error) throw error;
        note = data;
      } else {
        const { data, error } = await supabase
          .from("project_scene_notes")
          .insert({ project_id: projectId, cell_merges: validation.validMerges })
          .select("cell_merges,updated_at")
          .single();
        if (error?.code === "23505") {
          const { data: latest, error: latestError } = await supabase
            .from("project_scene_notes")
            .select("cell_merges,updated_at")
            .eq("project_id", projectId)
            .maybeSingle();
          if (latestError) throw latestError;
          return sceneListMergeConflict(latest?.cell_merges, latest?.updated_at);
        }
        if (error) throw error;
        note = data;
      }
      if (!note) {
        const { data: latest, error: latestError } = await supabase
          .from("project_scene_notes")
          .select("cell_merges,updated_at")
          .eq("project_id", projectId)
          .maybeSingle();
        if (latestError) throw latestError;
        return sceneListMergeConflict(latest?.cell_merges, latest?.updated_at);
      }

      return NextResponse.json({
        ok: true,
        cellMerges: note?.cell_merges ?? [],
        cellMergesMaterialized: true,
        cellMergesUpdatedAt: note?.updated_at ?? null
      });
    }

    if (body.action === "clear-cells") {
      const cells = normalizeClearCells(body.cells);
      if (!Array.isArray(body.cells) || cells.length !== body.cells.length || cells.length > 5000) {
        return NextResponse.json(
          { error: "비울 셀 범위가 올바르지 않습니다." },
          { status: 400 }
        );
      }
      if (cells.length === 0) {
        return NextResponse.json({ ok: true, clearedCells: [] });
      }

      const { data: clearedCount, error: clearError } = await supabase.rpc(
        "clear_project_scene_list_cells",
        { p_project_id: projectId, p_cells: cells }
      );
      if (clearError) throw clearError;
      const expectedCount = new Set(cells.map((cell) => cell.sceneId)).size;
      if (Number(clearedCount) !== expectedCount) {
        return NextResponse.json(
          { error: "선택한 씬을 찾을 수 없습니다." },
          { status: 409 }
        );
      }

      const { data: clearedRows, error: clearedRowsError } = await supabase
        .from("project_scene_items")
        .select(SCENE_COLUMNS)
        .eq("project_id", projectId)
        .in("id", [...new Set(cells.map((cell) => cell.sceneId))]);
      if (clearedRowsError) throw clearedRowsError;
      return NextResponse.json({ ok: true, clearedCells: cells, items: clearedRows ?? [] });
    }

    if (body.action === "restore-cells") {
      const cells = normalizeRestoreCells(body.cells);
      if (!Array.isArray(body.cells) || cells.length !== body.cells.length || cells.length > 5000) {
        return NextResponse.json({ error: "복원할 셀 범위가 올바르지 않습니다." }, { status: 400 });
      }
      const bySceneId = new Map<string, Record<string, string>>();
      for (const cell of cells) {
        const fields = bySceneId.get(cell.sceneId) ?? {};
        fields[restoreCellColumnName[cell.column]] = cell.value;
        bySceneId.set(cell.sceneId, fields);
      }
      const results = await settleWithConcurrency([...bySceneId], 8, async ([sceneId, fields]) => {
        const { data, error } = await supabase
          .from("project_scene_items")
          .update(fields)
          .eq("project_id", projectId)
          .eq("id", sceneId)
          .select(SCENE_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("복원할 씬을 찾을 수 없습니다.");
        return data;
      });
      return NextResponse.json({ ok: true, restoredCells: cells, items: results });
    }

    if (body.action === "reorder") {
      const orderedIds = normalizeOrderedSceneIds(body.orderedIds);
      if (!orderedIds || orderedIds.length > 1000) {
        return NextResponse.json(
          { error: "씬 순서 데이터가 올바르지 않습니다." },
          { status: 400 }
        );
      }

      const [rowsResult, noteResult] = await Promise.all([
        supabase
          .from("project_scene_items")
          .select("id")
          .eq("project_id", projectId)
          .order("sort_order")
          .order("created_at"),
        supabase
          .from("project_scene_notes")
          .select("cell_merges")
          .eq("project_id", projectId)
          .maybeSingle()
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (noteResult.error) throw noteResult.error;

      const currentIds = (rowsResult.data ?? []).map((row) => String(row.id));
      if (!sameIdSet(currentIds, orderedIds)) {
        return NextResponse.json(
          { error: "현재 씬 목록과 순서 데이터가 일치하지 않습니다." },
          { status: 409 }
        );
      }

      const parsedStoredMerges = parseSceneListCellMerges(noteResult.data?.cell_merges);
      if (parsedStoredMerges.errors.length > 0) {
        return NextResponse.json(
          { error: "저장된 셀 병합 범위가 올바르지 않습니다." },
          { status: 409 }
        );
      }
      const cellMerges = parsedStoredMerges.merges;
      const mergeValidation = validateSceneListCellMerges(currentIds, cellMerges);
      if (!mergeValidation.ok) {
        return NextResponse.json(
          { error: mergeValidation.errors[0]?.message || "저장된 셀 병합 범위가 올바르지 않습니다." },
          { status: 409 }
        );
      }
      const reorderValidation = validateSceneListReorderWithMerges(
        orderedIds,
        mergeValidation.validMerges,
        currentIds
      );
      if (!reorderValidation.ok) {
        return NextResponse.json(
          { error: SCENE_LIST_REORDER_MERGE_ERROR },
          { status: 409 }
        );
      }

      const reorderedRows = orderedIds.map((id, index) => ({
        id,
        project_id: projectId,
        sort_order: index + 1
      }));
      if (reorderedRows.length > 0) {
        const { error } = await supabase
          .from("project_scene_items")
          .upsert(reorderedRows, { onConflict: "id" });
        if (error) throw error;
      }

      const { data: reorderedRowsResult, error: reorderedRowsError } = await supabase
        .from("project_scene_items")
        .select(SCENE_COLUMNS)
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at");
      if (reorderedRowsError) throw reorderedRowsError;
      return NextResponse.json({ ok: true, orderedIds, items: reorderedRowsResult ?? [] });
    }

    return NextResponse.json({ error: "지원하지 않는 씬리스트 작업입니다." }, { status: 400 });
  } catch (error) {
    return sceneListError(error, "씬리스트 변경사항을 저장하지 못했습니다.");
  }
}

async function requireReadScope(request: NextRequest, context: RouteContext) {
  const projectId = await getProjectId(context);
  if (!projectId) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant && !(await canAdministerProject(request, projectId))) {
    return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

async function requireWriteScope(request: NextRequest, context: RouteContext) {
  const projectId = await getProjectId(context);
  if (!projectId) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  const canWrite = grant?.role === "admin" || (!grant && await canAdministerProject(request, projectId));
  if (!canWrite) {
    return NextResponse.json(
      { error: "씬리스트를 수정하려면 Key staff 권한이 필요합니다." },
      { status: grant ? 403 : 401 }
    );
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function normalizeItem(item: SceneItemInput, projectId: string, index: number) {
  const id = normalizeText(item.id, 36);
  if (!isUuid(id)) return null;
  const cutCount = validateSceneCutCountInput(item.cutCount);
  if (cutCount.error) return null;
  return {
    id,
    project_id: projectId,
    scene_no: normalizeSceneNumber(item.sceneNo) || normalizeText(item.sceneNo, 30),
    main_location: normalizeText(item.mainLocation, 120),
    sub_location: normalizeText(item.subLocation, 160),
    day_label: normalizeText(item.dayLabel, 30),
    day_night: normalizeText(item.dayNight, 10),
    interior_exterior: normalizeText(item.interiorExterior, 10),
    scene_content: normalizeText(item.sceneContent, 4000),
    characters: normalizeText(item.characters, 1000),
    character_notes: normalizeMultilineText(item.characterNotes, 4000),
    actor_cells: normalizeActorCells(item.actorCells),
    props: normalizeMultilineText(item.props, 1000),
    cut_count: cutCount.value,
    sort_order: index + 1
  };
}

function extractActorRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((actor) => {
        if (!actor || typeof actor !== "object") return "";
        const record = actor as Record<string, unknown>;
        return normalizeText(record.role, 120) || normalizeText(record.name, 120);
      })
      .filter(Boolean)
  ));
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeMultilineText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\r\n?/g, "\n").slice(0, maxLength);
}

function normalizeActorCells(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, { mode: "color" | "text"; text?: string }> = {};
  for (const [rawRole, rawCell] of Object.entries(value)) {
    const role = normalizeText(rawRole, 120);
    if (!role || !rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) continue;
    const record = rawCell as Record<string, unknown>;
    if (record.mode === "color") {
      normalized[role] = { mode: "color" };
      continue;
    }
    if (record.mode === "text") {
      const text = normalizeMultilineText(record.text, 120);
      if (text.trim()) normalized[role] = { mode: "text", text };
    }
  }
  return normalized;
}

function normalizeClearCells(value: unknown): Array<{
  sceneId: string;
  column: ProjectSceneMergeColumn;
}> {
  if (!Array.isArray(value)) return [];
  const supportedColumns = new Set<ProjectSceneMergeColumn>([
    "location",
    "subLocation",
    "day",
    "time",
    "intExt"
  ]);
  const seen = new Set<string>();
  const cells: Array<{ sceneId: string; column: ProjectSceneMergeColumn }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const sceneId = normalizeText(record.sceneId, 36);
    const column = normalizeText(record.column, 30) as ProjectSceneMergeColumn;
    const key = `${sceneId}:${column}`;
    if (!isUuid(sceneId) || !supportedColumns.has(column) || seen.has(key)) continue;
    seen.add(key);
    cells.push({ sceneId, column });
  }
  return cells;
}

function normalizeRestoreCells(value: unknown): Array<{
  sceneId: string;
  column: ProjectSceneMergeColumn;
  value: string;
}> {
  if (!Array.isArray(value)) return [];
  const cells = normalizeClearCells(value);
  if (cells.length !== value.length) return [];
  return cells.map((cell, index) => ({
    ...cell,
    value: normalizeText((value[index] as Record<string, unknown>).value, 160)
  }));
}

async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

function normalizeOrderedSceneIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => normalizeText(entry, 36));
  if (ids.some((id) => !isUuid(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

function normalizeExpectedUpdatedAt(value: unknown):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "셀 병합 버전 정보가 올바르지 않습니다." };
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || Number.isNaN(Date.parse(normalized))) {
    return { ok: false, error: "셀 병합 버전 정보가 올바르지 않습니다." };
  }
  return { ok: true, value: normalized };
}

function normalizeRowExpectedUpdatedAt(value: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "씬 행 버전 정보가 올바르지 않습니다." };
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || Number.isNaN(Date.parse(normalized))) {
    return { ok: false, error: "씬 행 버전 정보가 올바르지 않습니다." };
  }
  return { ok: true, value: normalized };
}

function normalizeNullableExpectedUpdatedAt(value: unknown):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const normalized = normalizeRowExpectedUpdatedAt(value);
  return normalized.ok
    ? normalized
    : { ok: false, error: "씬리스트 메모 버전 정보가 올바르지 않습니다." };
}

function normalizeSceneItemPatch(input: SceneItemInput):
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string } {
  const fields: Record<string, unknown> = {};
  const has = (key: keyof SceneItemInput) => Object.prototype.hasOwnProperty.call(input, key);
  if (has("sceneNo")) {
    fields.scene_no = normalizeSceneNumber(input.sceneNo) || normalizeText(input.sceneNo, 30);
  }
  if (has("mainLocation")) fields.main_location = normalizeText(input.mainLocation, 120);
  if (has("subLocation")) fields.sub_location = normalizeText(input.subLocation, 160);
  if (has("dayLabel")) fields.day_label = normalizeText(input.dayLabel, 30);
  if (has("dayNight")) fields.day_night = normalizeText(input.dayNight, 10);
  if (has("interiorExterior")) fields.interior_exterior = normalizeText(input.interiorExterior, 10);
  if (has("sceneContent")) fields.scene_content = normalizeText(input.sceneContent, 4000);
  if (has("characters")) fields.characters = normalizeText(input.characters, 1000);
  if (has("characterNotes")) fields.character_notes = normalizeMultilineText(input.characterNotes, 4000);
  if (has("actorCells")) fields.actor_cells = normalizeActorCells(input.actorCells);
  if (has("props")) fields.props = normalizeMultilineText(input.props, 1000);
  if (has("cutCount")) {
    const cutCount = validateSceneCutCountInput(input.cutCount);
    if (cutCount.error) return { ok: false, error: cutCount.error };
    fields.cut_count = cutCount.value;
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, error: "자동 저장할 씬 변경사항이 없습니다." };
  }
  return { ok: true, fields };
}

function sameIdSet(currentIds: string[], orderedIds: string[]) {
  if (currentIds.length !== orderedIds.length) return false;
  const expected = new Set(currentIds);
  return orderedIds.every((id) => expected.has(id));
}

type NormalizedSceneRow = NonNullable<ReturnType<typeof normalizeItem>>;

function hasSceneRowChanged(
  current: Record<string, unknown> | undefined,
  next: NormalizedSceneRow
) {
  if (!current) return true;

  const textColumns = [
    "project_id",
    "scene_no",
    "main_location",
    "sub_location",
    "day_label",
    "day_night",
    "interior_exterior",
    "scene_content",
    "characters",
    "character_notes",
    "props"
  ] as const;
  if (textColumns.some((column) => (
    String(current[column] ?? "") !== String(next[column] ?? "")
  ))) {
    return true;
  }

  const currentCutCount = current.cut_count == null ? null : Number(current.cut_count);
  if (currentCutCount !== next.cut_count) return true;
  if (Number(current.sort_order) !== next.sort_order) return true;

  return serializeActorCells(current.actor_cells) !== serializeActorCells(next.actor_cells);
}

function serializeActorCells(value: unknown) {
  const normalized = normalizeActorCells(value);
  return JSON.stringify(
    Object.keys(normalized)
      .sort((left, right) => left.localeCompare(right, "ko-KR"))
      .map((role) => [role, normalized[role]])
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseSceneItemDeleteReceipt(projectId: string, receipt: unknown) {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: "scene-list-item"
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDeleteReceiptError();
  }
  const payload = value as Record<string, unknown>;
  if (!payload.item || typeof payload.item !== "object" || Array.isArray(payload.item)) {
    throw new ProjectDeleteReceiptError();
  }
  const item = payload.item as Record<string, unknown>;
  if (
    !isUuid(String(item.id ?? ""))
    || String(item.project_id ?? "") !== projectId
    || !String(item.updated_at ?? "").trim()
  ) {
    throw new ProjectDeleteReceiptError();
  }
  const parsedMerges = parseSceneListCellMerges(payload.removedMerges);
  if (
    parsedMerges.errors.length > 0
    || !Array.isArray(payload.removedMerges)
    || parsedMerges.merges.length !== payload.removedMerges.length
    || parsedMerges.merges.some((merge) => !merge.sceneIds.includes(String(item.id)))
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return { item, removedMerges: parsedMerges.merges };
}

async function rollbackRestoredSceneItem(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  item: Record<string, unknown>
) {
  await supabase
    .from("project_scene_items")
    .delete()
    .eq("project_id", projectId)
    .eq("id", String(item.id ?? ""))
    .eq("updated_at", String(item.updated_at ?? ""));
}

function sceneListMergeConflict(cellMerges: unknown, updatedAt: unknown) {
  return NextResponse.json(
    {
      error: "다른 사용자가 변경한 최신 병합 상태로 동기화했습니다. 다시 시도해주세요.",
      cellMerges: parseSceneListCellMerges(cellMerges).merges,
      cellMergesMaterialized: Array.isArray(cellMerges),
      cellMergesUpdatedAt: updatedAt ? String(updatedAt) : null
    },
    { status: 409 }
  );
}

function sceneReferenceConflict(
  latest: { scenario_reference?: unknown; updated_at?: unknown } | null
) {
  return NextResponse.json(
    {
      error: "씬리스트 메모가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.",
      scenarioReference: latest?.scenario_reference ?? "",
      cellMergesUpdatedAt: latest?.updated_at ?? null
    },
    { status: 409 }
  );
}

function sceneListError(error: unknown, fallback: string) {
  if (error instanceof ProjectDeleteReceiptError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: fallback }, { status: 503 });
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "";
  const migrationMissing = (
    code === "42P01" ||
    code === "PGRST205"
  ) && /project_scene_(items|notes)/i.test(message);
  if (migrationMissing) {
    return NextResponse.json(
      { error: "프로젝트 씬리스트 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  const propsColumnMissing = (
    code === "42703" ||
    code === "PGRST204"
  ) && /props/i.test(message);
  if (propsColumnMissing) {
    return NextResponse.json(
      { error: "씬리스트 주요 소품 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  const cutCountColumnMissing = (
    code === "42703" ||
    code === "PGRST204"
  ) && /cut_count/i.test(message);
  if (cutCountColumnMissing) {
    return NextResponse.json(
      { error: "씬리스트 Cut migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  const characterNotesColumnMissing = (
    code === "42703" ||
    code === "PGRST204"
  ) && /character_notes/i.test(message);
  if (characterNotesColumnMissing) {
    return NextResponse.json(
      { error: "씬리스트 Characters 메모 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  const actorCellsColumnMissing = (
    code === "42703" ||
    code === "PGRST204"
  ) && /actor_cells/i.test(message);
  if (actorCellsColumnMissing) {
    return NextResponse.json(
      { error: "씬리스트 배우칸 상태 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  const cellMergesColumnMissing = (
    code === "42703" ||
    code === "PGRST204"
  ) && /cell_merges/i.test(message);
  const sceneListMergeRpcMissing = (
    code === "42883" ||
    code === "PGRST202"
  ) && /clear_project_scene_list_cells/i.test(message);
  if (cellMergesColumnMissing || sceneListMergeRpcMissing) {
    return NextResponse.json(
      { error: "씬리스트 셀 병합 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  console.error("[project-scene-list]", { code, message });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
