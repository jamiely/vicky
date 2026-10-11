/** Landscape camera distance (cm); zoom range around it. */
export const DEFAULT_DISTANCE = 300;
export const ZOOM_RANGE = { min: 90, max: 520 };

/**
 * Live-tunable view settings (camera, post-processing, LEDs). The stage reads these every frame, so the debug menu
 * can change them without rebuilding anything.
 */
export const VIEW = {
  camera: {
    /** Distance from the target (cm). Narrow screens scale it up so the cabinet width still fits. Zoom changes it. */
    distance: DEFAULT_DISTANCE,
    /** Elevation above the target, degrees. */
    pitch: 17,
    /** Rotation around the target, degrees (positive = camera moves right). */
    yaw: 7,
    targetX: 16,
    targetY: 46,
    targetZ: -4,
    /** Vertical field of view on landscape screens, degrees. */
    fov: 36,
    /** Free orbit with the mouse (debug); disables press-to-launch on the canvas. */
    orbit: false,
  },
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
