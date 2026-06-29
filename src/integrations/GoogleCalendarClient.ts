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

  if (params.start && params.end) {
    const startDateTime =
      typeof params.start === "string"
        ? params.start
        : params.start.dateTime ?? "";
    const endDateTime =
      typeof params.end === "string" ? params.end : params.end.dateTime ?? "";

    if (!startDateTime || !endDateTime) {
      throw new Error("Calendar event requires valid start and end dateTime values.");
    }

    return {
      start: {
        dateTime: startDateTime,
        timeZone:
          typeof params.start === "object" && params.start.timeZone
            ? params.start.timeZone
            : timeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone:
          typeof params.end === "object" && params.end.timeZone
            ? params.end.timeZone
            : timeZone,
      },
    };
  }

  if (params.date && params.time) {
    const durationMinutes =
      typeof params.duration_minutes === "number" ? params.duration_minutes : 60;
    const startDate = new Date(`${params.date}T${params.time}:00`);
    if (Number.isNaN(startDate.getTime())) {
      throw new Error(`Invalid calendar date/time: ${params.date} ${params.time}`);
    }
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    return {
      start: { dateTime: startDate.toISOString(), timeZone },
      end: { dateTime: endDate.toISOString(), timeZone },
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
