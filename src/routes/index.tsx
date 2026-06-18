import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Users, Globe2, GitBranch, ArrowRight } from "lucide-react";
import heroAura from "@/assets/hero-aura.jpg";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { EyebrowLabel } from "@/components/site/EyebrowLabel";

export const Route = createFileRoute("/")({
  component: Index,
});

const pillars = [
  {
    icon: Users,
    title: "Characters",
    body: "A cast generated with names, backstories, and the small contradictions that make people feel real.",
  },
  {
    icon: Globe2,
    title: "Worlds",
    body: "Era, atmosphere, the rules of the place. Designed to be inhabited, not merely described.",
  },
  {
    icon: GitBranch,
    title: "Choices",
    body: "A branching narrative that responds to you. Every decision moves the story to a different country.",
  },
];

const steps = [
  { n: "01", title: "Bring an idea", body: "A line is enough. A premise, a feeling, a single image." },
  { n: "02", title: "Meet the cast", body: "A specialist agent designs characters with depth and intent." },
  { n: "03", title: "Step into the world", body: "Locations, era, and atmosphere render around you." },
  { n: "04", title: "Play the story", body: "Read, decide, and watch the narrative reshape itself." },
];

const agents = [
  { name: "Orchestrator", role: "Routes the story, holds the state." },
  { name: "Character Designer", role: "Names, backstories, identity." },
  { name: "World Builder", role: "Era, atmosphere, rules of the place." },
  { name: "Visual Designer", role: "Translates words into cinematic frames." },
  { name: "Storyteller", role: "Writes the scene and offers the choices." },
  { name: "Judge", role: "Quietly guards continuity and tone." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* HERO */}
      <section className="relative isolate overflow-hidden">
        <img
          src={heroAura}
          alt=""
          aria-hidden
          fetchPriority="high"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          width={1920}
          height={1280}
        />
        <div className="pointer-events-none absolute inset-0 bg-mist" />
        <div className="pointer-events-none absolute inset-0 bg-aura" />
        <div className="pointer-events-none absolute inset-0 grain" />

        <div className="relative mx-auto flex min-h-[92vh] max-w-6xl flex-col items-center justify-center px-6 pb-24 pt-40 text-center">
          <div className="animate-fade-up">
            <EyebrowLabel>AI Interactive Storytelling Studio</EyebrowLabel>
          </div>
          <h1 className="mt-6 max-w-4xl text-balance font-display text-5xl font-light leading-[1.05] tracking-tight text-foreground sm:text-6xl md:text-7xl animate-fade-up [animation-delay:120ms]">
            Where imagination
            <br />
            <em className="not-italic text-[color:var(--lavender)]">
              becomes experience
            </em>
            .
          </h1>
          <p className="mt-7 max-w-xl text-balance text-base leading-relaxed text-muted-foreground animate-fade-up [animation-delay:240ms]">
            Bring a single idea. Recce assembles a cast, a world, and a
            choice-driven story you step inside — like a film you can play.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-up [animation-delay:360ms]">
            <Link
              to="/demo"
              className="group inline-flex items-center gap-2 bg-foreground px-6 py-3 text-sm font-medium text-background transition-all duration-500 ease-luxe"
            >
              Begin a story
              <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 border-2 border-hairline bg-surface px-6 py-3 text-sm text-foreground transition-colors hover:border-[color:var(--lavender)]"
            >
              How it works
            </a>
          </div>

          <div className="mt-16 flex items-center gap-2 text-xs text-muted-foreground animate-fade-in [animation-delay:600ms]">
            <Sparkles className="h-3.5 w-3.5 text-[color:var(--lavender)]" />
            A demo with mocked story data — no account needed.
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section className="relative border-t-2 border-hairline bg-background">
        <div className="mx-auto grid max-w-6xl gap-3 px-6 sm:grid-cols-3">
          {pillars.map((p) => (
            <article
              key={p.title}
              className="group border-2 border-foreground bg-background p-10 transition-colors duration-500 ease-luxe hover:bg-surface"
            >
              <div className="flex h-10 w-10 items-center justify-center border-2 border-hairline text-[color:var(--lavender)] transition-colors group-hover:border-[color:var(--lavender)]">
                <p.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-6 font-display text-2xl font-light text-foreground">
                {p.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="relative border-t-2 border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <div className="max-w-2xl">
            <EyebrowLabel>How it works</EyebrowLabel>
            <h2 className="mt-5 font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
              From an idea, in four quiet movements.
            </h2>
          </div>

          <ol className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li
                key={s.n}
                className="border-2 border-foreground bg-background p-8 transition-colors duration-500 ease-luxe hover:bg-surface"
              >
                <div className="font-display text-sm tracking-widest text-[color:var(--lavender)]">
                  {s.n}
                </div>
                <h3 className="mt-3 font-display text-xl font-normal text-foreground">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* AGENT ENSEMBLE */}
      <section className="relative border-t-2 border-hairline bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <EyebrowLabel>The Ensemble</EyebrowLabel>
              <h2 className="mt-5 font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
                A small studio of specialist minds.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Recce is not one model trying to do everything. It is a quiet
                ensemble — each agent with one craft, working together in a
                shared narrative state.
              </p>
            </div>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <div
                key={a.name}
                className="group border-2 border-hairline bg-background p-6 transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-block h-1.5 w-1.5 bg-lavender-gradient" />
                  <span className="eyebrow">Agent</span>
                </div>
                <h3 className="mt-3 font-display text-xl font-normal text-foreground">
                  {a.name}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{a.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="relative border-t-2 border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 py-28 text-center">
          <EyebrowLabel>Your turn</EyebrowLabel>
          <h2 className="max-w-3xl font-display text-4xl font-light leading-tight text-foreground sm:text-6xl">
            Step into your first scene.
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            A short, simulated playthrough. Three scenes. Two paths. Yours.
          </p>
          <Link
            to="/demo"
            className="group inline-flex items-center gap-2 bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-all duration-500 ease-luxe"
          >
            Enter the demo
            <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
