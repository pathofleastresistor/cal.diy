import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useBookerTime } from "@calcom/features/bookings/Booker/hooks/useBookerTime";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { ENABLE_WEBMCP } from "@calcom/lib/constants";
import { useEffect, useRef } from "react";
import type { BookerSnapshot, BookingFormApi } from "../webmcp/tools";
import { TOOL_DEFINITIONS, toWebMCPTool } from "../webmcp/tools";
import type { ModelContextHost } from "../webmcp/types";
import type { UseSlotsReturnType } from "./useSlots";

type Props = {
  event: BookerEvent | null | undefined;
  schedule: { data?: { slots?: BookerSnapshot["slots"] } | null; isPending?: boolean };
  slots: UseSlotsReturnType;
  form: BookingFormApi;
};

/**
 * Exposes the open booking page to browser AI assistants through WebMCP (opt-in with
 * NEXT_PUBLIC_WEBMCP_ENABLED=1). The tools read availability and fill in the booking form
 * through the same state the page uses, but none of them submits: the visitor confirms
 * the booking with the page's own button.
 */
export const useBookerWebMCP = ({ event, schedule, slots, form }: Props) => {
  const { timezone } = useBookerTime();
  const selectedDuration = useBookerStoreContext((state) => state.selectedDuration);
  const rescheduleUid = useBookerStoreContext((state) => state.rescheduleUid);
  const setSelectedDate = useBookerStoreContext((state) => state.setSelectedDate);
  const setSelectedDuration = useBookerStoreContext((state) => state.setSelectedDuration);
  const setSeatedEventData = useBookerStoreContext((state) => state.setSeatedEventData);

  // Tools run long after they were registered, so they read the latest render's state.
  const snapshotRef = useRef<BookerSnapshot | null>(null);
  snapshotRef.current = {
    event,
    slots: schedule.data?.slots,
    isLoadingSlots: !!schedule.isPending,
    timezone,
    selectedTimeslot: slots.selectedTimeslot,
    selectedDuration,
    isRescheduling: !!rescheduleUid,
    form,
    selectDate: (date) => setSelectedDate({ date }),
    selectDuration: setSelectedDuration,
    selectTimeslot: (time, { attendees, bookingUid }) => {
      slots.setTentativeSelectedTimeslots([]);
      if (event?.seatsPerTimeSlot) {
        setSeatedEventData({
          seatsPerTimeSlot: event.seatsPerTimeSlot,
          attendees: attendees ?? 0,
          bookingUid,
          showAvailableSeatsCount: event.seatsShowAvailabilityCount,
        });
      }
      slots.setSelectedTimeslot(time);
    },
  };

  useEffect(() => {
    if (!ENABLE_WEBMCP) return;
    const modelContext = (document as ModelContextHost).modelContext;
    if (!modelContext?.registerTool) return;

    const controller = new AbortController();
    const getSnapshot = () => {
      if (!snapshotRef.current) throw new Error("The booking page isn't ready.");
      return snapshotRef.current;
    };
    for (const definition of TOOL_DEFINITIONS) {
      Promise.resolve(
        modelContext.registerTool(toWebMCPTool(definition, getSnapshot), { signal: controller.signal })
      ).catch((error) => {
        if (!controller.signal.aborted) {
          console.warn(`[WebMCP] couldn't register "${definition.name}"`, error);
        }
      });
    }
    return () => controller.abort();
  }, []);
};
