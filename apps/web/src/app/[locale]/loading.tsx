export default function Loading() {
  return (
    <main id="main" className="container" style={{ padding: '32px 16px' }} aria-busy="true">
      <div className="skeleton" style={{ height: 36, width: '50%' }} />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </main>
  );
}
