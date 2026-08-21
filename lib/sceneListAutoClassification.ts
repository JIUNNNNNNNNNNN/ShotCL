export type SceneListClassificationActorCell = {
  mode: "color" | "text";
  text?: string;
  actorId?: string;
};

export type SceneListClassificationSourceScene = {
  sceneNo: unknown;
  text: unknown;
};

export type SceneListClassificationActor = {
  id: string;
  role: string;
  name: string;
};

export type SceneListClassificationExistingRow = {
  id: string;
  sceneNo: unknown;
  characters: string;
  actorCells: Record<string, SceneListClassificationActorCell>;
  sortOrder: number;
  updatedAt: string;
};

export type SceneListClassificationNewRow = {
  id: string;
  project_id: string;
  scene_no: string;
  main_location: string;
  sub_location: string;
  day_label: string;
  day_night: string;
  interior_exterior: string;
  scene_content: string;
  characters: string;
  character_notes: string;
  actor_cells: Record<string, SceneListClassificationActorCell>;
  props: string;
  cut_count: null;
  sort_order: number;
};

export type SceneListClassificationExistingUpdate = {
  id: string;
  expectedUpdatedAt: string;
  characters: string;
  actorCells: Record<string, SceneListClassificationActorCell>;
  actorLinkCount: number;
};

export type SceneListAutoClassificationPlan = {
  totalProcessedCount: number;
  skippedDuplicateCount: number;
  newRows: SceneListClassificationNewRow[];
  existingUpdates: SceneListClassificationExistingUpdate[];
  actorLinkCountByNewRowId: Map<string, number>;
};

type PlanInput = {
  projectId: string;
  scenarioScenes: SceneListClassificationSourceScene[];
  existingRows: SceneListClassificationExistingRow[];
  actors: SceneListClassificationActor[];
  normalizeSceneNumber: (value: unknown) => string;
  createSceneId: (canonicalSceneNo: string) => string;
};

type MatchableActor = SceneListClassificationActor & {
  displayRole: string;
  aliases: string[];
};

const KOREAN_PARTICLES = [
  "에게서는",
  "한테서는",
  "에게서",
  "한테서",
  "께서는",
  "으로는",
  "에서는",
  "에게",
  "한테",
  "께서",
  "으로",
  "처럼",
  "보다",
  "까지",
  "부터",
  "하고",
  "이랑",
  "랑",
  "에서",
  "께",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "도",
  "만",
  "의",
  "로"
] as const;

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * Canonical parsed scenes and one already-loaded Scene List snapshot are merged
 * in memory. The caller owns database writes so it can keep insert batching and
 * apply updated_at compare-and-swap to existing rows.
 */
export function planSceneListAutoClassification(
  input: PlanInput
): SceneListAutoClassificationPlan {
  const sourceScenes: Array<{ sceneNo: string; text: string }> = [];
  const seenSceneNumbers = new Set<string>();
  let skippedDuplicateCount = 0;

  for (const source of input.scenarioScenes) {
    const sceneNo = input.normalizeSceneNumber(source.sceneNo);
    if (!sceneNo) continue;
    if (seenSceneNumbers.has(sceneNo)) {
      skippedDuplicateCount += 1;
      continue;
    }
    seenSceneNumbers.add(sceneNo);
    sourceScenes.push({ sceneNo, text: normalizeSearchText(source.text) });
  }

  const existingBySceneNumber = new Map<string, SceneListClassificationExistingRow>();
  for (const row of input.existingRows) {
    const sceneNo = input.normalizeSceneNumber(row.sceneNo);
    if (sceneNo && !existingBySceneNumber.has(sceneNo)) {
      existingBySceneNumber.set(sceneNo, row);
    }
  }

  const actors = prepareActors(input.actors);
  const maxSortOrder = input.existingRows.reduce(
    (maximum, row) => Math.max(maximum, Number.isFinite(row.sortOrder) ? row.sortOrder : 0),
    0
  );
  const newRows: SceneListClassificationNewRow[] = [];
  const existingUpdates: SceneListClassificationExistingUpdate[] = [];
  const actorLinkCountByNewRowId = new Map<string, number>();

  for (const source of sourceScenes) {
    const detectedActors = actors.filter((actor) => (
      actor.aliases.some((alias) => containsExactActorName(source.text, alias))
    ));
    const existing = existingBySceneNumber.get(source.sceneNo);
    if (!existing) {
      const actorCells = createActorCells(detectedActors);
      const id = input.createSceneId(source.sceneNo);
      newRows.push({
        id,
        project_id: input.projectId,
        scene_no: source.sceneNo,
        main_location: "",
        sub_location: "",
        day_label: "",
        day_night: "",
        interior_exterior: "",
        scene_content: "",
        characters: Object.keys(actorCells).join(", "),
        character_notes: "",
        actor_cells: actorCells,
        props: "",
        cut_count: null,
        sort_order: maxSortOrder + newRows.length + 1
      });
      actorLinkCountByNewRowId.set(id, countStableActorIds(actorCells));
      continue;
    }

    const merged = mergeDetectedActors(existing, detectedActors);
    if (merged.changed) {
      existingUpdates.push({
        id: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        characters: merged.characters,
        actorCells: merged.actorCells,
        actorLinkCount: merged.actorLinkCount
      });
    }
  }

  return {
    totalProcessedCount: sourceScenes.length,
    skippedDuplicateCount,
    newRows,
    existingUpdates,
    actorLinkCountByNewRowId
  };
}

/** Exact Unicode token matching with a conservative Korean-particle suffix. */
export function containsExactActorName(body: unknown, rawName: unknown) {
  const text = normalizeSearchText(body);
  const name = normalizeSearchText(rawName);
  if (!text || !name) return false;

  let offset = text.indexOf(name);
  while (offset >= 0) {
    const before = offset > 0 ? text[offset - 1] : "";
    const afterOffset = offset + name.length;
    const after = afterOffset < text.length ? text[afterOffset] : "";
    const hasLeftBoundary = !before || !WORD_CHARACTER.test(before);
    if (hasLeftBoundary && (
      !after
      || !WORD_CHARACTER.test(after)
      || hasAllowedParticleBoundary(text, afterOffset)
    )) {
      return true;
    }
    offset = text.indexOf(name, offset + name.length);
  }
  return false;
}

function prepareActors(actors: SceneListClassificationActor[]): MatchableActor[] {
  const seenActorIds = new Set<string>();
  const prepared: MatchableActor[] = [];
  for (const source of actors) {
    const id = normalizeStableActorId(source.id);
    const role = normalizeDisplayText(source.role, 120);
    const name = normalizeDisplayText(source.name, 120);
    const displayRole = role || name;
    if (!id || !displayRole || seenActorIds.has(id)) continue;
    // Scene List is keyed by the canonical display role. A performer's real
    // name is only the fallback when Basic Info has no role value.
    const aliases = [normalizeSearchText(displayRole)].filter(Boolean);
    if (aliases.length === 0) continue;
    seenActorIds.add(id);
    prepared.push({ id, role, name, displayRole, aliases });
  }
  return prepared;
}

function createActorCells(actors: MatchableActor[]) {
  const cells: Record<string, SceneListClassificationActorCell> = {};
  for (const actor of actors) {
    if (Object.prototype.hasOwnProperty.call(cells, actor.displayRole)) continue;
    cells[actor.displayRole] = { mode: "color", actorId: actor.id };
  }
  return cells;
}

function mergeDetectedActors(
  row: SceneListClassificationExistingRow,
  detectedActors: MatchableActor[]
) {
  const actorCells = cloneActorCells(row.actorCells);
  const actorIdToRole = new Map<string, string>();
  const normalizedRoleToKey = new Map<string, string>();
  for (const [role, cell] of Object.entries(actorCells)) {
    normalizedRoleToKey.set(normalizeSearchText(role), role);
    const actorId = normalizeStableActorId(cell.actorId);
    if (actorId) actorIdToRole.set(actorId, role);
  }

  let actorLinkCount = 0;
  let changed = false;
  for (const actor of detectedActors) {
    if (actorIdToRole.has(actor.id)) continue;
    const existingRoleKey = normalizedRoleToKey.get(normalizeSearchText(actor.displayRole));
    if (existingRoleKey) {
      const current = actorCells[existingRoleKey];
      const currentActorId = normalizeStableActorId(current.actorId);
      if (currentActorId && currentActorId !== actor.id) continue;
      actorCells[existingRoleKey] = { ...current, actorId: actor.id };
    } else {
      actorCells[actor.displayRole] = { mode: "color", actorId: actor.id };
      normalizedRoleToKey.set(normalizeSearchText(actor.displayRole), actor.displayRole);
    }
    actorIdToRole.set(actor.id, existingRoleKey ?? actor.displayRole);
    actorLinkCount += 1;
    changed = true;
  }

  const characters = appendCharacterRoles(
    row.characters,
    detectedActors.map((actor) => actor.displayRole)
  );
  if (characters !== row.characters) changed = true;
  return { changed, characters, actorCells, actorLinkCount };
}

function appendCharacterRoles(existing: string, additions: string[]) {
  if (additions.length === 0) return existing;
  const current = String(existing ?? "");
  const known = new Set(
    current
      .split(/[,，/|\n]+/)
      .map(normalizeSearchText)
      .filter(Boolean)
  );
  const missing: string[] = [];
  for (const role of additions) {
    const key = normalizeSearchText(role);
    if (!key || known.has(key)) continue;
    known.add(key);
    missing.push(role);
  }
  if (missing.length === 0) return current;
  const prefix = current.trimEnd();
  return `${prefix}${prefix ? ", " : ""}${missing.join(", ")}`.slice(0, 1_000);
}

function hasAllowedParticleBoundary(text: string, afterNameOffset: number) {
  for (const particle of KOREAN_PARTICLES) {
    if (!text.startsWith(particle, afterNameOffset)) continue;
    const boundaryOffset = afterNameOffset + particle.length;
    const following = boundaryOffset < text.length ? text[boundaryOffset] : "";
    if (!following || !WORD_CHARACTER.test(following)) return true;
  }
  return false;
}

function cloneActorCells(value: Record<string, SceneListClassificationActorCell>) {
  return Object.fromEntries(
    Object.entries(value).map(([role, cell]) => [role, { ...cell }])
  );
}

function countStableActorIds(cells: Record<string, SceneListClassificationActorCell>) {
  return new Set(
    Object.values(cells).map((cell) => normalizeStableActorId(cell.actorId)).filter(Boolean)
  ).size;
}

function normalizeStableActorId(value: unknown) {
  const id = String(value ?? "").trim().slice(0, 160);
  return /^project_actor_[0-9a-z-]+$/i.test(id) ? id : "";
}

function normalizeDisplayText(value: unknown, maxLength: number) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}
