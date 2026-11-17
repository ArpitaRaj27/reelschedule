/** Shapes returned by the ReelSchedule API (mirrors api/src/services/*.ts DTOs). */

export type ScreeningStatus = "scheduled" | "canceled";

export interface Screening {
  id: string;
  status: ScreeningStatus;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
  runtimeMinutes: number;
  bufferMinutes: number;
  version: number;
  updatedAt: string;
  film: { id: string; title: string; genres: string[]; releaseYear: number | null; posterPath: string | null; source: string };
  room: { id: string; name: string; seats: number; venue: { id: string; name: string } };
}

export interface Page<T> {
  items: T[];
  count: number;
  page: number;
  pageSize: number;
}

export interface Room {
  id: string;
  name: string;
  seats: number;
  venue: { id: string; name: string; city: string };
}

export interface Film {
  id: string;
  source: string;
  tmdbId: number | null;
  title: string;
  runtimeMinutes: number | null;
  genres: string[];
  releaseYear: number | null;
  posterPath: string | null;
  fetchedAt: string;
}

export interface TmdbSearchItem {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterPath: string | null;
}

export interface TmdbSearchResult {
  items: TmdbSearchItem[];
  fetchedAt: string;
  stale: boolean;
  attribution: string;
}

export interface Meta {
  festivalName: string;
  timezone: string;
  defaultBufferMinutes: number;
  days: string[];
}

export interface Me {
  sub: string;
  roles: string[];
  scopes: string[];
  canProgram: boolean;
}

export interface Conflict {
  id: string;
  title: string;
  startsAt: string;
  occupiedUntil: string;
}

export interface Preview {
  film: { id: string; title: string };
  roomId: string;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
  runtimeMinutes: number;
  bufferMinutes: number;
  conflicts: Conflict[];
  ok: boolean;
}

export interface RoomSchedule {
  room: { id: string; name: string; seats: number; venue: string };
  screenings: Screening[];
}

export interface ChangeEvent {
  id: number;
  occurredAt: string;
  type: "screening.created" | "screening.rescheduled" | "screening.canceled" | string;
  screeningId: string | null;
  roomId: string | null;
  payload: unknown;
}

export interface ScheduleInput {
  filmId: string;
  roomId: string;
  startsAt: string;
  bufferMinutes?: number;
}

export interface StatusItem {
  id: string;
  title: string;
  room: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
}

export interface FestivalStatus {
  festival: string;
  timezone: string;
  generatedAt: string;
  nowShowing: StatusItem[];
  nextUp: StatusItem[];
  totals: { scheduled: number; canceled: number; rooms: number; roomsInUseNow: number };
}
