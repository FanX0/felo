-- Migration: 0011_listening_room_device_stream.sql
-- Add is_device_stream column to listening_rooms for live system audio broadcast flag

alter table public.listening_rooms
  add column if not exists is_device_stream boolean not null default false;
