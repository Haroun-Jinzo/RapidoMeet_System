import { connectionsStore } from "./ConnectionsStore";
import {
  fetchGoogleTokenScopes,
  formatInsufficientScopeError,
  tokenHasCalendarWriteScope,
} from "../auth/googleScopeUtils";

export interface GoogleCalendarEventParams {
  summary?: string;
  title?: string;
  description?: string;
  start?: string | { dateTime?: string; timeZone?: string };
  end?: string | { dateTime?: string; timeZone?: string };
  date?: string;
  time?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  attendees?: Array<{ email: string } | string>;
  participants?: string[];
  timeZone?: string;
}

export interface GoogleCalendarCreatedEvent {
  id: string;
  htmlLink: string;
  summary: string;
}

const DEFAULT_TIME_ZONE = process.env.GOOGLE_CALENDAR_TIMEZONE?.trim() || "UTC";

function normalizeCalendarDate(value: string): string {
  const input = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const isoMatch = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const namedMatch = input.match(
      /^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/
    );
    if (!namedMatch) {
      throw new Error(`Invalid calendar date: ${value}`);
    }

    const months: Record<string, number> = {
      january: 1,
      jan: 1,
      février: 2,
      february: 2,
      feb: 2,
      mars: 3,
      march: 3,
      mar: 3,
      avril: 4,
      april: 4,
      apr: 4,
      mai: 5,
      may: 5,
      juin: 6,
      june: 6,
      jun: 6,
      juillet: 7,
      july: 7,
      jul: 7,
      août: 8,
      august: 8,
      aug: 8,
      septembre: 9,
      september: 9,
      sept: 9,
      octobre: 10,
      october: 10,
      oct: 10,
      novembre: 11,
      november: 11,
      nov: 11,
      décembre: 12,
      december: 12,
      dec: 12,
    };

    year = Number(namedMatch[3]);
    month = months[namedMatch[2].toLocaleLowerCase("fr-FR")];
    day = Number(namedMatch[1]);
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeClockTime(value: string): { hour: number; minute: number } {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);

  if (!match) {
    throw new Error(`Invalid calendar time: ${value}`);
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3];

  if (minute > 59 || hour > (meridiem ? 12 : 23)) {
    throw new Error(`Invalid calendar time: ${value}`);
  }

  if (meridiem) {
    if (hour === 0) {
      throw new Error(`Invalid calendar time: ${value}`);
    }
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour !== 12) hour += 12;
  }

  return { hour, minute };
}

function addMinutesToClock(
  date: string,
  hour: number,
  minute: number,
  durationMinutes: number
): { date: string; hour: number; minute: number } {
  const baseDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error(`Invalid calendar date: ${date}`);
  }

  baseDate.setUTCMinutes(hour * 60 + minute + durationMinutes);
  return {
    date: baseDate.toISOString().slice(0, 10),
    hour: baseDate.getUTCHours(),
    minute: baseDate.getUTCMinutes(),
  };
}

function formatLocalDateTime(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function parseAttendees(
  params: GoogleCalendarEventParams
): Array<{ email: string }> | undefined {
  const raw = params.attendees ?? params.participants;
  if (!raw?.length) return undefined;

  return raw.map((entry) =>
    typeof entry === "string" ? { email: entry } : { email: entry.email }
  );
}

function buildDateTimeRange(params: GoogleCalendarEventParams): {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
} {
  const timeZone = params.timeZone ?? DEFAULT_TIME_ZONE;
  const start = params.start;
  const end = params.end;

  if (start && end) {
    const startDateTime =
      typeof start === "string" ? start : start.dateTime ?? "";
    const endDateTime =
      typeof end === "string" ? end : end.dateTime ?? "";

    if (!startDateTime || !endDateTime) {
      throw new Error("Calendar event requires valid start and end dateTime values.");
    }

    return {
      start: {
        dateTime: startDateTime,
        timeZone:
          typeof start === "object" && start.timeZone
            ? start.timeZone
            : timeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: typeof end === "object" && end.timeZone ? end.timeZone : timeZone,
      },
    };
  }

  const time = params.time ?? params.start_time;
  if (params.date && time) {
    const date = normalizeCalendarDate(params.date);
    const startClock = normalizeClockTime(time);
    const endClock = params.end_time
      ? normalizeClockTime(params.end_time)
      : addMinutesToClock(
          date,
          startClock.hour,
          startClock.minute,
          typeof params.duration_minutes === "number" ? params.duration_minutes : 60
        );
    const endDate =
      "date" in endClock && typeof endClock.date === "string"
        ? endClock.date
      : date;

    return {
      start: {
      dateTime: formatLocalDateTime(date, startClock.hour, startClock.minute),
        timeZone,
      },
      end: {
        dateTime: formatLocalDateTime(endDate, endClock.hour, endClock.minute),
        timeZone,
      },
    };
  }

  throw new Error(
    "Calendar event requires start/end ISO datetimes or date + time parameters."
  );
}

class GoogleCalendarClient {
  async createEvent(
    userId: string,
    params: GoogleCalendarEventParams
  ): Promise<GoogleCalendarCreatedEvent> {
    const accessToken = await connectionsStore.getGoogleAccessToken(userId);

    const tokenScopes = await fetchGoogleTokenScopes(accessToken);
    if (!tokenHasCalendarWriteScope(tokenScopes)) {
      throw new Error(
        "Google Calendar access is missing the Calendar permission. " +
          "Disconnect and reconnect Google Calendar in Settings → Integrations."
      );
    }

    const { start, end } = buildDateTimeRange(params);
    const summary = params.summary ?? params.title;

    if (!summary) {
      throw new Error("Calendar event requires a summary or title.");
    }

    const body: Record<string, unknown> = {
      summary,
      description: params.description,
      start,
      end,
    };

    const attendees = parseAttendees(params);
    if (attendees?.length) {
      body.attendees = attendees;
    }

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const apiMessage =
        typeof data.error === "object" && data.error !== null
          ? JSON.stringify(data.error)
          : typeof data.error === "string"
            ? data.error
            : JSON.stringify(data);

      if (response.status === 403) {
        throw new Error(formatInsufficientScopeError(apiMessage));
      }

      throw new Error(
        `Google Calendar API error (${response.status}): ${apiMessage}`
      );
    }

    return {
      id: String(data.id ?? ""),
      htmlLink: String(data.htmlLink ?? ""),
      summary: String(data.summary ?? summary),
    };
  }
}

export const googleCalendarClient = new GoogleCalendarClient();
