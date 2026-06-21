import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon } from "@hugeicons/core-free-icons";
import { AmbientToggle } from "./AmbientToggle";

export function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="flex w-full items-center justify-between px-8 py-6">
        <Link
          to="/"
          aria-label="Home"
          title="Home"
          className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={Home01Icon} className="h-4 w-4" />
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            to="/about"
            className="text-xs uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
          >
            About us
          </Link>
          <AmbientToggle />
        </nav>
      </div>
    </header>
  );
}
