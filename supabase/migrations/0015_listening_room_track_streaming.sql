-- Migration: 0015_listening_room_track_streaming.sql
-- Add is_track_streaming column to listening_rooms for live WebRTC track audio broadcast flag

alter table public.listening_rooms
  add column if not exists is_track_streaming boolean not null default false;
