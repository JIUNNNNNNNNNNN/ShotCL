import { NextRequest, NextResponse } from "next/server";
import {
  getAccessPreferenceScope,
  getSessionToken,
  listAccessGrants,
  ProjectAccessUnavailableError
} from "@/lib/projectAccess/server";

export async function GET(request: NextRequest) {
  try {
    const rows = await listAccessGrants(request);
    const projects = rows.flatMap((row) => {
      const relation = row.projects as unknown as Record<string, unknown> | Array<Record<string, unknown>>;
      const project = Array.isArray(relation) ? relation[0] : relation;
      if (!project || (row.role !== "admin" && row.role !== "progress")) return [];
      return [{ ...project, access_role: row.role }];
    });
    return NextResponse.json({
      projects,
      preferenceScope: getAccessPreferenceScope(getSessionToken(request))
    });
  } catch (error) {
    return NextResponse.json(
      {
        projects: [],
        preferenceScope: "",
        error: error instanceof ProjectAccessUnavailableError
          ? error.message
          : "접근 프로젝트를 불러오지 못했습니다."
      },
      { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 }
    );
  }
}
