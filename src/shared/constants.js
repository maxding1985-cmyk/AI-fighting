export const MAP_WIDTH = 15;
export const MAP_HEIGHT = 15;
export const TICK_MS = 300;
export const MAX_TICKS = 200;
export const SHOOT_COOLDOWN_TICKS = 8;
export const MAX_RULES = 10;

export const DIRECTIONS = Object.freeze({
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 }
});

export const DIRECTION_ORDER = Object.freeze(["up", "right", "down", "left"]);

export const TANK_ACTIONS = Object.freeze([
  "move_forward",
  "move_backward",
  "turn_left",
  "turn_right",
  "shoot",
  "wait"
]);

export const RULE_CONDITIONS = Object.freeze([
  "always",
  "enemy_in_line",
  "enemy_near",
  "enemy_on_left",
  "enemy_on_right",
  "enemy_behind",
  "wall_ahead",
  "wall_behind",
  "can_shoot",
  "bullet_in_front",
  "bullet_near",
  "path_forward_clear",
  "random_30"
]);

export const DEFAULT_WALLS = Object.freeze([
  { x: 3, y: 3 },
  { x: 4, y: 3 },
  { x: 10, y: 11 },
  { x: 11, y: 11 },
  { x: 7, y: 5 },
  { x: 7, y: 6 },
  { x: 7, y: 8 },
  { x: 7, y: 9 },
  { x: 2, y: 7 },
  { x: 12, y: 7 },
  { x: 5, y: 10 },
  { x: 9, y: 4 }
]);
