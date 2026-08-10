export type ShootingOrderValue = string | number[] | null | undefined;

export type ShootingOrderValidation = {
  numbers: number[];
  error: string;
};

export const SPLIT_SHOOTING_ORDER_ERROR = "분할 촬영에 선택되지 않은 컷입니다.";
export const SPLIT_SHOT_ALLOCATION_ERROR = "분할 촬영에 배정되지 않은 컷입니다.";

/**
 * 일반 행은 총 Cut 범위만, 분할 촬영 행은 명시적으로 선택한 Cut 집합까지
 * 확인합니다. `allowedCutNumbers === null`은 일반 촬영을 뜻합니다.
 */
export function getShootingOrderValidation(
  value: ShootingOrderValue,
  totalCut: unknown,
  allowedCutNumbers: number[] | null = null
): ShootingOrderValidation {
  const source = (Array.isArray(value) ? value.join(" ") : String(value ?? "")).trim();
  if (!source) return { numbers: [], error: "" };

  const count = parseTotalCutCount(totalCut);
  if (count === 0) {
    return { numbers: parseShootingOrderTokens(source, 0), error: "총 컷수를 먼저 입력해주세요." };
  }
  if (/[^0-9,\-\/\s]/.test(source)) {
    return { numbers: [], error: "촬영 순서는 숫자만 입력해주세요." };
  }

  const numbers = parseShootingOrderTokens(source, count);
  if (numbers.length === 0) {
    return { numbers: [], error: `1부터 ${count}까지의 컷 번호를 입력해주세요.` };
  }

  const outOfRange = numbers.find((cutNumber) => (
    !Number.isInteger(cutNumber) || cutNumber < 1 || cutNumber > count
  ));
  if (outOfRange !== undefined) {
    return {
      numbers,
      error: `${outOfRange}은(는) 총 컷수 ${count}의 범위를 벗어납니다.`
    };
  }

  const duplicate = numbers.find((cutNumber, index) => numbers.indexOf(cutNumber) !== index);
  if (duplicate !== undefined) {
    return { numbers, error: `컷 ${duplicate}이(가) 중복되었습니다.` };
  }

  if (allowedCutNumbers !== null) {
    const allowed = new Set(normalizeAllowedCutNumbers(allowedCutNumbers, count));
    if (numbers.some((cutNumber) => !allowed.has(cutNumber))) {
      return { numbers, error: SPLIT_SHOOTING_ORDER_ERROR };
    }
  }

  return { numbers, error: "" };
}

export function normalizeShootingOrder(
  value: ShootingOrderValue,
  totalCut: unknown,
  allowedCutNumbers: number[] | null = null
) {
  const validation = getShootingOrderValidation(value, totalCut, allowedCutNumbers);
  return validation.error ? "" : validation.numbers.join("-");
}

export function formatShootingOrderForDraft(
  value: ShootingOrderValue,
  totalCut: unknown,
  allowedCutNumbers: number[] | null = null
) {
  const validation = getShootingOrderValidation(value, totalCut, allowedCutNumbers);
  return validation.error
    ? formatRawShootingOrder(value, " ")
    : validation.numbers.join(" ");
}

/** 미리보기/PDF에는 검증을 통과한 촬영 순서만 전달합니다. */
export function formatShootingOrderForOutput(
  value: ShootingOrderValue,
  totalCut: unknown,
  allowedCutNumbers: number[] | null = null
) {
  const validation = getShootingOrderValidation(value, totalCut, allowedCutNumbers);
  return validation.error ? "" : validation.numbers.join("-");
}

export function sanitizeShootingOrderInput(value: string) {
  const allowed = value.replace(/[^0-9,\-\/\s]/g, "");
  const hasTrailingSeparator = /[-,/\s]$/.test(allowed);
  const normalized = allowed
    .split(/[-,/\s]+/)
    .filter(Boolean)
    .join(" ");
  return hasTrailingSeparator && normalized ? `${normalized} ` : normalized;
}

/** 현재 순서를 유지하면서 이 행에 배정된 Cut만 뒤에 보충합니다. */
export function appendRemainingShootingOrderCuts(
  value: ShootingOrderValue,
  totalCut: unknown,
  allowedCutNumbers: number[] | null = null
): ShootingOrderValidation {
  const validation = getShootingOrderValidation(value, totalCut, allowedCutNumbers);
  if (validation.error) return validation;

  const totalCutCount = parseTotalCutCount(totalCut);
  const availableNumbers = allowedCutNumbers === null
    ? Array.from({ length: totalCutCount }, (_, index) => index + 1)
    : normalizeAllowedCutNumbers(allowedCutNumbers, totalCutCount);
  const usedNumbers = new Set(validation.numbers);
  return {
    numbers: [
      ...validation.numbers,
      ...availableNumbers.filter((cutNumber) => !usedNumbers.has(cutNumber))
    ],
    error: ""
  };
}

/**
 * 숫자를 한 글자씩 입력하는 동안에는 마지막 Cut token이 선택 번호의 prefix면
 * 유지합니다. 예를 들어 [12, 15]에서는 `1`을 허용하지만 [1, 3]에서 `2`는
 * 즉시 거부합니다. paste/완료는 이 helper가 아니라 최종 validation을 씁니다.
 */
export function isShootingOrderDraftAllowed(
  value: string,
  totalCut: unknown,
  allowedCutNumbers: number[] | null
) {
  if (allowedCutNumbers === null) return true;
  const source = value.trim();
  if (!source) return true;
  if (/[^0-9,\-\/\s]/.test(value)) return false;

  const allowed = normalizeAllowedCutNumbers(allowedCutNumbers, parseTotalCutCount(totalCut));
  if (allowed.length === 0) return false;
  const allowedText = allowed.map(String);
  const hasSeparator = /[-,/\s]/.test(value);

  if (hasSeparator) {
    const hasTrailingSeparator = /[-,/\s]$/.test(value);
    const tokens = value.split(/[-,/\s]+/).filter(Boolean);
    const used = new Set<number>();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const isLastIncompleteToken = index === tokens.length - 1 && !hasTrailingSeparator;
      const exact = Number(token);
      if (allowed.includes(exact) && !used.has(exact)) {
        used.add(exact);
        continue;
      }
      if (
        isLastIncompleteToken
        && allowedText.some((candidate, candidateIndex) => (
          candidate.startsWith(token) && !used.has(allowed[candidateIndex])
        ))
      ) return true;
      return false;
    }
    return true;
  }

  if (!getShootingOrderValidation(value, totalCut, allowedCutNumbers).error) return true;

  // 구분자가 없는 기존 compact 입력은 canonical(total 기반 greedy) parser와
  // 동일하게 해석해야 합니다. 현재 문자열의 마지막 일부를 한 Cut 번호로
  // 완성했을 때 실제 validation을 통과하는 경우에만 transient prefix입니다.
  return allowedText.some((candidate) => {
    for (let prefixLength = 1; prefixLength < candidate.length; prefixLength += 1) {
      const prefix = candidate.slice(0, prefixLength);
      if (!value.endsWith(prefix)) continue;
      const completed = `${value}${candidate.slice(prefixLength)}`;
      if (!getShootingOrderValidation(completed, totalCut, allowedCutNumbers).error) return true;
    }
    return false;
  });
}

/**
 * selector에서 Cut을 해제하기 전에, 현재 촬영 순서가 참조하는 Cut이
 * 사라지는지 확인합니다. 선택 배열 순서는 촬영 순서로 강제하지 않습니다.
 */
export function getShootingOrderCutsMissingFromSelection(
  shootingOrder: ShootingOrderValue,
  totalCut: unknown,
  nextSelectedCutNumbers: number[]
) {
  const parsed = getShootingOrderValidation(shootingOrder, totalCut);
  const selected = new Set(normalizeAllowedCutNumbers(nextSelectedCutNumbers, parseTotalCutCount(totalCut)));
  return parsed.numbers.filter((cutNumber) => !selected.has(cutNumber));
}

/**
 * API 저장 직전에도 일촬표 memo 안의 row snapshot을 검사합니다. 추가 조회 없이
 * 요청 payload만 사용하며, legacy 일반 행(프로퍼티 없음)은 건드리지 않습니다.
 */
export function getSplitShootingOrderSaveError(timetableScenes: unknown): string {
  if (!Array.isArray(timetableScenes)) return "";

  for (let index = 0; index < timetableScenes.length; index += 1) {
    const scene = timetableScenes[index];
    if (!isRecord(scene) || !Object.prototype.hasOwnProperty.call(scene, "selectedCutNumbers")) continue;
    if (!Array.isArray(scene.selectedCutNumbers) || !isRecord(scene.rowSnapshot)) continue;

    const validation = getShootingOrderValidation(
      scene.rowSnapshot.shootingOrder as ShootingOrderValue,
      scene.rowSnapshot.totalCuts,
      scene.selectedCutNumbers.map(Number)
    );
    if (!validation.error) continue;

    const sceneNumber = String(scene.rowSnapshot.sceneNumber ?? "").trim();
    const label = sceneNumber ? `S#${sceneNumber}` : `촬영 행 ${index + 1}`;
    return `${label} 촬영 순서: ${validation.error}`;
  }

  return "";
}

/**
 * 전송된 shot 목록이 명시적인 분할 배정을 확장하지 않는지 검사합니다.
 * 같은 Scene에 일반 촬영 행이 하나라도 있으면 그 Scene은 기존 전체-Cut
 * semantics를 유지하고, 분할 행만 있는 Scene은 선택 배열의 합집합만 허용합니다.
 */
export function getSplitShotAllocationSaveError(
  timetableScenes: unknown,
  shots: unknown
): string {
  if (!Array.isArray(timetableScenes) || !Array.isArray(shots)) return "";

  const allocations = new Map<string, { label: string; unrestricted: boolean; cuts: Set<number> }>();
  timetableScenes.forEach((scene) => {
    if (!isRecord(scene) || !isRecord(scene.rowSnapshot)) return;
    const sceneNumber = normalizeSceneNumber(scene.rowSnapshot.sceneNumber);
    if (!sceneNumber) return;
    const current = allocations.get(sceneNumber) ?? {
      label: String(scene.rowSnapshot.sceneNumber ?? "").trim() || sceneNumber,
      unrestricted: false,
      cuts: new Set<number>()
    };
    if (!Object.prototype.hasOwnProperty.call(scene, "selectedCutNumbers")) {
      current.unrestricted = true;
    } else if (Array.isArray(scene.selectedCutNumbers)) {
      const totalCuts = parseTotalCutCount(scene.rowSnapshot.totalCuts);
      normalizeSubmittedCutNumbers(scene.selectedCutNumbers, totalCuts)
        .forEach((cutNumber) => current.cuts.add(cutNumber));
    }
    allocations.set(sceneNumber, current);
  });

  for (const shot of shots) {
    if (!isRecord(shot)) continue;
    const allocation = allocations.get(normalizeSceneNumber(shot.sceneNumber));
    if (!allocation || allocation.unrestricted) continue;
    const cutLabel = String(shot.cutNumber ?? "").trim();
    const cutNumber = Number(cutLabel);
    if (!Number.isInteger(cutNumber) || !allocation.cuts.has(cutNumber)) {
      return `S#${allocation.label} Cut ${cutLabel || "?"}: ${SPLIT_SHOT_ALLOCATION_ERROR}`;
    }
  }

  return "";
}

function formatRawShootingOrder(value: ShootingOrderValue, separator: "-" | " ") {
  const source = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return source
    .replace(/[^0-9,\-\/\s]/g, "")
    .split(/[-,/\s]+/)
    .filter(Boolean)
    .join(separator);
}

function parseShootingOrderTokens(value: string, totalCut: number) {
  const hasSeparator = /[-,/\s]/.test(value);
  if (hasSeparator) {
    return value.split(/[-,/\s]+/).filter(Boolean).map(Number);
  }
  if (totalCut <= 0) {
    return /^\d+$/.test(value) ? [Number(value)] : [];
  }
  return parseCompactShootingOrder(value, totalCut);
}

function parseCompactShootingOrder(value: string, totalCut: number) {
  const memo = new Map<number, number[] | null>();
  const maxTokenLength = String(totalCut).length;

  function parseFrom(index: number): number[] | null {
    if (index === value.length) return [];
    if (memo.has(index)) return memo.get(index) ?? null;

    for (let length = Math.min(maxTokenLength, value.length - index); length >= 1; length -= 1) {
      const token = value.slice(index, index + length);
      if (token.startsWith("0")) continue;
      const cutNumber = Number(token);
      if (cutNumber < 1 || cutNumber > totalCut) continue;
      const remainder = parseFrom(index + length);
      if (remainder) {
        const result = [cutNumber, ...remainder];
        memo.set(index, result);
        return result;
      }
    }

    memo.set(index, null);
    return null;
  }

  return parseFrom(0) ?? [];
}

function parseTotalCutCount(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeAllowedCutNumbers(value: number[], totalCut: number) {
  return Array.from(new Set(value))
    .filter((cutNumber) => Number.isInteger(cutNumber) && cutNumber >= 1 && cutNumber <= totalCut)
    .sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSceneNumber(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^S#?\s*/i, "")
    .toLocaleLowerCase("ko-KR");
}

function normalizeSubmittedCutNumbers(value: unknown[], totalCut: number) {
  return Array.from(new Set(value.map(Number)))
    .filter((cutNumber) => (
      Number.isInteger(cutNumber)
      && cutNumber >= 1
      && (totalCut === 0 || cutNumber <= totalCut)
    ))
    .sort((left, right) => left - right);
}
