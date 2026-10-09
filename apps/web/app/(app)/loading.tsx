export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-4 w-48" />
      <div className="skeleton h-16 w-80" />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="skeleton h-72" />
        <div className="skeleton h-72" />
      </div>
      <div className="skeleton h-96" />
    </div>
  );
}
