"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import type { ProjectReferenceAsset } from "@/lib/types";

export default function ProjectScenarioPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projectName, setProjectName] = useState("");
  const [assets, setAssets] = useState<ProjectReferenceAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, scenarioAssets] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "scenario")
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setAssets(scenarioAssets);
      setSelectedId((current) => scenarioAssets.some((asset) => asset.id === current)
        ? current
        : scenarioAssets[0]?.id ?? "");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "시나리오 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!projectId || files.length === 0) return;
    setIsUploading(true);
    setErrorMessage("");
    try {
      for (const file of files) {
        await uploadProjectReferenceAsset(projectId, "scenario", file);
      }
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 업로드하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(asset: ProjectReferenceAsset) {
    if (!projectId || !window.confirm(`"${asset.filename}"을 삭제할까요?`)) return;
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 삭제하지 못했습니다.");
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display truncate text-xl font-black text-field-primary">시나리오</h1>
          <p className="truncate text-xs font-bold text-field-muted">{projectName} · PDF 확인</p>
        </div>
        {canEdit ? (
          <>
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              <Upload className="h-4 w-4" aria-hidden />
              {isUploading ? "업로드 중" : "PDF 업로드"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={handleUpload}
            />
          </>
        ) : (
          <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span>
        )}
      </div>

      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="min-w-0">
          <div className="grid gap-2">
            {assets.length === 0 ? (
              <p className="py-5 text-center text-sm font-bold text-field-muted">등록된 시나리오 PDF가 없습니다.</p>
            ) : assets.map((asset) => (
              <div
                key={asset.id}
                className={`grid min-w-0 grid-cols-[1fr_auto] items-center gap-1 rounded-xl border p-1.5 ${
                  selectedId === asset.id ? "border-field-primary bg-field-light" : "border-field-border bg-white"
                }`}
              >
                <button type="button" onClick={() => setSelectedId(asset.id)} className="flex min-w-0 items-center gap-2 px-1.5 py-2 text-left">
                  <FileText className="h-4 w-4 shrink-0 text-field-primary" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-field-text">{asset.filename}</span>
                    <span className="block text-[11px] font-bold text-field-muted">{formatDate(asset.createdAt)} · {formatBytes(asset.sizeBytes)}</span>
                  </span>
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(asset)}
                    aria-label={`${asset.filename} 삭제`}
                    className="grid h-8 w-8 place-items-center rounded-full text-field-danger transition hover:bg-red-50 active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-h-[60dvh] min-w-0 !p-0">
          {selectedAsset ? (
            <div className="grid h-full min-h-[60dvh] grid-rows-[auto_1fr]">
              <div className="flex min-w-0 items-center justify-between gap-2 border-b border-field-border px-3 py-2">
                <p className="truncate text-sm font-black text-field-primary">{selectedAsset.filename}</p>
                <a
                  href={selectedAsset.publicUrl}
                  download={selectedAsset.filename}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  열기
                </a>
              </div>
              <iframe
                key={selectedAsset.id}
                src={selectedAsset.publicUrl}
                title={`${selectedAsset.filename} PDF`}
                className="h-full min-h-[55dvh] w-full border-0 bg-white"
              />
            </div>
          ) : (
            <div className="grid min-h-[60dvh] place-items-center text-sm font-bold text-field-muted">확인할 PDF를 선택하세요.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function formatBytes(value: number) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
