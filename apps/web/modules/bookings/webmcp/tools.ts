import type { BookerEvent, Slots } from "@calcom/features/bookings/types";
import type { WebMCPJSONSchema, WebMCPTool } from "./types";

type BookingField = BookerEvent["bookingFields"][number];
type FieldValue = string | number | boolean | string[] | Record<string, string>;

/** The part of the booking form (react-hook-form) the tools use. */
export interface BookingFormApi {
  getValues(name: string): unknown;
  setValue(name: string, value: unknown, options?: { shouldDirty?: boolean; shouldTouch?: boolean }): void;
  trigger(): Promise<boolean>;
  formState: { errors: { responses?: unknown } };
}

export type BookerSnapshot = {
  event: BookerEvent | null | undefined;
  slots: Slots | undefined;
  isLoadingSlots: boolean;
  timezone: string;
  selectedTimeslot: string | null;
  selectedDuration: number | null;
  isRescheduling: boolean;
  form: BookingFormApi;
  selectDate: (date: string) => void;
  selectDuration: (duration: number) => void;
  selectTimeslot: (time: string, seats: { attendees?: number; bookingUid?: string }) => void;
};

type ToolFailure = { ok: false; error: string };

const MAX_SLOTS = 200;
const DEFAULT_DAYS = 7;

const fail = (error: string): ToolFailure => ({ ok: false, error });

const formatInTimezone = (time: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));

const getDateKey = (time: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(time));

const isFillable = (field: BookingField) =>
  !field.hidden && (field.editable ?? "user") !== "system" && field.editable !== "user-readonly";

const getOptionValues = (field: BookingField) => (field.options ?? []).map((option) => option.value);

/** Returns an error message when the value can't be what the field accepts. */
const checkValue = (field: BookingField, value: unknown): string | null => {
  const optionValues = getOptionValues(field);
  switch (field.type) {
    case "number":
      return typeof value === "number" ? null : "expects a number";
    case "boolean":
      return typeof value === "boolean" ? null : "expects true or false";
    case "multiemail":
    case "multiselect":
    case "checkbox": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return "expects a list of strings";
      }
      if (field.type !== "multiemail" && value.some((item) => !optionValues.includes(item))) {
        return `expects values from: ${optionValues.join(", ")}`;
      }
      return null;
    }
    case "select":
    case "radio":
    case "radioInput":
      return typeof value === "string" && optionValues.includes(value)
        ? null
        : `expects one of: ${optionValues.join(", ")}`;
    case "name": {
      if (typeof value === "string") return null;
      const isNameParts =
        typeof value === "object" &&
        value !== null &&
        Object.values(value).every((part) => typeof part === "string");
      return isNameParts ? null : "expects text or an object with firstName and lastName";
    }
    default:
      return typeof value === "string" ? null : "expects text";
  }
};

// The location field stores the chosen option next to an optional free-text input (e.g. a phone number)
const toFormValue = (
  field: BookingField,
  value: FieldValue
): FieldValue | { value: string; optionValue: string } =>
  field.name === "location" && typeof value === "string" ? { value, optionValue: "" } : value;

const fromFormValue = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "value" in value
    ? (value as { value: unknown }).value
    : value;

const describeField = (field: BookingField, snapshot: BookerSnapshot) => {
  const fieldErrors = snapshot.form.formState.errors.responses as
    | Record<string, { message?: string } | undefined>
    | undefined;
  const error = fieldErrors?.[field.name];
  return {
    name: field.name,
    type: field.type,
    label: field.label || field.defaultLabel,
    required: !!field.required,
    ...(field.options?.length ? { options: getOptionValues(field) } : {}),
    value: fromFormValue(snapshot.form.getValues(`responses.${field.name}`)) ?? null,
    ...(error?.message ? { error: error.message } : {}),
  };
};

const getFillableFields = (snapshot: BookerSnapshot) =>
  (snapshot.event?.bookingFields ?? []).filter(isFillable);

type ToolDefinition = Omit<WebMCPTool, "execute"> & {
  run: (input: Record<string, unknown>, snapshot: BookerSnapshot) => Promise<unknown> | unknown;
};

const object = (properties: Record<string, WebMCPJSONSchema>, required: string[] = []): WebMCPJSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const READ_ONLY = { readOnlyHint: true, untrustedContentHint: true };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get-booking-page",
    title: "Get booking page",
    description:
      "Read the event being booked: title, host, durations, locations, timezone, and what the visitor has selected so far.",
    inputSchema: object({}),
    annotations: READ_ONLY,
    run: (_input, { event, timezone, selectedDuration, selectedTimeslot, isRescheduling }) => {
      if (!event) return fail("The event is still loading. Try again in a moment.");
      return {
        ok: true,
        title: event.title,
        description: event.description,
        hosts: event.subsetOfHosts?.map((host) => host.user.name).filter(Boolean),
        durationMinutes: event.length,
        selectableDurations: event.metadata?.multipleDuration ?? null,
        selectedDuration,
        locations: event.locations.map((location) => location.type),
        timezone,
        requiresHostConfirmation: !!event.requiresConfirmation,
        seatsPerTimeSlot: event.seatsPerTimeSlot ?? null,
        recurring: event.recurringEvent ?? null,
        isRescheduling,
        selectedTime: selectedTimeslot,
      };
    },
  },
  {
    name: "get-available-slots",
    title: "Get available slots",
    description:
      "List bookable times. Pass a date (YYYY-MM-DD) to show that day on the page; without one, lists the next days with availability.",
    inputSchema: object({ date: { type: "string", description: "Day to look at, YYYY-MM-DD" } }),
    annotations: READ_ONLY,
    run: ({ date }, snapshot) => {
      if (date !== undefined) {
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return fail("date must look like 2026-10-22.");
        }
        snapshot.selectDate(date);
      }
      if (snapshot.isLoadingSlots || !snapshot.slots) {
        return fail("Availability is still loading. Call this tool again in a moment.");
      }
      const days = Object.entries(snapshot.slots)
        .filter(([day, times]) => times.length > 0 && (date === undefined || day === date))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, date === undefined ? DEFAULT_DAYS : 1);
      let remaining = MAX_SLOTS;
      return {
        ok: true,
        timezone: snapshot.timezone,
        days: days.map(([day, times]) => {
          const shown = times.slice(0, Math.max(remaining, 0));
          remaining -= shown.length;
          return {
            date: day,
            slots: shown.map(({ time }) => ({ time, local: formatInTimezone(time, snapshot.timezone) })),
          };
        }),
      };
    },
  },
  {
    name: "select-time-slot",
    title: "Select time slot",
    description:
      "Pick one of the times returned by get-available-slots. This opens the booking form and holds the slot briefly; nothing is booked.",
    inputSchema: object(
      {
        time: { type: "string", description: "A `time` value from get-available-slots" },
        duration: { type: "integer", description: "Minutes, when the event offers several durations" },
      },
      ["time"]
    ),
    annotations: {},
    run: ({ time, duration }, snapshot) => {
      if (typeof time !== "string") return fail("time must be a value from get-available-slots.");
      const durations = snapshot.event?.metadata?.multipleDuration;
      if (duration !== undefined) {
        if (typeof duration !== "number" || !durations?.includes(duration)) {
          return fail(
            `duration must be one of: ${durations?.join(", ") ?? "none, this event has a fixed length"}.`
          );
        }
        snapshot.selectDuration(duration);
      }
      const slot = Object.values(snapshot.slots ?? {})
        .flat()
        .find((candidate) => new Date(candidate.time).getTime() === new Date(time).getTime());
      if (!slot) return fail("That time isn't in the loaded availability. Call get-available-slots first.");
      snapshot.selectDate(getDateKey(slot.time, snapshot.timezone));
      snapshot.selectTimeslot(slot.time, {
        attendees: (slot as { attendees?: number }).attendees,
        bookingUid: (slot as { bookingUid?: string }).bookingUid,
      });
      return { ok: true, selectedTime: slot.time, local: formatInTimezone(slot.time, snapshot.timezone) };
    },
  },
  {
    name: "get-booking-form",
    title: "Get booking form",
    description:
      "Read the booking questions the visitor has to answer, with their current answers and any validation errors.",
    inputSchema: object({}),
    annotations: READ_ONLY,
    run: (_input, snapshot) => {
      if (!snapshot.event) return fail("The event is still loading. Try again in a moment.");
      return { ok: true, fields: getFillableFields(snapshot).map((field) => describeField(field, snapshot)) };
    },
  },
  {
    name: "fill-booking-form",
    title: "Fill booking form",
    description:
      "Enter answers into the booking form, keyed by field name from get-booking-form. Only use what the visitor told you.",
    inputSchema: object(
      { answers: { type: "object", description: "Field name to answer", additionalProperties: true } },
      ["answers"]
    ),
    annotations: {},
    run: async ({ answers }, snapshot) => {
      if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
        return fail("answers must be an object keyed by field name.");
      }
      const fields = new Map(getFillableFields(snapshot).map((field) => [field.name, field]));
      const problems: string[] = [];
      for (const [name, value] of Object.entries(answers)) {
        const field = fields.get(name);
        const problem = field
          ? checkValue(field, value)
          : "isn't a field you can fill. Call get-booking-form.";
        if (problem || !field) problems.push(`${name} ${problem}`);
      }
      if (problems.length > 0) return fail(`Nothing was entered. ${problems.join("; ")}`);
      for (const [name, value] of Object.entries(answers)) {
        const field = fields.get(name);
        if (!field) continue;
        snapshot.form.setValue(`responses.${name}`, toFormValue(field, value as FieldValue), {
          shouldDirty: true,
          shouldTouch: true,
        });
      }
      return { ok: true, filled: Object.keys(answers) };
    },
  },
  {
    name: "review-booking",
    title: "Review booking",
    description:
      "Check the form and summarize the booking. It does not book anything: the visitor confirms by pressing the Confirm button on the page.",
    inputSchema: object({}),
    annotations: READ_ONLY,
    run: async (_input, snapshot) => {
      const { event, selectedTimeslot, timezone } = snapshot;
      if (!event) return fail("The event is still loading. Try again in a moment.");
      if (!selectedTimeslot) return fail("No time is selected. Call select-time-slot first.");
      const isValid = await snapshot.form.trigger();
      return {
        ok: true,
        readyToConfirm: isValid,
        summary: {
          event: event.title,
          time: formatInTimezone(selectedTimeslot, timezone),
          timezone,
          requiresHostConfirmation: !!event.requiresConfirmation,
          answers: getFillableFields(snapshot).map((field) => describeField(field, snapshot)),
        },
        next: isValid
          ? "Show this summary to the visitor and ask them to press Confirm on the page when happy."
          : "Some answers are missing or invalid (see `error`). Ask the visitor, then call fill-booking-form.",
      };
    },
  },
];

export const toWebMCPTool = (definition: ToolDefinition, getSnapshot: () => BookerSnapshot): WebMCPTool => {
  const { run, ...tool } = definition;
  return {
    ...tool,
    execute: async (input) => {
      try {
        return await run(input ?? {}, getSnapshot());
      } catch (error) {
        return fail(`The tool failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
};
