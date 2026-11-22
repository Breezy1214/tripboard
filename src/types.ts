export interface DayWeather {
  code: number
  max: number
  min: number
  precip: number | null
}

export interface TripForecast {
  days: Record<string, DayWeather>
}

export interface Trip {
  name: string
  destination: string
  placeLabel?: string
  lat?: number | null
  lon?: number | null
  startDate: string
  endDate: string
  teamId: string
  forecast?: TripForecast | null
  forecastAt?: string
}

export interface Stop {
  tripId: string
  day: string
  position: number
  title: string
  notes?: string
  time?: string
  placeName?: string
  address?: string
  lat?: number | null
  lon?: number | null
  rating?: number | null
  source?: 'user' | 'ai'
  addedBy?: string
}

export interface TeamMember {
  teamId: string
  userId: string
  status: 'active' | 'removed'
  role: 'owner' | 'member'
  name?: string
  imageUrl?: string
}
