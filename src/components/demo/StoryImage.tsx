import { Aperture } from "lucide-react";

/**
 * Displays a generated story image with a cinematic "developing" skeleton while
 * it renders.
 *
 * - `url` present  → fade the real generated image in.
 * - render failed  → fall back to `fallback` (the offline/mock asset) if given.
 * - otherwise      → animated skeleton (a light sweep + aperture + label) that
 *                    reads as a frame being rendered, not a dead placeholder.
 */
export function StoryImage({
  url,
  failed,
  alt,
  aspectClass,
  fallback,
  label,
  width,
  height,
}: {
  url: string | null;
  failed?: boolean;
  alt: string;
  /** Tailwind aspect + sizing for the wrapper, e.g. "aspect-[16/9]". */
  aspectClass: string;
  fallback?: string;
  /** Caption shown under the skeleton, e.g. "Painting the world". */
  label?: string;
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
      {/* Base wash */}
      <div className="absolute inset-0 bg-gradient-to-br from-surface via-background to-surface opacity-80" />
      {/* Soft breathing lavender bloom */}
      <div className="absolute -inset-12 animate-breathe bg-aura opacity-50" />
      {/* Diagonal light sweep — the "developing" pass */}
      <div className="pointer-events-none absolute inset-y-0 -inset-x-1/2">
        <div className="animate-sweep h-full w-1/3 bg-gradient-to-r from-transparent via-[color:var(--lavender-soft)] to-transparent opacity-60" />
      </div>
      {/* Film grain for texture */}
      <div className="grain absolute inset-0 opacity-70" />

      {/* Centered status mark */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <Aperture
          className="animate-spin-slow h-7 w-7 text-[color:var(--lavender)]"
          strokeWidth={1.5}
        />
        {label && (
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
