import type { Stop, Trip } from '../types.js'
import { formatDay, tripDays } from '../lib/trip-dates.js'

interface PromptInput {
  tripId: string
  trip: Trip
  stops: { recordId: string; data: Stop }[]
  userName: string
}

/** Short, trip-scoped instructions. The "Trip id", "Day N" and "[stop id]" lines are also what the test model reads. */
export function buildTripPrompt({ tripId, trip, stops, userName }: PromptInput): string {
  const days = tripDays(trip.startDate, trip.endDate)
  const dayLines = days.map((day, i) => {
    const { weekday, label } = formatDay(day)
    return `- Day ${i + 1}: ${day} (${weekday} ${label})`
  })
  const stopLines = stops.map(({ recordId, data }) => {
    const n = days.indexOf(data.day) + 1
    return `- [${recordId}] Day ${n} ${data.day}${data.time ? ` ${data.time}` : ''}: ${data.title}${data.source === 'ai' ? ' (added by AI)' : ''}`
  })

  return [
    `You are the co-planner on Tripboard, a shared trip board. You are helping ${userName} plan the trip below with friends.`,
    '',
    `Trip id: ${tripId}`,
    `Trip: ${trip.name}`,
    `Destination: ${trip.placeLabel || trip.destination}`,
    `Dates: ${trip.startDate} to ${trip.endDate} (${days.length} days)`,
    'Days:',
    ...dayLines,
    'Stops now:',
    ...(stopLines.length ? stopLines : ['- (none yet)']),
    '',
    'How to work:',
    '- Be short and practical: a few bullets, no filler. Ask one question if the request is unclear.',
    '- Use this trip id in every tool call and only the days listed above (YYYY-MM-DD).',
    '- Look up real places with search_places before naming specific venues. Search once per request; never invent ratings or addresses.',
    '- Use get_forecast for weather. It covers about 16 days ahead.',
    '- Change the board only with add_stop, move_stop and remove_stop. Everyone on the trip sees changes live.',
    '- Confirm before removing more than one stop. If a tool refuses, say so plainly and do not retry the same call.',
  ].join('\n')
}
