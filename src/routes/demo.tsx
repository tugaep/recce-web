import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ApertureIcon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  Refresh01Icon,
  SparklesIcon,
  FilmRoll01Icon,
} from "@hugeicons/core-free-icons";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { EyebrowLabel } from "@/components/site/EyebrowLabel";
import { StreamingText } from "@/components/demo/StreamingText";
import { StoryImage } from "@/components/demo/StoryImage";
import { mockCharacters, mockScenes, mockWorld, startingSuggestions } from "@/data/mockStory";
import { useWebSocket } from "@/hooks/useWebSocket";
import { toast } from "sonner";
import type {
  Character as WsCharacter,
  Choice as WsChoice,
  ImageReadyPayload,
  Scene as WsScene,
  World as WsWorld,
} from "@/hooks/useWebSocket";
import {
  applyImageReady,
  emptyVisualState,
  resetScene,
  type VisualState,
} from "@/lib/visualState";

// Cinema icon shims (lucide → Hugeicons) — call sites below stay unchanged.
// ponytail: thin aliases to swap the icon library with a minimal diff.
type IconProps = { className?: string; strokeWidth?: number };
const Aperture = (p: IconProps) => <HugeiconsIcon icon={ApertureIcon} {...p} />;
const ArrowRight = (p: IconProps) => <HugeiconsIcon icon={ArrowRight01Icon} {...p} />;
const ArrowLeft = (p: IconProps) => <HugeiconsIcon icon={ArrowLeft01Icon} {...p} />;
const RotateCcw = (p: IconProps) => <HugeiconsIcon icon={Refresh01Icon} {...p} />;
const Sparkles = (p: IconProps) => <HugeiconsIcon icon={SparklesIcon} {...p} />;
const BookOpen = (p: IconProps) => <HugeiconsIcon icon={FilmRoll01Icon} {...p} />;

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Recce — Demo playthrough" },
      {
        name: "description",
        content:
          "Experience a short, simulated Recce story: a cast, a world, and a choice-driven scene.",
      },
      { property: "og:title", content: "Recce — Demo playthrough" },
      {
        property: "og:description",
        content: "A short interactive story preview from Recce.",
      },
    ],
  }),
  component: DemoPage,
});

type Stage = "idea" | "dreaming" | "reveal" | "play" | "summary" | "error";

type ChoiceTaken = { sceneTitle: string; choiceLabel: string };

type SceneEntry = { scene: WsScene; choice: string | null };

// Persistence: snapshot the play state so a refresh (or a shared link) can restore it.
const STORAGE_KEY = "recce:lastStory";
const API_URL =
  (import.meta.env.VITE_API_URL as string) ||
  ((import.meta.env.VITE_WS_URL as string) || "ws://localhost:8000/ws")
    .replace(/^ws/, "http")
    .replace(/\/ws$/, "");

type Snapshot = {
  v: 1;
  sessionId: string | null;
  idea: string;
  stage: Stage;
  characters: WsCharacter[];
  world: WsWorld | null;
  currentScene: WsScene | null;
  choices: WsChoice[];
  history: ChoiceTaken[];
  allScenes: SceneEntry[];
  isFinal: boolean;
  visuals: VisualState;
};

// Render-quality presets — keys match the backend allowlist (main.py). Honest
// labels so the tradeoff (longer wait = richer output) is clear.
const TEXT_PRESETS = [
  { value: "fast", label: "Fast — quicker, lighter prose" },
  { value: "balanced", label: "Balanced — recommended" },
  { value: "capable", label: "Most capable — richest, slowest" },
];
const IMAGE_PRESETS = [
  { value: "fast", label: "Lightning — seconds, simpler art" },
  { value: "standard", label: "Standard — balanced (default)" },
  { value: "rich", label: "Rich — more detail, slower" },
  { value: "cinematic", label: "Cinematic — richest, ~2 min/image" },
];

function DemoPage() {
  const [stage, setStage] = useState<Stage>("idea");
  // Mirror of `stage` for use inside the [lastMessage]-only effect without staleness.
  const stageRef = useRef<Stage>(stage);
  stageRef.current = stage;
  const [idea, setIdea] = useState("");
  const [history, setHistory] = useState<ChoiceTaken[]>([]);
  const [textPreset, setTextPreset] = useState("balanced");
  const [imagePreset, setImagePreset] = useState("standard");
  const [progressStage, setProgressStage] = useState<string | null>(null);

  const { sendMessage, lastMessage, isConnected } = useWebSocket();

  const [characters, setCharacters] = useState<WsCharacter[]>([]);
  const [world, setWorld] = useState<WsWorld | null>(null);
  const [currentScene, setCurrentScene] = useState<WsScene | null>(null);
  const [choices, setChoices] = useState<WsChoice[]>([]);
  const [isFinal, setIsFinal] = useState(false);
  const [allScenes, setAllScenes] = useState<SceneEntry[]>([]);
  const [visuals, setVisuals] = useState<VisualState>(emptyVisualState);
  const [errorMsg, setErrorMsg] = useState("");
  // Prevents ScenePlayer re-mounting (and re-streaming old text) while the
  // backend generates the next chapter. history is updated only when
  // choice_applied arrives with the new scene.
  const [isWaitingForScene, setIsWaitingForScene] = useState(false);
  const pendingChoiceRef = useRef<string | null>(null);
  // Live scene streaming (continuation turns): prose arrives as scene_delta frames.
  // The ref is the staleness-free source of truth; the state drives rendering.
  const [streamingText, setStreamingText] = useState("");
  const streamingTextRef = useRef("");
  // True when the just-applied scene was streamed live, so it renders instantly
  // (no second typewriter pass over text the user already watched arrive).
  const [sceneStreamed, setSceneStreamed] = useState(false);
  // Persistence / resume / share.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumable, setResumable] = useState<Snapshot | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  // Post-story review (opt-in from the summary page)
  type StoryReview = {
    overall_impression: string;
    narrative_arc: string;
    inconsistencies: { type: string; description: string }[];
    highlights: string[];
    suggestions: string[];
  };
  const [review, setReview] = useState<StoryReview | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as { type: string; payload: Record<string, unknown> };

    // Progressive reveal: cast and world arrive ~10s before the opening scene, so
    // the user lands on the Cast & World page while the storyteller is still writing.
    if (msg.type === "cast_ready") {
      const p = msg.payload as unknown as { characters: WsCharacter[]; session_id?: string };
      if (p.session_id) setSessionId(p.session_id);
      setCharacters(p.characters);
      setVisuals(emptyVisualState);
      setStage((s) => (s === "dreaming" ? "reveal" : s));
    }

    if (msg.type === "world_ready") {
      const p = msg.payload as unknown as { world: WsWorld };
      setWorld(p.world);
    }

    if (msg.type === "story_started") {
      const p = msg.payload as unknown as {
        characters: WsCharacter[];
        world: WsWorld;
        scene: WsScene;
        choices: WsChoice[];
        session_id?: string;
      };
      if (p.session_id) setSessionId(p.session_id);
      setCharacters(p.characters);
      setWorld(p.world);
      setCurrentScene(p.scene);
      setChoices(p.choices);
      setAllScenes([{ scene: p.scene, choice: null }]);
      // The opening scene isn't streamed (it generates behind the reveal), so let it
      // type out for effect when the player enters the first scene.
      setSceneStreamed(false);
      // cast_ready already initialised visuals; only reset if we skipped it
      // (e.g. a client that connected straight to story_started).
      setStage((s) => (s === "dreaming" ? "reveal" : s));
    }

    if (msg.type === "choice_applied") {
      const p = msg.payload as unknown as {
        scene: WsScene;
        choices: WsChoice[];
        is_final?: boolean;
      };
      // If this scene streamed in live, render it instantly (don't re-type it).
      setSceneStreamed(streamingTextRef.current.length > 0);
      streamingTextRef.current = "";
      setStreamingText("");
      // Flush the pending choice into history now that the new scene is ready.
      // This ensures ScenePlayer re-mounts (via key={history.length}) only once
      // the new scene text is available, avoiding re-streaming of the old chapter.
      if (pendingChoiceRef.current !== null) {
        const choiceLabel = pendingChoiceRef.current;
        pendingChoiceRef.current = null;
        setHistory((h) => [
          ...h,
          { sceneTitle: currentScene?.location ?? "", choiceLabel },
        ]);
      }
      setCurrentScene(p.scene);
      setChoices(p.choices);
      setIsFinal(Boolean(p.is_final));
      setAllScenes((prev) => [...prev, { scene: p.scene, choice: null }]);
      // New scene begins rendering — clear the prior scene image, keep cast/world.
      setVisuals((prev) => resetScene(prev));
      setIsWaitingForScene(false);
      setStage("play");
    }

    if (msg.type === "progress") {
      const p = msg.payload as { stage?: string };
      if (p?.stage) setProgressStage(p.stage);
    }

    if (msg.type === "scene_delta") {
      const p = msg.payload as { text?: string };
      if (p?.text) {
        streamingTextRef.current += p.text;
        setStreamingText(streamingTextRef.current);
      }
    }

    if (msg.type === "image_ready") {
      const p = msg.payload as unknown as ImageReadyPayload;
      setVisuals((prev) => applyImageReady(prev, p));
    }

    if (msg.type === "review_started") {
      setIsReviewing(true);
    }

    if (msg.type === "story_review") {
      const p = msg.payload as { review: StoryReview };
      setReview(p.review);
      setIsReviewing(false);
    }

    if (msg.type === "error") {
      const p = msg.payload as { message?: string };
      const message = p?.message || "Something went wrong while building your story.";
      setIsReviewing(false);
      if (stageRef.current === "dreaming") {
        // Hard failure before any content — show the full error screen.
        setErrorMsg(message);
        setStage("error");
      } else {
        // Mid-story: surface it without losing the scene; revert any pending wait
        // so the user can retry their choice.
        toast.error(message);
        setIsWaitingForScene(false);
        pendingChoiceRef.current = null;
      }
    }
  }, [lastMessage]);

  // Fail-safe: if initial generation stalls (backend down/slow), don't spin forever.
  useEffect(() => {
    if (stage !== "dreaming") return;
    const id = window.setTimeout(() => {
      setErrorMsg("The studio took too long to respond. Please try again.");
      setStage("error");
    }, 90000);
    return () => window.clearTimeout(id);
  }, [stage]);

  // Fail-safe for a stuck choice: revert to the choices so the user can retry.
  useEffect(() => {
    if (!isWaitingForScene) return;
    const id = window.setTimeout(() => {
      toast.error("That took too long — try your choice again.");
      setIsWaitingForScene(false);
      pendingChoiceRef.current = null;
    }, 90000);
    return () => window.clearTimeout(id);
  }, [isWaitingForScene]);

  // Persist the current play state so a refresh (or shared link) can restore it.
  useEffect(() => {
    if (typeof window === "undefined" || readOnly) return;
    if (stage === "reveal" || stage === "play" || stage === "summary") {
      const snap: Snapshot = {
        v: 1,
        sessionId,
        idea,
        stage,
        characters,
        world,
        currentScene,
        choices,
        history,
        allScenes,
        isFinal,
        visuals,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      } catch {
        /* storage full / unavailable — non-fatal */
      }
    }
  }, [
    readOnly,
    stage,
    sessionId,
    idea,
    characters,
    world,
    currentScene,
    choices,
    history,
    allScenes,
    isFinal,
    visuals,
  ]);

  // On first load: open a shared story (?s=<id>) or offer to resume a saved one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sharedId = new URLSearchParams(window.location.search).get("s");
    let snap: Snapshot | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) snap = JSON.parse(raw) as Snapshot;
    } catch {
      snap = null;
    }
    if (sharedId && !(snap && snap.sessionId === sharedId)) {
      void loadSharedStory(sharedId);
    } else if (snap && (snap.allScenes?.length ?? 0) > 0) {
      setResumable(snap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitIdea(value: string) {
    const v = value.trim();
    if (!v) return;
    if (!isConnected) {
      toast.error("Still connecting to the studio — one moment, then try again.");
      return;
    }
    setIdea(v);
    setProgressStage(null);
    setErrorMsg("");
    sendMessage("start_story", { idea: v, text_preset: textPreset, image_preset: imagePreset });
    setStage("dreaming");
  }

  function chooseScene(choiceLabel: string) {
    // Store the choice label — history is updated when choice_applied arrives
    // so ScenePlayer's key doesn't change (and re-mount) before the new scene
    // text is ready, which was causing the old chapter to stream again.
    pendingChoiceRef.current = choiceLabel;
    streamingTextRef.current = "";
    setStreamingText("");
    setSceneStreamed(false);
    setIsWaitingForScene(true);
    setAllScenes((prev) =>
      prev.map((s, i) => (i === prev.length - 1 ? { ...s, choice: choiceLabel } : s)),
    );
    sendMessage("make_choice", { choice: choiceLabel });
  }

  function restart() {
    // Tell the backend to drop the abandoned story (best-effort cleanup).
    if (sessionId) sendMessage("cancel_story", { session_id: sessionId });
    setStage("idea");
    setIdea("");
    setHistory([]);
    setCharacters([]);
    setWorld(null);
    setCurrentScene(null);
    setChoices([]);
    setIsFinal(false);
    setAllScenes([]);
    setVisuals(emptyVisualState);
    setErrorMsg("");
    setProgressStage(null);
    setIsWaitingForScene(false);
    pendingChoiceRef.current = null;
    streamingTextRef.current = "";
    setStreamingText("");
    setSceneStreamed(false);
    setReadOnly(false);
    setSessionId(null);
    setResumable(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setReview(null);
    setIsReviewing(false);
  }

  function retryGeneration() {
    // Re-send the same idea rather than discarding it (submitIdea guards on connection).
    if (idea.trim()) submitIdea(idea);
    else restart();
  }

  function resumeStory(snap: Snapshot) {
    setIdea(snap.idea);
    setCharacters(snap.characters);
    setWorld(snap.world);
    setCurrentScene(snap.currentScene);
    setChoices(snap.choices);
    setHistory(snap.history);
    setAllScenes(snap.allScenes);
    setIsFinal(snap.isFinal);
    setVisuals(snap.visuals);
    setSessionId(snap.sessionId);
    setSceneStreamed(true); // prose is already known — show it instantly, don't re-type
    setReadOnly(false);
    setResumable(null);
    if (snap.sessionId) sendMessage("resume_story", { session_id: snap.sessionId });
    setStage(snap.stage === "summary" ? "summary" : snap.stage === "play" ? "play" : "reveal");
  }

  async function loadSharedStory(id: string) {
    try {
      const res = await fetch(`${API_URL}/story/${id}`);
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as {
        user_idea: string;
        characters: (WsCharacter & { image_url?: string | null })[];
        world: (WsWorld & { image_url?: string | null }) | null;
        scenes: { scene_text: string; location: string; image_url?: string | null }[];
      };
      setIdea(data.user_idea || "");
      setCharacters(data.characters || []);
      setWorld(data.world || null);
      const scenes: SceneEntry[] = (data.scenes || []).map((s) => ({
        scene: { scene_text: s.scene_text, location: s.location },
        choice: null,
      }));
      setAllScenes(scenes);
      const charVis: Record<number, string> = {};
      (data.characters || []).forEach((c, i) => {
        if (c.image_url) charVis[i] = c.image_url;
      });
      setVisuals({
        world: data.world?.image_url ?? null,
        scene: data.scenes?.length ? (data.scenes[data.scenes.length - 1].image_url ?? null) : null,
        characters: charVis,
        failed: {},
      });
      setReadOnly(true);
      setStage("summary");
    } catch {
      toast.error("That shared story isn't available.");
    }
  }

  function shareStory() {
    if (!sessionId) {
      toast.error("Nothing to share yet.");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?s=${sessionId}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast.success("Link copied — viewable while the studio is running."),
        () => toast.error("Couldn't copy the link."),
      );
    } else {
      toast(url);
    }
  }

  function handleReview() {
    if (isReviewing || review) return;
    sendMessage("review_story", {});
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <Nav />

      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-aura" />

      <main
        className={`mx-auto px-6 pb-24 pt-32 ${stage === "play" ? "max-w-[1600px]" : "max-w-5xl"}`}
      >
        {stage === "idea" && (
          <section className="animate-fade-up">
            <div className="text-center">
              <EyebrowLabel>Begin</EyebrowLabel>
              <h1 className="mt-5 font-display text-4xl font-light leading-tight sm:text-5xl">
                What story would you like to live in?
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground">
                A premise, a feeling, a single image. The studio will do the rest.
              </p>
            </div>

            {resumable && (
              <div className="mx-auto mt-8 flex max-w-2xl items-center justify-between gap-4 border-2 border-[color:var(--lavender)] bg-surface px-5 py-4">
                <div className="min-w-0">
                  <p className="eyebrow text-[10px]">Continue where you left off</p>
                  <p className="mt-1 truncate font-display text-sm italic text-foreground">
                    “{resumable.idea}”
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => resumeStory(resumable)}
                    disabled={!isConnected}
                    className="inline-flex items-center gap-1.5 bg-foreground px-4 py-2 text-xs font-medium text-background transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Resume <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setResumable(null);
                      try {
                        localStorage.removeItem(STORAGE_KEY);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitIdea(idea);
              }}
              className="mx-auto mt-12 max-w-2xl"
            >
              <div className="group border-2 border-hairline bg-surface p-2 transition-all duration-500 ease-luxe focus-within:border-[color:var(--lavender)]">
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  placeholder="A lighthouse keeper discovers a door in the cliffs…"
                  className="w-full resize-none bg-transparent px-4 py-3 font-display text-lg leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-[color:var(--lavender)]" />
                    {isConnected
                      ? "Press enter — or pick a starting point."
                      : "Connecting to the studio…"}
                  </div>
                  <button
                    type="submit"
                    disabled={!isConnected}
                    className="inline-flex items-center gap-2 bg-foreground px-5 py-2 text-sm font-medium text-background transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Begin
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {startingSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submitIdea(s)}
                    disabled={!isConnected}
                    className="border-2 border-hairline bg-background px-4 py-1.5 text-xs text-muted-foreground transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Render settings — longer wait = richer output */}
              <div className="mx-auto mt-10 grid max-w-md gap-4 sm:grid-cols-2">
                <label className="block text-left">
                  <span className="eyebrow">Writing</span>
                  <select
                    value={textPreset}
                    onChange={(e) => setTextPreset(e.target.value)}
                    className="mt-2 w-full border-2 border-hairline bg-background px-3 py-2 text-xs text-foreground transition-colors focus:border-[color:var(--lavender)] focus:outline-none"
                  >
                    {TEXT_PRESETS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-left">
                  <span className="eyebrow">Visuals</span>
                  <select
                    value={imagePreset}
                    onChange={(e) => setImagePreset(e.target.value)}
                    className="mt-2 w-full border-2 border-hairline bg-background px-3 py-2 text-xs text-foreground transition-colors focus:border-[color:var(--lavender)] focus:outline-none"
                  >
                    {IMAGE_PRESETS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </form>
          </section>
        )}

        {stage === "dreaming" && <DreamingLoader idea={idea} stage={progressStage} />}

        {stage === "error" && (
          <section className="mx-auto mt-24 max-w-xl text-center animate-fade-up">
            <EyebrowLabel>Something interrupted the dream</EyebrowLabel>
            <p className="mt-6 font-display text-2xl font-light leading-relaxed text-foreground">
              The studio couldn’t finish building your story.
            </p>
            {errorMsg && <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">{errorMsg}</p>}
            <div className="mt-10 flex justify-center">
              <button
                onClick={retryGeneration}
                className="inline-flex items-center gap-2 bg-foreground px-6 py-3 text-sm font-medium text-background transition-all"
              >
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
            </div>
          </section>
        )}

        {stage === "reveal" && (
          <RevealStage
            idea={idea}
            world={world}
            characters={characters}
            visuals={visuals}
            sceneReady={currentScene !== null}
            onContinue={() => setStage("play")}
            onRestart={restart}
          />
        )}

        {stage === "play" && (
          <ScenePlayer
            currentScene={currentScene}
            choices={choices}
            history={history}
            isFinal={isFinal}
            visuals={visuals}
            isWaiting={isWaitingForScene}
            streamingText={streamingText}
            sceneStreamed={sceneStreamed}
            onChoose={chooseScene}
            onRestart={restart}
            onBack={() => setStage("reveal")}
            onViewSummary={() => setStage("summary")}
          />
        )}

        {stage === "summary" && (
          <StorySummary
            idea={idea}
            world={world}
            characters={characters}
            allScenes={allScenes}
            visuals={visuals}
            onRestart={restart}
            onReview={handleReview}
            onShare={shareStory}
            readOnly={readOnly}
            isReviewing={isReviewing}
            review={review}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

// Cinematic phases shown in sequence while the story pipeline runs. Ordered to
// mirror the backend: outline → cast/world → opening scene → lighting → roll.
const DREAM_PHASES = [
  "Reading your premise",
  "Shaping the story",
  "Casting the characters",
  "Building the world",
  "Writing the opening scene",
  "Setting the lights",
  "Rolling camera",
];

// Backend progress milestones -> phase index in DREAM_PHASES.
const STAGE_TO_PHASE: Record<string, number> = {
  shaping: 1, // Shaping the story
  casting: 2, // Casting the characters
  building: 3, // Building the world
  writing: 4, // Writing the opening scene
};

function DreamingLoader({ idea, stage }: { idea: string; stage: string | null }) {
  const [timerPhase, setTimerPhase] = useState(0);
  const [realPhase, setRealPhase] = useState<number | null>(null);

  // Real backend milestones drive the phase once they start arriving.
  useEffect(() => {
    if (!stage) return;
    const target = STAGE_TO_PHASE[stage];
    if (target != null) setRealPhase((p) => Math.max(p ?? 0, target));
  }, [stage]);

  // Gentle fallback: only runs until the first real event, and is capped before
  // the final two phases so it never claims more progress than has happened.
  useEffect(() => {
    if (realPhase != null) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => {
      setTimerPhase((p) => Math.min(p + 1, 4));
    }, 3200);
    return () => window.clearInterval(id);
  }, [realPhase]);

  const phase = realPhase ?? timerPhase;

  return (
    <section className="mx-auto mt-20 max-w-xl text-center">
      {/* Animated aperture mark with a breathing aura and orbiting accents */}
      <div className="relative mx-auto flex h-32 w-32 items-center justify-center">
        <div className="absolute inset-0 animate-breathe rounded-full bg-aura blur-2xl" />
        {/* Academy-leader countdown wedge sweeping the ring */}
        <div
          className="animate-leader-sweep absolute inset-1 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--lavender) 50%, transparent) 55deg, transparent 115deg)",
            WebkitMaskImage: "radial-gradient(closest-side, transparent 70%, #000 72%)",
            maskImage: "radial-gradient(closest-side, transparent 70%, #000 72%)",
          }}
        />
        {/* Drifting film grain over the lens */}
        <div className="grain animate-film-grain pointer-events-none absolute inset-0 rounded-full opacity-50" />
        <div className="absolute inset-3 animate-spin-slow">
          <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[color:var(--lavender)]" />
          <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[color:var(--lavender-soft)]" />
        </div>
        <Aperture
          className="animate-spin-slow relative h-14 w-14 text-[color:var(--lavender)]"
          strokeWidth={1.25}
        />
      </div>

      <div className="mt-8">
        <EyebrowLabel>Recce is dreaming</EyebrowLabel>
      </div>
      <p className="mt-6 font-display text-2xl font-light italic leading-relaxed text-foreground">
        “{idea}”
      </p>

      {/* Rotating phase — re-keyed so it fades on each change */}
      <p
        key={phase}
        className="mt-8 animate-fade-in text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--lavender)]"
      >
        {DREAM_PHASES[phase]}
      </p>

      {/* Progress track with a travelling dot */}
      <div className="relative mx-auto mt-6 h-[2px] w-64 overflow-hidden bg-hairline">
        <div
          className="h-full w-1/3 bg-lavender-gradient"
          style={{ backgroundSize: "200% 100%", animation: "shimmer 1.6s linear infinite" }}
        />
      </div>
      <p className="mt-6 text-[11px] tracking-widest text-muted-foreground">
        This takes a moment — every frame is generated just for you.
      </p>
    </section>
  );
}

function RevealStage({
  idea,
  world,
  characters,
  visuals,
  sceneReady,
  onContinue,
  onRestart,
}: {
  idea: string;
  world: WsWorld | null;
  characters: WsCharacter[];
  visuals: VisualState;
  sceneReady: boolean;
  onContinue: () => void;
  onRestart: () => void;
}) {
  return (
    <section className="animate-fade-up">
      <div className="flex items-center justify-between">
        <EyebrowLabel>Your story</EyebrowLabel>
        <button
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Try a new idea
        </button>
      </div>
      <h2 className="mt-4 font-display text-3xl font-light italic leading-tight text-foreground sm:text-4xl">
        “{idea}”
      </h2>

      {/* World card — image streams in from the World & Environment Artist */}
      <article className="mt-12 overflow-hidden border-2 border-hairline bg-surface">
        <div className="relative">
          <StoryImage
            url={visuals.world}
            failed={Boolean(visuals.failed["world"])}
            fallback={mockWorld.image}
            alt={world?.location_name ?? "The world"}
            aspectClass="aspect-[16/8]"
            label="Painting the world"
            width={1600}
            height={900}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        </div>
        <div className="grid gap-8 p-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <EyebrowLabel>The World</EyebrowLabel>
            <h3 className="mt-3 font-display text-3xl font-light text-foreground">
              {world?.location_name}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{world?.time_period}</p>
            <p className="mt-4 text-base leading-relaxed text-foreground">{world?.atmosphere}</p>
          </div>
          {world?.description && (
            <div>
              <EyebrowLabel>Lore</EyebrowLabel>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {world.description}
              </p>
            </div>
          )}
        </div>
      </article>

      {/* Cast */}
      <div className="mt-16">
        <EyebrowLabel>The Cast</EyebrowLabel>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {characters.map((c, i) => {
            const mock = mockCharacters[i];
            return (
              <article
                key={c.name ?? i}
                className="group overflow-hidden border-2 border-hairline bg-surface transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)]"
              >
                <StoryImage
                  url={visuals.characters[i] ?? null}
                  failed={Boolean(visuals.failed[`character:${i}`])}
                  fallback={mock?.portrait}
                  alt={c.name}
                  aspectClass="aspect-[4/5]"
                  label={`Developing ${c.name}`}
                  width={768}
                  height={960}
                />
                <div className="p-6">
                  <h4 className="font-display text-2xl font-light text-foreground">
                    {c.name}
                  </h4>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {c.description}
                  </p>
                  {c.personality && (
                    <p className="mt-3 text-sm italic leading-relaxed text-[color:var(--lavender)]">
                      {c.personality}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-14 flex justify-center">
        <button
          onClick={onContinue}
          disabled={!sceneReady}
          className="group inline-flex items-center gap-2 bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-all duration-500 ease-luxe disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sceneReady ? "Begin the first scene" : "Composing the opening scene…"}
          <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
        </button>
      </div>
    </section>
  );
}

const CHAPTER_LABELS = [
  "Chapter I",
  "Chapter II",
  "Chapter III",
  "Chapter IV",
  "Chapter V",
  "Chapter VI",
  "Chapter VII",
  "Chapter VIII",
  "Chapter IX",
  "Chapter X",
];

function ScenePlayer({
  currentScene,
  choices,
  history,
  isFinal,
  visuals,
  isWaiting,
  streamingText,
  sceneStreamed,
  onChoose,
  onRestart,
  onBack,
  onViewSummary,
}: {
  currentScene: WsScene | null;
  choices: WsChoice[];
  history: ChoiceTaken[];
  isFinal: boolean;
  visuals: VisualState;
  isWaiting: boolean;
  streamingText: string;
  sceneStreamed: boolean;
  onChoose: (label: string) => void;
  onRestart: () => void;
  onBack: () => void;
  onViewSummary: () => void;
}) {
  return (
    <section key={history.length} className="animate-fade-in">
      {/* breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Cast & World
          </button>
          {history.map((h, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="text-[color:var(--lavender)]">›</span>
              <span className="text-foreground">{h.choiceLabel}</span>
            </span>
          ))}
        </div>
        <button
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Restart story
        </button>
      </div>

      {/* scene + context side-by-side */}
      <div className="mt-6 grid gap-8 md:grid-cols-2 md:items-center">
        <figure className="overflow-hidden border-2 border-hairline">
          <StoryImage
            url={visuals.scene}
            failed={Boolean(visuals.failed["scene"])}
            fallback={mockScenes["start"].image}
            alt={currentScene?.location ?? "Scene"}
            aspectClass="aspect-[16/9]"
            label="Composing the scene"
            width={1600}
            height={900}
          />
        </figure>

        <div>
          <p className="eyebrow">
            {isFinal
              ? "Epilogue"
              : (CHAPTER_LABELS[history.length] ?? `Chapter ${history.length + 1}`)}
          </p>
          <h2 className="mt-3 font-display text-3xl font-light leading-tight text-foreground sm:text-4xl lg:text-5xl">
            {currentScene?.location ?? (isFinal ? "The End" : "The Story Continues")}
          </h2>
          <div className="mt-6">
            <StreamingText text={currentScene?.scene_text ?? ""} animate={!sceneStreamed} />
          </div>
        </div>
      </div>

      {/* choices / loading / epilogue */}
      {isWaiting ? (
        streamingText ? (
          // Live prose: the next scene streams in as it's written.
          <div className="mt-12 max-w-3xl animate-fade-in">
            <p className="eyebrow">
              {isFinal
                ? "Epilogue"
                : (CHAPTER_LABELS[history.length] ?? `Chapter ${history.length + 1}`)}
            </p>
            <p className="mt-6 whitespace-pre-line font-display text-lg leading-relaxed text-foreground sm:text-xl">
              {streamingText}
              <span className="ml-0.5 inline-block h-5 w-px translate-y-1 animate-pulse bg-[color:var(--lavender)]" />
            </p>
          </div>
        ) : (
          <div className="mt-12">
            <EyebrowLabel>Your move</EyebrowLabel>
            <div className="mt-5 flex items-center gap-4 rounded-none border-2 border-hairline bg-surface px-6 py-8">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                <div className="absolute inset-0 animate-breathe rounded-full bg-aura blur-lg" />
                <Aperture
                  className="animate-spin-slow relative h-5 w-5 text-[color:var(--lavender)]"
                  strokeWidth={1.25}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-[color:var(--lavender)] animate-pulse">
                  Writing the next scene…
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your choice has been made. The story is continuing.
                </p>
              </div>
            </div>
          </div>
        )
      ) : isFinal ? (
        <div className="mt-12 border-2 border-hairline bg-surface p-10 text-center">
          <EyebrowLabel>End</EyebrowLabel>
          <p className="mx-auto mt-5 max-w-md font-display text-2xl font-light italic leading-relaxed text-foreground">
            Your story has reached its conclusion.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              onClick={onViewSummary}
              className="group inline-flex items-center gap-2 bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-all duration-500 ease-luxe"
            >
              <BookOpen className="h-4 w-4" />
              View your story
              <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-12">
          <EyebrowLabel>Your move</EyebrowLabel>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {choices.map((c, i) => (
              <button
                key={i}
                onClick={() => onChoose(c.choice_text)}
                className="group relative overflow-hidden border-2 border-hairline bg-surface p-6 text-left transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)] hover:bg-background active:border-[color:var(--lavender)] active:bg-background"
              >
                <div className="flex items-start justify-between gap-4">
                  <h4 className="font-display text-xl font-normal text-foreground">
                    {c.choice_text}
                  </h4>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[color:var(--lavender)] transition-transform duration-500 ease-luxe group-hover:translate-x-1 group-active:translate-x-1" />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {c.consequence}
                </p>
                <span className="absolute inset-x-6 bottom-3 h-px origin-left scale-x-0 bg-[color:var(--lavender)] transition-transform duration-500 ease-luxe group-hover:scale-x-100 group-active:scale-x-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StorySummary({
  idea,
  world,
  characters,
  allScenes,
  visuals,
  onRestart,
  onReview,
  onShare,
  readOnly,
  isReviewing,
  review,
}: {
  idea: string;
  world: WsWorld | null;
  characters: WsCharacter[];
  allScenes: SceneEntry[];
  visuals: VisualState;
  onRestart: () => void;
  onReview: () => void;
  onShare: () => void;
  readOnly?: boolean;
  isReviewing: boolean;
  review: {
    overall_impression: string;
    narrative_arc: string;
    inconsistencies: { type: string; description: string }[];
    highlights: string[];
    suggestions: string[];
  } | null;
}) {
  return (
    <section className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <EyebrowLabel>Your story</EyebrowLabel>
        <div className="flex items-center gap-4">
          {!readOnly && (
            <button
              onClick={onShare}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Copy link
            </button>
          )}
          <button
            onClick={onRestart}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> {readOnly ? "Create your own" : "Try a new idea"}
          </button>
        </div>
      </div>
      <h2 className="mt-4 font-display text-3xl font-light italic leading-tight text-foreground sm:text-4xl">
        “{idea}”
      </h2>

      {/* World */}
      <article className="mt-12 overflow-hidden border-2 border-hairline bg-surface">
        <div className="relative">
          <StoryImage
            url={visuals.world}
            failed={Boolean(visuals.failed["world"])}
            fallback={mockWorld.image}
            alt={world?.location_name ?? "The world"}
            aspectClass="aspect-[16/8]"
            label="Painting the world"
            width={1600}
            height={900}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        </div>
        <div className="p-8">
          <EyebrowLabel>The World</EyebrowLabel>
          <h3 className="mt-3 font-display text-3xl font-light text-foreground">
            {world?.location_name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{world?.time_period}</p>
          <p className="mt-4 text-base leading-relaxed text-foreground">{world?.atmosphere}</p>
        </div>
      </article>

      {/* Cast */}
      <div className="mt-16">
        <EyebrowLabel>The Cast</EyebrowLabel>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c, i) => {
            const mock = mockCharacters[i];
            return (
              <article
                key={c.name ?? i}
                className="overflow-hidden border-2 border-hairline bg-surface"
              >
                <StoryImage
                  url={visuals.characters[i] ?? null}
                  failed={Boolean(visuals.failed[`character:${i}`])}
                  fallback={mock?.portrait}
                  alt={c.name}
                  aspectClass="aspect-[4/5]"
                  label={`Developing ${c.name}`}
                  width={768}
                  height={960}
                />
                <div className="p-5">
                  <h4 className="font-display text-lg font-light text-foreground">{c.name}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {c.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Your path — a cinematic film strip of the journey taken */}
      {allScenes.length > 1 && (
        <div className="mt-16">
          <EyebrowLabel>Your path</EyebrowLabel>
          <div className="mt-6 overflow-x-auto pb-2">
            <div className="flex items-center">
              {allScenes.map((entry, i) => {
                const isLast = i === allScenes.length - 1;
                const sprockets = (
                  <div className="flex justify-around gap-1 bg-foreground/5 px-1.5 py-1">
                    {Array.from({ length: 6 }).map((_, k) => (
                      <span key={k} className="h-1.5 w-2 rounded-[1px] bg-background" />
                    ))}
                  </div>
                );
                return (
                  <div key={i} className="flex items-center">
                    <div
                      className={`relative w-44 shrink-0 border-2 bg-surface ${
                        isLast ? "border-[color:var(--lavender)]" : "border-hairline"
                      }`}
                    >
                      {sprockets}
                      <div className="px-3 py-3">
                        <p className="eyebrow text-[10px]">
                          {isLast ? "The End" : (CHAPTER_LABELS[i] ?? `Ch ${i + 1}`)}
                        </p>
                        <p className="mt-1 line-clamp-3 font-display text-sm leading-snug text-foreground">
                          {entry.scene?.location || entry.scene?.scene_text?.slice(0, 60) || "Scene"}
                        </p>
                      </div>
                      {sprockets}
                    </div>
                    {entry.choice && (
                      <div className="flex w-28 shrink-0 flex-col items-center px-1 text-center">
                        <ArrowRight className="h-4 w-4 text-[color:var(--lavender)]" />
                        <span className="mt-1 line-clamp-2 text-[11px] leading-tight text-[color:var(--lavender)]">
                          {entry.choice}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Story flow */}
      <div className="mt-16">
        <EyebrowLabel>The Story</EyebrowLabel>
        <div className="mt-8">
          {allScenes.map((entry, i) => {
            const isLast = i === allScenes.length - 1;
            return (
              <div key={i}>
                <div
                  className={
                    isLast
                      ? "border-2 border-[color:var(--lavender)] bg-surface p-6"
                      : "border-2 border-hairline bg-surface p-6"
                  }
                >
                  <p className="eyebrow mb-3">
                    {isLast ? "The End" : (CHAPTER_LABELS[i] ?? `Chapter ${i + 1}`)}
                  </p>
                  <p className="text-sm leading-relaxed text-foreground">
                    {entry.scene?.scene_text}
                  </p>
                </div>

                {entry.choice && (
                  <div className="flex items-center gap-3 py-4 pl-6">
                    <span className="inline-block h-px w-6 bg-[color:var(--lavender)]" />
                    <span className="text-sm font-medium text-[color:var(--lavender)]">
                      → {entry.choice}
                    </span>
                  </div>
                )}

                {!entry.choice && !isLast && <div className="h-4" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Story Review — opt-in after story completion (hidden on shared read-only views) */}
      <div className="mt-20">
        {!readOnly && !review && !isReviewing && (
          <div className="border-2 border-hairline bg-surface p-10 text-center">
            <EyebrowLabel>Story Review</EyebrowLabel>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Want a literary editor's take? Get a holistic review of your story —
              character consistency, narrative arc, and suggestions for a future telling.
            </p>
            <button
              onClick={onReview}
              className="mt-8 inline-flex items-center gap-2 border-2 border-[color:var(--lavender)] bg-background px-6 py-3 text-sm font-medium text-[color:var(--lavender)] transition-all duration-300 hover:bg-[color:var(--lavender)] hover:text-background"
            >
              <Sparkles className="h-4 w-4" />
              Evaluate my story
            </button>
          </div>
        )}

        {isReviewing && (
          <div className="border-2 border-hairline bg-surface p-10 text-center">
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 animate-breathe rounded-full bg-aura blur-xl" />
              <Aperture
                className="animate-spin-slow relative h-8 w-8 text-[color:var(--lavender)]"
                strokeWidth={1.25}
              />
            </div>
            <p className="mt-6 text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--lavender)] animate-pulse">
              Reading your story
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The editor is reviewing all scenes for consistency and craft…
            </p>
          </div>
        )}

        {review && (
          <div className="animate-fade-up border-2 border-[color:var(--lavender)] bg-surface">
            {/* Overall */}
            <div className="border-b-2 border-hairline p-8">
              <EyebrowLabel>Story Review</EyebrowLabel>
              <p className="mt-4 text-base leading-relaxed text-foreground">
                {review.overall_impression}
              </p>
            </div>

            {/* Arc + Inconsistencies */}
            <div className="grid divide-y-2 divide-hairline md:grid-cols-2 md:divide-x-2 md:divide-y-0">
              <div className="p-8">
                <EyebrowLabel>Narrative Arc</EyebrowLabel>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {review.narrative_arc}
                </p>
              </div>
              {review.inconsistencies.length > 0 && (
                <div className="p-8">
                  <EyebrowLabel>Inconsistencies</EyebrowLabel>
                  <ul className="mt-3 space-y-3">
                    {review.inconsistencies.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lavender)]" />
                        <div>
                          <span className="eyebrow text-[10px]">{item.type}</span>
                          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Highlights + Suggestions */}
            <div className="grid divide-y-2 divide-hairline border-t-2 border-hairline md:grid-cols-2 md:divide-x-2 md:divide-y-0">
              <div className="p-8">
                <EyebrowLabel>Highlights</EyebrowLabel>
                <ul className="mt-3 space-y-2">
                  {review.highlights.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lavender)]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-8">
                <EyebrowLabel>Suggestions</EyebrowLabel>
                <ul className="mt-3 space-y-2">
                  {review.suggestions.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lavender)]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-16 flex flex-wrap justify-center gap-3">
        <button
          onClick={onRestart}
          className="inline-flex items-center gap-2 bg-foreground px-6 py-3 text-sm font-medium text-background transition-all"
        >
          <RotateCcw className="h-4 w-4" /> Try a new idea
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 border-2 border-hairline bg-background px-6 py-3 text-sm text-foreground transition-colors hover:border-[color:var(--lavender)]"
        >
          Back to home
        </Link>
      </div>
    </section>
  );
}
