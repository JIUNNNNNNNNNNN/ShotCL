"use client";

import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** 편집 기능은 컷 리스트 카드 모달로 통합되어, 이 페이지는 안내용으로 유지합니다. */
export default function EditShotsPage() {
  const { project, projectId } = useProjectWorkspace();

  return (
    <>
      <PageHeader title="컷 편집" description={project?.name ?? "프로젝트"} />
      <Card>
        <h2 className="text-xl font-black text-field-text">편집 방식이 바뀌었습니다</h2>
        <p className="mt-2 text-base leading-6 text-field-subtle">
          이제 컷 리스트에서 카드를 누르면 수정 bottom sheet가 열립니다. 새 컷은 하단의 “새 컷 추가” 버튼으로 추가합니다.
        </p>
        <ButtonLink href={`/projects/${projectId}`} className="mt-5 w-full">
          <ListChecks className="h-5 w-5" aria-hidden />
          컷 리스트로 이동
        </ButtonLink>
      </Card>
    </>
  );
}
