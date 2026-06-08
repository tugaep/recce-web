import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

function DemoPage() {
  const [stage, setStage] = useState<Stage>("idea");
  const [idea, setIdea] = useState("");
  const [history, setHistory] = useState<ChoiceTaken[]>([]);

  const { sendMessage, lastMessage } = useWebSocket();

  const [characters, setCharacters] = useState<WsCharacter[]>([]);
  const [world, setWorld] = useState<WsWorld | null>(null);
  const [currentScene, setCurrentScene] = useState<WsScene | null>(null);
  const [choices, setChoices] = useState<WsChoice[]>([]);
  const [isFinal, setIsFinal] = useState(false);
  const [allScenes, setAllScenes] = useState<SceneEntry[]>([]);
  const [visuals, setVisuals] = useState<VisualState>(emptyVisualState);
  const [errorMsg, setErrorMsg] = useState("");

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
      setCurrentScene(p.scene);
      setChoices(p.choices);
      setIsFinal(Boolean(p.is_final));
      setAllScenes((prev) => [...prev, { scene: p.scene, choice: null }]);
      // New scene begins rendering — clear the prior scene image, keep cast/world.
      setVisuals((prev) => resetScene(prev));
      setStage("play");
    }

    if (msg.type === "image_ready") {
      const p = msg.payload as unknown as ImageReadyPayload;
      setVisuals((prev) => applyImageReady(prev, p));
    }

    if (msg.type === "error") {
      const p = msg.payload as { message?: string };
      setErrorMsg(p?.message || "Something went wrong while building your story.");
      // Only the generation phase has nothing to show — surface a recoverable screen.
      setStage((s) => (s === "dreaming" ? "error" : s));
    }
  }, [lastMessage]);

  function submitIdea(value: string) {
    const v = value.trim();
    if (!v) return;
    setIdea(v);
    sendMessage("start_story", { idea: v });
    setStage("dreaming");
  }

  function chooseScene(choiceLabel: string) {
    setHistory((h) => [...h, { sceneTitle: currentScene?.location ?? "", choiceLabel }]);
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
            </form>
          </section>
        )}

        {stage === "dreaming" && <DreamingLoader idea={idea} />}

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

function DreamingLoader({ idea }: { idea: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => {
      // Advance through phases, then hold on the last ("Rolling camera").
      setPhase((p) => Math.min(p + 1, DREAM_PHASES.length - 1));
    }, 3200);
    return () => window.clearInterval(id);
  }, []);

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

      {/* choices or epilogue */}
      {isFinal ? (
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
}: {
  idea: string;
  world: WsWorld | null;
  characters: WsCharacter[];
  allScenes: SceneEntry[];
  visuals: VisualState;
  onRestart: () => void;
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
