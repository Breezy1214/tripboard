/**
 * AI chat collections from the SDK, with one change: each chat belongs to a
 * trip, and a user has at most one chat per trip. The chat routes create the
 * row (members only) and read `tripId` to scope the prompt and tools.
 */

import { AI_CHATS_SCHEMA, AI_MESSAGES_SCHEMA, type CollectionSchema } from 'deepspace/schema'

export const tripChatsSchema: CollectionSchema = {
  ...AI_CHATS_SCHEMA,
  columns: [
    ...AI_CHATS_SCHEMA.columns,
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  uniqueOn: ['userId', 'tripId'],
}

export const aiChatSchemas: CollectionSchema[] = [tripChatsSchema, AI_MESSAGES_SCHEMA]
