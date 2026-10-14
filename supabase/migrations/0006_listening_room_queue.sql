-- Migration: 0006_listening_room_queue.sql
-- Add queue column to listening_rooms for live room queue synchronization

alter table public.listening_rooms
  add column if not exists queue jsonb default '[]'::jsonb;
