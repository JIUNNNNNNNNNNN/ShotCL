import { InlineLoader, PageLoader, SectionLoader } from "@/components/PixelDogLoader";

export default function PixelDogLoaderPreviewPage() {
  return (
    <main className="min-h-dvh bg-field-bg px-4 py-12 text-field-text">
      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        <div className="grid min-h-48 place-items-center border border-field-border bg-field-panel p-4">
          <PageLoader className="!min-h-0" />
        </div>
        <div className="grid min-h-48 place-items-center border border-field-border bg-field-panel p-4">
          <SectionLoader className="!min-h-0" />
        </div>
        <div className="grid min-h-48 place-items-center border border-field-border bg-field-panel p-4">
          <InlineLoader />
        </div>
      </div>
    </main>
  );
}
