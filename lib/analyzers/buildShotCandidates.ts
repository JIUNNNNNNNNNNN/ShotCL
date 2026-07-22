import type { ExtractedDocument, ExtractedRow, ColumnMapping } from "@/lib/analyzers/types";
import type { ShotCandidate } from "@/lib/types";

const headerAliases = {
  scene: ["씬", "씬번호", "s", "s#", "scene", "scenenumber", "장면"],
  cut: ["컷", "컷번호", "콘티", "콘티번호", "c", "c#", "cut", "shot", "shotnumber", "cutnumber", "쇼트", "쇼트번호"],
  description: ["내용", "촬영내용", "액션", "설명", "컷설명", "콘티내용", "description", "action"],
  location: ["장소", "로케이션", "location", "loc"],
  characters: ["인물", "등장인물", "출연", "배우", "cast", "character"],
  memo: ["비고", "메모", "참고", "note", "memo", "remark"]
} as const;

/** 추출된 행/텍스트를 컷 후보 배열로 바꿉니다. 애매하면 합치지 않고 분리합니다. */
export function buildShotCandidates(document: ExtractedDocument) {
  if (document.kind === "pdf") {
    return buildPdfCandidates(document);
  }

  return buildTableCandidates(document);
}

function buildTableCandidates(document: ExtractedDocument) {
  const warnings: string[] = [];
  const header = detectHeader(document.rows);
  const mapping = header ? detectColumns(header.row.cells) : {};
  const rows = header ? document.rows.filter((row) => row.rowNumber > header.row.rowNumber || row.sheetName !== header.row.sheetName) : document.rows;
  const candidates: ShotCandidate[] = [];
  const sceneCutCounters = new Map<string, number>();
  let carriedSceneNumber = "";

  for (const row of rows) {
    if (!row.cells.some((cell) => cell.trim())) continue;

    const rowText = row.cells.join(" | ").trim();
    const mappedDescription = readMapped(row, mapping.description);
    const meaningfulText = mappedDescription || rowText;
    if (meaningfulText.length < 2) continue;

    const detectedScene = readMapped(row, mapping.scene) || matchSceneNumber(rowText) || carriedSceneNumber || "1";
    carriedSceneNumber = detectedScene;
    const detectedCut = readMapped(row, mapping.cut) || matchCutNumber(rowText) || nextCutNumber(sceneCutCounters, detectedScene);
    const location = readMapped(row, mapping.location);
    const memo = readMapped(row, mapping.memo);
    const characters = splitCharacters(readMapped(row, mapping.characters));
    const description = mappedDescription || removeKnownNumbers(rowText);

    candidates.push({
      sceneNumber: detectedScene,
      cutNumber: detectedCut,
      title: buildTitle(description, location, detectedScene, detectedCut),
      description,
      location,
      characters,
      memo,
      orderIndex: candidates.length + 1,
      sourceSheet: row.sheetName ?? null,
      sourcePage: null,
      sourceRow: row.rowNumber,
      rawText: rowText,
      rawData: buildRawData(row, header?.row.cells)
    });
  }

  return {
    candidates,
    detectedHeaderRow: header?.row.rowNumber ?? null,
    detectedColumns: labelsFromMapping(header?.row.cells ?? [], mapping),
    warnings
  };
}

function buildPdfCandidates(document: ExtractedDocument) {
  const candidates: ShotCandidate[] = [];
  const warnings: string[] = [];
  const sceneCutCounters = new Map<string, number>();
  let carriedSceneNumber = "1";

  for (const row of document.rows) {
    const line = row.cells.join(" ").trim();
    if (shouldSkipPdfLine(line)) continue;

    const sceneNumber = matchSceneNumber(line) || carriedSceneNumber;
    carriedSceneNumber = sceneNumber;
    const cutNumber = matchCutNumber(line) || nextCutNumber(sceneCutCounters, sceneNumber);
    const description = removeKnownNumbers(line);

    candidates.push({
      sceneNumber,
      cutNumber,
      title: buildTitle(description, "", sceneNumber, cutNumber),
      description,
      location: "",
      characters: [],
      memo: "",
      orderIndex: candidates.length + 1,
      sourceSheet: null,
      sourcePage: null,
      sourceRow: row.rowNumber,
      rawText: line,
      rawData: { line }
    });
  }

  if (document.rows.length >= 10 && candidates.length <= 5) {
    warnings.push("PDF 텍스트 줄 수에 비해 컷 후보가 적습니다. 스캔 이미지 PDF이거나 텍스트 추출 품질이 낮을 수 있습니다.");
  }

  return {
    candidates,
    detectedHeaderRow: null,
    detectedColumns: {},
    warnings
  };
}

function detectHeader(rows: ExtractedRow[]) {
  let best: { row: ExtractedRow; score: number } | null = null;

  for (const row of rows.slice(0, 15)) {
    const score = Object.values(detectColumns(row.cells)).filter((value) => value !== undefined).length;
    if (!best || score > best.score) best = { row, score };
  }

  return best && best.score >= 2 ? best : null;
}

function detectColumns(cells: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};

  cells.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(headerAliases) as Array<[keyof ColumnMapping, readonly string[]]>) {
      if (mapping[key] === undefined && aliases.map(normalizeHeader).includes(normalized)) {
        mapping[key] = index;
      }
    }
  });

  return mapping;
}

function labelsFromMapping(headers: string[], mapping: ColumnMapping) {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, index]) => [key, index === undefined ? null : headers[index] ?? null])
  ) as Record<string, string | null>;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s#._-]+/g, "").trim();
}

function readMapped(row: ExtractedRow, index?: number) {
  if (index === undefined) return "";
  return row.cells[index]?.trim() ?? "";
}

function buildRawData(row: ExtractedRow, headers?: string[]) {
  const data: Record<string, string> = {};
  row.cells.forEach((cell, index) => {
    if (!cell) return;
    data[headers?.[index] || `col${index + 1}`] = cell;
  });
  return data;
}

function nextCutNumber(counters: Map<string, number>, sceneNumber: string) {
  const next = (counters.get(sceneNumber) ?? 0) + 1;
  counters.set(sceneNumber, next);
  return String(next);
}

function splitCharacters(value: string) {
  return value
    .split(/[,/·、，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchSceneNumber(value: string) {
  return (
    value.match(/(?:S|S#|Scene|씬|장면)\s*#?\s*(\d+)/i)?.[1] ??
    value.match(/S\s*#?\s*(\d+)/i)?.[1] ??
    ""
  );
}

function matchCutNumber(value: string) {
  return (
    value.match(/(?:C|C#|Cut|Shot|컷|콘티|쇼트)\s*#?\s*(\d+)/i)?.[1] ??
    value.match(/(\d+)\s*컷/)?.[1] ??
    value.match(/S\s*#?\s*\d+\s*[-/]\s*C?\s*#?\s*(\d+)/i)?.[1] ??
    value.match(/^(\d+)[.)]\s+/)?.[1] ??
    value.match(/[①②③④⑤⑥⑦⑧⑨⑩]/)?.[0] ??
    ""
  );
}

function removeKnownNumbers(value: string) {
  return value
    .replace(/(?:S|S#|Scene|씬|장면)\s*#?\s*\d+/gi, "")
    .replace(/(?:C|C#|Cut|Shot|컷|콘티|쇼트)\s*#?\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[|,\-:. ]+/, "")
    .trim();
}

function buildTitle(description: string, location: string, sceneNumber: string, cutNumber: string) {
  const base = description || location || `S#${sceneNumber} C#${cutNumber}`;
  return base.length > 24 ? base.slice(0, 24).trim() : base;
}

function shouldSkipPdfLine(line: string) {
  return (
    line.length < 3 ||
    /^page\s*\d+$/i.test(line) ||
    /^\d+$/.test(line) ||
    /^(일일촬영계획서|스토리보드|콘티|촬영\s*순서)$/i.test(line)
  );
}
