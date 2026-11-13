/**
 * Dot-matrix pictures. A scene says how bright each dot of a grid is at a
 * moment in time; a screen paints a scene onto a canvas as round dots; the
 * stage keeps the screens on the page moving.
 *
 * Unlit dots stay faintly visible, so a picture reads as a panel of lamps
 * rather than as shapes on a blank ground.
 */

/** Brightness, 0 to 1, of the dot at `column`, `row` at `time` seconds. */
export type Scene = (column: number, row: number, time: number) => number;

/** Canvas pixels per dot. The stylesheet scales the canvas to its container. */
const CELL = 14;
const DOT_RADIUS = CELL * 0.33;
/** How visible a dot is when it is off. */
const REST = 0.11;
const FRAME_SECONDS = 0.09;
/** The moment shown when motion is unwanted: mid-loop, so nothing is blank. */
const STILL_TIME = 1.3;

/** Sample a whole grid, row by row, with every value held to 0..1. */
export function sample(scene: Scene, columns: number, rows: number, time: number): Float32Array {
  const levels = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const level = scene(column, row, time);
      levels[row * columns + column] = level > 0 ? Math.min(1, level) : 0;
    }
  }
  return levels;
}

export interface DotScreen {
  readonly element: HTMLCanvasElement;
  readonly columns: number;
  readonly rows: number;
  /** Replace the scene and repaint at once. */
  show(scene: Scene): void;
  paint(time: number): void;
}

/** The canvas's CSS `color`, as red, green and blue. White if it cannot be read. */
function inkColour(canvas: HTMLCanvasElement): string {
  const parts = (getComputedStyle(canvas).color.match(/[\d.]+/g) ?? []).slice(0, 3);
  return parts.length === 3 ? parts.join(', ') : '255, 255, 255';
}

/**
 * A canvas `columns` dots wide and `rows` dots tall. A browser that cannot
 * give a 2D context shows an empty canvas and nothing else goes wrong.
 */
export function createDotScreen(columns: number, rows: number, initial: Scene): DotScreen {
  const element = document.createElement('canvas');
  element.className = 'dots';
  element.width = columns * CELL;
  element.height = rows * CELL;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = element.getContext('2d');
  } catch {
    context = null;
  }
  let scene = initial;
  let lastTime = STILL_TIME;

  const paint = (time: number): void => {
    lastTime = time;
    if (context === null) return;
    const ink = inkColour(element);
    const levels = sample(scene, columns, rows, time);
    context.clearRect(0, 0, element.width, element.height);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const level = levels[row * columns + column] ?? 0;
        context.fillStyle = `rgba(${ink}, ${(REST + (1 - REST) * level).toFixed(3)})`;
        context.beginPath();
        context.arc((column + 0.5) * CELL, (row + 0.5) * CELL, DOT_RADIUS, 0, Math.PI * 2);
        context.fill();
      }
    }
  };

  return {
    element,
    columns,
    rows,
    show: (next) => {
      scene = next;
      paint(lastTime);
    },
    paint,
  };
}

export interface Stage {
  /**
   * The screen called `key`, created on first use. Later calls hand back the
   * same canvas showing the new scene, so a redraw of the page around it does
   * not restart its motion.
   */
  screen(key: string, columns: number, rows: number, scene: Scene): DotScreen;
  start(): void;
  stop(): void;
}

/**
 * Drives every screen from one timer. Only screens that are on the page and
 * in view are repainted. Honours reduced-motion (screens hold one still
 * frame) and pauses while the tab is hidden.
 */
export function createStage(): Stage {
  const still =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const screens = new Map<string, DotScreen>();
  const offscreen = new Set<Element>();
  const watcher =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) offscreen.delete(entry.target);
            else offscreen.add(entry.target);
          }
        })
      : null;
  let time = STILL_TIME;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (document.hidden) return;
    time += FRAME_SECONDS;
    for (const screen of screens.values()) {
      if (screen.element.isConnected && !offscreen.has(screen.element)) screen.paint(time);
    }
  };

  return {
    screen: (key, columns, rows, scene) => {
      const existing = screens.get(key);
      if (existing !== undefined && existing.columns === columns && existing.rows === rows) {
        existing.show(scene);
        return existing;
      }
      const created = createDotScreen(columns, rows, scene);
      created.paint(time);
      screens.set(key, created);
      watcher?.observe(created.element);
      return created;
    },
    start: () => {
      if (still || timer !== null) return;
      timer = setInterval(tick, FRAME_SECONDS * 1000);
    },
    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
