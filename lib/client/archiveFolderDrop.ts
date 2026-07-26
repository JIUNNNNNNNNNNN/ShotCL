export type ArchiveFolderFile = {
  file: File;
  originalFolderName: string;
  relativePath: string;
  folderPath: string;
};

export type ArchiveFolderScanResult = {
  files: ArchiveFolderFile[];
  excludedCount: number;
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
  webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
};

const SUPPORTED_EXTENSION = /\.(?:pdf|jpe?g|png|webp)$/i;
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export async function scanArchiveDrop(dataTransfer: DataTransfer): Promise<ArchiveFolderScanResult> {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item): LegacyFileSystemEntry | null => (
      (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null
    ))
    .filter((entry): entry is LegacyFileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return scanArchiveFileList(Array.from(dataTransfer.files ?? []));
  }

  const result: ArchiveFolderScanResult = { files: [], excludedCount: 0 };
  for (const entry of entries) {
    if (entry.isDirectory) {
      await traverseEntry(entry, entry.name, entry.name, result);
    } else {
      await traverseEntry(entry, "", entry.name, result);
    }
  }
  return dedupeScanResult(result);
}

export function scanArchiveFileList(files: File[]): ArchiveFolderScanResult {
  const result: ArchiveFolderScanResult = { files: [], excludedCount: 0 };
  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    const parts = relativePath.split("/").filter(Boolean);
    const originalFolderName = parts.length > 1 ? parts[0] : "";
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    addFile(result, file, originalFolderName, relativePath, folderPath);
  }
  return dedupeScanResult(result);
}

async function traverseEntry(
  entry: LegacyFileSystemEntry,
  originalFolderName: string,
  relativePath: string,
  result: ArchiveFolderScanResult
) {
  if (isHiddenPath(relativePath)) {
    result.excludedCount += 1;
    return;
  }
  if (entry.isFile) {
    try {
      const file = await readFileEntry(entry as LegacyFileSystemFileEntry);
      const folderPath = normalizePath(relativePath).split("/").slice(0, -1).join("/");
      addFile(result, file, originalFolderName, normalizePath(relativePath), folderPath);
    } catch {
      result.excludedCount += 1;
    }
    return;
  }
  if (!entry.isDirectory) {
    result.excludedCount += 1;
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
    result.excludedCount += 1;
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
  if (
    file.size <= 0
    || !SUPPORTED_EXTENSION.test(file.name)
    || isHiddenPath(relativePath)
    || IGNORED_NAMES.has(file.name)
  ) {
    result.excludedCount += 1;
    return;
  }
  result.files.push({
    file,
    originalFolderName: originalFolderName.trim(),
    relativePath: normalizePath(relativePath),
    folderPath: normalizePath(folderPath)
  });
}

function isHiddenPath(value: string) {
  return normalizePath(value)
    .split("/")
    .some((part) => part.startsWith(".") || IGNORED_NAMES.has(part));
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function dedupeScanResult(result: ArchiveFolderScanResult): ArchiveFolderScanResult {
  const seen = new Set<string>();
  const files = result.files.filter((entry) => {
    const key = `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    files,
    excludedCount: result.excludedCount + result.files.length - files.length
  };
}
