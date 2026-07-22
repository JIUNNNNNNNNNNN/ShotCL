import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ shared: false, role: null }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ shared: false, role: null }, { status: 401 });
    return NextResponse.json({ shared: true, role: grant.role, projectName: grant.projectName, joinedAt: grant.joinedAt });
  } catch (error) {
    return NextResponse.json({ shared: false, role: null }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
