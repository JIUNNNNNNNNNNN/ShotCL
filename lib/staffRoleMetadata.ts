const staffRoleMetadataStart = "[[TODAY_BOARD_STAFF_ROLE_V1]]";
const staffRoleMetadataEnd = "[[/TODAY_BOARD_STAFF_ROLE_V1]]";

export type ProjectStaffNotes = {
  role: string;
  notes: string;
};

/**
 * 별도 DB 컬럼을 추가하지 않고도 직책과 기존 특이사항을 함께 보존합니다.
 * 메타데이터는 API 경계에서만 다루며 화면에는 노출하지 않습니다.
 */
export function encodeProjectStaffNotes(role: unknown, notes: unknown) {
  const normalizedRole = String(role ?? "").trim().slice(0, 100);
  const normalizedNotes = String(notes ?? "").slice(0, 2000);
  if (!normalizedRole) return normalizedNotes;

  return `${staffRoleMetadataStart}${JSON.stringify({ role: normalizedRole })}${staffRoleMetadataEnd}\n${normalizedNotes}`;
}

export function decodeProjectStaffNotes(value: unknown): ProjectStaffNotes {
  const rawValue = String(value ?? "");
  if (!rawValue.startsWith(staffRoleMetadataStart)) {
    return { role: "", notes: rawValue };
  }

  const metadataEndIndex = rawValue.indexOf(staffRoleMetadataEnd, staffRoleMetadataStart.length);
  if (metadataEndIndex < 0) {
    return { role: "", notes: rawValue };
  }

  const metadataText = rawValue.slice(staffRoleMetadataStart.length, metadataEndIndex);
  const notesStartIndex = metadataEndIndex + staffRoleMetadataEnd.length;
  const notes = rawValue.slice(notesStartIndex).replace(/^\r?\n/, "");

  try {
    const metadata = JSON.parse(metadataText) as { role?: unknown };
    return {
      role: String(metadata.role ?? "").trim().slice(0, 100),
      notes
    };
  } catch {
    return { role: "", notes: rawValue };
  }
}
