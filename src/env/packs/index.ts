import type { EnvPack, EnvPackId } from './types';
import { SYNTHETIC_ASCENT_V1 } from './synthetic_ascent_v1';
import { POOL_RIFFLE_V1 } from './pool_riffle_v1';

export type { EnvPack, EnvPackId, EnvLieMarker, EnvPoolWell, EnvOdorSource, LieKind } from './types';
export { SYNTHETIC_ASCENT_V1 } from './synthetic_ascent_v1';
export { POOL_RIFFLE_V1 } from './pool_riffle_v1';

export const ENV_PACKS: Record<EnvPackId, EnvPack> = {
  synthetic_ascent_v1: SYNTHETIC_ASCENT_V1,
  pool_riffle_v1: POOL_RIFFLE_V1,
};

export const DEFAULT_ENV_PACK_ID: EnvPackId = 'synthetic_ascent_v1';

export function getEnvPack(id?: string | null): EnvPack {
  if (id && id in ENV_PACKS) return ENV_PACKS[id as EnvPackId];
  return ENV_PACKS[DEFAULT_ENV_PACK_ID];
}

export function listEnvPackIds(): EnvPackId[] {
  return Object.keys(ENV_PACKS) as EnvPackId[];
}
