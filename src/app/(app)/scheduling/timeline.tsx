"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Copy, GripVertical, History, Search, ShieldCheck, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { CATEGORY_META } from "@/lib/categories";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action";
import {
  addEventAction,
  confirmAiredAction,
  deleteEventAction,
  duplicateDayAction,
  moveBreakAction,
  moveEventAction,
  placeInBreakAction,
  publishAction,
  reorderBreakAction,
  restoreVersionAction,
  updateEventNotesAction,
  validateDayAction,
} from "@/app/actions/scheduling";

export type TLChannel = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  color: string;
  dayStart: string;
  dayEnd: string;
  schedule: { id: string; status: string; version: number; hasUnpublishedChanges: boolean } | null;
  versions: { version: number; createdAt: string; comment: string | null }[];
};
export type TLEvent = { id: string; channelId: string; assetId: string; eventType: string; title: string; startAt: string; durationSec: number; status: string; breakId: string | null; positionInBreak: number | null; roNumber: string | null; notes: string | null; houseNo: string };
export type TLBreak = { id: string; channelId: string; code: string; startAt: string; maxDurationSec: number; programTitle: string | null; positions: number; available: number; spots: TLEvent[] };
type Violation = { rule: string; severity: string; message: string; eventIds: string[]; range?: { start: string; end: string } };
type Asset = { id: string; assetCode: string; title: string; category: string; durationSec: number; approvalStatus: string };
type UndoEntry = { label: string; run: (confirm: boolean) => Promise<ActionResult<unknown>> };

const RESIZABLE = new Set(["TIMER", "SLIDE", "COMING_UP", "FILLER", "NEW_MEDIA", "PROMO"]);
const ZOOMS = [1, 2, 4, 8, 16, 32];
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Timeline(props: { date: string; channels: TLChannel[]; events: TLEvent[]; breaks: TLBreak[]; canEdit: boolean; canPublish: boolean; canConfirmAired: boolean; allChannels: { id: string; code: string }[] }) {
  const { channels, events, breaks, canEdit } = props;
  const router = useRouter();
  const [zoom, setZoom] = React.useState(4); // px per minute
  const [snap, setSnap] = React.useState(30);
  const [rippleMode, setRipple] = React.useState(false);
  const [copyMode, setCopy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [violations, setViolations] = React.useState<{ title: string; items: Violation[] } | null>(null);
  const [undo, setUndo] = React.useState<UndoEntry[]>([]);
  const [dragging, setDragging] = React.useState<{ label: string; color: string; height: number } | null>(null);
  const [selected, setSelected] = React.useState<TLEvent | null>(null);
  const [selectedBreak, setSelectedBreak] = React.useState<TLBreak | null>(null);
  const [confirmState, setConfirmState] = React.useState<{ resolve: (v: boolean) => void } | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // "Now" is client-only to keep server and client renders identical.
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ref = channels[0];
  const dayStartMs = ref ? new Date(ref.dayStart).getTime() : 0;
  const daySeconds = ref ? (new Date(ref.dayEnd).getTime() - dayStartMs) / 1000 : 86400;
  const pxPerSec = zoom / 60;
  const height = daySeconds * pxPerSec;

  // Scroll to "now" (or 18:00) on first render.
  React.useEffect(() => {
    if (!scrollRef.current || !ref) return;
    const now = Date.now();
    const target = now > dayStartMs && now < dayStartMs + daySeconds * 1000 ? (now - dayStartMs) / 1000 : 12 * 3600;
    scrollRef.current.scrollTop = Math.max(0, target * pxPerSec - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.date]);

  const askConfirmPublished = () => new Promise<boolean>((resolve) => setConfirmState({ resolve }));

  async function exec(label: string, fn: (confirm: boolean) => Promise<ActionResult<unknown>>, inverse?: (data: unknown) => UndoEntry | null) {
    setBusy(true);
    try {
      let r = await fn(false);
      if (!r.ok && r.code === "CONFIRM_PUBLISHED_EDIT") {
        if (await askConfirmPublished()) r = await fn(true);
        else return false;
      }
      if (r.ok) {
        const w = (r.data as { warnings?: Violation[] } | undefined)?.warnings ?? [];
        toast.success(r.message ?? label, { description: w.length ? `${w.length} warning(s): ${w[0].message}` : undefined });
        setViolations(w.length ? { title: `${label} — saved with warnings`, items: w } : null);
        const inv = inverse?.(r.data) ?? null;
        if (inv) setUndo((s) => [...s.slice(-29), inv]);
        router.refresh();
        return true;
      }
      const v = (r.details as { violations?: Violation[] } | undefined)?.violations;
      setViolations({ title: r.error, items: v ?? [] });
      toast.error(r.error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Undo runs the inverse operation through the same validated server path.
  async function doUndo() {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((s) => s.slice(0, -1));
    await exec(`Undo: ${last.label}`, last.run);
  }

  const timeFromY = (ch: TLChannel, y: number) => {
    const sec = Math.max(0, Math.round(y / pxPerSec / snap) * snap);
    return new Date(new Date(ch.dayStart).getTime() + sec * 1000).toISOString();
  };

  // dnd-kit's delta includes auto-scroll offsets, so track the real pointer position.
  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  const trackPointer = React.useCallback((ev: PointerEvent) => {
    pointer.current = { x: ev.clientX, y: ev.clientY };
  }, []);

  function onDragStart(e: DragStartEvent) {
    pointer.current = null;
    window.addEventListener("pointermove", trackPointer, true);
    const d = e.active.data.current as { label: string; color: string; height: number };
    setDragging(d);
  }

  // Drop targets are resolved from the pointer position rather than dnd-kit's
  // collision rects, which drift inside the scrolling timeline.
  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active } = e;
    if (!canEdit) return;
    const ae = e.activatorEvent as PointerEvent | KeyboardEvent;
    if (!("clientY" in ae)) return;
    const px = pointer.current?.x ?? ae.clientX + e.delta.x;
    const py = pointer.current?.y ?? ae.clientY + e.delta.y;
    window.removeEventListener("pointermove", trackPointer, true);
    const init = active.rect.current.initial;
    const top = py - (init ? ae.clientY - init.top : 0);
    const hits = document.elementsFromPoint(px, py) as HTMLElement[];
    const brkEl = hits.find((h) => h.dataset.breakId);
    const colEl = hits.find((h) => h.dataset.channelId);
    const a = active.data.current as { kind: "asset" | "event" | "break"; asset?: Asset; event?: TLEvent; brk?: TLBreak };
    const targetBreak = brkEl ? breaks.find((b) => b.id === brkEl.dataset.breakId) : undefined;
    const targetCh = colEl ? channels.find((c) => c.id === colEl.dataset.channelId) : undefined;
    const o: { kind: "column" | "break"; channel?: TLChannel; brk?: TLBreak } | null = targetBreak && a.kind === "asset" ? { kind: "break", brk: targetBreak } : targetCh ? { kind: "column", channel: targetCh } : null;
    if (!o) return;
    const over = { rect: { top: colEl ? colEl.getBoundingClientRect().top : 0 } };

    if (o.kind === "break" && o.brk) {
      const assetId = a.asset?.id;
      if (!assetId) {
        toast.info("Drop media from the library onto a break to place a spot.");
        return;
      }
      await exec(`Placed "${a.asset!.title}" in ${o.brk.code}`, (c) => placeInBreakAction({ breakId: o.brk!.id, assetId, confirmPublishedEdit: c }), (d) => {
        const id = (d as { id: string }).id;
        return { label: `place ${a.asset!.title}`, run: (c) => deleteEventAction(id, c) };
      });
      return;
    }
    if (o.kind !== "column" || !o.channel) return;
    const ch = o.channel;
    const y = top - over.rect.top;
    const startAt = timeFromY(ch, y);

    if (a.kind === "asset" && a.asset) {
      const asset = a.asset;
      if (asset.category === "COMMERCIAL") {
        toast.info("Commercials go into a commercial break — drop it onto a break block.");
        return;
      }
      await exec(`Added "${asset.title}"`, (c) => addEventAction({ channelId: ch.id, assetId: asset.id, startAt, ripple: rippleMode, confirmPublishedEdit: c }), (d) => {
        if (rippleMode) return null;
        const id = (d as { id: string }).id;
        return { label: `add ${asset.title}`, run: (c) => deleteEventAction(id, c) };
      });
    } else if (a.kind === "event" && a.event) {
      const ev = a.event;
      if (!copyMode && ev.channelId === ch.id && startAt === ev.startAt) return;
      await exec(copyMode ? `Copied "${ev.title}"` : `Moved "${ev.title}"`, (c) => moveEventAction({ eventId: ev.id, startAt, channelId: ch.id, copy: copyMode, ripple: rippleMode, confirmPublishedEdit: c }), (d) => {
        if (rippleMode) return null;
        if (copyMode) {
          const id = (d as { id: string }).id;
          return { label: `copy ${ev.title}`, run: (c) => deleteEventAction(id, c) };
        }
        return { label: `move ${ev.title}`, run: (c) => moveEventAction({ eventId: ev.id, startAt: ev.startAt, channelId: ev.channelId, confirmPublishedEdit: c }) };
      });
    } else if (a.kind === "break" && a.brk) {
      const b = a.brk;
      if (ch.id !== b.channelId) {
        toast.error("Breaks belong to their channel's inventory and cannot move to another channel.");
        return;
      }
      await exec(`Moved break ${b.code}`, (c) => moveBreakAction({ breakId: b.id, startAt, ripple: rippleMode, confirmPublishedEdit: c }), () => (rippleMode ? null : { label: `move break ${b.code}`, run: (c) => moveBreakAction({ breakId: b.id, startAt: b.startAt, confirmPublishedEdit: c }) }));
    }
  }

  async function resize(ev: TLEvent, durationSec: number) {
    await exec(`Resized "${ev.title}"`, (c) => moveEventAction({ eventId: ev.id, startAt: ev.startAt, durationSec, ripple: rippleMode, confirmPublishedEdit: c }), () => (rippleMode ? null : { label: `resize ${ev.title}`, run: (c) => moveEventAction({ eventId: ev.id, startAt: ev.startAt, durationSec: ev.durationSec, confirmPublishedEdit: c }) }));
  }

  async function validateAll() {
    setBusy(true);
    const all: Violation[] = [];
    for (const ch of channels) {
      const r = await validateDayAction(ch.id, props.date);
      if (r.ok) all.push(...((r.data as Violation[]) ?? []).map((v) => ({ ...v, message: `${ch.code}: ${v.message}` })));
    }
    setBusy(false);
    setViolations({ title: all.length ? `${all.length} rule finding(s) on ${props.date}` : `No rule violations on ${props.date} ✓`, items: all });
  }

  const highlight = new Set(violations?.items.flatMap((v) => v.eventIds) ?? []);
  const hours = Math.ceil(daySeconds / 3600);
  const labelStep = zoom >= 16 ? 900 : zoom >= 8 ? 1800 : 3600;

  return (
    <DndContext id="schedule-timeline" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => {
        setDragging(null);
        window.removeEventListener("pointermove", trackPointer, true);
      }}>
      <div className="flex gap-3">
        {canEdit && <Library />}
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Zoom out" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
                <ZoomOut />
              </Button>
              <span className="w-16 text-center text-xs text-muted">{zoom}px/min</span>
              <Button size="icon" variant="ghost" aria-label="Zoom in" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
                <ZoomIn />
              </Button>
            </div>
            <label className="flex items-center gap-1 text-xs text-muted">
              Snap
              <Select value={snap} onChange={(e) => setSnap(Number(e.target.value))} className="h-8 w-20">
                {[1, 5, 10, 30, 60, 300].map((s) => (
                  <option key={s} value={s}>
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </option>
                ))}
              </Select>
            </label>
            {canEdit && (
              <>
                <label className="flex items-center gap-1.5 text-xs" title="Shift the following events so nothing overlaps">
                  <input type="checkbox" checked={rippleMode} onChange={(e) => setRipple(e.target.checked)} /> Ripple
                </label>
                <label className="flex items-center gap-1.5 text-xs" title="Dragging an event copies it instead of moving it">
                  <input type="checkbox" checked={copyMode} onChange={(e) => setCopy(e.target.checked)} /> Copy mode
                </label>
                <Button size="sm" variant="secondary" disabled={!undo.length || busy} onClick={doUndo} title={undo.length ? `Undo ${undo[undo.length - 1].label}` : "Nothing to undo"}>
                  <Undo2 /> Undo
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={validateAll}>
              <ShieldCheck /> Validate day
            </Button>
            {busy && <span className="text-xs text-muted">Working…</span>}
          </div>

          {violations && (
            <div className={cn("border-b border-border p-3 text-sm", violations.items.some((v) => v.severity === "ERROR") || !violations.items.length ? "bg-red-50 dark:bg-red-950/30" : "bg-amber-50 dark:bg-amber-950/30")} role="alert">
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-2 font-medium">
                  {violations.items.length === 0 && violations.title.includes("✓") ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-warning" />}
                  {violations.title}
                </p>
                <button onClick={() => setViolations(null)} aria-label="Dismiss" className="text-muted">
                  <X className="size-4" />
                </button>
              </div>
              {violations.items.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {violations.items.map((v, i) => (
                    <li key={i} className="flex gap-2">
                      <StatusBadge status={v.severity} />
                      <span className="font-mono text-muted">{v.rule}</span>
                      <span>{v.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* channel headers */}
          <div className="flex border-b border-border">
            <div className="w-16 shrink-0" />
            {channels.map((ch) => (
              <ChannelHeader key={ch.id} ch={ch} date={props.date} canPublish={props.canPublish} canEdit={canEdit} exec={exec} />
            ))}
          </div>

          <div ref={scrollRef} className="relative max-h-[calc(100vh-300px)] min-h-[400px] overflow-y-auto">
            <div className="relative flex" style={{ height }}>
              <div className="relative w-16 shrink-0 border-r border-border bg-surface-2">
                {Array.from({ length: Math.ceil((hours * 3600) / labelStep) }, (_, i) => {
                  const t = new Date(dayStartMs + i * labelStep * 1000);
                  return (
                    <div key={i} className="absolute right-1 -translate-y-1/2 font-mono text-[10px] text-muted" style={{ top: i * labelStep * pxPerSec }}>
                      {ref && formatInTimeZone(t, ref.timezone, "HH:mm")}
                    </div>
                  );
                })}
              </div>
              {channels.map((ch) => (
                <Column key={ch.id} ch={ch} pxPerSec={pxPerSec} labelStep={labelStep} height={height} nowMs={nowMs} events={events.filter((e) => e.channelId === ch.id && !e.breakId)} breaks={breaks.filter((b) => b.channelId === ch.id)} canEdit={canEdit} highlight={highlight} onSelect={setSelected} onSelectBreak={setSelectedBreak} onResize={resize} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none overflow-hidden rounded border-l-4 bg-surface/95 px-1.5 text-[11px] shadow-lg ring-1 ring-primary" style={{ borderColor: dragging.color, height: Math.max(18, dragging.height), width: 220 }}>
            {dragging.label}
          </div>
        )}
      </DragOverlay>

      {selected && <EventDialog ev={selected} channels={channels} onClose={() => setSelected(null)} canEdit={canEdit} canConfirmAired={props.canConfirmAired} exec={exec} />}
      {selectedBreak && <BreakDialog brk={selectedBreak} ch={channels.find((c) => c.id === selectedBreak.channelId)!} onClose={() => setSelectedBreak(null)} canEdit={canEdit} exec={exec} />}
      <Dialog
        open={!!confirmState}
        onOpenChange={(o) => {
          if (!o) {
            confirmState?.resolve(false);
            setConfirmState(null);
          }
        }}
        title="Change a published schedule?">
        <p className="text-sm">This day has been published. Your change will move it back to <b>draft</b> and it must be re-published before it reaches playout. The change is recorded in the audit log.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              confirmState?.resolve(false);
              setConfirmState(null);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              confirmState?.resolve(true);
              setConfirmState(null);
            }}
          >
            Change published schedule
          </Button>
        </div>
      </Dialog>
    </DndContext>
  );
}

type Exec = (label: string, fn: (confirm: boolean) => Promise<ActionResult<unknown>>, inverse?: (data: unknown) => UndoEntry | null) => Promise<boolean>;

function ChannelHeader({ ch, date, canPublish, canEdit, exec }: { ch: TLChannel; date: string; canPublish: boolean; canEdit: boolean; exec: Exec }) {
  const [pubOpen, setPubOpen] = React.useState(false);
  const [verOpen, setVerOpen] = React.useState(false);
  const [dupOpen, setDupOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const s = ch.schedule;
  return (
    <div className="min-w-[220px] flex-1 border-r border-border px-2 py-1.5 last:border-r-0">
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="size-2.5 rounded-full" style={{ background: ch.color }} />
            {ch.code}
            <span className="truncate text-xs font-normal text-muted">{ch.name}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted">
            {s ? <StatusBadge status={s.status} /> : <Badge>Empty</Badge>}
            {s && s.version > 0 && <span>v{s.version}</span>}
            {s?.hasUnpublishedChanges && s.version > 0 && <span className="text-warning">· unpublished changes</span>}
            <span>· {ch.timezone}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {canPublish && s && (
            <Button size="sm" variant={s.status === "PUBLISHED" ? "secondary" : "default"} onClick={() => setPubOpen(true)} disabled={s.status === "PUBLISHED" && !s.hasUnpublishedChanges}>
              <Upload /> Publish
            </Button>
          )}
          {s && ch.versions.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setVerOpen(true)} aria-label="Version history">
              <History />
            </Button>
          )}
          {canEdit && s && (
            <Button size="sm" variant="ghost" onClick={() => setDupOpen(true)} aria-label="Duplicate day">
              <Copy />
            </Button>
          )}
        </div>
      </div>
      <Dialog open={pubOpen} onOpenChange={setPubOpen} title={`Publish ${ch.code} — ${date}`} description="Every rule is re-checked. Publishing is blocked while any error remains.">
        <Label htmlFor="pub-comment">Comment (optional)</Label>
        <Textarea id="pub-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPubOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const ok = await exec(`Published ${ch.code} ${date}`, () => publishAction(s!.id, comment));
              if (ok) setPubOpen(false);
            }}
          >
            Publish version {(s?.version ?? 0) + 1}
          </Button>
        </div>
      </Dialog>
      <Dialog open={verOpen} onOpenChange={setVerOpen} title={`Version history — ${ch.code} ${date}`}>
        <ul className="divide-y divide-border text-sm">
          {ch.versions.map((v) => (
            <li key={v.version} className="flex items-center justify-between gap-2 py-2">
              <span>
                <b>v{v.version}</b> · {new Date(v.createdAt).toLocaleString()} {v.comment && <span className="text-muted">— {v.comment}</span>}
              </span>
              {canPublish && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (s && (await exec(`Restored v${v.version}`, () => restoreVersionAction(s.id, v.version)))) setVerOpen(false);
                  }}
                >
                  Restore to draft
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Restoring replaces the draft&apos;s primary events with that version. Commercial spots stay as they are because they are tied to release orders and inventory.</p>
      </Dialog>
      {dupOpen && <DuplicateDialog ch={ch} date={date} onClose={() => setDupOpen(false)} exec={exec} />}
    </div>
  );
}

function DuplicateDialog({ ch, date, onClose, exec }: { ch: TLChannel; date: string; onClose: () => void; exec: Exec }) {
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(next);
  const [to, setTo] = React.useState(next);
  const [days, setDays] = React.useState<number[]>([]);
  const [breaks, setBreaks] = React.useState(true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Copy ${ch.code} ${date} to other days`} description="Primary events (and optionally empty breaks) are copied at the same local times. Target days must be empty. Commercial spots are not copied.">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Label>Only on (leave empty for every day)</Label>
        <div className="flex flex-wrap gap-2 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))} />
              {d}
            </label>
          ))}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={breaks} onChange={(e) => setBreaks(e.target.checked)} /> Copy commercial breaks and their (empty) inventory
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            if (await exec("Copied schedule", () => duplicateDayAction({ channelId: ch.id, sourceDate: date, from, to, weekdays: days, includeBreaks: breaks }))) onClose();
          }}
        >
          Copy
        </Button>
      </div>
    </Dialog>
  );
}

function Column({ ch, pxPerSec, labelStep, height, nowMs, events, breaks, canEdit, highlight, onSelect, onSelectBreak, onResize }: { ch: TLChannel; pxPerSec: number; labelStep: number; height: number; nowMs: number | null; events: TLEvent[]; breaks: TLBreak[]; canEdit: boolean; highlight: Set<string>; onSelect: (e: TLEvent) => void; onSelectBreak: (b: TLBreak) => void; onResize: (e: TLEvent, d: number) => void }) {
  const start = new Date(ch.dayStart).getTime();
  const top = (iso: string) => ((new Date(iso).getTime() - start) / 1000) * pxPerSec;
  const nowTop = nowMs == null ? -1 : ((nowMs - start) / 1000) * pxPerSec;
  return (
    <div data-channel-id={ch.id} className="relative min-w-[220px] flex-1 border-r border-border last:border-r-0" style={{ height }}>
      {Array.from({ length: Math.ceil(height / (labelStep * pxPerSec)) }, (_, i) => (
        <div key={i} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: i * labelStep * pxPerSec }} />
      ))}
      {nowTop > 0 && nowTop < height && <div className="absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: nowTop }} title="Now" />}
      {breaks.map((b) => (
        <BreakBlock key={b.id} b={b} top={top(b.startAt)} h={b.maxDurationSec * pxPerSec} canEdit={canEdit} highlighted={highlight.has(b.id) || b.spots.some((s) => highlight.has(s.id))} onClick={() => onSelectBreak(b)} tz={ch.timezone} />
      ))}
      {events.map((e) => (
        <EventBlock key={e.id} e={e} top={top(e.startAt)} h={e.durationSec * pxPerSec} canEdit={canEdit} highlighted={highlight.has(e.id)} onClick={() => onSelect(e)} tz={ch.timezone} pxPerSec={pxPerSec} onResize={onResize} />
      ))}
    </div>
  );
}

function EventBlock({ e, top, h, canEdit, highlighted, onClick, tz, pxPerSec, onResize }: { e: TLEvent; top: number; h: number; canEdit: boolean; highlighted: boolean; onClick: () => void; tz: string; pxPerSec: number; onResize: (e: TLEvent, d: number) => void }) {
  const meta = CATEGORY_META[e.eventType] ?? CATEGORY_META.FILLER;
  const draggable = canEdit && e.status === "PLANNED";
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `ev:${e.id}`, data: { kind: "event", event: e, label: e.title, color: meta.color, height: h }, disabled: !draggable });
  const [resizeDy, setResizeDy] = React.useState<number | null>(null);
  const resizable = draggable && RESIZABLE.has(e.eventType);
  const shownH = Math.max(2, h + (resizeDy ?? 0));
  function startResize(ev: React.PointerEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    const y0 = ev.clientY;
    const move = (m: PointerEvent) => setResizeDy(m.clientY - y0);
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizeDy(null);
      const newDur = Math.max(1, Math.round((h + (m.clientY - y0)) / pxPerSec));
      if (newDur !== e.durationSec) onResize(e, newDur);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-label={`${e.title} at ${formatInTimeZone(new Date(e.startAt), tz, "HH:mm:ss")}, ${fmtDur(e.durationSec)}`}
      onClick={onClick}
      onKeyDown={(k) => k.key === "Enter" && onClick()}
      title={`${formatInTimeZone(new Date(e.startAt), tz, "HH:mm:ss")} · ${e.title} · ${fmtDur(e.durationSec)}${e.status !== "PLANNED" ? ` · ${e.status}` : ""}`}
      className={cn("absolute left-1 right-1 z-10 overflow-hidden rounded-sm border-l-4 text-[11px] leading-tight shadow-sm", draggable ? "cursor-grab" : "cursor-pointer", isDragging && "opacity-30", highlighted && "ring-2 ring-red-500", e.status === "AIRED" && "opacity-70")}
      style={{ top, height: shownH, borderColor: meta.color, background: `color-mix(in srgb, ${meta.color} 22%, var(--surface))` }}
    >
      {shownH >= 12 && (
        <div className="flex items-center gap-1 truncate px-1 pt-px">
          <span className="font-mono text-[10px] text-muted">{formatInTimeZone(new Date(e.startAt), tz, "HH:mm:ss")}</span>
          <span className="truncate font-medium">{e.title}</span>
          {e.status === "AIRED" && <CheckCircle2 className="size-3 shrink-0 text-success" />}
        </div>
      )}
      {resizable && <div onPointerDown={startResize} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-primary/40" aria-hidden />}
    </div>
  );
}

function BreakBlock({ b, top, h, canEdit, highlighted, onClick, tz }: { b: TLBreak; top: number; h: number; canEdit: boolean; highlighted: boolean; onClick: () => void; tz: string }) {
  const used = b.spots.reduce((n, s) => n + s.durationSec, 0);
  const drag = useDraggable({ id: `br:${b.id}`, data: { kind: "break", brk: b, label: `Break ${b.code}`, color: "#ff6f59", height: h }, disabled: !canEdit || b.spots.some((s) => s.status === "AIRED") });
  const pct = Math.min(100, Math.round((used / b.maxDurationSec) * 100));
  return (
    <div
      ref={drag.setNodeRef}
      data-break-id={b.id}
      {...drag.listeners}
      {...drag.attributes}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(k) => k.key === "Enter" && onClick()}
      title={`Break ${b.code} ${formatInTimeZone(new Date(b.startAt), tz, "HH:mm:ss")} · ${used}/${b.maxDurationSec}s · ${b.spots.length} spot(s) · ${b.available} free position(s)`}
      className={cn("absolute left-1 right-1 z-10 overflow-hidden rounded-sm border border-dashed text-[10px]", "border-[#ff6f59] bg-[#ff6f59]/10", highlighted && "ring-2 ring-red-500", drag.isDragging && "opacity-30", canEdit ? "cursor-grab" : "cursor-pointer")}
      style={{ top, height: Math.max(3, h) }}
    >
      <div className="absolute inset-y-0 left-0 bg-[#ff6f59]/30" style={{ width: `${pct}%` }} />
      {h >= 11 && (
        <div className="relative flex items-center justify-between px-1">
          <span className="font-semibold">
            {b.code} · {b.spots.length} spot(s)
          </span>
          <span className="text-muted">
            {used}/{b.maxDurationSec}s
          </span>
        </div>
      )}
      {h >= 30 &&
        b.spots.map((s) => (
          <div key={s.id} className="relative truncate px-1">
            {s.positionInBreak}. {s.title} {s.roNumber && <span className="text-muted">({s.roNumber})</span>}
          </div>
        ))}
    </div>
  );
}

function Library() {
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/media/search?q=${encodeURIComponent(q)}&category=${cat}`);
        if (r.ok) setAssets((await r.json()).assets);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, cat]);
  return (
    <div className="sticky top-16 hidden max-h-[calc(100vh-140px)] w-64 shrink-0 flex-col rounded-lg border border-border bg-surface lg:flex">
      <div className="space-y-2 border-b border-border p-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Media library</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or house no." className="pl-7" aria-label="Search media" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_META)
            .filter(([k]) => k !== "SECONDARY")
            .map(([k, m]) => (
              <option key={k} value={k}>
                {m.plural}
              </option>
            ))}
        </Select>
        <p className="text-[11px] text-muted">Drag onto a channel to schedule. Drop commercials, promos or fillers onto a break to place a spot.</p>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {loading && <p className="text-xs text-muted">Loading…</p>}
        {!loading && assets.length === 0 && <p className="text-xs text-muted">No media found.</p>}
        {assets.map((a) => (
          <LibraryItem key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function LibraryItem({ a }: { a: Asset }) {
  const meta = CATEGORY_META[a.category];
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `as:${a.id}`, data: { kind: "asset", asset: a, label: a.title, color: meta.color, height: 24 } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("flex cursor-grab items-center gap-1.5 rounded border border-border border-l-4 bg-surface px-1.5 py-1 text-xs hover:bg-surface-2", isDragging && "opacity-40")} style={{ borderLeftColor: meta.color }}>
      <GripVertical className="size-3 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{a.title}</div>
        <div className="flex justify-between text-[10px] text-muted">
          <span>
            {a.assetCode} · {meta.label}
          </span>
          <span className="font-mono">{fmtDur(a.durationSec)}</span>
        </div>
      </div>
      {a.approvalStatus !== "APPROVED" && <span className="text-[9px] text-warning">{a.approvalStatus}</span>}
    </div>
  );
}

function EventDialog({ ev, channels, onClose, canEdit, canConfirmAired, exec }: { ev: TLEvent; channels: TLChannel[]; onClose: () => void; canEdit: boolean; canConfirmAired: boolean; exec: Exec }) {
  const ch = channels.find((c) => c.id === ev.channelId)!;
  const [time, setTime] = React.useState(formatInTimeZone(new Date(ev.startAt), ch.timezone, "HH:mm:ss"));
  const [dateStr, setDateStr] = React.useState(formatInTimeZone(new Date(ev.startAt), ch.timezone, "yyyy-MM-dd"));
  const [target, setTarget] = React.useState(ev.channelId);
  const [dur, setDur] = React.useState(String(ev.durationSec));
  const [notes, setNotes] = React.useState(ev.notes ?? "");
  const editable = canEdit && ev.status === "PLANNED";
  const targetCh = channels.find((c) => c.id === target) ?? ch;
  const iso = () => fromZonedTime(`${dateStr}T${time.length === 5 ? time + ":00" : time}`, targetCh.timezone).toISOString();
  const meta = CATEGORY_META[ev.eventType];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={ev.title} description={`${meta?.label ?? ev.eventType} · house no. ${ev.houseNo}`}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Starts</dt>
        <dd className="font-mono">{formatInTimeZone(new Date(ev.startAt), ch.timezone, "yyyy-MM-dd HH:mm:ss")}</dd>
        <dt className="text-muted">Duration</dt>
        <dd className="font-mono">{fmtDur(ev.durationSec)}</dd>
        <dt className="text-muted">Status</dt>
        <dd>
          <StatusBadge status={ev.status} />
        </dd>
        {ev.roNumber && (
          <>
            <dt className="text-muted">Release order</dt>
            <dd>{ev.roNumber}</dd>
          </>
        )}
      </dl>
      {editable && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase text-muted">Move / copy to an exact time</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Date</Label>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div>
              <Label>Local time</Label>
              <Input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {RESIZABLE.has(ev.eventType) && (
            <div className="w-40">
              <Label>Duration (seconds)</Label>
              <Input type="number" min={1} value={dur} onChange={(e) => setDur(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const d = RESIZABLE.has(ev.eventType) ? Number(dur) : undefined;
                if (await exec(`Moved "${ev.title}"`, (c) => moveEventAction({ eventId: ev.id, startAt: iso(), channelId: target, durationSec: d, confirmPublishedEdit: c }), () => ({ label: `move ${ev.title}`, run: (c) => moveEventAction({ eventId: ev.id, startAt: ev.startAt, channelId: ev.channelId, durationSec: ev.durationSec, confirmPublishedEdit: c }) }))) onClose();
              }}
            >
              Move
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (await exec(`Copied "${ev.title}"`, (c) => moveEventAction({ eventId: ev.id, startAt: iso(), channelId: target, copy: true, confirmPublishedEdit: c }), (d) => ({ label: `copy ${ev.title}`, run: (c) => deleteEventAction((d as { id: string }).id, c) }))) onClose();
              }}
            >
              <Copy /> Copy
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              onClick={async () => {
                if (await exec(`Removed "${ev.title}"`, (c) => deleteEventAction(ev.id, c), () => (ev.breakId ? null : { label: `remove ${ev.title}`, run: (c) => addEventAction({ channelId: ev.channelId, assetId: ev.assetId, startAt: ev.startAt, durationSec: ev.durationSec, confirmPublishedEdit: c }) }))) onClose();
              }}
            >
              <Trash2 /> Remove
            </Button>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => exec("Notes saved", () => updateEventNotesAction(ev.id, notes))}>
              Save notes
            </Button>
          </div>
        </div>
      )}
      {canConfirmAired && ev.status === "PLANNED" && new Date(ev.startAt).getTime() < Date.now() && (
        <div className="mt-3 border-t border-border pt-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (await exec(`Confirmed "${ev.title}" aired`, () => confirmAiredAction([ev.id]))) onClose();
            }}
          >
            <CheckCircle2 /> Confirm aired (as-run)
          </Button>
          <p className="mt-1 text-xs text-muted">Plays only count against licences once confirmed. Scheduling alone never marks content as broadcast.</p>
        </div>
      )}
    </Dialog>
  );
}

function BreakDialog({ brk, ch, onClose, canEdit, exec }: { brk: TLBreak; ch: TLChannel; onClose: () => void; canEdit: boolean; exec: Exec }) {
  const [order, setOrder] = React.useState(brk.spots.map((s) => s.id));
  const [time, setTime] = React.useState(formatInTimeZone(new Date(brk.startAt), ch.timezone, "HH:mm:ss"));
  const spots = order.map((id) => brk.spots.find((s) => s.id === id)!).filter(Boolean);
  const used = spots.reduce((n, s) => n + s.durationSec, 0);
  const move = (i: number, d: number) => {
    const o = [...order];
    const [x] = o.splice(i, 1);
    o.splice(i + d, 0, x);
    setOrder(o);
  };
  const changed = order.join() !== brk.spots.map((s) => s.id).join();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Break ${brk.code}`} description={`${formatInTimeZone(new Date(brk.startAt), ch.timezone, "yyyy-MM-dd HH:mm:ss")} · ${brk.programTitle ?? ""} · ${used}/${brk.maxDurationSec}s used · ${brk.available} of ${brk.positions} positions free`}>
      {spots.length === 0 && <p className="text-sm text-muted">No spots yet. Drag a commercial, promo or filler from the library onto this break.</p>}
      <ol className="divide-y divide-border text-sm">
        {spots.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <span className="w-5 text-muted">{i + 1}.</span>
            <span className="size-2.5 rounded-full" style={{ background: CATEGORY_META[s.eventType]?.color }} />
            <span className="flex-1 truncate">
              {s.title} <span className="text-xs text-muted">{s.durationSec}s {s.roNumber && `· ${s.roNumber}`}</span>
            </span>
            <StatusBadge status={s.status} />
            {canEdit && s.status === "PLANNED" && (
              <>
                <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp />
                </Button>
                <Button size="icon" variant="ghost" disabled={i === spots.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown />
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => (await exec(`Removed "${s.title}"`, (c) => deleteEventAction(s.id, c))) && onClose()} aria-label="Remove spot">
                  <Trash2 />
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          {changed && (
            <Button size="sm" onClick={async () => (await exec(`Reordered ${brk.code}`, (c) => reorderBreakAction(brk.id, order, c))) && onClose()}>
              Save order
            </Button>
          )}
          <div>
            <Label>Move break to (local time)</Label>
            <Input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const date = formatInTimeZone(new Date(brk.startAt), ch.timezone, "yyyy-MM-dd");
              const iso = fromZonedTime(`${date}T${time.length === 5 ? time + ":00" : time}`, ch.timezone).toISOString();
              if (await exec(`Moved break ${brk.code}`, (c) => moveBreakAction({ breakId: brk.id, startAt: iso, confirmPublishedEdit: c }), () => ({ label: `move break ${brk.code}`, run: (c) => moveBreakAction({ breakId: brk.id, startAt: brk.startAt, confirmPublishedEdit: c }) }))) onClose();
            }}
          >
            Move break
          </Button>
        </div>
      )}
    </Dialog>
  );
}
