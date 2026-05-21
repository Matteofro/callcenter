export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1">{hint}</p>}
    </div>
  );
}
