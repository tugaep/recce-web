import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Sparkles, ArrowRight, BookOpen, Aperture } from "lucide-react";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { EyebrowLabel } from "@/components/site/EyebrowLabel";
import { StreamingText } from "@/components/demo/StreamingText";
import { StoryImage } from "@/components/demo/StoryImage";
import { mockCharacters, mockScenes, mockWorld, startingSuggestions } from "@/data/mockStory";
import { useWebSocket } from "@/hooks/useWebSocket";
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
  const [idea, setIdea] = useState("");
  const [history, setHistory] = useState<ChoiceTaken[]>([]);
  const [textPreset, setTextPreset] = useState("balanced");
  const [imagePreset, setImagePreset] = useState("standard");
  const [progressStage, setProgressStage] = useState<string | null>(null);

  const { sendMessage, lastMessage } = useWebSocket();

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

    if (msg.type === "story_started") {
      const p = msg.payload as unknown as {
        characters: WsCharacter[];
        world: WsWorld;
        scene: WsScene;
        choices: WsChoice[];
      };
      setCharacters(p.characters);
      setWorld(p.world);
      setCurrentScene(p.scene);
      setChoices(p.choices);
      setAllScenes([{ scene: p.scene, choice: null }]);
      setVisuals(emptyVisualState);
      setStage("reveal");
    }

    if (msg.type === "choice_applied") {
      const p = msg.payload as unknown as {
        scene: WsScene;
        choices: WsChoice[];
        is_final?: boolean;
      };
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
      setErrorMsg(p?.message || "Something went wrong while building your story.");
      setStage((s) => (s === "dreaming" ? "error" : s));
      setIsReviewing(false);
    }
  }, [lastMessage]);

  function submitIdea(value: string) {
    const v = value.trim();
    if (!v) return;
    setIdea(v);
    setProgressStage(null);
    sendMessage("start_story", { idea: v, text_preset: textPreset, image_preset: imagePreset });
    setStage("dreaming");
  }

  function chooseScene(choiceLabel: string) {
    // Store the choice label — history is updated when choice_applied arrives
    // so ScenePlayer's key doesn't change (and re-mount) before the new scene
    // text is ready, which was causing the old chapter to stream again.
    pendingChoiceRef.current = choiceLabel;
    setIsWaitingForScene(true);
    setAllScenes((prev) =>
      prev.map((s, i) => (i === prev.length - 1 ? { ...s, choice: choiceLabel } : s)),
    );
    sendMessage("make_choice", { choice: choiceLabel });
  }

  function restart() {
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
    setReview(null);
    setIsReviewing(false);
  }

  function handleReview() {
    if (isReviewing || review) return;
    sendMessage("review_story", {});
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <Nav />

      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-aura" />

      <main className="mx-auto max-w-5xl px-6 pb-24 pt-32">
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
                    Press enter — or pick a starting point.
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 bg-foreground px-5 py-2 text-sm font-medium text-background transition-all"
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
                    className="border-2 border-hairline bg-background px-4 py-1.5 text-xs text-muted-foreground transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)] hover:text-foreground"
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
                onClick={restart}
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
  onContinue,
  onRestart,
}: {
  idea: string;
  world: WsWorld | null;
  characters: WsCharacter[];
  visuals: VisualState;
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
                  {mock?.role && <p className="eyebrow">{mock.role}</p>}
                  <h4 className="mt-2 font-display text-2xl font-light text-foreground">
                    {c.name}
                  </h4>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {c.description}
                  </p>
                  {mock?.traits && mock.traits.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {mock.traits.map((t) => (
                        <span
                          key={t}
                          className="border-2 border-hairline bg-background px-3 py-1 text-[11px] tracking-wide text-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
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
          className="group inline-flex items-center gap-2 bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-all duration-500 ease-luxe"
        >
          Begin the first scene
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

      {/* image — scene illustration streams in from the Scene Composer */}
      <figure className="mt-6 overflow-hidden border-2 border-hairline">
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

      {/* narrative */}
      <div className="mt-10 max-w-3xl">
        <p className="eyebrow">
          {isFinal
            ? "Epilogue"
            : (CHAPTER_LABELS[history.length] ?? `Chapter ${history.length + 1}`)}
        </p>
        <h2 className="mt-3 font-display text-3xl font-light leading-tight text-foreground sm:text-4xl">
          {currentScene?.location ?? (isFinal ? "The End" : "The Story Continues")}
        </h2>
        <div className="mt-6">
          <StreamingText text={currentScene?.scene_text ?? ""} />
        </div>
      </div>

      {/* choices / loading / epilogue */}
      {isWaiting ? (
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
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {choices.map((c, i) => (
              <button
                key={i}
                onClick={() => onChoose(c.choice_text)}
                className="group relative overflow-hidden border-2 border-hairline bg-surface p-6 text-left transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)] hover:bg-background"
              >
                <div className="flex items-start justify-between gap-4">
                  <h4 className="font-display text-xl font-normal text-foreground">
                    {c.choice_text}
                  </h4>
                  <ArrowRight className="mt-1 h-4 w-4 text-[color:var(--lavender)] transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {c.consequence}
                </p>
                <span className="absolute inset-x-6 bottom-3 h-px origin-left scale-x-0 bg-[color:var(--lavender)] transition-transform duration-500 ease-luxe group-hover:scale-x-100" />
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

      {/* Story Review — opt-in after story completion */}
      <div className="mt-20">
        {!review && !isReviewing && (
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
