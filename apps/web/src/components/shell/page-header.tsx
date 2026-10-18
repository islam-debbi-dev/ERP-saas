export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-1.5 text-muted-foreground">{description}</p> : null}
    </header>
  );
}
