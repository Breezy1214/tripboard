// Imported by both the worker and the client.
import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { tripSchemas } from './schemas/trip-schemas'
import { aiChatSchemas } from './schemas/ai-chat-schema'

export const schemas: CollectionSchema[] = [
  ...aiChatSchemas,
  usersSchema,
  settingsSchema,
  ...tripSchemas,
]
