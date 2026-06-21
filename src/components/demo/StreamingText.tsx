import { useEffect, useRef, useState } from "react";

export function StreamingText({
  text,
  speed = 18,
  animate = true,
  onDone,
}: {
  text: string;
  speed?: number;
  /** When false, show the full text immediately (e.g. it already streamed live). */
  animate?: boolean;
  onDone?: () => void;
}) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  const intervalRef = useRef<number | null>(null);
  // Held in a ref so a parent passing an inline onDone can't retrigger the effect.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !animate) {
      setOut(text);
      setDone(true);
      onDoneRef.current?.();
      return;
    }
    setOut("");
    setDone(false);
    let i = 0;
    intervalRef.current = window.setInterval(() => {
      i += 2;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        setDone(true);
        onDoneRef.current?.();
      }
    }, speed);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [text, speed, animate]);

  // Tap/click anywhere in the text to skip the typewriter and read at full speed.
  function skip() {
    if (done) return;
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    setOut(text);
    setDone(true);
    onDoneRef.current?.();
  }

  return (
    <p
      aria-live="polite"
      onClick={skip}
      title={done ? undefined : "Skip"}
      className={`whitespace-pre-line font-display text-lg leading-relaxed text-foreground sm:text-xl ${
        done ? "" : "cursor-pointer"
      }`}
    >
      {out}
      {!done && (
        <span className="ml-0.5 inline-block h-5 w-px translate-y-1 animate-pulse bg-[color:var(--lavender)]" />
      )}
    </p>
  );
}
