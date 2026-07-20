import type { TextQualityResult } from "@/lib/types";

const suspiciousCharacters = new Set(["Ã", "Â", "ä", "å", "ë", "ì", "í", "î", "ï", "ð", "Ð", "Ø", "ç", "¯", "µ", "²", "³", "�"]);
const koreanRegex = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/** 추출된 텍스트가 AI 분석에 넣어도 될 정도로 정상인지 검사합니다. */
export function detectTextCorruption(text: string): TextQualityResult {
  const normalizedText = text.replace(/\s+/g, "");
  const totalLength = normalizedText.length;
  let koreanCharCount = 0;
  let suspiciousCharCount = 0;

  for (const char of normalizedText) {
    if (koreanRegex.test(char)) koreanCharCount += 1;
    if (suspiciousCharacters.has(char) || isSuspiciousControlChar(char)) suspiciousCharCount += 1;
  }

  const koreanRatio = totalLength > 0 ? koreanCharCount / totalLength : 0;
  const suspiciousRatio = totalLength > 0 ? suspiciousCharCount / totalLength : 0;
  const warnings: string[] = [];

  if (totalLength === 0) {
    warnings.push("추출된 텍스트가 없습니다.");
  }

  if (suspiciousRatio >= 0.05) {
    warnings.push("깨진 문자 비율이 높습니다.");
  }

  if (suspiciousCharCount >= 10) {
    warnings.push("깨진 것으로 보이는 문자가 많이 발견됐습니다.");
  }

  if (koreanRatio < 0.01 && suspiciousCharCount >= 5) {
    warnings.push("한글이 거의 없고 깨진 문자가 감지됐습니다.");
  }

  if (text.includes("�")) {
    warnings.push("문자 인코딩 변환 실패 문자가 발견됐습니다.");
  }

  return {
    isLikelyCorrupted: warnings.length > 0,
    koreanCharCount,
    suspiciousCharCount,
    totalLength,
    koreanRatio,
    suspiciousRatio,
    warnings
  };
}

/** CSV/TSV처럼 텍스트 파일일 때 UTF-8과 한국어 인코딩 후보 중 더 정상적인 결과를 고릅니다. */
export function decodeTextBuffer(buffer: Buffer) {
  const candidates = [
    { encoding: "utf-8", text: decodeWithEncoding(buffer, "utf-8") },
    { encoding: "euc-kr", text: decodeWithEncoding(buffer, "euc-kr") },
    { encoding: "windows-949", text: decodeWithEncoding(buffer, "windows-949") }
  ].filter((candidate): candidate is { encoding: string; text: string } => Boolean(candidate.text));

  const scoredCandidates = candidates.map((candidate) => ({
    ...candidate,
    quality: detectTextCorruption(candidate.text)
  }));

  scoredCandidates.sort((a, b) => {
    if (a.quality.isLikelyCorrupted !== b.quality.isLikelyCorrupted) {
      return a.quality.isLikelyCorrupted ? 1 : -1;
    }

    if (a.quality.suspiciousRatio !== b.quality.suspiciousRatio) {
      return a.quality.suspiciousRatio - b.quality.suspiciousRatio;
    }

    return b.quality.koreanRatio - a.quality.koreanRatio;
  });

  return scoredCandidates[0] ?? { encoding: "utf-8", text: buffer.toString("utf8"), quality: detectTextCorruption(buffer.toString("utf8")) };
}

function decodeWithEncoding(buffer: Buffer, encoding: string) {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    return "";
  }
}

function isSuspiciousControlChar(char: string) {
  const code = char.charCodeAt(0);
  return code < 32 && char !== "\n" && char !== "\r" && char !== "\t";
}
