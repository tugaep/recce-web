export function Footer() {
  return (
    <footer className="border-t-2 border-hairline">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-1.5 w-1.5 bg-lavender-gradient" />
          <span className="font-display text-base text-foreground">recce</span>
          <span className="text-muted-foreground">· An AI storytelling studio</span>
        </div>
        <p className="text-xs tracking-wide text-muted-foreground">
          © {new Date().getFullYear()} Recce. Crafted for dreamers.
        </p>
      </div>
    </footer>
  );
}
