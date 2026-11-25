// Window placement for the cabinet: fill the display the game opens on, whatever its orientation.
// A fixed landscape size left most of a portrait (rotated) monitor unused.
export const FULLSCREEN_FLAG = "--fullscreen";

/**
 * @param {{ bounds: Electron.Rectangle, workArea: Electron.Rectangle }} display
 * @param {readonly string[]} argv
 */
export function windowLayout(display, argv) {
  const fullscreen = argv.includes(FULLSCREEN_FLAG);
  const area = fullscreen ? display.bounds : display.workArea;
  return {
    fullscreen,
    bounds: { x: area.x, y: area.y, width: area.width, height: area.height },
  };
}
