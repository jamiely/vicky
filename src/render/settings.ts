/** Screen layout, picked from the viewport shape: portrait (taller than wide) is the vertical-cabinet view. */
export type Layout = 'landscape' | 'portrait';

/** One layout's camera framing. Angles in degrees, positions in cm. */
export interface CameraView {
  /** Multiplies the fitted distance (< 1 is closer). Wheel, pinch, and +/− change it within `ZOOM_RANGE`. */
  zoom: number;
  /** Elevation above the target. */
  pitch: number;
  /** Rotation around the target (positive = camera moves right). */
  yaw: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Vertical field of view. */
  fov: number;
  /** Half extents around the target that the unzoomed view always shows; the tighter screen axis sets the distance. */
  fitHalfWidth: number;
  fitHalfHeight: number;
}

export const ZOOM_RANGE = { min: 0.3, max: 1.75 };

/**
 * Live-tunable view settings (cameras, post-processing, LEDs). The stage reads these every frame, so the debug menu
 * can change them without rebuilding anything.
 */
export const VIEW = {
  cameras: {
    /** Desktop/phone-landscape: an angled three-quarter view from the player's left. */
    landscape: { zoom: 1, pitch: 17, yaw: 7, targetX: 16, targetY: 46, targetZ: -4, fov: 36, fitHalfWidth: 72, fitHalfHeight: 97.5 },
    /** Vertical arcade monitor: the whole cabinet straight on, from the topper sign down to the deck and pocket disk. */
    portrait: { zoom: 1, pitch: 10, yaw: 0, targetX: 12, targetY: 34, targetZ: -4, fov: 30, fitHalfWidth: 70, fitHalfHeight: 90 },
  } satisfies Record<Layout, CameraView>,
  /** Free orbit with the mouse (debug); disables press-to-launch on the canvas. */
  orbit: false,
  render: {
    exposure: 1.05,
    bloom: true,
    bloomStrength: 0.55,
    bloomRadius: 0.45,
    bloomThreshold: 0.9,
    shadows: true,
    environment: 1,
  },
  leds: {
    /** Chase speed multiplier; parties multiply this further. */
    speed: 1,
    brightness: 1.6,
  },
};
