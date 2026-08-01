function normalizeCutLabelPart(value: unknown, kind: "scene" | "cut") {
  const text = String(value ?? "").trim();
  if (!text) return "-";

  const prefix = kind === "scene"
    ? /^(?:s(?:cene)?|씬)\s*#?\s*/i
    : /^(?:c(?:ut)?|컷)\s*#?\s*/i;
  return text.replace(prefix, "").trim() || "-";
}

/** 진행도 카드에 표시할 씬/컷 번호를 중복 prefix 없이 정리합니다. */
export function formatProgressCutLabel(sceneNumber: unknown, cutNumber: unknown) {
  return `S#${normalizeCutLabelPart(sceneNumber, "scene")} C#${normalizeCutLabelPart(cutNumber, "cut")}`;
}
