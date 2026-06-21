import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Linkedin01Icon,
  GithubIcon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { EyebrowLabel } from "@/components/site/EyebrowLabel";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Recce" },
      {
        name: "description",
        content:
          "Learn about Recce — the AI interactive storytelling studio and the team behind it.",
      },
    ],
  }),
  component: About,
});

type IconProps = { className?: string };
const ArrowRight = (p: IconProps) => (
  <HugeiconsIcon icon={ArrowRight01Icon} {...p} />
);


type SocialLink = {
  type: "linkedin" | "github" | "mail";
  href: string;
  label: string;
};

const team = [
  {
    initials: "RK",
    name: "Rana Kara",
    bio: "Responsible for shaping the storytelling system, turning ideas into structured narratives and interactive experiences.",
    socials: [
      { type: "linkedin" as const, href: "https://www.linkedin.com/in/rana-karaa/", label: "LinkedIn" },
      { type: "github" as const, href: "https://github.com/ranakaraa", label: "GitHub" },
      { type: "mail" as const, href: "mailto:ranakara2002@gmail.com", label: "Email" },
    ] satisfies SocialLink[],
  },
  {
    initials: "TED",
    name: "Tuğrap Efe Dikpınar",
    bio: "Focuses on the visual and user experience side of Recce, bringing stories and worlds to life through design and interfaces.",
    socials: [
      { type: "linkedin" as const, href: "https://www.linkedin.com/in/tugrapefedikpinar/", label: "LinkedIn" },
      { type: "github" as const, href: "https://github.com/tugaep", label: "GitHub" },
      { type: "mail" as const, href: "mailto:tugaep@gmail.com", label: "Email" },
    ] satisfies SocialLink[],
  },
];

const socialIcons = {
  linkedin: Linkedin01Icon,
  github: GithubIcon,
  mail: Mail01Icon,
} as const;


function About() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* HERO */}
      <section className="relative border-b border-hairline bg-background pt-40 pb-32">
        <div className="mx-auto max-w-7xl px-8 md:px-12">
          <div className="animate-fade-up [animation-delay:80ms]">
            <EyebrowLabel>About Recce</EyebrowLabel>
          </div>
          <h1 className="mt-10 max-w-4xl font-display text-[clamp(2.8rem,7vw,7.5rem)] font-light leading-[0.95] tracking-[-0.03em] text-foreground animate-fade-up [animation-delay:200ms]">
            A studio built{" "}
            <em className="not-italic text-[color:var(--lavender)]">
              for stories
            </em>
            <br />
            that deserve to exist.
          </h1>
          <p className="mt-12 max-w-2xl text-base leading-relaxed text-muted-foreground animate-fade-up [animation-delay:360ms]">
            Recce started with a simple belief: the gap between a
            story idea and a playable, cinematic world should be
            measured in seconds, not in years of creative or technical
            effort. We built the studio we wished existed.
            <br /><br />
            Developed as part of our Data Science course, Recce explores
            how generative AI can transform ideas into interactive storytelling experiences.
          </p>
        </div>
      </section>

      {/* MISSION */}
      <section className="relative border-b border-hairline bg-surface">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-3">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Our Mission
              </span>
            </div>
            <div className="md:col-span-9 space-y-8">
              <p className="font-display text-[clamp(1.6rem,3vw,2.75rem)] font-light leading-[1.15] tracking-[-0.015em] text-foreground">
                No idea is too small to {" "}
                <em className="not-italic text-[color:var(--lavender)]">
                  become a world.
                </em>
              </p>
              <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                Recce’s mission is to break down the barriers between
                imagination and creation by transforming simple ideas
                into immersive, interactive storytelling experiences.
                We believe that everyone should have the ability to step
                inside the worlds they imagine, without needing technical
                skills, production resources, or specialized knowledge.
              </p>
            </div>
          </div>
        </div>
      </section>


      {/* TEAM */}
      <section className="relative border-b border-hairline bg-background">
        <div className="mx-auto max-w-7xl px-8 py-32 md:px-12">
          <div className="grid gap-16 md:grid-cols-12">
            <div className="md:col-span-5">
              <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Team
              </span>
              <h2 className="mt-8 font-display text-4xl font-light leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl md:text-6xl">
                Meet our{" "}
                <em className="not-italic text-[color:var(--lavender)]">
                  team.
                </em>

              </h2>

            </div>

            <div className="md:col-span-7 grid gap-px bg-hairline sm:grid-cols-1">
              {team.map((member, i) => (
                <div
                  key={member.name + i}
                  className="group relative bg-background p-8 transition-colors duration-700 ease-luxe hover:bg-surface"
                >
                  <div className="flex items-start gap-6">
                    {/* Avatar */}
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-hairline bg-surface font-display text-base font-light text-[color:var(--lavender)] transition-colors duration-500 group-hover:border-[color:var(--lavender)]">
                      {member.initials}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-display text-xl font-light tracking-[-0.01em] text-foreground">
                            {member.name}
                          </h3>


                        </div>

                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {member.bio}
                      </p>
                      {/* Social links */}
                      <div className="mt-5 flex items-center gap-2">
                        {member.socials.map((s) => (
                          <a
                            key={s.type}
                            href={s.href}
                            target={s.type !== "mail" ? "_blank" : undefined}
                            rel={s.type !== "mail" ? "noopener noreferrer" : undefined}
                            aria-label={s.label}
                            title={s.label}
                            className="inline-flex h-8 w-8 items-center justify-center border border-hairline text-muted-foreground transition-all duration-300 ease-luxe hover:border-[color:var(--lavender)] hover:text-[color:var(--lavender)]"
                          >
                            <HugeiconsIcon icon={socialIcons[s.type]} className="h-3.5 w-3.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
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
            Action
          </span>
          <h2 className="mx-auto mt-10 max-w-5xl font-display text-[clamp(2.5rem,7vw,7rem)] font-light leading-[0.98] tracking-[-0.03em] text-foreground">
            Ready to tell
            <br />
            <em className="not-italic text-[color:var(--lavender)]">
              your story
            </em>
            ?
          </h2>
          <div className="mt-16 flex flex-wrap justify-center gap-4">
            <Link
              to="/demo"
              className="group inline-flex items-center gap-3 border border-foreground bg-foreground px-8 py-4 text-sm font-medium tracking-wide text-background transition-all duration-500 ease-luxe hover:bg-transparent hover:text-foreground"
            >
              Begin a story
              <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-luxe group-hover:translate-x-1" />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-3 border border-foreground px-8 py-4 text-sm font-medium tracking-wide text-foreground transition-all duration-500 ease-luxe hover:bg-foreground hover:text-background"
            >
              Back to home
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
