/**
 * Displays a generated story image with a shimmer skeleton while it renders.
 *
 * - `url` present  → fade the real generated image in.
 * - render failed  → fall back to `fallback` (the offline/mock asset) if given.
 * - otherwise      → shimmer skeleton (image is still being generated).
 */
export function StoryImage({
  url,
  failed,
  alt,
  aspectClass,
  fallback,
  width,
  height,
}: {
  url: string | null;
  failed?: boolean;
  alt: string;
  /** Tailwind aspect + sizing for the wrapper, e.g. "aspect-[16/9]". */
  aspectClass: string;
  fallback?: string;
  width?: number;
  height?: number;
}) {
  const src = url ?? (failed ? fallback : undefined);

  if (src) {
    return (
      <div className={`relative w-full overflow-hidden ${aspectClass}`}>
        <img
          src={src}
          alt={alt}
          loading="lazy"
          width={width}
          height={height}
          className="h-full w-full animate-fade-in object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden bg-surface ${aspectClass}`}
      role="img"
      aria-label={`${alt} — generating`}
      aria-busy="true"
    >
      <div
        className="absolute inset-0 bg-lavender-gradient opacity-40"
        style={{ backgroundSize: "200% 100%", animation: "shimmer 1.6s linear infinite" }}
      />
    </div>
  );
}
