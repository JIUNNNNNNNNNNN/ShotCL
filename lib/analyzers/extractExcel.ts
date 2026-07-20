import { inflateRawSync, inflateSync } from "node:zlib";
import { decodeTextBuffer } from "@/lib/analyzers/detectTextCorruption";
import type { ExtractedDocument, ExtractedRow } from "@/lib/analyzers/types";

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

/** Excel/CSV 파일에서 모든 시트의 행을 텍스트 셀 배열로 추출합니다. */
export function extractExcel(buffer: Buffer, fileName: string, fileType: string): ExtractedDocument {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "csv" || fileType.includes("csv")) {
    const decoded = decodeTextBuffer(buffer);
    return buildTextTableDocument(parseDelimitedText(decoded.text, ","), fileName, fileType, "CSV", `CSV ${decoded.encoding}`);
  }

  if (extension === "tsv" || fileType.includes("tab-separated")) {
    const decoded = decodeTextBuffer(buffer);
    return buildTextTableDocument(parseDelimitedText(decoded.text, "\t"), fileName, fileType, "TSV", `TSV ${decoded.encoding}`);
  }

  if (extension === "xlsx" || fileType.includes("spreadsheetml")) {
    return extractXlsx(buffer, fileName, fileType);
  }

  const decoded = decodeTextBuffer(buffer);
  return {
    kind: "unknown",
    fileName,
    fileType,
    extractionMethod: `unsupported-excel-text-fallback-${decoded.encoding}`,
    sheetNames: [],
    rows: decoded.text
      .split(/\r?\n/)
      .map((line, index) => ({ rowNumber: index + 1, cells: [line.trim()] }))
      .filter((row) => row.cells.some(Boolean)),
    rawText: decoded.text.slice(0, 8000),
    warnings: ["지원되지 않는 Excel 형식입니다. CSV/TSV 또는 XLSX를 권장합니다."]
  };
}

function buildTextTableDocument(rows: string[][], fileName: string, fileType: string, sheetName: string, extractionMethod: string): ExtractedDocument {
  const extractedRows = rows
    .map((cells, index) => ({ sheetName, rowNumber: index + 1, cells: cells.map((cell) => cell.trim()) }))
    .filter((row) => row.cells.some(Boolean));

  return {
    kind: "excel",
    fileName,
    fileType,
    extractionMethod,
    sheetNames: [sheetName],
    rows: extractedRows,
    rawText: extractedRows.map((row) => row.cells.join(" | ")).join("\n").slice(0, 8000),
    warnings: []
  };
}

function extractXlsx(buffer: Buffer, fileName: string, fileType: string): ExtractedDocument {
  const entries = readZipEntries(buffer);
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const sharedStrings = parseSharedStrings(readEntryText(buffer, entryMap.get("xl/sharedStrings.xml")));
  const sheetInfos = parseWorkbookSheets(
    readEntryText(buffer, entryMap.get("xl/workbook.xml")),
    readEntryText(buffer, entryMap.get("xl/_rels/workbook.xml.rels"))
  );
  const warnings: string[] = [];
  const rows: ExtractedRow[] = [];

  for (const sheet of sheetInfos) {
    const normalizedPath = sheet.path.startsWith("xl/") ? sheet.path : `xl/${sheet.path.replace(/^\/+/, "")}`;
    const sheetXml = readEntryText(buffer, entryMap.get(normalizedPath));
    if (!sheetXml) {
      warnings.push(`${sheet.name} 시트를 읽지 못했습니다.`);
      continue;
    }

    rows.push(...parseSheetRows(sheetXml, sharedStrings, sheet.name));
  }

  return {
    kind: "excel",
    fileName,
    fileType,
    extractionMethod: "xlsx-zip-xml",
    sheetNames: sheetInfos.map((sheet) => sheet.name),
    rows,
    rawText: rows.map((row) => `${row.sheetName ?? ""} ${row.rowNumber}: ${row.cells.join(" | ")}`).join("\n").slice(0, 8000),
    warnings
  };
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findSignatureBackwards(buffer, 0x06054b50);
  if (eocdOffset < 0) throw new Error("XLSX ZIP 중앙 디렉터리를 찾지 못했습니다.");

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntryText(buffer: Buffer, entry?: ZipEntry) {
  if (!entry) return "";
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return "";

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compression === 0) return compressed.toString("utf8");
  if (entry.compression === 8) {
    try {
      return inflateRawSync(compressed).toString("utf8");
    } catch {
      return inflateSync(compressed).toString("utf8");
    }
  }

  return "";
}

function findSignatureBackwards(buffer: Buffer, signature: number) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function parseWorkbookSheets(workbookXml: string, relsXml: string) {
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
    rels.set(match[1], match[2]);
  }

  return [...workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)].map((match, index) => ({
    name: decodeXml(match[1]) || `Sheet${index + 1}`,
    path: rels.get(match[2]) ?? `worksheets/sheet${index + 1}.xml`
  }));
}

function parseSharedStrings(sharedStringsXml: string) {
  return [...sharedStringsXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const textParts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXml(textMatch[1]));
    return textParts.join("");
  });
}

function parseSheetRows(sheetXml: string, sharedStrings: string[], sheetName: string): ExtractedRow[] {
  const rows: ExtractedRow[] = [];

  for (const rowMatch of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    const cells: string[] = [];

    for (const cellMatch of rowMatch[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const cellRef = attrs.match(/r="([A-Z]+)\d+"/)?.[1] ?? "";
      const colIndex = columnNameToIndex(cellRef);
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? "";
      const value = readCellValue(body, type, sharedStrings);
      cells[colIndex] = value.trim();
    }

    if (cells.some(Boolean)) rows.push({ sheetName, rowNumber, cells: fillSparseCells(cells) });
  }

  return rows;
}

function readCellValue(body: string, type: string, sharedStrings: string[]) {
  if (type === "inlineStr") {
    return [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
  }

  const value = decodeXml(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "");
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  return value;
}

function columnNameToIndex(columnName: string) {
  if (!columnName) return 0;
  return columnName.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function fillSparseCells(cells: string[]) {
  return Array.from({ length: cells.length }, (_, index) => cells[index] ?? "");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseDelimitedText(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"" && nextChar === "\"" && inQuotes) {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value.trim()));
}
