/**
 * Trip membership uses the 'team' level: a row passes when the caller created
 * it or has an active team_members row whose teamId equals the row's teamField.
 *
 * `create` is a plain boolean in the RBAC model (no row to check), so 'team'
 * cannot stop a non-member from creating a stop on someone else's trip. Every
 * create therefore goes through a server action that checks membership first
 * (src/actions/index.ts); clients get create: false everywhere here.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }

export const tripsSchema: CollectionSchema = {
  name: 'trips',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'destination', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'placeLabel', storage: 'text', interpretation: 'plain', maxLength: 160 },
    { name: 'lat', storage: 'number', interpretation: 'plain' },
    { name: 'lon', storage: 'number', interpretation: 'plain' },
    { name: 'startDate', storage: 'text', interpretation: 'plain', required: true },
    { name: 'endDate', storage: 'text', interpretation: 'plain', required: true },
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'forecast', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'forecastAt', storage: 'text', interpretation: 'plain' },
  ],
  teamField: 'teamId',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'team', create: false, update: 'team', delete: false, writableFields: ['name'] },
    admin: { read: 'team', create: false, update: 'team', delete: false, writableFields: ['name'] },
  },
}

const stopMemberPermissions: RolePermissions = {
  read: 'team',
  create: false,
  update: 'team',
  delete: 'team',
  writableFields: ['day', 'position', 'title', 'notes', 'time'],
}

export const stopsSchema: CollectionSchema = {
  name: 'stops',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'day', storage: 'text', interpretation: 'plain', required: true },
    { name: 'position', storage: 'number', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'notes', storage: 'text', interpretation: 'plain', maxLength: 1000 },
    { name: 'time', storage: 'text', interpretation: 'plain', maxLength: 5 },
    { name: 'placeName', storage: 'text', interpretation: 'plain', maxLength: 160 },
    { name: 'address', storage: 'text', interpretation: 'plain', maxLength: 240 },
    { name: 'lat', storage: 'number', interpretation: 'plain' },
    { name: 'lon', storage: 'number', interpretation: 'plain' },
    { name: 'rating', storage: 'number', interpretation: 'plain' },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['user', 'ai'] } },
    { name: 'addedBy', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
  ],
  teamField: 'tripId',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: stopMemberPermissions,
    admin: stopMemberPermissions,
  },
}

const readOwnTeam: RolePermissions = { read: 'team', create: false, update: false, delete: false }

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'removed'] } },
    { name: 'role', storage: 'text', interpretation: { kind: 'select', options: ['owner', 'member'] } },
    // Copied from the member's users row when they create or join the trip:
    // co-members read names here, since the users roster is scoped to self.
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'imageUrl', storage: 'text', interpretation: 'plain' },
  ],
  teamField: 'teamId',
  uniqueOn: ['teamId', 'userId'],
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: readOwnTeam,
    admin: readOwnTeam,
  },
}

const adminReadOnly = {
  '*': NONE,
  viewer: NONE,
  member: NONE,
  admin: { read: true, create: false, update: false, delete: false },
} satisfies Record<string, RolePermissions>

export const tripInvitesSchema: CollectionSchema = {
  name: 'trip_invites',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'code', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  uniqueOn: ['code'],
  permissions: adminReadOnly,
}

export const usageSchema: CollectionSchema = {
  name: 'usage',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'day', storage: 'text', interpretation: 'plain', required: true },
    { name: 'kind', storage: 'text', interpretation: 'plain', required: true },
    { name: 'count', storage: 'number', interpretation: 'plain' },
    { name: 'credits', storage: 'number', interpretation: 'plain' },
  ],
  permissions: adminReadOnly,
}

/** Cached place searches, one row per trip and normalized query, written by the search_places tool. */
export const placeSearchesSchema: CollectionSchema = {
  name: 'place_searches',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'query', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'places', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['serpapi', 'openstreetmap'] } },
  ],
  uniqueOn: ['tripId', 'query'],
  permissions: adminReadOnly,
}

/** One row per Nominatim request, keyed by the second it was sent in: the unique index keeps the app at one request per second. */
export const osmSlotsSchema: CollectionSchema = {
  name: 'osm_slots',
  columns: [{ name: 'second', storage: 'text', interpretation: 'plain', required: true, immutable: true }],
  uniqueOn: ['second'],
  permissions: adminReadOnly,
}

export const tripSchemas = [
  tripsSchema,
  stopsSchema,
  teamMembersSchema,
  tripInvitesSchema,
  usageSchema,
  placeSearchesSchema,
  osmSlotsSchema,
]
