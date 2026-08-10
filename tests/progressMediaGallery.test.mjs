import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProgressMediaGalleryItems,
  clampGalleryIndex,
  getGalleryNeighborIndexes,
  mergeProgressMediaWithLinkedFallbacks,
  moveGalleryIndex,
  orderProgressMediaAsArchive,
  progressMediaIdentityKey,
  safeProgressThumbnailUrl
} from "../lib/progress/mediaGallery.ts";

const assets = [
  { id: "story-2", mediaType: "storyboard", title: "두 번째", publicUrl: "/story-2.jpg", thumbnailUrl: "/thumb-story-2.jpg" },
  { id: "overhead-1", mediaType: "overhead", title: "부감도", publicUrl: "/overhead-1.jpg", thumbnailUrl: "/thumb-overhead-1.jpg" },
  { id: "story-1", mediaType: "storyboard", title: "첫 번째", publicUrl: "/story-1.jpg", thumbnailUrl: "/thumb-story-1.jpg" }
];

test("category galleries stay isolated and preserve the canonical input order", () => {
  const storyboards = buildProgressMediaGalleryItems(assets, "storyboard");
  const overheads = buildProgressMediaGalleryItems(assets, "overhead");

  assert.deepEqual(storyboards.map((item) => item.id), ["story-2", "story-1"]);
  assert.deepEqual(overheads.map((item) => item.id), ["overhead-1"]);
  assert.equal(storyboards[0]?.thumbnailUrl, "/thumb-story-2.jpg");
});

test("a unique legacy image is appended without displacing the canonical representative", () => {
  const result = buildProgressMediaGalleryItems(assets, "storyboard", {
    id: "legacy",
    title: "legacy",
    url: "/legacy.jpg",
    thumbnailUrl: "/legacy.jpg"
  });
  assert.deepEqual(result.map((item) => item.id), ["story-2", "story-1", "legacy"]);

  const duplicate = buildProgressMediaGalleryItems(assets, "storyboard", {
    id: "duplicate",
    title: "duplicate",
    url: "/story-2.jpg",
    thumbnailUrl: "/story-2.jpg"
  });
  assert.deepEqual(duplicate.map((item) => item.id), ["story-2", "story-1"]);
});

test("bounded gallery navigation never moves beyond the first or last image", () => {
  assert.equal(clampGalleryIndex(12, 5), 4);
  assert.equal(moveGalleryIndex(0, -1, 5), 0);
  assert.equal(moveGalleryIndex(4, 1, 5), 4);
  assert.equal(moveGalleryIndex(2, 1, 5), 3);
  assert.deepEqual(getGalleryNeighborIndexes(0, 5), [1]);
  assert.deepEqual(getGalleryNeighborIndexes(2, 5), [1, 3]);
  assert.deepEqual(getGalleryNeighborIndexes(4, 5), [3]);
});

test("progress media uses the same canonical order as the archive grid", () => {
  const ordered = orderProgressMediaAsArchive([
    { id: "c", sortOrder: 2, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", sortOrder: 1, createdAt: "2026-08-03T00:00:00.000Z" },
    { id: "a", sortOrder: 1, createdAt: "2026-08-02T00:00:00.000Z" }
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["a", "b", "c"]);
});

test("the list never substitutes an original URL for a missing thumbnail", () => {
  assert.equal(safeProgressThumbnailUrl("/original.jpg", "/original.jpg"), "");
  assert.equal(safeProgressThumbnailUrl("/original.jpg", ""), "");
  assert.equal(safeProgressThumbnailUrl("/original.jpg", "/thumb.jpg"), "/thumb.jpg");
});

test("linked thumbnail fallbacks cannot cross categories, duplicate URLs, or displace canonical media", () => {
  assert.notEqual(
    progressMediaIdentityKey("storyboard", "/shared.jpg"),
    progressMediaIdentityKey("overhead", "/shared.jpg")
  );

  const canonical = [
    { id: "current-a", mediaType: "storyboard", publicUrl: "/current-a.jpg", thumbnailUrl: "", sortOrder: 9, createdAt: "2026-08-02T00:00:00.000Z" },
    { id: "current-a-copy", mediaType: "storyboard", publicUrl: "/current-a.jpg", thumbnailUrl: "/thumb-current-a.jpg", sortOrder: 10, createdAt: "2026-08-02T01:00:00.000Z" },
    { id: "current-b", mediaType: "storyboard", publicUrl: "/current-b.jpg", thumbnailUrl: "/thumb-current-b.jpg", sortOrder: 11, createdAt: "2026-08-03T00:00:00.000Z" }
  ];
  const linked = [
    { id: "duplicate-current", mediaType: "storyboard", publicUrl: "/current-a.jpg", thumbnailUrl: "/thumb-current-a-linked.jpg", sortOrder: 1, createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "linked-story", mediaType: "storyboard", publicUrl: "/linked.jpg", thumbnailUrl: "/thumb-linked-story.jpg", sortOrder: 1, createdAt: "2026-07-02T00:00:00.000Z" },
    { id: "linked-story-copy", mediaType: "storyboard", publicUrl: "/linked.jpg", thumbnailUrl: "/thumb-linked-story-copy.jpg", sortOrder: 2, createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "linked-overhead", mediaType: "overhead", publicUrl: "/linked.jpg", thumbnailUrl: "/thumb-linked-overhead.jpg", sortOrder: 1, createdAt: "2026-07-02T00:00:00.000Z" }
  ];

  const result = mergeProgressMediaWithLinkedFallbacks(canonical, linked);
  assert.deepEqual(result.slice(0, 2).map((item) => item.id), ["current-a", "current-b"]);
  assert.equal(result[0]?.thumbnailUrl, "/thumb-current-a.jpg");
  assert.deepEqual(
    new Set(result.slice(2).map((item) => item.id)),
    new Set(["linked-story", "linked-overhead"])
  );
});
