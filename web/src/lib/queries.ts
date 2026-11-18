import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, query } from "./api";
import { dataVersion } from "./freshness";
import type { FestivalStatus, Film, Meta, Page, Room, RoomSchedule, Screening, ScreeningStatus } from "./types";

/** Cache key for public reads: changes whenever a live update arrives (see freshness.ts). */
const v = () => dataVersion() || undefined;

export const FALLBACK_META: Meta = {
  festivalName: "Lakeshore Film Festival",
  timezone: "America/Chicago",
  defaultBufferMinutes: 15,
  days: [],
};

/** The URL matches the <link rel="preload"> in index.html on first load (no ?v= yet), so the preload is reused. */
export function useMetaQuery() {
  return useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => api<Meta>(`/api/meta${query({ v: v() })}`, { signal }), staleTime: 60_000 });
}

export function useMeta(): Meta {
  return useMetaQuery().data ?? FALLBACK_META;
}

export function useRooms() {
  return useQuery({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => api<{ items: Room[] }>("/api/rooms", { signal }).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function useGenres() {
  return useQuery({
    queryKey: ["genres"],
    queryFn: ({ signal }) => api<{ items: string[] }>("/api/genres", { signal }).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function useFilms() {
  return useQuery({
    queryKey: ["films"],
    queryFn: ({ signal }) => api<{ items: Film[] }>("/api/films", { signal, auth: true }).then((r) => r.items),
  });
}

export interface ScreeningFilters {
  q?: string;
  date?: string;
  roomId?: string;
  genre?: string;
  status?: ScreeningStatus;
  page?: number;
  pageSize?: number;
}

export function useScreenings(filters: ScreeningFilters) {
  return useQuery({
    queryKey: ["screenings", filters],
    queryFn: ({ signal }) => api<Page<Screening>>(`/api/screenings${query({ ...filters, v: v() })}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useScreening(id: string | undefined) {
  return useQuery({
    queryKey: ["screening", id],
    queryFn: ({ signal }) => api<Screening>(`/api/screenings/${id}${query({ v: v() })}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useRoomSchedule(roomId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ["room-schedule", roomId, date],
    queryFn: ({ signal }) => api<RoomSchedule>(`/api/rooms/${roomId}/schedule${query({ date, v: v() })}`, { signal }),
    enabled: Boolean(roomId),
    placeholderData: keepPreviousData,
  });
}

/** Now showing / next up. Polled every 30 s (the clock moves even when nothing is edited) and
 *  refreshed immediately by live updates. */
export function useFestivalStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<FestivalStatus>(`/api/status${query({ v: v() })}`, { signal }),
    refetchInterval: 30_000,
  });
}

/** Value that only updates after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
