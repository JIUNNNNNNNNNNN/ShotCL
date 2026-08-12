import { NextRequest, NextResponse } from "next/server";
import {
  getAccountAccessPreferenceScope,
  getAccessPreferenceScope,
  getSessionToken,
  listAccessGrants,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { resolveShotclAuthenticatedAccount } from "@/lib/projectAccess/accountServer";

export async function GET(request: NextRequest) {
  try {
    const account = await resolveShotclAuthenticatedAccount(request);
    if (account) {
      const supabase = requireProjectAccessDb();
      const { data, error } = await supabase
        .from("project_members")
        .select("role,created_at,projects!inner(id,name,shoot_date,description,created_at,share_enabled)")
        .eq("user_id", account.userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const projects = (data ?? []).flatMap((row) => {
        const relation = row.projects as unknown as Record<string, unknown> | Array<Record<string, unknown>>;
        const project = Array.isArray(relation) ? relation[0] : relation;
        if (!project) return [];
        const membershipRole = String(row.role ?? "");
        const accessRole = account.isEditor && membershipRole === "admin" ? "admin" : "progress";
        return [{ ...project, access_role: accessRole }];
      });
      return NextResponse.json({
        projects,
        preferenceScope: getAccountAccessPreferenceScope(account.userId)
      }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    }

    const rows = await listAccessGrants(request);
    const projects = rows.flatMap((row) => {
      const relation = row.projects as unknown as Record<string, unknown> | Array<Record<string, unknown>>;
      const project = Array.isArray(relation) ? relation[0] : relation;
      if (!project) return [];
      return [{ ...project, access_role: "progress" as const }];
    });
    return NextResponse.json({
      projects,
      preferenceScope: getAccessPreferenceScope(getSessionToken(request))
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
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
