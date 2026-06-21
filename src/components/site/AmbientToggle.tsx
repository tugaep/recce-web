import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";

/**
 * A tiny ambient cinema drone, synthesized with the Web Audio API — no audio asset
 * to ship. Off by default, so it respects autoplay policies and never surprises the
 * user; toggling it on starts a very low, slowly-moving pad.
 */
export function AmbientToggle() {
  const [on, setOn] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // Clean up the audio graph if the nav unmounts while playing.
  useEffect(() => () => stopRef.current?.(), []);

  function toggle() {
    if (on) {
      stopRef.current?.();
      stopRef.current = null;
      setOn(false);
      return;
    }
    const stop = startAmbient();
    if (stop) {
      stopRef.current = stop;
      setOn(true);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? "Mute ambience" : "Play ambience"}
      className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
    >
      <HugeiconsIcon icon={on ? VolumeHighIcon : VolumeOffIcon} className="h-4 w-4" />
    </button>
  );
}

/** Build a calm low drone and return a stop() that fades it out. Null if unsupported. */
function startAmbient(): (() => void) | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.connect(master);

    // A2 + a slightly detuned A2 (slow beating) + E3 — a quiet, filmic pad.
    const oscs = [110, 110.5, 164.81].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g);
      g.connect(filter);
      o.start();
      return o;
    });

    // Slow filter sweep for gentle movement.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    master.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2); // gentle, very low

    return () => {
      try {
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
        window.setTimeout(() => {
          oscs.forEach((o) => o.stop());
          lfo.stop();
          void ctx.close();
        }, 700);
      } catch {
        void ctx.close();
      }
    };
  } catch {
    return null;
  }
}
