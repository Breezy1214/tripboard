import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from 'lucide-react'
import { weatherLabel, type WeatherLabel } from './weather-codes'

const ICONS: Record<WeatherLabel, LucideIcon> = {
  Clear: Sun,
  'Partly cloudy': CloudSun,
  Overcast: Cloud,
  Fog: CloudFog,
  Drizzle: CloudDrizzle,
  Rain: CloudRain,
  Snow: CloudSnow,
  Thunderstorm: CloudLightning,
  Cloudy: Cloud,
}

export function describeWeather(code: number): { label: WeatherLabel; Icon: LucideIcon } {
  const label = weatherLabel(code)
  return { label, Icon: ICONS[label] }
}
