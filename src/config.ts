/** Season + geolocation knobs that drive environment fields. */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface GeoLocation {
  /** Latitude in degrees (positive = N). */
  lat: number;
  /** Longitude in degrees (positive = E). */
  lon: number;
  /** Display name for HUD. */
  name: string;
}

export interface SimConfig {
  season: Season;
  location: GeoLocation;
  /** Mean river discharge scale (0.5–1.5). */
  dischargeScale: number;
  /** Target water temperature override °C, or null to derive from season/lat. */
  tempOverrideC: number | null;
}

/** Default: mid-autumn ascent, Scottish Highlands analogue. */
export const DEFAULT_CONFIG: SimConfig = {
  season: 'autumn',
  location: {
    lat: 57.5,
    lon: -4.5,
    name: 'Highlands analogue',
  },
  dischargeScale: 1.0,
  tempOverrideC: null,
};

/** Adult Atlantic salmon body length (m) — typical anadromous adult. */
export const FISH_LENGTH_M = 0.75;
export const FISH_MASS_KG = 4.5;

/** River corridor extents (metres, sim space ≈ metres). */
export const RIVER = {
  length: 80,
  width: 12,
  depth: 4,
  bankSlope: 0.4,
} as const;

/** Derive base water temperature from season + latitude (very coarse). */
export function baseTempC(cfg: SimConfig): number {
  if (cfg.tempOverrideC !== null) return cfg.tempOverrideC;
  const latFactor = Math.max(0, 1 - Math.abs(cfg.location.lat) / 90);
  const seasonBase: Record<Season, number> = {
    spring: 8,
    summer: 14,
    autumn: 10,
    winter: 4,
  };
  return seasonBase[cfg.season] + latFactor * 2;
}

/** Mean surface current speed (m/s) from discharge + season. */
export function meanCurrentSpeed(cfg: SimConfig): number {
  const seasonMul: Record<Season, number> = {
    spring: 1.2,
    summer: 0.85,
    autumn: 1.1,
    winter: 1.3,
  };
  return 0.55 * cfg.dischargeScale * seasonMul[cfg.season];
}
