import { inflateRawSync, inflateSync } from "node:zlib";
import type { ExtractedDocument } from "@/lib/analyzers/types";

/** PDF에서 텍스트 연산자를 중심으로 줄 텍스트를 추출합니다. OCR/이미지 PDF는 추후 단계에서 다룹니다. */
export function extractPdf(buffer: Buffer, fileName: string, fileType: string): ExtractedDocument {
  const rawLatin = buffer.toString("latin1");
  const streamTexts = extractStreamTexts(rawLatin);
  const directText = extractTextOperators(rawLatin);
  const text = [...streamTexts, ...directText].join("\n");
  const lines = normalizePdfLines(text);
  const warnings: string[] = [];

  if (lines.length === 0) {
    warnings.push("PDF에서 텍스트를 충분히 추출하지 못했습니다. 스캔 이미지 PDF라면 OCR 단계가 필요합니다.");
  }

  return {
    kind: "pdf",
    fileName,
    fileType,
    extractionMethod: "pdf-text-operators",
    sheetNames: [],
    rows: lines.map((line, index) => ({ rowNumber: index + 1, cells: [line] })),
    rawText: lines.join("\n").slice(0, 8000),
    warnings
  };
}

function extractStreamTexts(rawLatin: string) {
  const texts: string[] = [];

  for (const match of rawLatin.matchAll(/<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g)) {
    const dictionary = match[1];
    const streamBody = Buffer.from(match[2], "latin1");
    let decoded = "";

    if (/FlateDecode/.test(dictionary)) {
      try {
        decoded = inflateRawSync(streamBody).toString("latin1");
      } catch {
        try {
          decoded = inflateSync(streamBody).toString("latin1");
        } catch {
          decoded = "";
        }
      }
    } else {
      decoded = streamBody.toString("latin1");
    }

    if (decoded) texts.push(extractTextOperators(decoded).join("\n"));
  }

  return texts.filter(Boolean);
}

function extractTextOperators(pdfText: string) {
  const textParts: string[] = [];

  for (const match of pdfText.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*(?:Tj|'|")/g)) {
    textParts.push(decodePdfLiteral(match[1]));
  }

  for (const match of pdfText.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const pieces = [...match[1].matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)].map((piece) => decodePdfLiteral(piece[1]));
    if (pieces.length > 0) textParts.push(pieces.join(""));
  }

  return textParts;
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .trim();
}

function normalizePdfLines(text: string) {
  return text
    .split(/\r?\n| {2,}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3)
    .filter((line) => !/^page\s*\d+$/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .slice(0, 1000);
}
