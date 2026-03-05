"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Member = {
  user_id: string;
  display_name: string;
  email: string;
};

type TaskRow = {
  id: string;
  household_id: string;

  kind: "todo" | "chore";
  status: "open" | "done";

  title: string;
  notes: string | null;

  priority: number; // 1..3
  due_at: string | null;

  created_by: string;
  created_by_name: string | null;

  assigned_to: string | null;
  assigned_to_name: string | null;

  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;

  recurrence_freq: "none" | "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_count: number | null;
  recurrence_until: string | null;

  created_at: string;
  updated_at: string;
};

type FilterKind = "all" | "todo" | "chore";
type FilterStatus = "open" | "done" | "all";
type FilterAssignee = "everyone" | "mine" | "unassigned";

type ViewMode = "list" | "calendar";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function dateToYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDateLong(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(d);
}

function fmtDateShort(iso: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function toNoonISOFromYMD(ymd: string) {
  // Keep due dates stable-ish across timezones
  return new Date(`${ymd}T12:00:00`).toISOString();
}

function recurrenceLabel(t: Pick<TaskRow, "recurrence_freq" | "recurrence_interval">) {
  if (t.recurrence_freq === "none") return null;
  const interval = t.recurrence_interval ?? 1;
  const unit =
    t.recurrence_freq === "daily" ? "day" : t.recurrence_freq === "weekly" ? "week" : "month";
  const plural = interval === 1 ? "" : "s";
  return interval === 1 ? `Repeats every ${unit}` : `Repeats every ${interval} ${unit}${plural}`;
}

export default function TasksPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; email?: string | null } | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  // Filters + view
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("open");
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [filterAssignee, setFilterAssignee] = useState<FilterAssignee>("everyone");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Quick add
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<"todo" | "chore">("todo");
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2);
  const [newDue, setNewDue] = useState<string>("");
  const [newAssignedTo, setNewAssignedTo] = useState<string>("");

  const [newRecFreq, setNewRecFreq] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [newRecInterval, setNewRecInterval] = useState<number>(1);
  const [newRecCount, setNewRecCount] = useState<string>("");
  const [newRecUntil, setNewRecUntil] = useState<string>("");

  const addRef = useRef<HTMLInputElement | null>(null);
  const [adding, setAdding] = useState(false);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);

  const [eTitle, setETitle] = useState("");
  const [eKind, setEKind] = useState<"todo" | "chore">("todo");
  const [ePriority, setEPriority] = useState<1 | 2 | 3>(2);
  const [eDue, setEDue] = useState<string>("");
  const [eAssignedTo, setEAssignedTo] = useState<string>("");

  const [eRecFreq, setERecFreq] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [eRecInterval, setERecInterval] = useState<number>(1);
  const [eRecCount, setERecCount] = useState<string>("");
  const [eRecUntil, setERecUntil] = useState<string>("");

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteTitle, setDeleteTitle] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr("");

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setMe({ id: user.id, email: user.email });

    const { data: hh, error: hhErr } = await supabase.rpc("get_active_household");
    if (hhErr) {
      setErr(hhErr.message);
      setLoading(false);
      return;
    }
    if (!hh) {
      setErr("No active household selected. Go back and pick one.");
      setLoading(false);
      return;
    }
    setHouseholdId(hh);

    const { data: mRows, error: mErr } = await supabase.rpc("get_household_members", {
      p_household_id: hh,
    });
    if (mErr) {
      setErr(mErr.message);
      setLoading(false);
      return;
    }
    setMembers((mRows as any) ?? []);

    const { data: tRows, error: tErr } = await supabase.rpc("get_tasks_for_active_household");
    if (tErr) {
      setErr(tErr.message);
      setTasks([]);
      setLoading(false);
      return;
    }
    setTasks((tRows as any) ?? []);

    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setErr("Failed to load tasks.");
      setLoading(false);
    });
  }, []);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status === "open").length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { open, done, total: tasks.length };
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (filterKind !== "all" && t.kind !== filterKind) return false;

      if (filterAssignee === "mine") {
        if (!me?.id) return false;
        return t.assigned_to === me.id;
      }
      if (filterAssignee === "unassigned") {
        return !t.assigned_to;
      }
      return true;
    });
  }, [tasks, filterStatus, filterKind, filterAssignee, me?.id]);

  // Calendar view: show the next 7 days (today..+6), group by day
  const calendarDays = useMemo(() => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const openTasks = tasks.filter((t) => t.status === "open");

    const byDay = days.map((d) => {
      const items = openTasks.filter((t) => {
        if (!t.due_at) return false;
        return isSameDay(new Date(t.due_at), d);
      });
      // also include tasks with no due date in "today" bucket? keep separate:
      return { day: d, items };
    });

    const noDue = openTasks.filter((t) => !t.due_at);
    return { byDay, noDue };
  }, [tasks]);

  const addTask = async () => {
    if (!householdId || !me?.id) return;
    const title = newTitle.trim();
    if (!title) return;

    const interval = clamp(Number(newRecInterval || 1), 1, 52);
    if (Number.isNaN(interval)) return alert("Recurrence interval must be a number.");

    const countVal = newRecCount.trim() === "" ? null : Number(newRecCount);
    if (countVal !== null && (Number.isNaN(countVal) || countVal < 1 || countVal > 9999)) {
      return alert("Recurrence count must be 1–9999 or blank.");
    }

    const due_at = newDue ? toNoonISOFromYMD(newDue) : null;
    const untilVal = newRecUntil ? new Date(`${newRecUntil}T23:59:59`).toISOString() : null;

    setAdding(true);

    const { error } = await supabase.from("tasks").insert({
      household_id: householdId,
      kind: newKind,
      status: "open",
      title,
      notes: null,
      priority: newPriority,
      due_at,
      created_by: me.id,
      assigned_to: newAssignedTo ? newAssignedTo : null,
      recurrence_freq: newRecFreq,
      recurrence_interval: interval,
      recurrence_count: countVal,
      recurrence_until: untilVal,
    });

    if (error) {
      setAdding(false);
      return alert(error.message);
    }

    setNewTitle("");
    setNewDue("");
    setNewAssignedTo("");
    setNewRecFreq("none");
    setNewRecInterval(1);
    setNewRecCount("");
    setNewRecUntil("");

    await load();
    setAdding(false);
    addRef.current?.focus();
  };

  const markDoneOrOpen = async (task: TaskRow) => {
    if (!me?.id) return;

    if (task.status === "done") {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "open", completed_at: null, completed_by: null })
        .eq("id", task.id);

      if (error) return alert(error.message);
      await load();
      return;
    }

    // If recurring, use RPC so it spawns the next task occurrence.
    if (task.recurrence_freq !== "none") {
      const { error } = await supabase.rpc("complete_task", { p_task_id: task.id });
      if (error) return alert(error.message);
      await load();
      return;
    }

    // Non-recurring simple complete
    const { error } = await supabase
      .from("tasks")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        completed_by: me.id,
      })
      .eq("id", task.id);

    if (error) return alert(error.message);
    await load();
  };

  const snooze = async (task: TaskRow, days: number) => {
    const base = task.due_at ? new Date(task.due_at) : new Date();
    const next = addDays(base, days);

    const { error } = await supabase.from("tasks").update({ due_at: next.toISOString() }).eq("id", task.id);
    if (error) return alert(error.message);
    await load();
  };

  const openEdit = (t: TaskRow) => {
    setEditTask(t);
    setEditOpen(true);

    setETitle(t.title);
    setEKind(t.kind);
    setEPriority((t.priority as any) ?? 2);

    setEDue(t.due_at ? dateToYMD(new Date(t.due_at)) : "");
    setEAssignedTo(t.assigned_to ?? "");

    setERecFreq(t.recurrence_freq ?? "none");
    setERecInterval(t.recurrence_interval ?? 1);
    setERecCount(t.recurrence_count == null ? "" : String(t.recurrence_count));
    setERecUntil(t.recurrence_until ? dateToYMD(new Date(t.recurrence_until)) : "");
  };

  const saveEdit = async () => {
    if (!editTask) return;

    const title = eTitle.trim();
    if (!title) return alert("Title required.");

    const interval = clamp(Number(eRecInterval || 1), 1, 52);
    if (Number.isNaN(interval)) return alert("Recurrence interval must be a number.");

    const countVal = eRecCount.trim() === "" ? null : Number(eRecCount);
    if (countVal !== null && (Number.isNaN(countVal) || countVal < 1 || countVal > 9999)) {
      return alert("Recurrence count must be 1–9999 or blank.");
    }

    const due_at = eDue ? toNoonISOFromYMD(eDue) : null;
    const untilVal = eRecUntil ? new Date(`${eRecUntil}T23:59:59`).toISOString() : null;

    const { error } = await supabase
      .from("tasks")
      .update({
        title,
        kind: eKind,
        priority: ePriority,
        due_at,
        assigned_to: eAssignedTo ? eAssignedTo : null,

        recurrence_freq: eRecFreq,
        recurrence_interval: interval,
        recurrence_count: countVal,
        recurrence_until: untilVal,
      })
      .eq("id", editTask.id);

    if (error) return alert(error.message);

    setEditOpen(false);
    setEditTask(null);
    await load();
  };

  const requestDelete = (t: TaskRow) => {
    setDeleteId(t.id);
    setDeleteTitle(t.title);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("tasks").delete().eq("id", deleteId);
    if (error) return alert(error.message);
    setDeleteId(null);
    setDeleteTitle("");
    await load();
  };

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="mt-1 text-sm text-gray-300">
            Open {counts.open} • Done {counts.done} • Total {counts.total}
          </p>
          <Link href="/app" className="mt-2 inline-block text-sm text-gray-300 hover:underline">
            ← Back to Home
          </Link>
        </div>

        <button
          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
          onClick={() => load()}
        >
          Refresh
        </button>
      </div>

      {err && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      )}

      {/* View switch */}
      <div className="mt-4 flex gap-2">
        <button
          className={`rounded-lg border px-3 py-2 text-sm ${
            viewMode === "list" ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
          }`}
          onClick={() => setViewMode("list")}
        >
          List
        </button>
        <button
          className={`rounded-lg border px-3 py-2 text-sm ${
            viewMode === "calendar"
              ? "border-white/40 bg-white/10"
              : "border-white/20 hover:bg-white/10"
          }`}
          onClick={() => setViewMode("calendar")}
        >
          Calendar (7 days)
        </button>
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap gap-2">
        {(["open", "done", "all"] as const).map((s) => (
          <button
            key={s}
            className={`rounded-lg border px-3 py-2 text-sm ${
              filterStatus === s ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilterStatus(s)}
          >
            {s === "open" ? "Open" : s === "done" ? "Done" : "All"}
          </button>
        ))}
        <div className="w-px bg-white/10 mx-1" />
        {(["all", "todo", "chore"] as const).map((k) => (
          <button
            key={k}
            className={`rounded-lg border px-3 py-2 text-sm ${
              filterKind === k ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilterKind(k)}
          >
            {k === "all" ? "All types" : k === "todo" ? "To-dos" : "Chores"}
          </button>
        ))}
        <div className="w-px bg-white/10 mx-1" />
        {(["everyone", "mine", "unassigned"] as const).map((a) => (
          <button
            key={a}
            className={`rounded-lg border px-3 py-2 text-sm ${
              filterAssignee === a
                ? "border-white/40 bg-white/10"
                : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilterAssignee(a)}
          >
            {a === "everyone" ? "Everyone" : a === "mine" ? "Mine" : "Unassigned"}
          </button>
        ))}
      </div>

      {/* Quick add */}
      <div className="mt-4 rounded-xl border border-white/20 bg-black p-3">
        <div className="grid gap-2 sm:grid-cols-6">
          <input
            ref={addRef}
            className="sm:col-span-6 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white placeholder:text-gray-600"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add task (e.g., take out trash)"
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />

          <select
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as any)}
          >
            <option value="todo">To-do</option>
            <option value="chore">Chore</option>
          </select>

          <select
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            value={newPriority}
            onChange={(e) => setNewPriority(Number(e.target.value) as any)}
          >
            <option value={1}>High</option>
            <option value={2}>Normal</option>
            <option value={3}>Low</option>
          </select>

          <input
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
          />

          <select
            className="sm:col-span-3 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            value={newAssignedTo}
            onChange={(e) => setNewAssignedTo(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>

          <select
            className="sm:col-span-3 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            value={newRecFreq}
            onChange={(e) => setNewRecFreq(e.target.value as any)}
          >
            <option value="none">No recurrence</option>
            <option value="daily">Repeat daily</option>
            <option value="weekly">Repeat weekly</option>
            <option value="monthly">Repeat monthly</option>
          </select>

          <input
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            type="number"
            min={1}
            max={52}
            value={newRecInterval}
            onChange={(e) => setNewRecInterval(Number(e.target.value))}
            disabled={newRecFreq === "none"}
            placeholder="Interval"
          />
          <input
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            type="number"
            min={1}
            max={9999}
            value={newRecCount}
            onChange={(e) => setNewRecCount(e.target.value)}
            disabled={newRecFreq === "none"}
            placeholder="Count (optional)"
          />
          <input
            className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
            type="date"
            value={newRecUntil}
            onChange={(e) => setNewRecUntil(e.target.value)}
            disabled={newRecFreq === "none"}
            placeholder="Until (optional)"
          />

          <button
            className="sm:col-span-6 rounded-lg bg-white px-4 py-3 text-base text-black disabled:opacity-60"
            onClick={addTask}
            disabled={adding}
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </div>

        {newRecFreq !== "none" && (
          <div className="mt-2 text-xs text-gray-400">
            {`This will ${recurrenceLabel({ recurrence_freq: newRecFreq, recurrence_interval: newRecInterval })}. (Next
            task is created when you mark this one done.)`}
          </div>
        )}
      </div>

      {/* CONTENT */}
      {viewMode === "calendar" ? (
        <div className="mt-4 space-y-3 pb-8">
          {/* No due bucket */}
          <div className="rounded-xl border border-white/20 bg-black p-3">
            <div className="text-sm font-semibold">No due date</div>
            <div className="mt-2 space-y-2">
              {calendarDays.noDue.length === 0 ? (
                <div className="text-sm text-gray-300">No open tasks without a due date.</div>
              ) : (
                calendarDays.noDue.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onToggle={() => markDoneOrOpen(t)}
                    onSnooze={(d) => snooze(t, d)}
                    onEdit={() => openEdit(t)}
                    onDelete={() => requestDelete(t)}
                  />
                ))
              )}
            </div>
          </div>

          {calendarDays.byDay.map(({ day, items }) => (
            <div key={day.toISOString()} className="rounded-xl border border-white/20 bg-black p-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">{fmtDateLong(day)}</div>
                <div className="text-xs text-gray-400">{items.length} due</div>
              </div>

              <div className="mt-2 space-y-2">
                {items.length === 0 ? (
                  <div className="text-sm text-gray-300">No tasks due.</div>
                ) : (
                  items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onToggle={() => markDoneOrOpen(t)}
                      onSnooze={(d) => snooze(t, d)}
                      onEdit={() => openEdit(t)}
                      onDelete={() => requestDelete(t)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-4 space-y-3 pb-8">
          {filtered.map((t) => (
            <li
              key={t.id}
              className={`rounded-xl border p-3 bg-black ${
                t.status === "done" ? "border-white/10 opacity-70" : "border-white/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                      {t.kind === "chore" ? "Chore" : "To-do"}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                      {t.priority === 1 ? "High" : t.priority === 3 ? "Low" : "Normal"}
                    </span>
                    {t.due_at && (
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                        Due {fmtDateShort(t.due_at)}
                      </span>
                    )}
                    {t.assigned_to_name && (
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                        Assigned: {t.assigned_to_name}
                      </span>
                    )}
                    {recurrenceLabel(t) && (
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                        {recurrenceLabel(t)}
                      </span>
                    )}
                  </div>

                  <div className={`mt-2 text-base ${t.status === "done" ? "line-through" : ""}`}>
                    {t.title}
                  </div>

                  <div className="mt-1 text-xs text-gray-400">
                    {t.created_by_name ? `Created by ${t.created_by_name}` : "Created"}
                    {t.status === "done" && t.completed_at && <> • Done {fmtDateShort(t.completed_at)}</>}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                    onClick={() => markDoneOrOpen(t)}
                  >
                    {t.status === "done" ? "Mark open" : "Mark done"}
                  </button>

                  {t.status === "open" && (
                    <>
                      <button
                        className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                        onClick={() => snooze(t, 1)}
                      >
                        Snooze +1d
                      </button>
                      <button
                        className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                        onClick={() => snooze(t, 7)}
                      >
                        Snooze +7d
                      </button>
                    </>
                  )}

                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                    onClick={() => openEdit(t)}
                  >
                    Edit
                  </button>

                  <button
                    className="rounded-lg border border-red-400/50 px-3 py-2 text-sm text-red-200 hover:bg-red-600/20"
                    onClick={() => requestDelete(t)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}

          {filtered.length === 0 && (
            <li className="rounded-xl border border-white/20 bg-black p-4 text-sm text-gray-300">
              No tasks match your filters.
            </li>
          )}
        </ul>
      )}

      {/* EDIT MODAL */}
      {editOpen && editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-black p-4 text-white border border-white/20">
            <h2 className="text-lg font-semibold">Edit task</h2>

            <label className="mt-3 block text-sm text-gray-300">Title</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={eTitle}
              onChange={(e) => setETitle(e.target.value)}
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-gray-300">Type</label>
                <select
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={eKind}
                  onChange={(e) => setEKind(e.target.value as any)}
                >
                  <option value="todo">To-do</option>
                  <option value="chore">Chore</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300">Priority</label>
                <select
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={ePriority}
                  onChange={(e) => setEPriority(Number(e.target.value) as any)}
                >
                  <option value={1}>High</option>
                  <option value={2}>Normal</option>
                  <option value={3}>Low</option>
                </select>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-gray-300">Due date</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  type="date"
                  value={eDue}
                  onChange={(e) => setEDue(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300">Assigned to</label>
                <select
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={eAssignedTo}
                  onChange={(e) => setEAssignedTo(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-white/20 p-3">
              <div className="text-sm font-semibold">Recurrence</div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm text-gray-300">Repeat</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                    value={eRecFreq}
                    onChange={(e) => setERecFreq(e.target.value as any)}
                  >
                    <option value="none">None</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300">Interval</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                    type="number"
                    min={1}
                    max={52}
                    disabled={eRecFreq === "none"}
                    value={eRecInterval}
                    onChange={(e) => setERecInterval(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm text-gray-300">Count (optional)</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                    disabled={eRecFreq === "none"}
                    value={eRecCount}
                    onChange={(e) => setERecCount(e.target.value)}
                    placeholder="e.g., 12"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300">Until (optional)</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                    type="date"
                    disabled={eRecFreq === "none"}
                    value={eRecUntil}
                    onChange={(e) => setERecUntil(e.target.value)}
                  />
                </div>
              </div>

              {eRecFreq !== "none" && (
                <div className="mt-2 text-xs text-gray-400">
                  {recurrenceLabel({ recurrence_freq: eRecFreq, recurrence_interval: eRecInterval } as any)}
                  {" • "}Next occurrence is created when you mark the task done.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => {
                  setEditOpen(false);
                  setEditTask(null);
                }}
              >
                Cancel
              </button>
              <button className="rounded-lg bg-white px-3 py-2 text-black" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-black p-4 text-white border border-white/20">
            <h2 className="text-lg font-semibold">Delete task?</h2>
            <p className="mt-2 text-sm text-gray-300">
              Are you sure you want to delete <span className="font-semibold">“{deleteTitle}”</span>?
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => {
                  setDeleteId(null);
                  setDeleteTitle("");
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-lg border border-red-400/50 px-3 py-2 text-red-200 hover:bg-red-600/20"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Small reusable card used in Calendar view */
function TaskCard({
  task,
  onToggle,
  onSnooze,
  onEdit,
  onDelete,
}: {
  task: TaskRow;
  onToggle: () => void;
  onSnooze: (days: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/20 bg-black p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
              {task.kind === "chore" ? "Chore" : "To-do"}
            </span>
            {task.assigned_to_name && (
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                Assigned: {task.assigned_to_name}
              </span>
            )}
            {recurrenceLabel(task) && (
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-200">
                {recurrenceLabel(task)}
              </span>
            )}
          </div>

          <div className="mt-2 text-base">{task.title}</div>
          <div className="mt-1 text-xs text-gray-400">
            Priority: {task.priority === 1 ? "High" : task.priority === 3 ? "Low" : "Normal"}
            {task.due_at ? ` • Due ${fmtDateShort(task.due_at)}` : ""}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" onClick={onToggle}>
            Mark done
          </button>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => onSnooze(1)}
            >
              +1d
            </button>
            <button
              className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => onSnooze(7)}
            >
              +7d
            </button>
          </div>
          <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" onClick={onEdit}>
            Edit
          </button>
          <button
            className="rounded-lg border border-red-400/50 px-3 py-2 text-sm text-red-200 hover:bg-red-600/20"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}