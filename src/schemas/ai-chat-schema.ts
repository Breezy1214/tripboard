/**
 * AI chat collections from the SDK, with two changes:
 * - each chat belongs to a trip, and a user has at most one chat per trip. The
 *   chat routes create the row (members only) and read `tripId` to scope the
 *   prompt and tools;
 * - members cannot update chats or messages over the records socket. History
 *   is model input, so only the worker writes it.
 */

import { AI_CHATS_SCHEMA, AI_MESSAGES_SCHEMA, type CollectionSchema } from 'deepspace/schema'

const memberReadOnly = { read: 'own', create: false, update: false, delete: 'own' } as const

export const tripChatsSchema: CollectionSchema = {
  ...AI_CHATS_SCHEMA,
  columns: [
    ...AI_CHATS_SCHEMA.columns,
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  uniqueOn: ['userId', 'tripId'],
  permissions: { ...AI_CHATS_SCHEMA.permissions, member: memberReadOnly },
}

export const tripMessagesSchema: CollectionSchema = {
  ...AI_MESSAGES_SCHEMA,
  permissions: { ...AI_MESSAGES_SCHEMA.permissions, member: memberReadOnly },
}

export const aiChatSchemas: CollectionSchema[] = [tripChatsSchema, tripMessagesSchema]
