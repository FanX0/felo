-- Migration: 0013_room_commands_replica_identity.sql
-- Ensure full replica identity for realtime postgres_changes filters on listening_room_commands

alter table public.listening_room_commands replica identity full;
