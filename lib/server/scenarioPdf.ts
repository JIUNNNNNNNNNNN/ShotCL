import { inflateSync } from "node:zlib";
import { splitScenarioScenesByNumber } from "@/lib/server/scenarioSceneParser";
import type { ProjectScenarioScene } from "@/lib/types";

type PdfObject = {
  id: number;
  body: string;
  stream: Buffer | null;
  order: number;
};

type PageText = {
  page: number;
  text: string;
};

type UnicodeMap = Map<string, string>;

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_STREAM_BYTES = 24 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;

export type ScenarioPdfExtraction = {
  scenes: ProjectScenarioScene[];
  error: string | null;
};

/**
 * 새 런타임 의존성 없이 일반 텍스트 PDF의 content stream과 ToUnicode CMap을 읽습니다.
 * 스캔 PDF나 지원하지 않는 filter는 오류로 돌려 수동 입력 흐름을 사용하게 합니다.
 */
export function extractScenarioScenesFromPdf(buffer: Buffer): ScenarioPdfExtraction {
  try {
    if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES) {
      return failed("PDF 크기가 자동 분석 범위를 벗어났습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }
    if (!buffer.subarray(0, 8).toString("latin1").startsWith("%PDF-")) {
      return failed("올바른 PDF 형식을 확인할 수 없습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }

    const objects = parsePdfObjects(buffer);
    const pages = extractPageTexts(objects);
    const readablePages = pages.filter((page) => countReadableCharacters(page.text) >= 8);
    if (readablePages.length === 0) {
      return failed("텍스트를 추출할 수 없습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }

    const scenes = splitScenarioScenesByNumber(readablePages);
    if (scenes.length === 0) {
      return failed(
        "씬 표기를 찾지 못했습니다. S#1, Scene1, #1, 씬1 같은 표기만 자동 인식합니다. 수동으로 씬을 추가하세요."
      );
    }
    return { scenes, error: null };
  } catch {
    return failed("PDF 텍스트 분석에 실패했습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
  }
}

function failed(error: string): ScenarioPdfExtraction {
  return { scenes: [], error };
}

function parsePdfObjects(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = objectPattern.exec(raw)) && objects.size < 50_000) {
    const id = Number(match[1]);
    const bodyStart = objectPattern.lastIndex;
    const endObject = raw.indexOf("endobj", bodyStart);
    if (endObject < 0) break;
    const completeBody = raw.slice(bodyStart, endObject);
    const streamMarker = completeBody.search(/\bstream(?:\r\n|\n|\r)/);
    let stream: Buffer | null = null;
    let body = completeBody;

    if (streamMarker >= 0) {
      const markerText = completeBody.slice(streamMarker).match(/^stream(?:\r\n|\n|\r)/)?.[0] ?? "";
      const streamStart = bodyStart + streamMarker + markerText.length;
      const endStream = raw.indexOf("endstream", streamStart);
      if (endStream >= 0 && endStream <= endObject) {
        let streamEnd = endStream;
        while (streamEnd > streamStart && (raw[streamEnd - 1] === "\n" || raw[streamEnd - 1] === "\r")) {
          streamEnd -= 1;
        }
        stream = buffer.subarray(streamStart, streamEnd);
        body = completeBody.slice(0, streamMarker);
      }
    }
    objects.set(id, { id, body, stream, order: order++ });
    objectPattern.lastIndex = endObject + "endobj".length;
  }
  return objects;
}

function extractPageTexts(objects: Map<number, PdfObject>): PageText[] {
  const pageObjects = orderedPageObjects(objects);
  const unicodeMaps = new Map<number, UnicodeMap>();
  let totalCharacters = 0;

  return pageObjects.map((pageObject, index) => {
    const resources = findInheritedResources(pageObject, objects);
    const fontMaps = readPageFontMaps(resources, objects, unicodeMaps);
    const contentIds = readReferenceList(pageObject.body, "Contents");
    const chunks: string[] = [];

    contentIds.forEach((contentId) => {
      const contentObject = objects.get(contentId);
      const decoded = contentObject ? decodeStream(contentObject) : null;
      if (!decoded || totalCharacters >= MAX_EXTRACTED_CHARACTERS) return;
      const chunk = extractTextOperators(decoded.toString("latin1"), fontMaps);
      if (!chunk) return;
      totalCharacters += chunk.length;
      chunks.push(chunk.slice(0, Math.max(0, MAX_EXTRACTED_CHARACTERS - totalCharacters + chunk.length)));
    });

    return {
      page: index + 1,
      text: cleanExtractedText(chunks.join("\n"))
    };
  });
}

function orderedPageObjects(objects: Map<number, PdfObject>) {
  const fallback = [...objects.values()]
    .filter((object) => /\/Type\s*\/Page\b/.test(object.body))
    .sort((a, b) => a.order - b.order);
  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog\b/.test(object.body));
  const pagesRoot = catalog ? readSingleReference(catalog.body, "Pages") : null;
  if (!pagesRoot) return fallback;

  const ordered: PdfObject[] = [];
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const object = objects.get(id);
    if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object.body)) {
      ordered.push(object);
      return;
    }
    readReferenceList(object.body, "Kids").forEach(visit);
  };
  visit(pagesRoot);
  return ordered.length > 0 ? ordered : fallback;
}

function findInheritedResources(page: PdfObject, objects: Map<number, PdfObject>) {
  let current: PdfObject | undefined = page;
  const visited = new Set<number>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const resourceId = readSingleReference(current.body, "Resources");
    if (resourceId && objects.has(resourceId)) return objects.get(resourceId)?.body ?? "";
    const inline = current.body.match(/\/Resources\s*<<([\s\S]*?)>>/)?.[1];
    if (inline) return `<<${inline}>>`;
    const parentId = readSingleReference(current.body, "Parent");
    current = parentId ? objects.get(parentId) : undefined;
  }
  return "";
}

function readPageFontMaps(
  resources: string,
  objects: Map<number, PdfObject>,
  cache: Map<number, UnicodeMap>
) {
  const result = new Map<string, UnicodeMap>();
  const fontSection = resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? resources;
  const fontPattern = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  let match: RegExpExecArray | null;
  while ((match = fontPattern.exec(fontSection))) {
    const alias = match[1];
    const fontId = Number(match[2]);
    const font = objects.get(fontId);
    if (!font || !/\/(?:Subtype|Type)\s*\/(?:Type0|Type1|TrueType|Font)\b/.test(font.body)) continue;
    const toUnicodeId = readSingleReference(font.body, "ToUnicode");
    if (!toUnicodeId) continue;
    if (!cache.has(toUnicodeId)) {
      const cmapObject = objects.get(toUnicodeId);
      const cmapStream = cmapObject ? decodeStream(cmapObject) : null;
      cache.set(toUnicodeId, cmapStream ? parseUnicodeCMap(cmapStream.toString("latin1")) : new Map());
    }
    result.set(alias, cache.get(toUnicodeId) ?? new Map());
  }
  return result;
}

function decodeStream(object: PdfObject) {
  if (!object.stream) return null;
  if (!/\/Filter\b/.test(object.body)) return object.stream;
  if (!/\/FlateDecode\b/.test(object.body)) return null;
  try {
    return inflateSync(object.stream, { maxOutputLength: MAX_STREAM_BYTES });
  } catch {
    return null;
  }
}

function parseUnicodeCMap(source: string) {
  const map: UnicodeMap = new Map();
  const bfcharBlocks = source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
  for (const block of bfcharBlocks) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(entry[1].toUpperCase(), decodeUtf16Hex(entry[2]));
    }
  }

  const rangeBlocks = source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
  for (const block of rangeBlocks) {
    const lines = block[1].split(/\r?\n/);
    lines.forEach((line) => {
      const range = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(.*)$/);
      if (!range) return;
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const width = range[1].length;
      const arrayTargets = [...range[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((entry) => entry[1]);
      if (range[3].trim().startsWith("[")) {
        for (let code = start; code <= end && code - start < arrayTargets.length; code += 1) {
          map.set(code.toString(16).toUpperCase().padStart(width, "0"), decodeUtf16Hex(arrayTargets[code - start]));
        }
        return;
      }
      const destination = arrayTargets[0];
      if (!destination) return;
      const destinationValue = Number.parseInt(destination, 16);
      for (let code = start; code <= end && code - start < 10_000; code += 1) {
        const target = (destinationValue + code - start).toString(16).padStart(destination.length, "0");
        map.set(code.toString(16).toUpperCase().padStart(width, "0"), decodeUtf16Hex(target));
      }
    });
  }
  return map;
}

function extractTextOperators(source: string, fontMaps: Map<string, UnicodeMap>) {
  const blocks = source.match(/BT[\s\S]*?ET/g) ?? [];
  const output: string[] = [];
  let activeFont = "";
  const operatorPattern =
    /\/([^\s/<>\[\]()]+)\s+[-+]?\d*\.?\d+\s+Tf|(\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]+>)\s*(Tj|'|")|\[((?:\\[\s\S]|[^\]])*)\]\s*TJ|[-+.\d\s]+(?:Td|TD|Tm)\b|T\*/g;

  blocks.forEach((block) => {
    let match: RegExpExecArray | null;
    while ((match = operatorPattern.exec(block))) {
      if (match[1]) {
        activeFont = match[1];
        continue;
      }
      if (match[2]) {
        appendText(output, decodePdfString(match[2], fontMaps.get(activeFont)));
        if (match[3] === "'" || match[3] === "\"") appendLineBreak(output);
        continue;
      }
      if (match[4] !== undefined) {
        const parts = match[4].match(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]+>|[-+]?\d*\.?\d+/g) ?? [];
        parts.forEach((part) => {
          if (part.startsWith("(") || part.startsWith("<")) {
            appendText(output, decodePdfString(part, fontMaps.get(activeFont)), false);
          } else if (Number(part) < -220) {
            appendText(output, " ");
          }
        });
        continue;
      }
      appendLineBreak(output);
    }
    appendLineBreak(output);
  });
  return output.join("");
}

function decodePdfString(token: string, unicodeMap?: UnicodeMap) {
  const cleanHex = token.startsWith("<") ? token.slice(1, -1).replace(/\s/g, "") : "";
  const bytes = token.startsWith("<")
    ? Buffer.from(cleanHex.padEnd(Math.ceil(cleanHex.length / 2) * 2, "0"), "hex")
    : decodeLiteralString(token.slice(1, -1));
  if (bytes.length === 0) return "";
  const hex = bytes.toString("hex").toUpperCase();
  if (unicodeMap && unicodeMap.size > 0) {
    const lengths = [...new Set([...unicodeMap.keys()].map((key) => key.length))].sort((a, b) => b - a);
    let position = 0;
    let decoded = "";
    while (position < hex.length) {
      const length = lengths.find((candidate) => unicodeMap.has(hex.slice(position, position + candidate)));
      if (length) {
        decoded += unicodeMap.get(hex.slice(position, position + length));
        position += length;
      } else {
        position += 2;
      }
    }
    if (decoded) return decoded;
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Hex(bytes.subarray(2).toString("hex"));
  }
  return bytes.toString("latin1");
}

function decodeLiteralString(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 92) {
      bytes.push(code & 0xff);
      continue;
    }
    const next = value[index + 1];
    if (next === "\r" || next === "\n") {
      if (next === "\r" && value[index + 2] === "\n") index += 1;
      index += 1;
      continue;
    }
    if (/[0-7]/.test(next ?? "")) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    bytes.push(escapes[next] ?? (next?.charCodeAt(0) ?? 92));
    index += 1;
  }
  return Buffer.from(bytes);
}

function decodeUtf16Hex(value: string) {
  const clean = value.replace(/\s/g, "");
  let result = "";
  for (let index = 0; index + 3 < clean.length; index += 4) {
    result += String.fromCharCode(Number.parseInt(clean.slice(index, index + 4), 16));
  }
  return result;
}

function readSingleReference(body: string, key: string) {
  const match = body.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));
  return match ? Number(match[1]) : null;
}

function readReferenceList(body: string, key: string) {
  const array = body.match(new RegExp(`/${key}\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (array) return [...array.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
  const single = readSingleReference(body, key);
  return single ? [single] : [];
}

function appendText(output: string[], value: string, allowWordGap = true) {
  if (!value) return;
  const previous = output.at(-1) ?? "";
  if (value === " " || !previous || /\s$/.test(previous) || /^\s|^[,.;:!?)]/.test(value)) {
    output.push(value);
  } else if (allowWordGap && /[\p{L}\p{N}]$/u.test(previous) && /^[\p{L}\p{N}]/u.test(value)) {
    output.push(" ", value);
  } else {
    output.push(value);
  }
}

function appendLineBreak(output: string[]) {
  if (!output.at(-1)?.endsWith("\n")) output.push("\n");
}

function cleanExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countReadableCharacters(value: string) {
  return (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
