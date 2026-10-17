import type { Anchor } from '@/interaction';

/**
 * The anchors of the transform (M20, ADR 0021): 'pivot', the center of the bodies, only for
 * 'bodiesCenter'. The core computes them, the manipulator reads them; the origin and pivotPoint
 * are in the params, so the manipulator computes them itself. A type alias, so it fits
 * FeatureAnchors (an index signature).
 */
export type TransformAnchors = { readonly pivot?: Anchor };
