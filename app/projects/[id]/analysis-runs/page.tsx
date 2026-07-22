"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Download, ListChecks, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getProject } from "@/lib/data/projects";
import { listAnalysisRunItems, listAnalysisRuns } from "@/lib/data/analysisRuns";
import type { AnalysisRun, AnalysisRunAction, AnalysisRunItem, Project, ShotDraft } from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

const statusLabels: Record<AnalysisRun["status"], string> = {
  preview: "미리보기",
  confirmed: "확정 완료",
  discarded: "폐기",
  failed: "실패"
};

const actionLabels: Record<AnalysisRunAction, string> = {
  unchanged: "변경 없음",
  edited: "수정됨",
  deleted: "제외됨",
  added: "추가됨"
};

/** AI 분석 기록과 사람이 확정한 최종 결과를 비교해서 보여주는 화면입니다. */
export default function AnalysisRunsPage() {
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [itemsByRunId, setItemsByRunId] = useState<Record<string, AnalysisRunItem[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const projectData = await getProject(projectId);
      setProject(projectData);
      if (!projectData) {
        setRuns([]);
        setItemsByRunId({});
        setErrorMessage("");
        return;
      }
      const runData = await listAnalysisRuns(projectData.id);
      const itemPairs = await Promise.all(
        runData.map(async (run) => {
          const items = await listAnalysisRunItems(run.id).catch(() => []);
          return [run.id, items] as const;
        })
      );

      setRuns(runData);
      setItemsByRunId(Object.fromEntries(itemPairs));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "분석 기록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (isLoading) {
    return <Card className="text-field-muted">분석 기록을 불러오는 중입니다.</Card>;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <>
      <PageHeader
        title="분석 기록"
        description={`${project.name} · AI 원본과 사람이 확정한 최종 결과를 비교합니다.`}
        actions={
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href={`/projects/${project.id}`}
              className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              컷 리스트
            </Link>
            <Link
              href={`/projects/${project.id}/upload`}
              className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
            >
              <Upload className="h-4 w-4" aria-hidden />
              업로드
            </Link>
          </div>
        }
      />

      {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

      {runs.length === 0 ? (
        <Card>
          <h2 className="text-xl font-black text-field-primary">아직 분석 기록이 없습니다</h2>
          <p className="mt-2 text-base leading-6 text-field-muted">업로드 화면에서 파일을 분석하면 이곳에 AI 원본 결과가 기록됩니다.</p>
          <Link
            href={`/projects/${project.id}/upload`}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-primary bg-field-primary px-4 text-sm font-black text-white"
          >
            <Upload className="h-5 w-5" aria-hidden />
            업로드 / 분석으로 이동
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {runs.map((run) => (
            <AnalysisRunCard key={run.id} run={run} items={itemsByRunId[run.id] ?? []} />
          ))}
        </div>
      )}
    </>
  );
}

function AnalysisRunCard({ run, items }: { run: AnalysisRun; items: AnalysisRunItem[] }) {
  const actionCounts = useMemo(
    () =>
      items.reduce<Record<AnalysisRunAction, number>>(
        (acc, item) => {
          acc[item.action] += 1;
          return acc;
        },
        { unchanged: 0, edited: 0, deleted: 0, added: 0 }
      ),
    [items]
  );
  const canExportImprovementData =
    run.status === "confirmed" &&
    run.failureReason !== "encoding_error" &&
    run.failureReason !== "ocr_image_failed" &&
    run.finalConfirmedShots.length > 0;

  function handleExport() {
    if (!canExportImprovementData) {
      return;
    }

    const payload = {
      source_file_name: run.sourceFileName,
      detected_shot_candidate_count: run.detectedShotCandidateCount,
      generated_shot_count: run.generatedShotCount,
      final_shot_count: run.finalShotCount,
      ai_normalized_shots: run.aiNormalizedShots,
      final_confirmed_shots: run.finalConfirmedShots,
      user_feedback: run.userFeedback,
      warnings: run.warnings,
      comparison_items: items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `analysis-run-${run.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-md border border-field-border bg-white p-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-field-border bg-field-soft px-2 py-1 text-xs font-black text-field-primary">{statusLabels[run.status]}</span>
            <span className="text-xs font-bold text-field-muted">{run.analyzerType}</span>
          </div>
          <h2 className="mt-2 break-words text-lg font-black text-field-text">{run.sourceFileName || "파일명 없음"}</h2>
          <p className="mt-1 text-sm font-bold text-field-muted">{formatDate(run.createdAt)}</p>
        </div>
        <Button variant="secondary" onClick={handleExport} disabled={!canExportImprovementData}>
          <Download className="h-5 w-5" aria-hidden />
          개선 데이터 JSON 내보내기
        </Button>
      </div>

      {!canExportImprovementData ? (
        <div className="mt-4 rounded-md border border-field-border bg-field-soft p-3 text-sm font-bold text-field-muted">
          확정된 정상 분석만 개선 데이터 JSON으로 내보낼 수 있습니다. OCR까지 실패했거나 최종 확정 컷이 없는 기록은 제외됩니다.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Stat label="후보 수" value={run.detectedShotCandidateCount} />
        <Stat label="AI 생성" value={run.generatedShotCount} />
        <Stat label="최종 확정" value={run.finalShotCount} />
        <Stat label="경고" value={run.warnings.length} />
      </div>

      {run.warnings.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {run.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-md border border-field-danger bg-white p-3 text-sm font-bold text-field-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <details className="mt-5 rounded-md border border-field-border bg-field-soft p-4">
        <summary className="cursor-pointer text-sm font-black text-field-primary">상세 보기</summary>

        <div className="mt-4 grid gap-4">
          <section>
            <h3 className="text-sm font-black text-field-primary">차이 요약</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {(Object.keys(actionLabels) as AnalysisRunAction[]).map((action) => (
                <Stat key={action} label={actionLabels[action]} value={actionCounts[action]} />
              ))}
            </div>
          </section>

          {run.userFeedback ? (
            <section>
              <h3 className="text-sm font-black text-field-primary">사용자 피드백</h3>
              <p className="mt-2 rounded-md border border-field-border bg-white p-3 text-sm leading-6 text-field-text">{run.userFeedback}</p>
            </section>
          ) : null}

          {run.textQuality ? (
            <section>
              <h3 className="text-sm font-black text-field-primary">텍스트 품질 검사</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <Stat label="한글 비율" value={`${(run.textQuality.koreanRatio * 100).toFixed(1)}%`} />
                <Stat label="깨진 문자 비율" value={`${(run.textQuality.suspiciousRatio * 100).toFixed(1)}%`} />
                <Stat label="한글 글자 수" value={run.textQuality.koreanCharCount} />
                <Stat label="의심 문자 수" value={run.textQuality.suspiciousCharCount} />
              </div>
            </section>
          ) : null}

          <ShotTable title="AI가 처음 만든 결과" shots={run.aiNormalizedShots} />
          <ShotTable title="사람이 수정하고 확정한 최종 결과" shots={run.finalConfirmedShots} />
          <ComparisonTable items={items} />

          {process.env.NODE_ENV !== "production" ? (
            <details className="rounded-md border border-field-border bg-white p-4">
              <summary className="cursor-pointer text-sm font-black text-field-primary">개발자 debug_payload</summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-field-soft p-3 text-xs leading-5 text-field-text">
                {JSON.stringify(run.debugPayload, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-field-border bg-white p-3">
      <p className="text-xs font-bold text-field-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-field-primary">{value}</p>
    </div>
  );
}

function ShotTable({ title, shots }: { title: string; shots: ShotDraft[] }) {
  return (
    <section>
      <h3 className="text-sm font-black text-field-primary">{title}</h3>
      {shots.length === 0 ? (
        <p className="mt-2 rounded-md border border-field-border bg-white p-3 text-sm font-bold text-field-muted">저장된 컷이 없습니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-md border border-field-border bg-white">
          <table className="min-w-[900px] w-full border-collapse text-left text-sm">
            <thead className="bg-field-light text-xs font-black text-field-primary">
              <tr>
                <th className="border-b border-field-border p-3">순서</th>
                <th className="border-b border-field-border p-3">씬</th>
                <th className="border-b border-field-border p-3">컷</th>
                <th className="border-b border-field-border p-3">제목</th>
                <th className="border-b border-field-border p-3">설명</th>
                <th className="border-b border-field-border p-3">장소</th>
                <th className="border-b border-field-border p-3">인물</th>
                <th className="border-b border-field-border p-3">메모</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, index) => (
                <tr key={`${shot.orderIndex}-${index}`}>
                  <td className="border-b border-field-border p-3 font-black text-field-muted">{shot.orderIndex}</td>
                  <td className="border-b border-field-border p-3">{shot.sceneNumber}</td>
                  <td className="border-b border-field-border p-3">{shot.cutNumber}</td>
                  <td className="border-b border-field-border p-3 font-bold">{shot.title}</td>
                  <td className="border-b border-field-border p-3">{shot.description}</td>
                  <td className="border-b border-field-border p-3">{shot.location}</td>
                  <td className="border-b border-field-border p-3">{shot.characters.join(", ")}</td>
                  <td className="border-b border-field-border p-3">{shot.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ComparisonTable({ items }: { items: AnalysisRunItem[] }) {
  return (
    <section>
      <h3 className="text-sm font-black text-field-primary">컷 단위 비교</h3>
      {items.length === 0 ? (
        <p className="mt-2 rounded-md border border-field-border bg-white p-3 text-sm font-bold text-field-muted">아직 컷 단위 비교 기록이 없습니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-md border border-field-border bg-white">
          <table className="min-w-[900px] w-full border-collapse text-left text-sm">
            <thead className="bg-field-light text-xs font-black text-field-primary">
              <tr>
                <th className="border-b border-field-border p-3">판정</th>
                <th className="border-b border-field-border p-3">AI 씬/컷</th>
                <th className="border-b border-field-border p-3">최종 씬/컷</th>
                <th className="border-b border-field-border p-3">AI 제목</th>
                <th className="border-b border-field-border p-3">최종 제목</th>
                <th className="border-b border-field-border p-3">원본 위치</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="border-b border-field-border p-3 font-black text-field-primary">{actionLabels[item.action]}</td>
                  <td className="border-b border-field-border p-3">
                    {item.aiSceneNumber} / {item.aiCutNumber}
                  </td>
                  <td className="border-b border-field-border p-3">
                    {item.finalSceneNumber} / {item.finalCutNumber}
                  </td>
                  <td className="border-b border-field-border p-3">{item.aiTitle}</td>
                  <td className="border-b border-field-border p-3">{item.finalTitle}</td>
                  <td className="border-b border-field-border p-3 text-xs font-bold text-field-muted">
                    {item.sourceSheet ? `${item.sourceSheet} · ` : ""}
                    {item.sourcePage ? `p.${item.sourcePage} · ` : ""}
                    {item.sourceRow ? `row ${item.sourceRow}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}
