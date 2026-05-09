import { useEffect, useState } from "react";

export function StreamingText({
  text,
  speed = 18,
  onDone,
}: {
  text: string;
  speed?: number;
  onDone?: () => void;
}) {
  const [out, setOut] = useState("");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setOut(text);
      onDone?.();
      return;
    }
    setOut("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        onDone?.();
      }
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed, onDone]);

  return (
    <p
      aria-live="polite"
      className="whitespace-pre-line font-display text-lg leading-relaxed text-foreground sm:text-xl"
    >
      {out}
      <span className="ml-0.5 inline-block h-5 w-px translate-y-1 animate-pulse bg-[color:var(--lavender)]" />
    </p>
  );
}
