export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const tiles = [
    ["PROMOS", "bg-cat-promo"],
    ["Timers", "bg-slate-200 text-slate-700"],
    ["New Media", "bg-cat-newmedia"],
    ["slides", "bg-cat-slide"],
    ["movies", "bg-cat-movie"],
    ["programs", "bg-cat-program"],
    ["coming up", "bg-cat-comingup"],
    ["fillers", "bg-cat-filler text-white"],
  ];
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-[#e9e9e9] p-10 text-slate-900 lg:flex">
        <div className="grid grid-cols-4 gap-2">
          {tiles.map(([t, c]) => (
            <div key={t} className={`grid aspect-square place-items-center rounded-sm text-center text-lg font-semibold ${c}`}>
              {t}
            </div>
          ))}
        </div>
        <div>
          <h2 className="text-3xl font-light tracking-[0.2em]">TRENDS — TRAFFIC &amp; SCHEDULING</h2>
          <ul className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600">
            {["Web based deals & ROs", "Agreement status per booking", "Online payments for invoices", "Flexible billing for agencies & clients", "Multi-channel environment", "Three-layer data security", "New media scheduling", "SAP / Tally / third-party integration", "Email notifications on status"].map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid place-items-center p-6">{children}</div>
    </div>
  );
}
