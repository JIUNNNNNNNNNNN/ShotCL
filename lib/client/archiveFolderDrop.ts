export type ArchiveFolderFile = {
  file: File;
  originalFolderName: string;
  relativePath: string;
  folderPath: string;
};

export type ArchiveFolderIssue = {
  path: string;
  reason: string;
};

export type ArchiveFolderScanResult = {
  files: ArchiveFolderFile[];
  discoveredCount: number;
  excludedCount: number;
  skipped: ArchiveFolderIssue[];
};

type LegacyFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type LegacyFileSystemFileEntry = LegacyFileSystemEntry & {
  file: (success: (file: File) => void, failure?: () => void) => void;
};

type FileSystemDirectoryReader = {
  readEntries: (
    success: (entries: LegacyFileSystemEntry[]) => void,
    failure?: () => void
  ) => void;
};

type LegacyFileSystemDirectoryEntry = LegacyFileSystemEntry & {
  createReader: () => FileSystemDirectoryReader;
};

type DataTransferItemWithEntry = {
  kind?: string;
  webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
  getAsEntry?: () => LegacyFileSystemEntry | null;
  getAsFile?: () => File | null;
};

const SUPPORTED_EXTENSION = /\.(?:pdf|jpe?g|png|webp)$/i;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);
const EXTENSION_FALLBACK_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream"
]);
const IGNORED_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const IGNORED_DIRECTORIES = new Set([
  "__macosx",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd"
]);
const ARCHIVE_PATH_COLLATOR = new Intl.Collator("ko-KR", {
  numeric: true,
  sensitivity: "base"
});

export async function scanArchiveDrop(dataTransfer: DataTransfer): Promise<ArchiveFolderScanResult> {
  const items = Array.from(dataTransfer.items ?? []).map((item) => {
    const candidate = item as unknown as DataTransferItemWithEntry;
    const entry = candidate.getAsEntry?.() ?? candidate.webkitGetAsEntry?.() ?? null;
    return { candidate, entry };
  });
  const entries = items
    .map(({ entry }) => entry)
    .filter((entry): entry is LegacyFileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return scanArchiveFileList(Array.from(dataTransfer.files ?? []));
  }

  const result = createScanResult();
  for (const entry of entries) {
    if (entry.isDirectory) {
      await traverseEntry(entry, entry.name, entry.name, result);
    } else {
      await traverseEntry(entry, "", entry.name, result);
    }
  }
  const fallbackFiles = items.flatMap(({ candidate, entry }) => {
    if (entry || candidate.kind === "string") return [];
    const file = candidate.getAsFile?.() ?? null;
    return file ? [file] : [];
  });
  if (fallbackFiles.length > 0) {
    const fallback = scanArchiveFileList(fallbackFiles);
    result.files.push(...fallback.files);
    result.discoveredCount += fallback.discoveredCount;
    result.excludedCount += fallback.excludedCount;
    result.skipped.push(...fallback.skipped);
  }
  return finalizeScanResult(result);
}

export function scanArchiveFileList(files: File[]): ArchiveFolderScanResult {
  const result = createScanResult();
  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    const parts = relativePath.split("/").filter(Boolean);
    const originalFolderName = parts.length > 1 ? parts[0] : "";
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    result.discoveredCount += 1;
    addFile(result, file, originalFolderName, relativePath, folderPath);
  }
  return finalizeScanResult(result);
}

async function traverseEntry(
  entry: LegacyFileSystemEntry,
  originalFolderName: string,
  relativePath: string,
  result: ArchiveFolderScanResult
) {
  if (isIgnoredSystemPath(relativePath)) {
    if (entry.isFile) result.discoveredCount += 1;
    addSkipped(result, relativePath, "숨김 또는 시스템 파일");
    return;
  }
  if (entry.isFile) {
    result.discoveredCount += 1;
    try {
      const file = await readFileEntry(entry as LegacyFileSystemFileEntry);
      const folderPath = normalizePath(relativePath).split("/").slice(0, -1).join("/");
      addFile(result, file, originalFolderName, normalizePath(relativePath), folderPath);
    } catch {
      addSkipped(result, relativePath, "파일 읽기 실패");
    }
    return;
  }
  if (!entry.isDirectory) {
    addSkipped(result, relativePath, "지원하지 않는 항목");
    return;
  }

  try {
    const children = await readAllDirectoryEntries(entry as LegacyFileSystemDirectoryEntry);
    for (const child of children) {
      await traverseEntry(
        child,
        originalFolderName || entry.name,
        normalizePath(`${relativePath}/${child.name}`),
        result
      );
    }
  } catch {
    addSkipped(result, relativePath, "폴더 읽기 실패");
  }
}

function readFileEntry(entry: LegacyFileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllDirectoryEntries(entry: LegacyFileSystemDirectoryEntry) {
  const reader = entry.createReader();
  const entries: LegacyFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

function addFile(
  result: ArchiveFolderScanResult,
  file: File,
  originalFolderName: string,
  relativePath: string,
  folderPath: string
) {
  if (file.size <= 0) {
    addSkipped(result, relativePath, "0바이트 파일");
    return;
  }
  if (isIgnoredSystemPath(relativePath) || isIgnoredName(file.name)) {
    addSkipped(result, relativePath, "숨김 또는 시스템 파일");
    return;
  }
  if (!isSupportedArchiveFolderFile(file)) {
    addSkipped(result, relativePath, "지원하지 않는 형식");
    return;
  }
  result.files.push({
    file,
    originalFolderName: originalFolderName.trim(),
    relativePath: normalizePath(relativePath),
    folderPath: normalizePath(folderPath)
  });
}

export function isSupportedArchiveFolderFile(file: File) {
  const mimeType = file.type.trim().toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(mimeType)) return true;
  if (!EXTENSION_FALLBACK_MIME_TYPES.has(mimeType)) return false;
  return SUPPORTED_EXTENSION.test(file.name);
}

function isIgnoredSystemPath(value: string) {
  return normalizePath(value)
    .split("/")
    .some((part) => (
      isIgnoredName(part)
      || IGNORED_DIRECTORIES.has(part.toLowerCase())
      || part.startsWith("._")
    ));
}

function isIgnoredName(value: string) {
  return IGNORED_NAMES.has(value.toLowerCase());
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function createScanResult(): ArchiveFolderScanResult {
  return {
    files: [],
    discoveredCount: 0,
    excludedCount: 0,
    skipped: []
  };
}

function addSkipped(result: ArchiveFolderScanResult, path: string, reason: string) {
  result.excludedCount += 1;
  result.skipped.push({ path: normalizePath(path) || "(이름 없음)", reason });
}

function finalizeScanResult(result: ArchiveFolderScanResult): ArchiveFolderScanResult {
  const seen = new Set<string>();
  const files = result.files.filter((entry) => {
    const key = `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`;
    if (seen.has(key)) {
      addSkipped(result, entry.relativePath, "동일 경로·크기·수정일 중복");
      return false;
    }
    seen.add(key);
    return true;
  });
  files.sort((left, right) => {
    const pathOrder = ARCHIVE_PATH_COLLATOR.compare(
      left.relativePath.normalize("NFC"),
      right.relativePath.normalize("NFC")
    );
    if (pathOrder !== 0) return pathOrder;
    const nameOrder = ARCHIVE_PATH_COLLATOR.compare(left.file.name, right.file.name);
    if (nameOrder !== 0) return nameOrder;
    if (left.file.size !== right.file.size) return left.file.size - right.file.size;
    return left.file.lastModified - right.file.lastModified;
  });
  return {
    ...result,
    files,
    excludedCount: result.excludedCount
  };
}
