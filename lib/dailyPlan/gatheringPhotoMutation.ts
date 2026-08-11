export type GatheringPhotoMutationItem = {
  id: string;
  sortOrder: number;
};

export type GatheringPhotoReplacementResult<T extends GatheringPhotoMutationItem> =
  | {
      status: "apply";
      photos: T[];
      replacedPhoto: T;
    }
  | {
      status: "idempotent";
      photo: T;
    }
  | {
      status: "conflict" | "missing";
    };

/**
 * 한 장 교체의 metadata 결과를 계산합니다.
 *
 * 새 사진은 기존 사진의 정확한 위치를 이어받고 legacy sibling은 그대로
 * 보존합니다. 동일한 새 photo ID로 재시도했을 때 old ID가 이미 사라졌다면
 * 이전 요청이 확정된 것으로 처리할 수 있습니다.
 */
export function resolveGatheringPhotoReplacement<T extends GatheringPhotoMutationItem>(
  photos: readonly T[],
  replacedPhotoId: string,
  replacementPhoto: T
): GatheringPhotoReplacementResult<T> {
  const replacedIndex = photos.findIndex((photo) => photo.id === replacedPhotoId);
  const existingReplacement = photos.find((photo) => photo.id === replacementPhoto.id);

  if (existingReplacement) {
    return replacedIndex < 0
      ? { status: "idempotent", photo: existingReplacement }
      : { status: "conflict" };
  }
  if (replacedIndex < 0) return { status: "missing" };

  const replacedPhoto = photos[replacedIndex];
  const nextPhotos = photos.map((photo, index) => (
    index === replacedIndex ? replacementPhoto : photo
  )).map((photo, index) => ({ ...photo, sortOrder: index }));

  return {
    status: "apply",
    photos: nextPhotos,
    replacedPhoto
  };
}
