import type { BookerEvent } from "@calcom/features/bookings/types";
import { describe, expect, it, vi } from "vitest";
import type { BookerSnapshot } from "./tools";
import { TOOL_DEFINITIONS, toWebMCPTool } from "./tools";

const field = (overrides: Record<string, unknown>) => ({ type: "text", required: false, ...overrides });

const makeSnapshot = (overrides: Partial<BookerSnapshot> = {}) => {
  const values: Record<string, unknown> = {};
  const snapshot: BookerSnapshot = {
    event: {
      title: "Intro call",
      length: 30,
      locations: [{ type: "integrations:daily" }],
      metadata: { multipleDuration: [15, 30] },
      bookingFields: [
        field({ name: "name", type: "name", required: true, editable: "system" }),
        field({ name: "email", type: "email", required: true, editable: "system" }),
        field({ name: "topic", type: "select", options: [{ label: "Sales", value: "sales" }] }),
        field({ name: "rescheduleReason", type: "textarea", views: [{ id: "reschedule" }] }),
        field({ name: "internal", hidden: true }),
        field({ name: "locked", editable: "user-readonly" }),
      ],
    } as unknown as BookerEvent,
    slots: {
      "2026-10-22": [{ time: "2026-10-22T16:00:00.000Z" }, { time: "2026-10-22T16:30:00.000Z" }],
      "2026-10-23": [],
      "2026-10-24": [{ time: "2026-10-24T16:00:00.000Z" }],
    },
    isLoadingSlots: false,
    timezone: "America/Los_Angeles",
    selectedTimeslot: null,
    selectedDuration: null,
    isRescheduling: false,
    form: {
      getValues: (name) => values[name],
      setValue: (name, value) => {
        values[name] = value;
      },
      trigger: vi.fn().mockResolvedValue(true),
      formState: { errors: {} },
    },
    selectDate: vi.fn(),
    selectDuration: vi.fn(),
    selectTimeslot: vi.fn(),
    ...overrides,
  };
  return snapshot;
};

const call = (name: string, input: Record<string, unknown>, snapshot: BookerSnapshot) => {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error(`no tool ${name}`);
  return toWebMCPTool(definition, () => snapshot).execute(input);
};

describe("booker WebMCP tools", () => {
  it("has no tool that books", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "get-booking-page",
      "get-available-slots",
      "select-time-slot",
      "get-booking-form",
      "fill-booking-form",
      "review-booking",
    ]);
  });

  it("lists the days with availability and skips empty ones", async () => {
    const result = (await call("get-available-slots", {}, makeSnapshot())) as {
      days: { date: string; slots: unknown[] }[];
    };
    expect(result.days.map((day) => day.date)).toEqual(["2026-10-22", "2026-10-24"]);
  });

  it("shows the requested day on the page", async () => {
    const snapshot = makeSnapshot();
    const result = (await call("get-available-slots", { date: "2026-10-22" }, snapshot)) as {
      days: { slots: unknown[] }[];
    };
    expect(snapshot.selectDate).toHaveBeenCalledWith("2026-10-22");
    expect(result.days[0].slots).toHaveLength(2);
  });

  it("asks to retry while availability loads", async () => {
    const result = await call("get-available-slots", {}, makeSnapshot({ isLoadingSlots: true }));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses times that aren't offered", async () => {
    const snapshot = makeSnapshot();
    const result = await call("select-time-slot", { time: "2026-10-22T17:00:00.000Z" }, snapshot);
    expect(result).toMatchObject({ ok: false });
    expect(snapshot.selectTimeslot).not.toHaveBeenCalled();
  });

  it("selects an offered time on its day in the booker's timezone", async () => {
    const snapshot = makeSnapshot();
    await call("select-time-slot", { time: "2026-10-22T16:30:00.000Z", duration: 15 }, snapshot);
    expect(snapshot.selectDuration).toHaveBeenCalledWith(15);
    expect(snapshot.selectDate).toHaveBeenCalledWith("2026-10-22");
    expect(snapshot.selectTimeslot).toHaveBeenCalledWith("2026-10-22T16:30:00.000Z", {});
  });

  it("rejects a duration the event doesn't offer", async () => {
    const snapshot = makeSnapshot();
    const result = await call(
      "select-time-slot",
      { time: "2026-10-22T16:00:00.000Z", duration: 45 },
      snapshot
    );
    expect(result).toMatchObject({ ok: false });
    expect(snapshot.selectTimeslot).not.toHaveBeenCalled();
  });

  it("only exposes questions the visitor can answer", async () => {
    const result = (await call("get-booking-form", {}, makeSnapshot())) as { fields: { name: string }[] };
    expect(result.fields.map((f) => f.name)).toEqual(["name", "email", "topic"]);
  });

  it("keeps the page's rules when rescheduling", async () => {
    const result = (await call("get-booking-form", {}, makeSnapshot({ isRescheduling: true }))) as {
      fields: { name: string }[];
    };
    expect(result.fields.map((f) => f.name)).toEqual(["topic", "rescheduleReason"]);
  });

  it("fills answers, or nothing when one of them is wrong", async () => {
    const snapshot = makeSnapshot();
    const bad = await call("fill-booking-form", { answers: { email: "a@b.co", topic: "legal" } }, snapshot);
    expect(bad).toMatchObject({ ok: false });
    expect(snapshot.form.getValues("responses.email")).toBeUndefined();

    const hidden = await call("fill-booking-form", { answers: { internal: "x", locked: "y" } }, snapshot);
    expect(hidden).toMatchObject({ ok: false });

    const good = await call("fill-booking-form", { answers: { email: "a@b.co", topic: "sales" } }, snapshot);
    expect(good).toMatchObject({ ok: true });
    expect(snapshot.form.getValues("responses.email")).toBe("a@b.co");
  });

  it("reviews without booking and points the visitor to the Confirm button", async () => {
    const snapshot = makeSnapshot({ selectedTimeslot: "2026-10-22T16:00:00.000Z" });
    const result = (await call("review-booking", {}, snapshot)) as { readyToConfirm: boolean; next: string };
    expect(result.readyToConfirm).toBe(true);
    expect(result.next).toContain("Confirm");
  });

  it("needs a selected time to review", async () => {
    expect(await call("review-booking", {}, makeSnapshot())).toMatchObject({ ok: false });
  });
});
