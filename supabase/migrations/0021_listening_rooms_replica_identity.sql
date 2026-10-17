-- Migration: 0021_listening_rooms_replica_identity.sql
-- Ensure full replica identity for realtime postgres_changes on listening_rooms
-- so the queue and all room columns are always fully delivered to subscribers on update.

alter table if exists public.listening_rooms replica identity full;
