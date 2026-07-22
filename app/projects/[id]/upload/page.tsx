"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Bot, Camera, FileUp, History, ListChecks, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { AnalysisPreview } from "@/components/AnalysisPreview";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { confirmAnalysisRun, createAnalysisRun, discardAnalysisRun, saveAnalysisRunFeedback } from "@/lib/data/analysisRuns";
import { createShotsFromDrafts, deleteAllShots, listShots } from "@/lib/data/shots";
import { listDailyPlans } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { deleteStoryboardFile, listStoryboardFiles, saveStoryboardFile } from "@/lib/data/storyboardFiles";
import { ensureSupabaseDevSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AnalysisReviewedShot, DailyPlan, ExtractionPreview, Project, ShotDraft, StoryboardAnalysisResult, StoryboardFile } from "@/lib/types";

type LastAnalysis = {
  analysisRunId: string | null;
  fileId: string;
  fileName: string;
  fileType: string;
  sourceFileUrl: string | null;
  result: StoryboardAnalysisResult;
} | null;

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

function formatFileSize(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isPdfFile(file: StoryboardFile) {
  return file.fileType === "application/pdf" || file.fileName.toLowerCase().endsWith(".pdf");
}

/** 스토리보드/일일촬영계획서 업로드와 컷 단위 분석을 처리합니다. */
export default function UploadStoryboardPage() {
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlans, setDailyPlans] = useState<Array<DailyPlan & { shotCount: number }>>([]);
  const [selectedDailyPlanId, setSelectedDailyPlanId] = useState(searchParams.get("dailyPlanId") ?? "");
  const [files, setFiles] = useState<StoryboardFile[]>([]);
  const [selectedFilesById, setSelectedFilesById] = useState<Record<string, File>>({});
  const [existingShotCount, setExistingShotCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<LastAnalysis | null>(null);
  const [lastExtractionPreview, setLastExtractionPreview] = useState<ExtractionPreview | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const [projectData, fileData, planData] = await Promise.all([getProject(projectId), listStoryboardFiles(projectId), listDailyPlans(projectId)]);
      const nextDailyPlanId = planData.some((plan) => plan.id === selectedDailyPlanId) ? selectedDailyPlanId : planData[0]?.id ?? "";
      const shotData = nextDailyPlanId ? await listShots(projectId, nextDailyPlanId) : [];
      setProject(projectData);
      setFiles(fileData);
      setDailyPlans(planData);
      setSelectedDailyPlanId(nextDailyPlanId);
      setExistingShotCount(shotData.length);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "업로드 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, selectedDailyPlanId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !projectId) return;

    setErrorMessage("");
    setMessage("");
    setBusyFileId("uploading");
    setLastExtractionPreview(null);

    try {
      const savedFile = await saveStoryboardFile(projectId, file);
      setSelectedFilesById((current) => ({ ...current, [savedFile.id]: file }));
      setMessage("파일을 업로드했습니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "파일 업로드에 실패했습니다.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleAnalyze(file: StoryboardFile) {
    if (!projectId) return;

    setBusyFileId(file.id);
    setErrorMessage("");
    setMessage("");
    setLastAnalysis(null);
    setLastExtractionPreview(null);

    try {
      const sourceFile = selectedFilesById[file.id];
      if (!sourceFile) {
        throw new Error("분석할 원본 파일이 브라우저에 남아 있지 않습니다. 파일을 다시 선택한 뒤 분석해주세요.");
      }

      if (isPdfFile(file)) {
        setMessage("PDF 내부 텍스트 추출 중입니다. 이어서 PDF 텍스트 품질을 확인하고, 필요하면 PDF 페이지를 이미지로 변환해 OCR/이미지 분석으로 전환합니다.");
      }

      const formData = new FormData();
      formData.append("file", sourceFile);
      formData.append("fileId", file.id);
      formData.append("fileName", file.fileName);
      formData.append("sourceFileUrl", file.storagePath);
      formData.append("projectName", project?.name ?? "");
      formData.append("shootDate", project?.shootDate ?? "");
      const headers = await getAnalyzeRequestHeaders();

      const response = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "POST",
        headers,
        body: formData
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: string;
          extractionPreview?: ExtractionPreview;
          analysisRunId?: string | null;
          textQuality?: ExtractionPreview["textQuality"];
          warnings?: string[];
        } | null;

        if (errorBody?.extractionPreview) {
          setLastExtractionPreview(errorBody.extractionPreview);
          await ensureFailedAnalysisRunRecord(errorBody, file);
        }

        throw new Error(errorBody?.error || "AI 분석 요청에 실패했습니다.");
      }

      const result = (await response.json()) as StoryboardAnalysisResult;
      const analysisRunId = await ensureAnalysisRunRecord(result, file);
      setLastAnalysis({ analysisRunId, fileId: file.id, fileName: file.fileName, fileType: file.fileType, sourceFileUrl: file.storagePath, result });
      setLastExtractionPreview(result.extractionPreview ?? null);
      setMessage(
        result.analysisRunPersistenceWarning
          ? `분석 결과를 미리보기로 불러왔습니다. 다만 ${result.analysisRunPersistenceWarning}`
          : result.extractionPreview?.extractionMethod === "ocr_image" && result.extractionPreview.ocrSucceeded
            ? "PDF 내부 텍스트는 깨졌지만, OCR 결과는 정상 한글로 추출되었습니다. 분석 결과를 미리보기로 불러왔습니다."
          : result.extractionPreview?.extractionMethod === "vision_image"
            ? "PDF 내부 텍스트와 OCR 결과가 충분하지 않아 이미지 기반 비전 분석으로 전환했습니다. 분석 결과를 미리보기로 불러왔습니다."
          : result.extractionPreview?.usedFallback
            ? "PDF fallback 분석 결과를 미리보기로 불러왔습니다. 품질 정보를 확인한 뒤 컷 리스트에 반영해주세요."
          : "분석 결과를 미리보기로 불러왔습니다. 확인 후 컷 리스트에 반영해주세요."
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 분석에 실패했습니다.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleSaveAnalysisFeedback(userFeedback: string) {
    if (!projectId || !lastAnalysis?.analysisRunId) {
      throw new Error("분석 기록 ID가 없어 피드백을 저장할 수 없습니다. 파일을 다시 분석한 뒤 저장해주세요.");
    }

    await saveAnalysisRunFeedback({
      analysisRunId: lastAnalysis.analysisRunId,
      projectId,
      userFeedback
    });
  }

  async function handleImportAnalysis(
    mode: "append" | "replace",
    payload: {
      finalShots: ShotDraft[];
      reviewedShots: AnalysisReviewedShot[];
      userFeedback: string;
    }
  ) {
    if (!projectId || !lastAnalysis) return;
    if (!selectedDailyPlanId) {
      setErrorMessage("먼저 컷을 반영할 회차를 선택하세요.");
      return;
    }

    setBusyFileId("importing");
    setErrorMessage("");
    setMessage("");

    try {
      const finalShots = payload.finalShots.map((shot) => ({
        ...shot,
        analysisRunId: lastAnalysis.analysisRunId,
        sourceFileId: lastAnalysis.fileId
      }));
      const reviewedShots = payload.reviewedShots.map((shot) => ({
        ...shot,
        analysisRunId: lastAnalysis.analysisRunId,
        sourceFileId: lastAnalysis.fileId
      }));

      if (mode === "replace") {
        await deleteAllShots(projectId, selectedDailyPlanId);
      }

      await createShotsFromDrafts(projectId, finalShots, selectedDailyPlanId);

      if (lastAnalysis.analysisRunId) {
        await confirmAnalysisRun({
          analysisRunId: lastAnalysis.analysisRunId,
          projectId,
          aiShots: lastAnalysis.result.shots,
          reviewedShots,
          finalShots,
          userFeedback: payload.userFeedback
        });
      }

      setLastAnalysis(null);
      setLastExtractionPreview(null);
      setMessage(`${mode === "replace" ? "기존 컷을 교체하고" : "기존 컷 뒤에"} ${finalShots.length}개 컷을 반영했습니다.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "분석 결과를 컷 리스트에 반영하지 못했습니다.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleDeleteFile(file: StoryboardFile) {
    const shouldDelete = window.confirm(`"${file.fileName}" 파일을 삭제할까요?`);
    if (!shouldDelete) return;

    setBusyFileId(file.id);
    setErrorMessage("");
    setMessage("");

    try {
      await deleteStoryboardFile(file);
      setMessage("파일을 삭제했습니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "파일을 삭제하지 못했습니다.");
    } finally {
      setBusyFileId(null);
    }
  }

  function handleResetAnalysisPreview() {
    if (lastAnalysis?.analysisRunId && projectId) {
      discardAnalysisRun(lastAnalysis.analysisRunId, projectId).catch(() => undefined);
    }
    setLastAnalysis(null);
    setLastExtractionPreview(null);
    setErrorMessage("");
    setMessage("분석 미리보기를 초기화했습니다. 저장된 컷 목록은 변경하지 않았습니다.");
  }

  async function handleCancelAnalysisPreview() {
    if (lastAnalysis?.analysisRunId && projectId) {
      await discardAnalysisRun(lastAnalysis.analysisRunId, projectId).catch(() => undefined);
    }

    setLastAnalysis(null);
    setLastExtractionPreview(null);
    setMessage("분석 결과 반영을 취소했습니다.");
  }

  async function getAnalyzeRequestHeaders(): Promise<HeadersInit> {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return {};

    await ensureSupabaseDevSession();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }

  async function ensureAnalysisRunRecord(result: StoryboardAnalysisResult, file: StoryboardFile) {
    if (!projectId) {
      return null;
    }

    if (result.analysisRunId) {
      return result.analysisRunId;
    }

    try {
      const run = await createAnalysisRun({
        projectId,
        sourceFileName: file.fileName,
        sourceFileType: file.fileType || "unknown",
        sourceFileUrl: file.storagePath,
        analyzerType: result.analyzerType || result.source || "mock",
        detectedRowCount: result.summary.detectedRowCount,
        detectedShotCandidateCount: result.summary.detectedShotCandidateCount ?? result.summary.detectedCandidateCount,
        generatedShotCount: result.summary.generatedShotCount,
        aiRawResult: result,
        aiNormalizedShots: result.shots,
        warnings: result.summary.warnings ?? (result.warning ? [result.warning] : []),
        debugPayload: result.debug,
        textQuality: result.textQuality ?? null,
        isTextCorrupted: Boolean(result.isTextCorrupted),
        failureReason: result.failureReason ?? ""
      });

      return run.id;
    } catch (error) {
      setErrorMessage(error instanceof Error ? `분석 기록을 저장하지 못했습니다. Supabase SQL 실행이 필요할 수 있습니다. (${error.message})` : "분석 기록을 저장하지 못했습니다.");
      return null;
    }
  }

  async function ensureFailedAnalysisRunRecord(
    errorBody: {
      extractionPreview?: ExtractionPreview;
      analysisRunId?: string | null;
      textQuality?: ExtractionPreview["textQuality"];
      warnings?: string[];
    },
    file: StoryboardFile
  ) {
    if (!projectId || errorBody.analysisRunId) {
      return;
    }

    try {
      await createAnalysisRun({
        projectId,
        sourceFileName: file.fileName,
        sourceFileType: file.fileType || "unknown",
        sourceFileUrl: file.storagePath,
        analyzerType: "encoding-check",
        status: "failed",
        detectedRowCount: 0,
        detectedShotCandidateCount: 0,
        generatedShotCount: 0,
        finalShotCount: 0,
        aiRawResult: null,
        aiNormalizedShots: [],
        finalConfirmedShots: [],
        warnings: errorBody.warnings ?? ["encoding_error"],
        debugPayload: {
          extractionPreview: errorBody.extractionPreview,
          textQuality: errorBody.textQuality
        },
        textQuality: errorBody.textQuality ?? errorBody.extractionPreview?.textQuality ?? null,
        isTextCorrupted: true,
        failureReason: "encoding_error"
      });
    } catch {
      // 실패 기록 저장이 막혀도 사용자에게 인코딩 경고를 보여주는 흐름은 유지합니다.
    }
  }

  if (isLoading) {
    return <Card className="text-field-muted">업로드 화면을 불러오는 중입니다.</Card>;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">프로젝트를 찾을 수 없습니다.</Card>;
  }

  return (
    <>
      <PageHeader
        title="문서 업로드 / 분석"
        description={project.name}
        actions={
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href={`/projects/${project.id}${selectedDailyPlanId ? `?dailyPlanId=${encodeURIComponent(selectedDailyPlanId)}` : ""}`}
              className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              컷 리스트
            </Link>
            <Link
              href={`/projects/${project.id}/analysis-runs`}
              className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
            >
              <History className="h-4 w-4" aria-hidden />
              분석 기록
            </Link>
          </div>
        }
      />

      <div className="mb-4 rounded-[1.25rem] border border-field-border bg-white p-3 text-sm font-bold leading-6 text-field-muted">
        일촬표 데이터는 웹 편집기에서 관리해주세요. PDF·이미지 분석은 외부에서 자료만 받은 경우에 사용하는 보조 기능입니다.
      </div>

      <label className="mb-4 grid gap-2 rounded-md border border-field-border bg-white p-4 text-sm font-black text-field-primary">
        컷을 반영할 회차
        <select className="min-h-11 rounded-md border border-field-border bg-white px-3 text-center" value={selectedDailyPlanId} onChange={(event) => setSelectedDailyPlanId(event.target.value)}>
          <option value="">회차 선택</option>
          {dailyPlans.map((plan, index) => <option key={plan.id} value={plan.id}>{plan.episode ? `${plan.episode}${plan.episode.includes("회차") ? "" : "회차"}` : plan.shootingDate || `${index + 1}회차`}</option>)}
        </select>
      </label>

      {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
      {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

      {lastExtractionPreview ? <ExtractionPreviewCard preview={lastExtractionPreview} /> : null}

      <Card>
        <div className="grid gap-3">
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-field-primary px-4 font-black text-white">
            <FileUp className="h-5 w-5" aria-hidden />
            PDF / 이미지 선택
            <input
              type="file"
              accept="application/pdf,.pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
              className="sr-only"
              onChange={handleFileChange}
              disabled={busyFileId !== null}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-field-border bg-white px-3 text-sm font-black text-field-primary">
              <Camera className="h-4 w-4" aria-hidden />
              촬영
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} disabled={busyFileId !== null} />
            </label>

            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-field-border bg-white px-3 text-sm font-black text-field-primary">
              <UploadCloud className="h-4 w-4" aria-hidden />
              앨범
              <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} disabled={busyFileId !== null} />
            </label>
          </div>
        </div>
      </Card>

      <section className="mt-5">
        <h2 className="mb-3 text-lg font-black text-field-primary">업로드된 파일</h2>

        {files.length === 0 ? (
          <Card className="text-field-muted">아직 업로드된 파일이 없습니다.</Card>
        ) : (
          <div className="grid gap-3">
            {files.map((file) => (
              <Card key={file.id}>
                <div className="min-w-0">
                  <h3 className="break-words text-base font-black text-field-text">{file.fileName}</h3>
                  <p className="mt-1 text-sm font-bold text-field-muted">
                    {formatFileSize(file.fileSize)} · {file.fileType || "unknown"} · {new Date(file.createdAt).toLocaleString("ko-KR")}
                  </p>
                  <p className="mt-2 text-xs font-bold text-field-secondary">
                    분석 상태: {selectedFilesById[file.id] ? "원본 준비됨" : "재분석하려면 파일을 다시 선택해주세요"}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <Button onClick={() => handleAnalyze(file)} disabled={busyFileId !== null} className="w-full">
                    <Bot className="h-5 w-5" aria-hidden />
                    {busyFileId === file.id ? "분석 중" : "컷 단위 분석"}
                  </Button>
                  <Button variant="danger" onClick={() => handleDeleteFile(file)} disabled={busyFileId !== null} className="px-3">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {lastAnalysis ? (
        <AnalysisPreview
          analysis={{ ...lastAnalysis.result, fileName: lastAnalysis.fileName, fileType: lastAnalysis.fileType }}
          existingShotCount={existingShotCount}
          isSaving={busyFileId === "importing"}
          onCancel={handleCancelAnalysisPreview}
          onSaveFeedback={handleSaveAnalysisFeedback}
          onImport={handleImportAnalysis}
        />
      ) : null}

      {process.env.NODE_ENV !== "production" && lastAnalysis ? (
        <section className="mt-5 rounded-md border border-field-border bg-white p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-base font-black text-field-primary">개발용 초기화</h2>
              <p className="mt-1 text-sm font-bold leading-6 text-field-muted">
                분석 미리보기만 지웁니다. 이미 저장된 컷 목록과 프로젝트 정보는 삭제하지 않습니다.
              </p>
            </div>
            <Button variant="secondary" onClick={handleResetAnalysisPreview} disabled={busyFileId !== null}>
              <RotateCcw className="h-5 w-5" aria-hidden />
              분석 미리보기 초기화
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}

function ExtractionPreviewCard({ preview }: { preview: ExtractionPreview }) {
  const nativeQuality = preview.nativeTextQuality ?? preview.textQuality;
  const ocrQuality = preview.ocrTextQuality ?? null;
  const finalQuality = preview.textQuality;
  const hasVisionDebug = Boolean(preview.visionRequestSent || preview.visionModelUsed || preview.extractionMethod === "vision_image" || preview.extractionMethod === "manual_review");
  const visionResultLabel = preview.visionSucceeded ? "성공" : preview.visionRequestSent ? "실패" : "요청 안 됨";
  const finalStatusLabel =
    preview.extractionMethod === "ocr_image"
      ? "OCR 이미지 분석"
      : preview.extractionMethod === "vision_image"
        ? "비전 이미지 분석"
        : preview.extractionMethod === "manual_review"
          ? "수동 검토 필요"
          : preview.extractionMethod;
  const successMessage =
    preview.extractionMethod === "ocr_image" && preview.ocrSucceeded
      ? "PDF 내부 텍스트는 깨졌지만, OCR 결과는 정상 한글로 추출되었습니다."
      : preview.extractionMethod === "vision_image"
        ? "PDF 내부 텍스트와 OCR 결과가 충분하지 않아 이미지 기반 비전 분석으로 전환했습니다."
        : preview.extractionMethod === "manual_review" && preview.openaiApiKeyConfigured && preview.visionRequestSent
          ? "PDF 이미지는 선명하고 비전 AI 요청도 전송됐지만, 비전 AI 응답을 컷 리스트로 만들지 못했습니다. 비전 이미지 분석 영역의 오류 내용을 확인해주세요."
        : preview.extractionMethod === "manual_review"
          ? "PDF 내부 텍스트도 깨졌고, OCR 결과도 한글을 읽지 못했습니다. 더 선명한 PDF 또는 페이지 캡처 이미지를 업로드해주세요."
          : "문서에서 텍스트를 추출했습니다.";

  return (
    <section className={`mb-5 rounded-md border bg-white p-5 ${preview.hasEncodingWarning ? "border-field-danger" : "border-field-border"}`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <h2 className="text-lg font-black text-field-primary">PDF / 문서 추출 품질 확인</h2>
          <p className="mt-1 break-words text-sm font-bold text-field-muted">
            {preview.fileName} · {preview.fileType || "unknown"} · {preview.extractionMethod}
          </p>
          <p className={`mt-2 text-sm font-black leading-6 ${preview.extractionMethod === "manual_review" ? "text-field-danger" : "text-field-primary"}`}>{successMessage}</p>
        </div>
        <div className={`rounded-md border px-3 py-2 text-sm font-black ${preview.hasEncodingWarning ? "border-field-danger text-field-danger" : "border-field-primary text-field-primary"}`}>
          {finalStatusLabel}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <QualityPanel
          title="PDF 내부 텍스트 추출 결과"
          quality={nativeQuality}
          textSample={preview.nativeTextPreview ?? preview.textSample}
          resultLabel={nativeQuality.isLikelyCorrupted ? "깨짐" : "정상"}
          tone={nativeQuality.isLikelyCorrupted ? "danger" : "primary"}
        />

        {ocrQuality ? (
          <QualityPanel
            title="OCR 이미지 분석 결과"
            quality={ocrQuality}
            textSample={preview.ocrTextPreview ?? ""}
            resultLabel={preview.ocrSucceeded ? "정상" : "깨짐 / 실패"}
            tone={preview.ocrSucceeded ? "primary" : "danger"}
            meta={[
              ["OCR 엔진", preview.ocrEngine || "-"],
              ["OCR 언어", preview.ocrLanguage || "-"]
            ]}
          />
        ) : null}

        {hasVisionDebug ? <VisionPanel preview={preview} resultLabel={visionResultLabel} /> : null}
      </div>

      {preview.usedFallback ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <PreviewStat label="최종 분석 방식" value={finalStatusLabel} />
          <PreviewStat label="전환 이유" value={preview.fallbackReason || "-"} />
          <PreviewStat label="렌더링 페이지" value={preview.renderedPageCount ?? preview.ocrPageCount ?? 0} />
          <PreviewStat label="OCR 성공 여부" value={preview.ocrSucceeded ? "성공" : "실패"} />
          <PreviewStat label="비전 AI 요청" value={preview.visionRequestSent ? "전송됨" : "전송 안 됨"} />
          <PreviewStat label="파싱 컷 수" value={preview.parsedShotCount ?? 0} />
        </div>
      ) : null}

      {preview.ocrFailureReason || preview.ocrErrorMessage ? (
        <div className="mt-4 rounded-md border border-field-danger bg-white p-3 text-sm font-bold leading-6 text-field-danger">
          {preview.ocrFailureReason ? `OCR 실패 이유: ${preview.ocrFailureReason}` : ""}
          {preview.ocrErrorMessage ? <span className="block break-words">상세: {preview.ocrErrorMessage}</span> : null}
        </div>
      ) : null}

      {finalQuality.warnings.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {finalQuality.warnings.map((warning) => (
            <div key={warning} className="rounded-md border border-field-danger bg-white p-3 text-sm font-bold text-field-danger">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {process.env.NODE_ENV !== "production" && preview.usedFallback ? (
        <details className="mt-4 rounded-md border border-field-border bg-field-soft p-4">
          <summary className="cursor-pointer text-sm font-black text-field-primary">개발자 디버그: OCR에 사용한 PDF 이미지</summary>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-2 md:grid-cols-3">
              {(preview.renderedImageInfo ?? []).map((image) => (
                <PreviewStat
                  key={`${image.pageNumber}-${image.width}-${image.height}`}
                  label={`${image.pageNumber}페이지`}
                  value={`${image.width}x${image.height} / ${image.dpi}dpi`}
                />
              ))}
            </div>
            {preview.renderedImagePreviewDataUrl ? (
              <img
                src={preview.renderedImagePreviewDataUrl}
                alt="OCR에 사용한 첫 번째 PDF 페이지 이미지"
                className="max-h-[520px] w-full rounded-md border border-field-border bg-white object-contain"
              />
            ) : (
              <p className="text-sm font-bold text-field-muted">표시할 렌더링 이미지 미리보기가 없습니다.</p>
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function VisionPanel({ preview, resultLabel }: { preview: ExtractionPreview; resultLabel: string }) {
  const tone = preview.visionSucceeded ? "primary" : "danger";
  const toneClass = tone === "danger" ? "border-field-danger text-field-danger" : "border-field-primary text-field-primary";

  return (
    <div className={`rounded-md border p-4 ${tone === "danger" ? "border-field-danger bg-white" : "border-field-border bg-field-soft"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-black text-field-primary">비전 이미지 분석</h3>
        <span className={`rounded-md border px-2 py-1 text-xs font-black ${toneClass}`}>{resultLabel}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PreviewStat label="OpenAI API 키" value={preview.openaiApiKeyConfigured ? "설정됨" : "없음"} />
        <PreviewStat label="사용 모델" value={preview.visionModelUsed || "-"} />
        <PreviewStat label="요청 전송" value={preview.visionRequestSent ? "true" : "false"} />
        <PreviewStat label="응답 수신" value={preview.visionResponseReceived ? "true" : "false"} />
        <PreviewStat label="생성 컷 수" value={preview.parsedShotCount ?? 0} />
        <PreviewStat label="이미지 타입" value={preview.imageMimeType || "-"} />
        <PreviewStat label="이미지 크기" value={`${preview.firstPageImageWidth ?? 0}x${preview.firstPageImageHeight ?? 0} / ${preview.firstPageImageDpi ?? 0}dpi`} />
      </div>
      {preview.visionRawResponsePreview ? (
        <details className="mt-3 rounded-md border border-field-border bg-white p-3">
          <summary className="cursor-pointer text-sm font-black text-field-primary">비전 AI 응답 일부</summary>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-field-text">{preview.visionRawResponsePreview}</pre>
        </details>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-field-border bg-field-soft p-3">
      <p className="text-xs font-bold text-field-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-field-primary">{value}</p>
    </div>
  );
}

function QualityPanel({
  title,
  quality,
  textSample,
  resultLabel,
  tone,
  meta = []
}: {
  title: string;
  quality: ExtractionPreview["textQuality"];
  textSample: string;
  resultLabel: string;
  tone: "primary" | "danger";
  meta?: Array<[string, string]>;
}) {
  const toneClass = tone === "danger" ? "border-field-danger text-field-danger" : "border-field-primary text-field-primary";

  return (
    <div className={`rounded-md border p-4 ${tone === "danger" ? "border-field-danger bg-white" : "border-field-border bg-field-soft"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-black text-field-primary">{title}</h3>
        <span className={`rounded-md border px-2 py-1 text-xs font-black ${toneClass}`}>{resultLabel}</span>
      </div>
      {meta.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {meta.map(([label, value]) => (
            <PreviewStat key={label} label={label} value={value} />
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PreviewStat label="한글 비율" value={`${(quality.koreanRatio * 100).toFixed(1)}%`} />
        <PreviewStat label="깨진 문자 비율" value={`${(quality.suspiciousRatio * 100).toFixed(1)}%`} />
        <PreviewStat label="한글 글자 수" value={quality.koreanCharCount} />
        <PreviewStat label="의심 문자 수" value={quality.suspiciousCharCount} />
      </div>
      {quality.warnings.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {quality.warnings.map((warning) => (
            <div key={warning} className="rounded-md border border-field-danger bg-white p-3 text-sm font-bold text-field-danger">
              {warning}
            </div>
          ))}
        </div>
      ) : null}
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-field-border bg-white p-3 text-sm leading-6 text-field-text">
        {textSample || "추출된 텍스트가 없습니다."}
      </pre>
    </div>
  );
}
