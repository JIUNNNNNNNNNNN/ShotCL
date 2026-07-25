"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RightProjectSidebar } from "@/components/RightProjectSidebar";
import type { SharedProjectRole } from "@/lib/projectAccess/core";

const ProjectAccessContext = createContext<{ role: SharedProjectRole | null; isShared: boolean }>({
  role: null,
  isShared: false
});

export function ProjectAccessGate({
  projectId,
  projectName,
  role,
  children
}: {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const progressPath = `/projects/${projectId}`;
  const progressReadablePaths = new Set([
    progressPath,
    `${progressPath}/scene-list`,
    `${progressPath}/scenario`,
    `${progressPath}/costumes`,
    `${progressPath}/storyboard-overhead`
  ]);
  const denied = role === "progress" && !progressReadablePaths.has(pathname);

  useEffect(() => {
    if (denied) router.replace(progressPath);
  }, [denied, progressPath, router]);

  if (denied) {
    return (
      <div className="rounded-2xl border border-field-border bg-white p-5 text-center">
        <p className="font-black text-field-primary">Key staff 권한이 필요합니다.</p>
        <p className="mt-2 text-sm font-bold text-field-muted">Staff 권한은 진행도와 프로젝트 자료를 읽기 전용으로 이용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <ProjectAccessContext.Provider value={{ role, isShared: role !== null }}>
      <div className="min-w-0">
        <div className="min-w-0">{children}</div>
        <RightProjectSidebar
          projectId={projectId}
          projectName={projectName}
          role={role}
        />
      </div>
    </ProjectAccessContext.Provider>
  );
}

export function useProjectAccess() {
  return useContext(ProjectAccessContext);
}
