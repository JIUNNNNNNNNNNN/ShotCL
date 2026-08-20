const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_DELETE_BATCH_SIZE = 100;
const STORAGE_DELETE_BATCH_RETRY_LIMIT = 2;
const STORAGE_DIRECTORY_DEPTH_LIMIT = 64;

export type ProjectStorageListEntry = {
  id?: string | null;
  name?: string | null;
  metadata?: unknown;
};

export type ProjectStorageBucket = {
  list: (
    path: string,
    options: {
      limit: number;
      offset: number;
      sortBy: { column: "name"; order: "asc" };
    }
  ) => PromiseLike<{ data: ProjectStorageListEntry[] | null; error: unknown }>;
  remove: (paths: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Recursively lists every object under exact, caller-validated prefixes. */
export async function inventoryStorageObjects(
  storage: ProjectStorageBucket,
  prefixes: readonly string[]
) {
  const paths = new Set<string>();
  for (const prefix of prefixes) {
    await listStorageDirectory(storage, prefix, paths, 0);
  }
  return [...paths].sort();
}

/** Removes bounded batches and retries each transiently failing batch twice. */
export async function removeStorageObjects(
  storage: ProjectStorageBucket,
  paths: string[]
) {
  for (let start = 0; start < paths.length; start += STORAGE_DELETE_BATCH_SIZE) {
    const batch = paths.slice(start, start + STORAGE_DELETE_BATCH_SIZE);
    let removed = false;
    for (let attempt = 0; attempt <= STORAGE_DELETE_BATCH_RETRY_LIMIT; attempt += 1) {
      const { error } = await storage.remove(batch);
      if (!error) {
        removed = true;
        break;
      }
    }
    if (!removed) throw new Error("Storage batch removal failed.");
  }
}

async function listStorageDirectory(
  storage: ProjectStorageBucket,
  directory: string,
  paths: Set<string>,
  depth: number
): Promise<void> {
  if (depth > STORAGE_DIRECTORY_DEPTH_LIMIT) {
    throw new Error("Storage directory depth exceeded.");
  }
  let offset = 0;
  for (;;) {
    const { data, error } = await storage.list(directory, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error("Storage listing failed.");
    const entries = data ?? [];
    for (const entry of entries) {
      const name = String(entry.name ?? "");
      if (!name || name === "." || name === ".." || name.includes("/")) {
        throw new Error("Unsafe Storage entry.");
      }
      const path = `${directory}/${name}`;
      if (entry.id) paths.add(path);
      else await listStorageDirectory(storage, path, paths, depth + 1);
    }
    if (entries.length < STORAGE_LIST_PAGE_SIZE) return;
    offset += entries.length;
  }
}
