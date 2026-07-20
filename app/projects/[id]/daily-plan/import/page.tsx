"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { saveDailyPlanWithShots } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { downloadStandardDailyPlanTemplate, parseDailyPlanExcel } from "@/lib/dailyPlan/excel";
import type { Project } from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** Excel 일촬표를 웹 편집기용 daily_plan으로 가져옵니다. */
export default function ImportDailyPlanPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then((data) => {
        setProject(data);
        setErrorMessage("");
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !project || !projectId) return;

    setIsImporting(true);
    setMessage("");
    setErrorMessage("");

    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("xlsx 파일만 업로드할 수 있습니다.");
      }

      const parsed = await parseDailyPlanExcel(file, project);
      const saved = await saveDailyPlanWithShots({
        projectId,
        plan: parsed.plan,
        shots: parsed.shots
      });

      setMessage("Excel 파일을 불러왔습니다. 아래 내용을 확인하고 필요한 부분을 수정해주세요.");
      router.push(`/projects/${projectId}/daily-plans/${saved.plan.id}?imported=excel`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Excel 파일을 불러오지 못했습니다.");
    } finally {
      setIsImporting(false);
    }
  }

  if (isLoading) {
    return <Card className="text-field-muted">Excel 업로드 화면을 불러오는 중입니다.</Card>;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <>
      <PageHeader title="Excel 일촬표 업로드" description={project.name} />

      {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
      {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="text-xl font-black text-field-primary">xlsx 파일을 웹 편집기로 가져오기</h2>
          <p className="mt-2 text-base leading-7 text-field-muted">
            Excel 업로드는 최종 결과가 아니라 웹 일촬표 편집기로 가져오는 기능입니다. 업로드 후 반드시 편집기에서 내용을 확인하고 저장하세요.
          </p>

          <label className="mt-6 flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-md bg-field-primary px-4 text-base font-black text-white">
            <UploadCloud className="h-6 w-6" aria-hidden />
            {isImporting ? "Excel 불러오는 중" : "Excel 일촬표 선택"}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={handleFileChange} disabled={isImporting} />
          </label>
        </Card>

        <Card>
          <h2 className="text-lg font-black text-field-primary">표준 양식</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-field-muted">
            이 양식으로 작성한 파일은 다시 업로드했을 때 가장 안정적으로 읽힙니다. 시트명은 “일촬표”입니다.
          </p>
          <Button variant="secondary" onClick={() => downloadStandardDailyPlanTemplate(project)} disabled={isImporting} className="mt-5 w-full">
            <FileSpreadsheet className="h-5 w-5" aria-hidden />
            표준 Excel 양식 다운로드
          </Button>
        </Card>
      </div>
    </>
  );
}
