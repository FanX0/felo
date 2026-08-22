import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core'

export type SharedSong = {
  localId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  artworkUrl?: string
}

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_members_user_idx').on(table.userId)
  ]
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull(),
    body: text('body').notNull().default(''),
    song: jsonb('song').$type<SharedSong>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt)]
)

export const sharedPlaylists = pgTable('shared_playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const sharedPlaylistMembers = pgTable(
  'shared_playlist_members',
  {
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => sharedPlaylists.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('editor'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.userId] }),
    index('shared_playlist_members_user_idx').on(table.userId)
  ]
)

export const sharedPlaylistItems = pgTable(
  'shared_playlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => sharedPlaylists.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').notNull(),
    song: jsonb('song').$type<SharedSong>().notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('shared_playlist_items_playlist_idx').on(table.playlistId, table.position)]
)

export const listeningRooms = pgTable('listening_rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  song: jsonb('song').$type<SharedSong>(),
  positionSeconds: integer('position_seconds').notNull().default(0),
  isPlaying: boolean('is_playing').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const listeningRoomMembers = pgTable(
  'listening_room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => listeningRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index('listening_room_members_user_idx').on(table.userId)
  ]
)
