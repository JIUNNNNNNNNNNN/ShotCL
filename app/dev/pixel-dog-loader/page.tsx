import { PixelDogLoader } from "@/components/PixelDogLoader";

export default function PixelDogLoaderPreviewPage() {
  return (
    <main className="min-h-dvh bg-field-bg px-4 py-12 text-field-text">
      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {(["sm", "md", "lg"] as const).map((size) => (
          <div key={size} className="border border-field-border bg-field-panel p-4">
            <PixelDogLoader size={size} />
          </div>
        ))}
      </div>
    </main>
  );
}
