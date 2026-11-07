// Central tuning values for Downhill Rush. All distances are in metres, times in seconds.

// ---- Road layout -------------------------------------------------------------
export const LANE_WIDTH = 3.3;
export const LANES = [-LANE_WIDTH, 0, LANE_WIDTH] as const;
export const EDGE_LINE = 5.0; // yellow edge line (centre of the line)
export const ASPHALT_HALF = 5.8; // asphalt ends here
export const ROAD_HALF = 6.8; // road ribbon incl. gravel shoulder
export const RAIL_OFFSET = 6.25; // guard-rail face
export const PLAYER_X_LIMIT = 4.6;

/** Distance along the track where every run starts (leaves road behind for the chase camera). */
export const START_S = 50;

// ---- Streaming world window ---------------------------------------------------
export const VIEW_BEHIND = 40;
export const VIEW_AHEAD = 600;
export const CHUNK = 20; // the world window is rebuilt every CHUNK metres
export const ROAD_ROW = 2; // road ribbon resolution
export const TERRAIN_ROW = 4; // terrain resolution along the road
export const SPAWN_AHEAD = 320; // obstacles/coins are spawned this far ahead
export const DESPAWN_BEHIND = 20;
export const ROAD_TEX_PERIOD = 12; // metres covered by one repeat of the road texture

// ---- Player physics ----------------------------------------------------------
export const GRAVITY = 32;
export const JUMP_VELOCITY = 11;
export const HOP_VELOCITY = 9.2;
export const FAST_FALL_VELOCITY = -17;
export const SLIDE_TIME = 0.8;
export const LATERAL_MAX = 9;
export const LATERAL_ACCEL = 70;
export const LATERAL_DECEL = 80;

export const MENU_SPEED = 13;
export const BASE_SPEED = 20;
export const MAX_SPEED = 43;
export const SPEED_TIME_CONSTANT = 115; // how fast speed approaches max (exponential)

// Player hit box (track space)
export const PLAYER_HALF_S = 0.42;
export const PLAYER_HALF_X = 0.3;
export const PLAYER_HEIGHT = 1.45;
export const PLAYER_SLIDE_HEIGHT = 0.95;

// ---- Scoring -------------------------------------------------------------------
export const COIN_VALUE = 10;
export const DISTANCE_POINTS = 1; // per metre
export const SHIELD_TIME = 9;
export const MAGNET_TIME = 10;
export const BOOST_TIME = 6;
/** Extra downhill speed while boosting (fraction of the current target speed). */
export const BOOST_SPEED = 0.32;
/** Magnet pull zone around the rider (track space, metres). */
export const MAGNET_AHEAD = 18;
export const MAGNET_BEHIND = 3;
export const MAGNET_SIDE = 7.5;

// ---- Timing ----------------------------------------------------------------------
export const CRASH_DURATION = 1.45;
export const MAX_FRAME_DT = 1 / 20;
export const SUBSTEP = 1 / 120;
