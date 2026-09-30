import { GridLayoutValidationError } from './errors'
import {
  createAbsoluteStyle,
  createTransformStyle,
  validatePositionGeometry,
} from './position-style'

import type { PositionStrategy, PositionStyle } from '../helpers/types'

/** The default positioning strategy, which renders items with CSS `translate3d` transforms. */
export const transformStrategy: PositionStrategy = {
  usesCssTransforms: true,
  getStyle(top: number, left: number, width: number, height: number): PositionStyle {
    return createTransformStyle(validatePositionGeometry(top, left, width, height, 'ltr'), 'ltr')
  },
  getRtlStyle(top: number, right: number, width: number, height: number): PositionStyle {
    return createTransformStyle(validatePositionGeometry(top, right, width, height, 'rtl'), 'rtl')
  },
}

/** Positions items with absolute `top` and the direction-appropriate `left` or `right` declaration. */
export const absoluteStrategy: PositionStrategy = {
  usesCssTransforms: false,
  getStyle(top: number, left: number, width: number, height: number): PositionStyle {
    return createAbsoluteStyle(validatePositionGeometry(top, left, width, height, 'ltr'), 'ltr')
  },
  getRtlStyle(top: number, right: number, width: number, height: number): PositionStyle {
    return createAbsoluteStyle(validatePositionGeometry(top, right, width, height, 'rtl'), 'rtl')
  },
}

/**
 * Returns a transform strategy for a grid rendered inside a scaled CSS transform context.
 *
 * Generated styles stay in grid coordinates; `scale` only corrects pointer deltas.
 *
 * @param scale - The positive finite CSS scale applied by the containing transform context.
 * @throws {@link GridLayoutValidationError} If `scale` is not positive and finite.
 */
export function scaledStrategy(scale: number): PositionStrategy {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new GridLayoutValidationError('Scale must be a positive finite number', {
      code: 'invalid-config',
      path: 'config.scale',
      cause: scale,
    })
  }

  return {
    ...transformStrategy,
    usesCssTransforms: true,
    transformScale: scale,
  }
}

/**
 * Wraps a strategy so every edge and size is snapped to a whole pixel first, as grid-layout-plus
 * v1 did. Keeps the wrapped strategy's transform flags and sets `roundsGeometry`, so the grid
 * rounds the geometry before calling the strategy and validates the styles against the rounded
 * values.
 *
 * @param base - The strategy that receives the rounded values.
 * @returns A frozen strategy with the same `usesCssTransforms` and `transformScale` as `base`
 * and `roundsGeometry: true`.
 */
export function roundedStrategy(base: PositionStrategy): PositionStrategy {
  return Object.freeze({
    usesCssTransforms: base.usesCssTransforms,
    ...(base.transformScale === undefined ? {} : { transformScale: base.transformScale }),
    roundsGeometry: true,
    getStyle: (top: number, left: number, width: number, height: number) =>
      base.getStyle(Math.round(top), Math.round(left), Math.round(width), Math.round(height)),
    getRtlStyle: (top: number, right: number, width: number, height: number) =>
      base.getRtlStyle(Math.round(top), Math.round(right), Math.round(width), Math.round(height)),
  })
}

/** Transform positioning with v1.1.1 whole-pixel rounding. */
export const v1PixelStrategy: PositionStrategy = roundedStrategy(transformStrategy)
