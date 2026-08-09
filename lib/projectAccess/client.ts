import type { SharedProjectRole } from "@/lib/projectAccess/core";

export class KeyStaffUpgradeError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 0) {
    super(message);
    this.name = "KeyStaffUpgradeError";
    this.code = code;
    this.status = status;
  }
}

type KeyStaffUpgradeResult = {
  role: Extract<SharedProjectRole, "admin">;
  status: "upgraded" | "already_key_staff";
};

/** 사용자 submit 시에만 현재 프로젝트의 Key staff 승격 API 한 건을 호출합니다. */
export async function upgradeCurrentProjectToKeyStaff(
  projectId: string,
  password: string
): Promise<KeyStaffUpgradeResult> {
  let response: Response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/access`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
  } catch {
    throw new KeyStaffUpgradeError(
      "네트워크 연결을 확인한 뒤 다시 시도해주세요.",
      "PROJECT_ACCESS_NETWORK_ERROR"
    );
  }

  const payload = await readJsonObject(response);
  if (!response.ok) {
    throw new KeyStaffUpgradeError(
      typeof payload?.error === "string" ? payload.error : "권한을 변경하지 못했습니다.",
      typeof payload?.code === "string" ? payload.code : "PROJECT_ACCESS_UPGRADE_FAILED",
      response.status
    );
  }
  if (
    payload?.ok !== true
    || payload.role !== "admin"
    || (payload.status !== "upgraded" && payload.status !== "already_key_staff")
  ) {
    throw new KeyStaffUpgradeError(
      "권한 변경 결과를 확인하지 못했습니다.",
      "PROJECT_ACCESS_RESPONSE_INVALID",
      response.status
    );
  }
  return { role: payload.role, status: payload.status };
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json() as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
