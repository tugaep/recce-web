import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserGroupIcon,
  Globe02Icon,
  GitBranchIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { EyebrowLabel } from "@/components/site/EyebrowLabel";
import FloatingLines from "@/components/ui/FloatingLines";

type IconProps = { className?: string };
const Users = (p: IconProps) => <HugeiconsIcon icon={UserGroupIcon} {...p} />;
const Globe2 = (p: IconProps) => <HugeiconsIcon icon={Globe02Icon} {...p} />;
const GitBranch = (p: IconProps) => <HugeiconsIcon icon={GitBranchIcon} {...p} />;
const ArrowRight = (p: IconProps) => <HugeiconsIcon icon={ArrowRight01Icon} {...p} />;

export const Route = createFileRoute("/")({
  component: Index,
});

// recce brand palette — lavender → soft → blush, looped, drives the hero waves.
const BRAND_LINES = ["#8B5FE5", "#A77FE8", "#C9B8E8", "#F1B4C9", "#8B5FE5"];

const pillars = [
  {
    icon: Users,
    title: "Characters",
    body: "Principal cast briefed the way a casting director would. Backstory, motivation, the line they wouldn't say.",
  },
  {
    icon: Globe2,
    title: "Worlds",
    body: "Production design before the set exists. Period and place, drawn from the script up.",
  },
  {
    icon: GitBranch,
    title: "Choices",
    body: "A branching screenplay. Pick a choice and the next scene rewrites around it.",
  },
];

const steps = [
  { n: "01", title: "Bring a logline", body: "A sentence works, or a single image." },
  { n: "02", title: "Read the sides", body: "The character designer drafts a principal cast you can read the way a casting director reads sides." },
  { n: "03", title: "Scout the world", body: "The world builder fills in period and place with production-design notes." },
  { n: "04", title: "Roll the scene", body: "Read, decide, and the next beat is written around your choice." },
];

const agents = [
  { name: "Orchestrator", role: "Runs the production. Tracks where the story is and what comes next." },
  { name: "Character Designer", role: "Drafts the principal cast with backstory and motivation." },
  { name: "World Builder", role: "Production design. Period, place, and the look the script asks for." },
  { name: "Visual Designer", role: "Cinematography. Turns the script into shots." },
  { name: "Storyteller", role: "The writer in the room. Drafts the scene and the choices that follow." },
  { name: "Judge", role: "Script supervisor. Keeps continuity and tone." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* HERO — dark stage so FloatingLines' screen blend reveals the brand palette */}
      <section className="dark relative isolate overflow-hidden bg-[color:var(--background)] text-[color:var(--foreground)]">
        <div className="absolute inset-0 z-0">
          <FloatingLines
            linesGradient={BRAND_LINES}
            mixBlendMode="screen"
            animationSpeed={0.6}
            interactive={true}
            bendRadius={5}
            bendStrength={-0.35}
            parallax={true}
            parallaxStrength={0.12}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(60%_50%_at_50%_30%,transparent_0%,oklch(0.18_0.03_285/0.6)_100%)]" />
        <div className="pointer-events-none absolute inset-0 z-[1] grain opacity-40" />

        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-8 pb-24 pt-32 md:px-12">
          <div className="mt-auto max-w-5xl">
            <div className="animate-fade-up [animation-delay:120ms]">
              <EyebrowLabel>AI Interactive Storytelling</EyebrowLabel>
            </div>

            <h1 className="mt-10 font-display text-[clamp(3rem,9vw,9.5rem)] font-light leading-[0.95] tracking-[-0.03em] text-[color:var(--foreground)] animate-fade-up [animation-delay:240ms]">
              Where imagination
              <br />
              <em className="not-italic text-[color:var(--lavender)]">becomes</em>{" "}
              experience.
            </h1>

            <div className="mt-14 flex justify-end animate-fade-up [animation-delay:420ms]">
              <div className="flex items-center gap-6">
                <Link
                  to="/demo"
                  className="group inline-flex items-center gap-3 border border-[color:var(--foreground)] bg-[color:var(--foreground)] px-7 py-4 text-sm font-medium tracking-wide text-[color:var(--background)] transition-all duration-500 ease-luxe hover:bg-transparent hover:text-[color:var(--foreground)]"
                >
                  Begin a story
                  <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
                </Link>
                <a
                  href="#how"
                  className="hidden text-sm tracking-wide text-[color:var(--foreground)] underline-offset-8 transition-opacity duration-300 hover:opacity-60 sm:inline"
                >
                  How it works
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MANIFESTO — quiet transition */}
      <section className="relative border-t border-hairline bg-background">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-3">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                I. Premise
              </span>
            </div>
            <p className="md:col-span-9 font-display text-[clamp(1.75rem,3.2vw,3rem)] font-light leading-[1.15] tracking-[-0.015em] text-foreground">
              A recce is the location scout a director runs before principal
              photography. We borrowed the{" "}
              <em className="not-italic text-[color:var(--lavender)]">term</em>.
              Bring a logline. A studio of agents handles casting, world, and script
              alongside you.
            </p>
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section className="relative border-t border-hairline bg-background">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-3">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                II. Departments
              </span>
              <h2 className="mt-8 font-display text-4xl font-light leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl">
                Three departments,
                <br />
                one production.
              </h2>
            </div>

            <div className="md:col-span-9 grid gap-px bg-hairline sm:grid-cols-3">
              {pillars.map((p, i) => (
                <article
                  key={p.title}
                  className="group relative bg-background p-10 transition-colors duration-700 ease-luxe hover:bg-surface"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center border border-hairline text-[color:var(--lavender)] transition-colors duration-500 group-hover:border-[color:var(--lavender)]">
                      <p.icon className="h-4 w-4" />
                    </div>
                    <span className="text-xs tracking-[0.22em] text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-12 font-display text-2xl font-light tracking-[-0.01em] text-foreground">
                    {p.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {p.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="relative border-t border-hairline bg-surface">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-4">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                III. Workflow
              </span>
              <h2 className="mt-8 font-display text-4xl font-light leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl md:text-6xl">
                From logline
                <br />
                to playable
                <br />
                <em className="not-italic text-[color:var(--lavender)]">scene</em>.
              </h2>
            </div>

            <ol className="md:col-span-8 divide-y divide-hairline border-y border-hairline">
              {steps.map((s) => (
                <li
                  key={s.n}
                  className="group grid grid-cols-[auto_1fr] items-baseline gap-8 py-10 transition-colors duration-500 ease-luxe md:grid-cols-[6rem_1fr_2fr]"
                >
                  <span className="font-display text-sm tracking-[0.22em] text-[color:var(--lavender)]">
                    {s.n}
                  </span>
                  <h3 className="font-display text-2xl font-light tracking-[-0.01em] text-foreground sm:text-3xl">
                    {s.title}
                  </h3>
                  <p className="col-span-2 text-sm leading-relaxed text-muted-foreground md:col-span-1">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* AGENT ENSEMBLE */}
      <section className="relative border-t border-hairline bg-background">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-5">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                IV. Crew
              </span>
              <h2 className="mt-8 font-display text-4xl font-light leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl md:text-6xl">
                A studio,
                <br />
                by <em className="not-italic text-[color:var(--lavender)]">department</em>.
              </h2>
              <p className="mt-8 max-w-md text-sm leading-relaxed text-muted-foreground">
                Recce isn't one model doing every job. It's a crew of agents, each
                running one department off the same script.
              </p>
            </div>

            <div className="md:col-span-7 grid gap-px bg-hairline sm:grid-cols-2">
              {agents.map((a, i) => (
                <div
                  key={a.name}
                  className="group relative bg-background p-8 transition-colors duration-700 ease-luxe hover:bg-surface"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="inline-block h-1.5 w-1.5 bg-lavender-gradient" />
                      <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                        Agent. 0{i + 1}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-8 font-display text-2xl font-light tracking-[-0.01em] text-foreground">
                    {a.name}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {a.role}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="relative border-t border-hairline bg-background">
        <div className="mx-auto max-w-7xl px-8 py-40 text-center md:px-12">
          <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            V. Action
          </span>
          <h2 className="mx-auto mt-10 max-w-5xl font-display text-[clamp(2.5rem,7vw,7rem)] font-light leading-[0.98] tracking-[-0.03em] text-foreground">
            A logline
            <br />
            <em className="not-italic text-[color:var(--lavender)]">is enough</em>.
          </h2>
          <div className="mt-16">
            <Link
              to="/demo"
              className="group inline-flex items-center gap-3 border border-foreground bg-foreground px-8 py-4 text-sm font-medium tracking-wide text-background transition-all duration-500 ease-luxe hover:bg-transparent hover:text-foreground"
            >
              Start a recce
              <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
