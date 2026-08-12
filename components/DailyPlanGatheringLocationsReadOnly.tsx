"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Copy, ImageIcon, MapPin } from "lucide-react";
import { copyText } from "@/lib/client/copyText";
import { selectActiveGatheringPhoto } from "@/lib/client/gatheringPhotoCard";
import { selectProgressGatheringPlace } from "@/lib/progress/gatheringPlace";
import type { DailyPlan } from "@/lib/types";
import { cn } from "@/lib/utils";
import styles from "./DailyPlanGatheringLocations.module.css";

const COPY_FEEDBACK_MS = 1300;

/** Guest Progress에 필요한 집합시간·대표 사진·주소만 hydrate합니다. */
export function DailyPlanGatheringLocationsReadOnly({ plan }: { plan: DailyPlan }) {
  const place = useMemo(
    () => selectProgressGatheringPlace(plan),
    [plan.meetingLocation, plan.memo, plan.shootingLocations]
  );
  const activePhoto = selectActiveGatheringPhoto(place?.photos ?? []);
  const safeThumbnailUrl = activePhoto?.thumbnailUrl.trim()
    && activePhoto.thumbnailUrl.trim() !== activePhoto.url.trim()
    ? activePhoto.thumbnailUrl.trim()
    : "";
  const callTime = plan.callTime.trim();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function copyAddress() {
    const address = place?.address.trim() ?? "";
    if (!address) return;
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    try {
      await copyText(address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopyStatus("idle");
    }, COPY_FEEDBACK_MS);
  }

  return (
    <section
      className={cn(
        "mb-3 rounded-[var(--radius-card)] border border-field-border bg-field-section",
        styles.card
      )}
      aria-labelledby="gathering-locations-title"
    >
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-field-border px-3 py-2">
        <h2 id="gathering-locations-title" className="text-sm font-bold text-field-text">집합장소</h2>
      </div>

      {!place ? (
        <p className="px-3 py-3 text-xs font-normal leading-5 text-field-muted">집합장소 정보가 없습니다.</p>
      ) : (
        <article className="min-w-0 p-3">
          <div className={styles.layout}>
            <div className={styles.time} aria-label={callTime ? `집합 시간 ${callTime}` : "집합 시간 미입력"}>
              <Clock3 className={styles.timeIcon} aria-hidden />
              {callTime ? <time dateTime={callTime}>{callTime}</time> : <span className={styles.missingTime}>시간 미입력</span>}
            </div>

            <div className={styles.mediaGroup}>
              <div
                className={cn(
                  styles.media,
                  "rounded-[var(--radius-control)] border border-field-border bg-field-soft",
                  safeThumbnailUrl ? styles.photoSurface : styles.emptyMedia
                )}
                role="img"
                aria-label={safeThumbnailUrl
                  ? `${place.locationName} 집합장소 사진`
                  : `${place.locationName} 집합장소 사진 없음`}
              >
                {safeThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={safeThumbnailUrl}
                    alt=""
                    width={960}
                    height={540}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className={cn("block h-full w-full object-cover", styles.photoImage)}
                  />
                ) : (
                  <div className={styles.emptyMediaContent}>
                    <ImageIcon className="h-8 w-8" aria-hidden />
                    <span className="text-xs font-semibold">집합장소 사진 없음</span>
                  </div>
                )}
              </div>
              <p className={styles.photoFeedback} aria-hidden="true">{"\u00a0"}</p>
            </div>

            {place.address.trim() ? (
              <button
                type="button"
                className={styles.addressButton}
                onClick={() => void copyAddress()}
                aria-label={`집합장소 주소 복사: ${place.address.trim()}`}
              >
                <MapPin className={styles.addressIcon} aria-hidden />
                <span className={styles.addressText}>{place.address.trim()}</span>
                <Copy className={styles.copyIcon} aria-hidden />
                <span
                  className={cn(styles.copyFeedback, copyStatus !== "idle" && styles.copyFeedbackVisible)}
                  role="status"
                  aria-live="polite"
                >
                  {copyStatus === "copied" ? "주소 복사됨" : copyStatus === "failed" ? "주소 복사 실패" : ""}
                </span>
              </button>
            ) : (
              <div className={cn(styles.addressButton, styles.addressMissing)}>
                <MapPin className={styles.addressIcon} aria-hidden />
                <span className={styles.addressText}>주소 미입력</span>
              </div>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
