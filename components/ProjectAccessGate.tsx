"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { SharedProjectRole } from "@/lib/projectAccess/core";

const ProjectAccessContext = createContext<{ role: SharedProjectRole | null; isShared: boolean }>({ role: null, isShared: false });

export function ProjectAccessGate({ projectId, role, children }: { projectId: string; role: SharedProjectRole | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const progressPath = `/projects/${projectId}`;
  const denied = role === "progress" && pathname !== progressPath;

  useEffect(() => {
    if (denied) router.replace(progressPath);
  }, [denied, progressPath, router]);

  if (denied) {
    return (
      <div className="rounded-2xl border border-field-border bg-white p-5 text-center">
        <p className="font-black text-field-primary">관리자 권한이 필요합니다.</p>
        <p className="mt-2 text-sm font-bold text-field-muted">진행도 권한은 컷 진행 화면에서 OK 처리만 할 수 있습니다.</p>
      </div>
    );
  }

  return <ProjectAccessContext.Provider value={{ role, isShared: role !== null }}>{children}</ProjectAccessContext.Provider>;
}

export function useProjectAccess() {
  return useContext(ProjectAccessContext);
}
