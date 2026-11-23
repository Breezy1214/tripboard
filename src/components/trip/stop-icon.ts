import {
  BedDouble,
  Camera,
  Coffee,
  Landmark,
  MapPin,
  Mountain,
  Music,
  Plane,
  ShoppingBag,
  Sunset,
  TrainFront,
  Trees,
  UtensilsCrossed,
  Waves,
  Wine,
  type LucideIcon,
} from 'lucide-react'

const RULES: Array<[RegExp, LucideIcon]> = [
  [/\b(check[- ]?in|hotel|hostel|stay|airbnb|apartment)\b/i, BedDouble],
  [/\b(flight|airport|fly)\b/i, Plane],
  [/\b(train|tram|metro|bus|ferry|station|day trip)\b/i, TrainFront],
  [/\b(coffee|caf[eé]|bakery|pastel|brunch|breakfast)\b/i, Coffee],
  [/\b(lunch|dinner|restaurant|market|food|eat|tapas|bistro|pizza)\b/i, UtensilsCrossed],
  [/\b(bar|wine|cocktail|drinks|pub)\b/i, Wine],
  [/\b(sunset|sunrise|miradouro|viewpoint|view)\b/i, Sunset],
  [/\b(museum|gallery|palace|castle|cathedral|church|monastery|temple|monument)\b/i, Landmark],
  [/\b(beach|surf|swim|coast|bay)\b/i, Waves],
  [/\b(park|garden|forest|walk|botanical)\b/i, Trees],
  [/\b(hike|trail|mountain|summit)\b/i, Mountain],
  [/\b(shop|shopping|mall|boutique)\b/i, ShoppingBag],
  [/\b(concert|fado|show|club|music)\b/i, Music],
  [/\b(photo|tour)\b/i, Camera],
]

/** A category icon guessed from the stop's title and place name. */
export function stopIcon(text: string): LucideIcon {
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? MapPin
}
