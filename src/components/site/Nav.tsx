import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="group flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 bg-lavender-gradient"
          />
          <span className="font-display text-xl tracking-tight text-foreground">
            recce
          </span>
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            Home
          </Link>
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 border-2 border-hairline bg-surface px-4 py-1.5 text-foreground transition-all duration-500 ease-luxe hover:border-[color:var(--lavender)]"
          >
            Experience demo
            <span aria-hidden className="text-[color:var(--lavender)]">→</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
