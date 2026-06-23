/* Battlemap Screen and GM Streaming Tool
 * Coordinate model:
 *   - "native" coords are image pixels (0..imageWidth, 0..imageHeight). Fog, rooms,
 *     tokens, pings and measures are all stored in native coords so they stay glued to
 *     the map regardless of zoom or the "Map image size" (map.scale) slider.
 *   - The render transform maps native -> world (x map.scale) -> screen (x view.scale,
 *     centered on view.cx/cy). Because the view is expressed as a centered map point +
 *     zoom, the GM and player windows frame the same thing even at different canvas sizes.
 */

const canvas = document.getElementById("battlemap");
const ctx = canvas.getContext("2d");
// Fog is composited from two independent layers so erasing freeform fog can never get
// "stuck": polyCanvas holds the polygon/stamp areas, strokeCanvas holds the freeform
// brush/bucket layer (its own erases baked in chronologically), and fogCanvas is their
// union (what's drawn). liveCanvas previews the in-progress brush stroke.
const fogCanvas = document.createElement("canvas");
const fogCtx = fogCanvas.getContext("2d");
const liveCanvas = document.createElement("canvas");
const liveCtx = liveCanvas.getContext("2d");
const polyCanvas = document.createElement("canvas");
const polyCtx = polyCanvas.getContext("2d");
const strokeCanvas = document.createElement("canvas");
const strokeCtx = strokeCanvas.getContext("2d");
const shell = document.querySelector(".app-shell");
const emptyState = document.getElementById("emptyState");
const channel = new BroadcastChannel("fog-table-state");
const APP_NAME = "Battlemap Screen and GM Streaming Tool";
const LEGACY_APP_NAME = "Fog Table";
const SAVE_FILE_VERSION = 3;
const DB_NAME = "fog-table-library";
const DB_VERSION = 1;
const MAP_STORE = "maps";
const FOG_MAX_EDGE = 4096; // cap fog raster resolution so huge maps stay within canvas/memory limits
const HISTORY_LIMIT = 80;

// Tabler stair icons (24×24), copied verbatim from tabler.io.
// NEUTRAL = tabler/stairs · UP = tabler/stairs-up · DOWN = tabler/stairs-down.
const STAIRS_ICON_NEUTRAL = new Path2D("M22 5h-5v5h-5v5h-5v5h-5");
const STAIRS_ICON_UP = new Path2D("M22 6h-5v5h-5v5h-5v5h-5 M6 10v-7 M3 6l3 -3l3 3");
const STAIRS_ICON_DOWN = new Path2D("M22 21h-5v-5h-5v-5h-5v-5h-5 M18 3v7 M15 7l3 3l3 -3");
const FEET_PER_CELL = 5;
// Real-world distance one grid cell represents, per measurement system.
const MEASURE_UNITS = {
  imperial: { perCell: 5, label: "ft" },
  metric: { perCell: 1.5, label: "m" },
};
const PING_DURATION = 1300;

const controls = {
  mapUpload: document.getElementById("mapUpload"),
  splashUpload: document.getElementById("splashUpload"),
  splashEnabled: document.getElementById("splashEnabled"),
  blackoutEnabled: document.getElementById("blackoutEnabled"),
  loadLibrary: document.getElementById("loadLibrary"),
  saveSession: document.getElementById("saveSession"),
  openPlayer: document.getElementById("openPlayer"),
  exportLibrary: document.getElementById("exportLibrary"),
  importLibrary: document.getElementById("importLibrary"),
  gridEnabled: document.getElementById("gridEnabled"),
  gridSnap: document.getElementById("gridSnap"),
  gridSize: document.getElementById("gridSize"),
  gridOffsetX: document.getElementById("gridOffsetX"),
  gridOffsetY: document.getElementById("gridOffsetY"),
  gridColor: document.getElementById("gridColor"),
  gridOpacity: document.getElementById("gridOpacity"),
  gridLineWidth: document.getElementById("gridLineWidth"),
  mapScale: document.getElementById("mapScale"),
  brushSize: document.getElementById("brushSize"),
  fogTint: document.getElementById("fogTint"),
  gmFogOpacity: document.getElementById("gmFogOpacity"),
  tokenColor: document.getElementById("tokenColor"),
  tokenCells: document.getElementById("tokenCells"),
  tokenLabel: document.getElementById("tokenLabel"),
  tokenNote: document.getElementById("tokenNote"),
  tokenHidden: document.getElementById("tokenHidden"),
  tokenSelEdit: document.getElementById("tokenSelEdit"),
  tokenPanelHeading: document.getElementById("tokenPanelHeading"),
  tokenImage: document.getElementById("tokenImage"),
  tokenBulk: document.getElementById("tokenBulk"),
  tokenImagePreview: document.getElementById("tokenImagePreview"),
  tokenImageClear: document.getElementById("tokenImageClear"),
  panMode: document.getElementById("panMode"),
  fogToggle: document.getElementById("fogToggle"),
  fogRibbon: document.getElementById("fogRibbon"),
  polygonMode: document.getElementById("polygonMode"),
  namedPolygonMode: document.getElementById("namedPolygonMode"),
  brushMode: document.getElementById("brushMode"),
  eraserMode: document.getElementById("eraserMode"),
  stampMode: document.getElementById("stampMode"),
  tokenMode: document.getElementById("tokenMode"),
  aoeMode: document.getElementById("aoeMode"),
  aoeOptions: document.getElementById("aoeOptions"),
  aoeCircle: document.getElementById("aoeCircle"),
  aoeSquare: document.getElementById("aoeSquare"),
  aoeCone: document.getElementById("aoeCone"),
  aoeColor: document.getElementById("aoeColor"),
  aoePresetsRow: document.getElementById("aoePresetsRow"),
  aoeCustomSize: document.getElementById("aoeCustomSize"),
  aoeAngleSlider: document.getElementById("aoeAngleSlider"),
  aoeAngleRow: document.getElementById("aoeAngleRow"),
  measureMode: document.getElementById("measureMode"),
  measureOptions: document.getElementById("measureOptions"),
  measureUnit: document.getElementById("measureUnit"),
  measureCalibrate: document.getElementById("measureCalibrate"),
  measureCalibrateRow: document.getElementById("measureCalibrateRow"),
  gridCalibrate: document.getElementById("gridCalibrate"),
  roundShape: document.getElementById("roundShape"),
  squareShape: document.getElementById("squareShape"),
  brushSizeRow: document.getElementById("brushSizeRow"),
  brushShapeRow: document.getElementById("brushShapeRow"),
  stampShapeRow: document.getElementById("stampShapeRow"),
  fogToolHeading: document.getElementById("fogToolHeading"),
  stampRect: document.getElementById("stampRect"),
  stampSquare: document.getElementById("stampSquare"),
  stampEllipse: document.getElementById("stampEllipse"),
  stampCircle: document.getElementById("stampCircle"),
  stampTriangle: document.getElementById("stampTriangle"),
  clearFog: document.getElementById("clearFog"),
  bucketFill: document.getElementById("bucketFill"),
  undo: document.getElementById("undoBtn"),
  redo: document.getElementById("redoBtn"),
  brushOptions: document.getElementById("brushOptions"),
  tokenOptions: document.getElementById("tokenOptions"),
  fitMap: document.getElementById("fitMap"),
  playerMatchDM: document.getElementById("playerMatchDM"),
  playerFrameToggle: document.getElementById("playerFrameToggle"),
  rotateMapLeft: document.getElementById("rotateMapLeft"),
  rotateMapRight: document.getElementById("rotateMapRight"),
  rotatePlayerLeft: document.getElementById("rotatePlayerLeft"),
  rotatePlayerRight: document.getElementById("rotatePlayerRight"),
  playerFit: document.getElementById("playerFit"),
  lockPlayerSquare: document.getElementById("lockPlayerSquare"),
  stairColor: document.getElementById("stairColor"),
  addImageInput: document.getElementById("addImageInput"),
  addNoteBtn: document.getElementById("addNoteBtn"),
  imageSnap: document.getElementById("imageSnap"),
  imageSelPanel: document.getElementById("imageSelPanel"),
  imageShowPlayers: document.getElementById("imageShowPlayers"),
  imageSize: document.getElementById("imageSize"),
  imageRotation: document.getElementById("imageRotation"),
  noteSelPanel: document.getElementById("noteSelPanel"),
  noteSize: document.getElementById("noteSize"),
  aoeMarkerSelPanel: document.getElementById("aoeMarkerSelPanel"),
  aoeMarkerLabel: document.getElementById("aoeMarkerLabel"),
  aoeMarkerShowPlayers: document.getElementById("aoeMarkerShowPlayers"),
  playerFrameColor: document.getElementById("playerFrameColor"),
  playerFrameOpacity: document.getElementById("playerFrameOpacity"),
  panelToggle: document.getElementById("panelToggle"),
  copyDMView: document.getElementById("copyDMView"),
  playerZoom: document.getElementById("playerZoom"),
  playerOffsetX: document.getElementById("playerOffsetX"),
  playerOffsetY: document.getElementById("playerOffsetY"),
  modeHint: document.getElementById("modeHint"),
  playerFullscreen: document.getElementById("playerFullscreen"),
  libraryDialog: document.getElementById("libraryDialog"),
  savedMapList: document.getElementById("savedMapList"),
  nameDialog: document.getElementById("nameDialog"),
  roomNameInput: document.getElementById("roomNameInput"),
  stairMode: document.getElementById("stairMode"),
  stairDialog: document.getElementById("stairDialog"),
  stairFloorSelect: document.getElementById("stairFloorSelect"),
  stairLabelInput: document.getElementById("stairLabelInput"),
  floorIndicator: document.getElementById("floorIndicator"),
  floorName: document.getElementById("floorName"),
  floorUp: document.getElementById("floorUp"),
  floorDown: document.getElementById("floorDown"),
  addFloorUp: document.getElementById("addFloorUp"),
  addFloorDown: document.getElementById("addFloorDown"),
  deleteFloor: document.getElementById("deleteFloor"),
  playerFloorBadge: document.getElementById("playerFloorBadge"),
  fitMapBtn: document.getElementById("fitMapBtn"),
  initToggle: document.getElementById("initToggle"),
  initiativePanel: document.getElementById("initiativePanel"),
  initiativeOverlay: document.getElementById("initiativeOverlay"),
  initShowPlayers: document.getElementById("initShowPlayers"),
  initShowOverlay: document.getElementById("initShowOverlay"),
  initPanelToggle: document.getElementById("initPanelToggle"),
  initPrev: document.getElementById("initPrev"),
  initNext: document.getElementById("initNext"),
  initReset: document.getElementById("initReset"),
  initRoundLabel: document.getElementById("initRoundLabel"),
  initList: document.getElementById("initList"),
  initAddForm: document.getElementById("initAddForm"),
  initName: document.getElementById("initName"),
  initRoll: document.getElementById("initRoll"),
  initHp: document.getElementById("initHp"),
  initType: document.getElementById("initType"),
};

const isPlayer = new URLSearchParams(window.location.search).get("view") === "player";
const DEFAULT_GM_FOG_OPACITY = 0.3;
const INITIAL_FLOOR_ID = "floor-1";

// Each floor is its own map (image + fog + tokens + stairs + view). The top-level
// imageData/fog/tokens/stairs/view fields below always mirror the CURRENT floor so the
// render/fog/token code can stay floor-agnostic; captureCurrentFloor()/applyFloor() swap
// them in and out of state.floors when navigating between floors.
function makeFloor(id) {
  return {
    id: id || `floor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    imageId: "",
    imageData: "",
    imageName: "",
    imageWidth: 0,
    imageHeight: 0,
    mapScale: 1,
    rooms: [],
    strokes: [],
    tokens: [],
    stairs: [],
    images: [],
    notes: [],
    aoeMarkers: [],
    view: { scale: 1, cx: 0, cy: 0, rotation: 0 },
  };
}

const state = {
  imageId: "",
  imageData: "",
  imageName: "",
  imageWidth: 0,
  imageHeight: 0,
  splash: { enabled: false, imageData: "", imageName: "" },
  blackout: false,
  grid: { enabled: true, snap: true, snapImages: false, size: 70, offsetX: 0, offsetY: 0, color: "#000000", opacity: 0.45, lineWidth: 1 },
  map: { scale: 1 },
  fog: {
    rooms: [],
    strokes: [],
    toolSize: 70,
    toolShape: "round",
    stampShape: "rectangle",
    gmColor: "#080909",
    gmOpacity: DEFAULT_GM_FOG_OPACITY,
  },
  tokens: [],
  stairs: [],
  // Droppable map images (synced to players; only those with showPlayers render there) and
  // GM-only floating notes (never synced). Both are per-floor like tokens/stairs.
  images: [],
  notes: [],
  aoeMarkers: [], // persistent AoE regions; shapes/positions synced to players, labels are GM-only
  stairColor: "#ffffff", // GM-only stair marker color (stairs never show on the player display)
  // Initiative tracker: a turn order shared across all floors. When showPlayers is on, a
  // compact order overlay is mirrored to the player display.
  initiative: { active: false, showPlayers: false, showOverlay: true, round: 1, turn: 0, combatants: [] },
  // Measurement: unit system + an optional calibrated cell size (world px) used when the
  // grid overlay is off but the map has its own printed grid.
  measure: { unit: "imperial", cellSize: 0 },
  // Views carry a rotation (degrees) so the map can be re-oriented. The GM "rotate map"
  // drives view.rotation; the player can be rotated independently via playerView.rotation.
  view: { scale: 1, cx: 0, cy: 0, rotation: 0 },
  playerView: { matchDM: true, scale: 1, cx: 0, cy: 0, rotation: 0 },
  currentFloorId: INITIAL_FLOOR_ID,
  floors: [makeFloor(INITIAL_FLOOR_ID)],
  floorPosition: 1, // player-side display only
  floorCount: 1, // player-side display only
};

let mapImage = new Image();
let splashImage = new Image();
let mode = "pan";
let drawingRoom = [];
let activeStroke = null;
let stampDraft = null; // {shape, start, end} preview while drag-drawing a fog shape
let calibrating = null; // 'grid' | 'measure' while waiting for a drag-a-square calibration
let calibrationDraft = null; // {start, end} preview during a calibration drag
// Area of effect is a live "hover template" (not placed): the shape follows the cursor
// and is mirrored to the player display in real time.
let aoeShape = "circle"; // circle | square | cone (triangle)
let aoeColor = "#e2603a";
let aoeSizeFt = 10; // size in feet (radius for circle, side for square, length for cone)
let aoeAngle = -Math.PI / 2; // cone direction (radians); default points "up"
let aoeTemplate = { visible: false, x: 0, y: 0 }; // GM: cursor pos · player: full received template
let aoeSyncQueued = false;
const AOE_PRESETS = { circle: [5, 10, 15, 20], square: [10, 20, 30], cone: [15, 30] };
const AOE_CONE_HALF_ANGLE = Math.atan(0.5); // ~26.6°, total spread ≈ 53° (D&D cone)
let selectedToken = null; // token highlighted in Move mode for arrow-key nudging (GM only)
let selectedImage = null; // map image selected in Move mode (GM only)
let selectedNote = null; // floating note selected in Move mode (GM only)
let selectedAoeMarker = null; // persistent AoE marker selected in Move mode (GM only)
let tokenImageData = ""; // image applied to newly placed tokens (data URL), authoring default
const tokenImageCache = new Map(); // data URL -> HTMLImageElement, so token art draws each frame
const IMAGE_MAX_EDGE = 1024; // cap dropped map images so saves/syncs stay bounded
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let viewStart = { cx: 0, cy: 0 };
let draggingToken = null;
let tokenDragMoved = false; // becomes true once a token drag actually moves (defers undo history)
let tokenPath = null; // route a selected token has taken (cell points), for the path + distance readout
let draggingImage = null;
let draggingNote = null;
let draggingFrame = false; // GM is dragging the player-view frame to pan the player display
let dragGrab = { dx: 0, dy: 0 }; // offset from cursor to object center while dragging images/notes/frame
let measureLine = null;
let pings = [];
let pingRaf = 0;
let lastPointer = { clientX: 0, clientY: 0 };
let fogResScale = 1;
let fogDirty = true;
let curK = 1; // last rendered view scale (screen px per world px)
let curMs = 1; // last rendered map.scale
let viewSyncQueued = false;

const undoStack = [];
const redoStack = [];

let playerWindow = null; // handle to the popup (GM side), used as a direct postMessage fallback
let seenMids = []; // recently handled message ids, for de-duplicating the two transports
let playerViewport = null; // {w,h} CSS px the player reports, used to draw the player frame
let showPlayerFrame = true; // GM-only: draw a red rectangle of what the players currently see
let playerFrameColor = "#e24a4a"; // GM-only: color of that rectangle
let playerFrameOpacity = 0.9; // GM-only: opacity of that rectangle
// IRL play: keep one grid square a constant physical size on the player screen (TV). The
// target is screen px per square; the player zoom is re-derived per map from its grid size.
let lockPlayerSquare = false;
let lockedSquarePx = 0;
const SQUARE_LOCK_KEY = "lodestar.squareLock";

function handleMessage(message, source) {
  if (!message || typeof message !== "object") return;
  if (message.mid) {
    if (seenMids.includes(message.mid)) return;
    seenMids.push(message.mid);
    if (seenMids.length > 60) seenMids.shift();
  }
  if (message.type === "assets" && isPlayer) applyAssets(message);
  if (message.type === "sync" && isPlayer) loadSnapshot(message.state);
  if (message.type === "view" && isPlayer) applyRemoteView(message);
  if (message.type === "ping") addPing(message.x, message.y, message.color);
  if (message.type === "measure" && isPlayer) {
    measureLine = message.line;
    render();
  }
  if (message.type === "player-ready" && !isPlayer) {
    if (source) playerWindow = source;
    broadcastAssets();
    broadcastState();
  }
  if (message.type === "request-assets" && !isPlayer) broadcastAssets();
  if (message.type === "viewport" && !isPlayer) {
    playerViewport = { w: message.w, h: message.h };
    render();
  }
}

// Player -> GM: report this display's pixel size so the GM can draw the "player frame".
function reportPlayerViewport() {
  if (!isPlayer) return;
  const rect = canvas.getBoundingClientRect();
  relay({ type: "viewport", w: rect.width, h: rect.height });
}

// Send a message over both transports. BroadcastChannel reaches any same-origin window;
// the direct postMessage reaches the opener/popup even when BroadcastChannel does not.
function relay(message) {
  message.mid = uuid();
  try {
    channel.postMessage(message);
  } catch {}
  const target = isPlayer ? window.opener : playerWindow;
  if (target && !target.closed) {
    try {
      target.postMessage(message, "*");
    } catch {}
  }
}

function setupStartScreen() {
  const screen = document.getElementById("startScreen");
  if (!screen) return;
  // The player display never shows the opening menu.
  if (isPlayer) {
    screen.remove();
    return;
  }
  const dismiss = () => {
    screen.classList.add("hidden");
    setTimeout(() => screen.remove(), 500);
    window.removeEventListener("keydown", onStartKey);
  };
  const onStartKey = (event) => {
    if (event.key === "Enter" || event.key === "Escape" || event.key === " ") {
      event.preventDefault();
      dismiss();
    }
  };
  document.getElementById("startEnter")?.addEventListener("click", dismiss);
  window.addEventListener("keydown", onStartKey);
}

// Make each GM panel section collapsible: a caret in the title toggles a slide-down
// body. The top action buttons (no heading) stay always visible.
function setupCollapsibleSections() {
  document.querySelectorAll(".gm-panel .control-section").forEach((section) => {
    const title = section.querySelector(":scope > .section-title");
    const heading = title?.querySelector("h2");
    if (!title || !heading) return;
    // Wrap everything after the title in an animatable body (grid-rows 1fr -> 0fr).
    const body = document.createElement("div");
    body.className = "section-body";
    const inner = document.createElement("div");
    inner.className = "section-body-inner";
    while (title.nextSibling) inner.appendChild(title.nextSibling);
    body.appendChild(inner);
    section.appendChild(body);
    // Caret toggle at the start of the title.
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "section-toggle";
    arrow.setAttribute("aria-label", "Collapse or expand section");
    arrow.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    title.insertBefore(arrow, title.firstChild);
    section.classList.add("collapsed"); // start collapsed by default; click a title to open
    const toggle = () => section.classList.toggle("collapsed");
    arrow.addEventListener("click", toggle);
    heading.style.cursor = "pointer";
    heading.addEventListener("click", toggle);
  });
}

// The player screen hides the cursor for a clean display, but that also hides the
// fullscreen button. Reveal both whenever the mouse moves, then fade out after a pause.
function setupPlayerCursor() {
  let timer = 0;
  const hide = () => shell.classList.remove("cursor-active");
  window.addEventListener("mousemove", () => {
    shell.classList.add("cursor-active");
    clearTimeout(timer);
    timer = setTimeout(hide, 2500);
  });
}

function setup() {
  shell.dataset.role = isPlayer ? "player" : "gm";
  setupStartScreen();
  if (isPlayer) {
    document.title = "Player Battlemap";
    relay({ type: "player-ready" });
  } else {
    bindControls();
    loadSquareLock();
    syncControlsFromState();
    updateSquareLockUI();
    refreshLibraryButtonState();
    updateUndoButtons();
    setupCollapsibleSections();
    updateInitiativeUI();
  }

  // Two transports so the link works whether or not BroadcastChannel delivers between
  // windows (it is unreliable on file://): the BroadcastChannel and a direct
  // window.postMessage to the opener / popup. Messages carry a "mid" so the receiver
  // ignores the duplicate when both transports succeed.
  channel.onmessage = (event) => handleMessage(event.data, null);
  window.addEventListener("message", (event) => handleMessage(event.data, event.source));

  watchCanvasSize();
  window.addEventListener("keydown", onKeyDown);

  // Suppress the middle-click autoscroll widget so middle-drag can pan instead.
  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    if (mode === "aoe" && !isPlayer && aoeTemplate.visible) {
      aoeTemplate.visible = false;
      renderAndSyncView();
    }
  });
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // Drag-and-drop image files onto the map to place them (GM only).
  if (!isPlayer) {
    canvas.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    canvas.addEventListener("drop", (event) => {
      const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length || !state.imageData) return;
      event.preventDefault();
      const n = toNativePoint(event);
      files.forEach((file) => addImageFile(file, n.x, n.y));
    });
  }

  if (isPlayer) {
    controls.playerFullscreen?.addEventListener("click", toggleFullscreen);
    setupPlayerCursor();
  }

  resizeCanvas();
  refreshFloorUI();
  render();
  reportPlayerViewport(); // player: announce initial size for the GM's player-frame
}

function bindControls() {
  controls.mapUpload.addEventListener("change", loadMapFile);
  controls.splashUpload.addEventListener("change", loadSplashFile);
  controls.splashEnabled.addEventListener("input", () => {
    state.splash.enabled = controls.splashEnabled.checked;
    if (state.splash.enabled) {
      state.blackout = false;
      controls.blackoutEnabled.checked = false;
    }
    renderAndSync();
  });
  controls.blackoutEnabled.addEventListener("input", () => {
    state.blackout = controls.blackoutEnabled.checked;
    if (state.blackout) {
      state.splash.enabled = false;
      controls.splashEnabled.checked = false;
    }
    renderAndSync();
  });
  controls.loadLibrary.addEventListener("click", openLibrary);
  controls.saveSession.addEventListener("click", saveSession);
  controls.exportLibrary?.addEventListener("click", exportLibrary);
  controls.importLibrary?.addEventListener("change", importLibrary);
  controls.openPlayer.addEventListener("click", openPlayerWindow);

  const gridBindings = [
    ["gridEnabled", "enabled", "checked"],
    ["gridSnap", "snap", "checked"],
    ["gridSize", "size", "value"],
    ["gridOffsetX", "offsetX", "value"],
    ["gridOffsetY", "offsetY", "value"],
    ["gridColor", "color", "value"],
    ["gridOpacity", "opacity", "value"],
    ["gridLineWidth", "lineWidth", "value"],
  ];
  gridBindings.forEach(([controlName, stateKey, prop]) => {
    controls[controlName].addEventListener("input", () => {
      state.grid[stateKey] = prop === "checked" ? controls[controlName][prop] : normalizeInput(controls[controlName][prop]);
      renderAndSync();
    });
  });
  controls.gridEnabled.addEventListener("input", updateMeasureCalibrateRow);

  controls.brushSize.addEventListener("input", () => {
    state.fog.toolSize = Number(controls.brushSize.value);
    render();
  });
  controls.fogTint.addEventListener("input", () => {
    state.fog.gmColor = controls.fogTint.value;
    fogDirty = true;
    render();
  });
  controls.gmFogOpacity.addEventListener("input", () => {
    state.fog.gmOpacity = Number(controls.gmFogOpacity.value);
    render();
  });
  controls.mapScale.addEventListener("input", () => {
    state.map.scale = Number(controls.mapScale.value);
    renderAndSync();
  });

  controls.panMode.addEventListener("click", () => setMode("pan"));
  controls.fogToggle.addEventListener("click", toggleFogRibbon);
  controls.polygonMode.addEventListener("click", () => setMode("polygon"));
  controls.namedPolygonMode.addEventListener("click", () => setMode("namedPolygon"));
  controls.brushMode.addEventListener("click", () => setMode("brush"));
  controls.eraserMode.addEventListener("click", () => setMode("eraser"));
  controls.stampMode?.addEventListener("click", () => setMode("stamp"));
  controls.tokenMode.addEventListener("click", () => setMode("token"));
  controls.aoeMode?.addEventListener("click", () => setMode("aoe"));
  controls.measureMode.addEventListener("click", () => setMode("measure"));
  controls.stairMode?.addEventListener("click", () => setMode("stair"));

  // Floor navigation
  controls.floorUp?.addEventListener("click", () => goToFloor(currentFloorIndex() + 1));
  controls.floorDown?.addEventListener("click", () => goToFloor(currentFloorIndex() - 1));
  controls.addFloorUp?.addEventListener("click", () => addFloor("up"));
  controls.addFloorDown?.addEventListener("click", () => addFloor("down"));
  controls.deleteFloor?.addEventListener("click", deleteCurrentFloor);
  controls.floorName?.addEventListener("change", () => {
    const floor = state.floors[currentFloorIndex()];
    if (floor) {
      floor.name = controls.floorName.value.trim();
      refreshFloorUI();
      broadcastState();
    }
  });
  controls.roundShape.addEventListener("click", () => setToolShape("round"));
  controls.squareShape.addEventListener("click", () => setToolShape("square"));
  controls.stampRect?.addEventListener("click", () => setStampShape("rectangle"));
  controls.stampSquare?.addEventListener("click", () => setStampShape("square"));
  controls.stampEllipse?.addEventListener("click", () => setStampShape("ellipse"));
  controls.stampCircle?.addEventListener("click", () => setStampShape("circle"));
  controls.stampTriangle?.addEventListener("click", () => setStampShape("triangle"));
  controls.tokenImage?.addEventListener("change", loadTokenImage);
  controls.tokenImageClear?.addEventListener("click", clearTokenImage);
  controls.tokenBulk?.addEventListener("change", (event) => {
    bulkAddTokenImages(event.target.files);
    event.target.value = ""; // allow re-selecting the same files
  });
  controls.measureUnit?.addEventListener("change", () => {
    state.measure.unit = controls.measureUnit.value === "metric" ? "metric" : "imperial";
    renderAndSync();
  });
  controls.aoeCircle?.addEventListener("click", () => setAoeShape("circle"));
  controls.aoeSquare?.addEventListener("click", () => setAoeShape("square"));
  controls.aoeCone?.addEventListener("click", () => setAoeShape("cone"));
  controls.aoeColor?.addEventListener("input", () => {
    aoeColor = controls.aoeColor.value;
    render();
  });
  controls.aoeCustomSize?.addEventListener("input", () => {
    const v = parseFloat(controls.aoeCustomSize.value);
    if (v > 0) { aoeSizeFt = v; updateAoePresets(); render(); }
  });
  controls.aoeAngleSlider?.addEventListener("input", () => {
    aoeAngle = parseFloat(controls.aoeAngleSlider.value) * Math.PI / 180;
    render();
  });
  controls.measureCalibrate?.addEventListener("click", () => armCalibration("measure"));
  controls.gridCalibrate?.addEventListener("click", () => armCalibration("grid"));
  controls.playerFrameToggle?.addEventListener("input", () => {
    showPlayerFrame = controls.playerFrameToggle.checked;
    render();
  });
  controls.playerFrameColor?.addEventListener("input", () => {
    playerFrameColor = controls.playerFrameColor.value;
    render();
  });
  controls.playerFrameOpacity?.addEventListener("input", () => {
    playerFrameOpacity = parseFloat(controls.playerFrameOpacity.value);
    render();
  });
  controls.panelToggle?.addEventListener("click", togglePanelCollapsed);

  // Initiative tracker
  controls.initToggle?.addEventListener("click", toggleInitiative);
  controls.initPanelToggle?.addEventListener("click", toggleInitiative);
  controls.initPrev?.addEventListener("click", () => stepInitiative(-1));
  controls.initNext?.addEventListener("click", () => stepInitiative(1));
  controls.initReset?.addEventListener("click", resetInitiative);
  controls.initShowPlayers?.addEventListener("input", () => {
    state.initiative.showPlayers = controls.initShowPlayers.checked;
    updateInitiativeUI();
    broadcastState();
  });
  controls.initShowOverlay?.addEventListener("input", () => {
    state.initiative.showOverlay = controls.initShowOverlay.checked;
    updateInitiativeUI();
    broadcastState();
  });
  // Turn arrows / hide button on the bottom-left overlay (GM only).
  controls.initiativeOverlay?.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "ov-next") stepInitiative(1);
    else if (act === "ov-prev") stepInitiative(-1);
    else if (act === "ov-hide") setOverlayVisible(false);
  });
  controls.initAddForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    addCombatant();
  });
  controls.initList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.closest("[data-act='remove']")) removeCombatant(id);
    else if (event.target.closest("[data-act='hp-down']")) adjustHp(id, -1);
    else if (event.target.closest("[data-act='hp-up']")) adjustHp(id, 1);
    else if (event.target.closest("[data-act='set-turn']")) setTurnToId(id);
  });
  controls.initList?.addEventListener("change", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    const c = state.initiative.combatants.find((x) => x.id === row.dataset.id);
    if (!c) return;
    if (event.target.matches("[data-field='hp']")) {
      c.hp = event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0);
      if (c.hp != null && (c.maxHp == null || c.hp > c.maxHp)) c.maxHp = c.hp;
    } else if (event.target.matches("[data-field='init']")) {
      c.init = Number(event.target.value) || 0;
      clampInitiativeTurn();
    }
    updateInitiativeUI();
    broadcastState();
  });
  controls.clearFog.addEventListener("click", () => {
    clearFog();
    closeFogRibbon();
  });
  controls.bucketFill?.addEventListener("click", () => {
    fillAllFog();
    closeFogRibbon();
  });
  controls.undo?.addEventListener("click", undo);
  controls.redo?.addEventListener("click", redo);
  controls.fitMap.addEventListener("click", () => fitMap(true));
  controls.fitMapBtn?.addEventListener("click", () => fitMap(true));

  // Close the fog ribbon when clicking anywhere outside it (and outside its toggle).
  document.addEventListener("pointerdown", (event) => {
    if (!isFogRibbonOpen()) return;
    if (event.target.closest("#fogRibbon") || event.target.closest("#fogToggle")) return;
    closeFogRibbon();
  });

  controls.playerMatchDM.addEventListener("input", () => {
    state.playerView.matchDM = controls.playerMatchDM.checked;
    if (state.playerView.matchDM) {
      state.playerView.scale = state.view.scale;
      state.playerView.cx = state.view.cx;
      state.playerView.cy = state.view.cy;
      state.playerView.rotation = state.view.rotation;
    }
    syncPlayerViewControls();
    renderAndSync();
  });
  controls.rotateMapLeft?.addEventListener("click", () => rotateMap(-90));
  controls.rotateMapRight?.addEventListener("click", () => rotateMap(90));
  controls.rotatePlayerLeft?.addEventListener("click", () => rotatePlayerView(-90));
  controls.rotatePlayerRight?.addEventListener("click", () => rotatePlayerView(90));
  controls.playerFit?.addEventListener("click", fitPlayerView);
  controls.stairColor?.addEventListener("input", () => {
    state.stairColor = controls.stairColor.value;
    renderAndSync();
  });
  controls.addImageInput?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) addImageFile(file, state.view.cx, state.view.cy);
    event.target.value = "";
  });
  controls.addNoteBtn?.addEventListener("click", addNote);
  controls.imageSnap?.addEventListener("input", () => {
    state.grid.snapImages = controls.imageSnap.checked;
  });
  controls.imageShowPlayers?.addEventListener("input", () => {
    if (!selectedImage) return;
    selectedImage.showPlayers = controls.imageShowPlayers.checked;
    renderAndSync();
  });
  controls.imageSize?.addEventListener("input", () => {
    if (!selectedImage) return;
    const aspect = selectedImage.w / selectedImage.h || 1;
    selectedImage.w = Number(controls.imageSize.value);
    selectedImage.h = selectedImage.w / aspect;
    renderAndSync();
  });
  controls.imageRotation?.addEventListener("input", () => {
    if (!selectedImage) return;
    selectedImage.rotation = Number(controls.imageRotation.value);
    renderAndSync();
  });
  controls.noteSize?.addEventListener("input", () => {
    if (!selectedNote) return;
    selectedNote.scale = Number(controls.noteSize.value);
    render(); // notes are GM-only
  });
  controls.aoeMarkerLabel?.addEventListener("input", () => {
    if (!selectedAoeMarker) return;
    selectedAoeMarker.label = controls.aoeMarkerLabel.value;
    render();
  });
  controls.aoeMarkerShowPlayers?.addEventListener("change", () => {
    if (!selectedAoeMarker) return;
    selectedAoeMarker.showPlayers = controls.aoeMarkerShowPlayers.checked;
    renderAndSync();
  });
  controls.copyDMView.addEventListener("click", () => snapPlayerViewToGM(true));
  controls.playerZoom.addEventListener("input", () => {
    state.playerView.matchDM = false;
    controls.playerMatchDM.checked = false;
    state.playerView.scale = Number(controls.playerZoom.value);
    captureSquareLock(); // manual zoom re-dials the locked TV square size
    renderAndSyncView();
  });
  controls.lockPlayerSquare?.addEventListener("input", () => {
    setPlayerSquareLock(controls.lockPlayerSquare.checked);
  });
  controls.playerOffsetX.addEventListener("input", () => {
    state.playerView.matchDM = false;
    controls.playerMatchDM.checked = false;
    state.playerView.cx = Number(controls.playerOffsetX.value);
    renderAndSyncView();
  });
  controls.playerOffsetY.addEventListener("input", () => {
    state.playerView.matchDM = false;
    controls.playerMatchDM.checked = false;
    state.playerView.cy = Number(controls.playerOffsetY.value);
    renderAndSyncView();
  });
}

function normalizeInput(value) {
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function openPlayerWindow() {
  const url = `${location.pathname}?view=player`;
  playerWindow = window.open(url, "fog-table-player", "popup=yes,width=1280,height=720");
  // The new window announces itself with "player-ready"; we answer with assets + state then.
}

/* ----------------------------- file loading ----------------------------- */

function loadMapFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onerror = () => window.alert("Could not read that image file.");
  reader.onload = () => {
    state.imageData = reader.result;
    state.imageName = file.name;
    state.imageId = uuid();
    state.map.scale = 1;
    state.fog.rooms = [];
    state.fog.strokes = [];
    state.tokens = [];
    state.stairs = [];
    drawingRoom = [];
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoButtons();
    loadImage(state.imageData, () => {
      state.imageWidth = mapImage.naturalWidth;
      state.imageHeight = mapImage.naturalHeight;
      fogDirty = true;
      captureCurrentFloor(); // flush new image into the current floor record
      updatePlayerSliderRanges();
      controls.mapScale.value = state.map.scale;
      refreshFloorUI();
      fitMap(false);
      broadcastAssets();
      renderAndSync();
    });
  };
  reader.readAsDataURL(file);
}

function loadSplashFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onerror = () => window.alert("Could not read that image file.");
  reader.onload = () => {
    state.splash.imageData = reader.result;
    state.splash.imageName = file.name;
    state.splash.enabled = true;
    state.blackout = false;
    controls.splashEnabled.checked = true;
    controls.blackoutEnabled.checked = false;
    loadSplashImage(state.splash.imageData, () => {
      broadcastAssets();
      renderAndSync();
    });
  };
  reader.readAsDataURL(file);
}

/* ----------------------------- library / IndexedDB ----------------------------- */

function saveSession() {
  captureCurrentFloor();
  if (!state.floors.some((floor) => floor.imageData)) {
    window.alert("Load a map image before saving.");
    return;
  }

  const suggestedName = state.imageName ? state.imageName.replace(/\.[^.]+$/, "") : "battlemap";
  const enteredName = window.prompt("Save map as:", suggestedName);
  const mapName = enteredName?.trim();
  if (!mapName) return;

  const saveData = {
    id: makeMapId(mapName),
    app: APP_NAME,
    version: SAVE_FILE_VERSION,
    name: mapName,
    savedAt: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(state)),
  };

  saveMapRecord(saveData)
    .then(() => {
      window.alert(`Saved "${saveData.name}" to the local map library.`);
      refreshLibraryButtonState();
    })
    .catch((error) => window.alert(`Could not save this map: ${error.message}`));
}

function makeMapId(name) {
  return name.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function validateSessionData(data) {
  if (!data || ![APP_NAME, LEGACY_APP_NAME].includes(data.app) || !data.state) {
    throw new Error("invalid or unsupported battlemap save");
  }
  if (!data.state.grid || !data.state.fog) {
    throw new Error("the save file is missing required map data");
  }
  return migrateState(data.state, data.version || 1);
}

function migrateState(snapshot, version) {
  // v1 -> v2: fog/room points were stored in scaled-world coords (native x map.scale).
  if (version < 2) {
    const scale = snapshot.map?.scale || 1;
    if (scale !== 1 && snapshot.fog) {
      (snapshot.fog.rooms || []).forEach((room) => {
        room.points = (room.points || []).map((p) => ({ x: p.x / scale, y: p.y / scale }));
      });
      (snapshot.fog.strokes || []).forEach((stroke) => {
        stroke.points = (stroke.points || []).map((p) => ({ x: p.x / scale, y: p.y / scale }));
        stroke.size = stroke.size / scale;
      });
    }
    snapshot._refit = true; // old view used a different model; refit on load
  }
  snapshot.tokens = snapshot.tokens || [];
  if (snapshot.blackout === undefined) snapshot.blackout = false;

  // v2 -> v3: a single map becomes the first (and only) floor.
  if (!Array.isArray(snapshot.floors) || !snapshot.floors.length) {
    snapshot.floors = [
      {
        id: INITIAL_FLOOR_ID,
        imageId: snapshot.imageId || "",
        imageData: snapshot.imageData || "",
        imageName: snapshot.imageName || "",
        imageWidth: snapshot.imageWidth || 0,
        imageHeight: snapshot.imageHeight || 0,
        mapScale: snapshot.map?.scale || 1,
        rooms: snapshot.fog?.rooms || [],
        strokes: snapshot.fog?.strokes || [],
        tokens: snapshot.tokens || [],
        stairs: [],
        view: { ...(snapshot.view || { scale: 1, cx: 0, cy: 0 }) },
      },
    ];
    snapshot.currentFloorId = INITIAL_FLOOR_ID;
  }
  return snapshot;
}

async function openLibrary() {
  try {
    const maps = await listMapRecords();
    renderLibraryList(maps);
    controls.libraryDialog.showModal();
  } catch (error) {
    window.alert(`Could not open the map library: ${error.message}`);
  }
}

function renderLibraryList(maps) {
  controls.savedMapList.replaceChildren();
  if (!maps.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No saved maps yet.";
    controls.savedMapList.appendChild(empty);
    return;
  }

  maps
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .forEach((map) => {
      const row = document.createElement("div");
      row.className = "saved-map-row";

      const text = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = map.name;
      const meta = document.createElement("span");
      meta.textContent = `${map.state.imageName || "Map image"} - ${new Date(map.savedAt).toLocaleString()}`;
      text.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "saved-map-actions";
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Load";
      load.addEventListener("click", () => loadLibraryMap(map.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => deleteLibraryMap(map.id, map.name));
      actions.append(load, remove);

      row.append(text, actions);
      controls.savedMapList.appendChild(row);
    });
}

async function loadLibraryMap(id) {
  try {
    const data = await getMapRecord(id);
    const snapshot = validateSessionData(data);
    drawingRoom = [];
    activeStroke = null;
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoButtons();
    loadSnapshot(snapshot);
    syncControlsFromState();
    broadcastAssets();
    renderAndSync();
    controls.libraryDialog.close();
  } catch (error) {
    window.alert(`Could not load this map: ${error.message}`);
  }
}

async function deleteLibraryMap(id, name) {
  if (!window.confirm(`Delete "${name}" from the local map library?`)) return;
  await deleteMapRecord(id);
  const maps = await listMapRecords();
  renderLibraryList(maps);
  refreshLibraryButtonState(maps);
}

async function exportLibrary() {
  try {
    const maps = await listMapRecords();
    if (!maps.length) {
      window.alert("There are no saved maps to export.");
      return;
    }
    const payload = { app: APP_NAME, version: SAVE_FILE_VERSION, exportedAt: new Date().toISOString(), maps };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `battlemap-library-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(`Could not export the library: ${error.message}`);
  }
}

function importLibrary(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const maps = Array.isArray(parsed) ? parsed : parsed.maps;
      if (!Array.isArray(maps) || !maps.length) throw new Error("no maps found in that file");
      let imported = 0;
      for (const record of maps) {
        if (!record?.id || !record?.state) continue;
        await saveMapRecord(record);
        imported += 1;
      }
      window.alert(`Imported ${imported} map${imported === 1 ? "" : "s"}.`);
      const updated = await listMapRecords();
      renderLibraryList(updated);
      refreshLibraryButtonState(updated);
    } catch (error) {
      window.alert(`Could not import that file: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

async function refreshLibraryButtonState(existingMaps) {
  if (isPlayer) return;
  try {
    const maps = existingMaps || (await listMapRecords());
    const hasMaps = maps.length > 0;
    controls.loadLibrary.classList.toggle("empty", !hasMaps);
    controls.loadLibrary.disabled = !hasMaps;
    if (controls.exportLibrary) controls.exportLibrary.disabled = !hasMaps;
  } catch {
    controls.loadLibrary.classList.add("empty");
    controls.loadLibrary.disabled = true;
  }
}

function openMapDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MAP_STORE)) {
        db.createObjectStore(MAP_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withMapStore(modeName, action) {
  const db = await openMapDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MAP_STORE, modeName);
    const store = transaction.objectStore(MAP_STORE);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function saveMapRecord(record) {
  return withMapStore("readwrite", (store) => store.put(record));
}
function listMapRecords() {
  return withMapStore("readonly", (store) => store.getAll());
}
function getMapRecord(id) {
  return withMapStore("readonly", (store) => store.get(id));
}
function deleteMapRecord(id) {
  return withMapStore("readwrite", (store) => store.delete(id));
}

/* ----------------------------- snapshots / sync ----------------------------- */

function loadSnapshot(snapshot) {
  // Shared / global settings.
  Object.assign(state.splash, snapshot.splash || { enabled: false, imageData: "", imageName: "" });
  state.blackout = Boolean(snapshot.blackout);
  Object.assign(state.grid, snapshot.grid);
  if (state.grid.snap === undefined) state.grid.snap = true;
  if (snapshot.stairColor) state.stairColor = snapshot.stairColor;
  if (snapshot.measure) Object.assign(state.measure, snapshot.measure);
  if (snapshot.initiative) {
    state.initiative = { active: false, showPlayers: false, showOverlay: true, round: 1, turn: 0, combatants: [], ...snapshot.initiative };
  }
  if (snapshot.fog) {
    state.fog.toolSize = snapshot.fog.toolSize ?? state.fog.toolSize;
    state.fog.toolShape = snapshot.fog.toolShape ?? state.fog.toolShape;
    state.fog.gmColor = snapshot.fog.gmColor || "#080909";
    state.fog.gmOpacity = snapshot.fog.gmOpacity ?? DEFAULT_GM_FOG_OPACITY;
  }
  const incomingPlayerView = snapshot.playerView || { matchDM: true, ...(snapshot.view || {}) };
  if (isPlayer) applyIncomingPlayerView(incomingPlayerView);
  else Object.assign(state.playerView, incomingPlayerView);

  if (Array.isArray(snapshot.floors) && snapshot.floors.length) {
    // Full load (library / GM): the floor stack is authoritative.
    state.floors = snapshot.floors;
    state.currentFloorId = snapshot.currentFloorId || state.floors[0].id;
    applyFloor(state.floors.find((f) => f.id === state.currentFloorId) || state.floors[0]);
  } else {
    // Lightweight sync (player) — only the current floor's live fields are present.
    Object.assign(state.map, snapshot.map || { scale: 1 });
    state.fog.rooms = snapshot.fog?.rooms || [];
    state.fog.strokes = snapshot.fog?.strokes || [];
    state.tokens = Array.isArray(snapshot.tokens) ? snapshot.tokens : [];
    state.stairs = Array.isArray(snapshot.stairs) ? snapshot.stairs : [];
    state.images = Array.isArray(snapshot.images) ? snapshot.images : [];
    state.notes = []; // notes are GM-only and never arrive on the player
    state.aoeMarkers = Array.isArray(snapshot.aoeMarkers) ? snapshot.aoeMarkers : [];
    Object.assign(state.view, snapshot.view || {});
    state.imageId = snapshot.imageId || state.imageId;
    state.imageData = snapshot.imageData || state.imageData; // keep the image assets delivered separately
    state.imageName = snapshot.imageName || state.imageName;
    if (snapshot.imageWidth) state.imageWidth = snapshot.imageWidth;
    if (snapshot.imageHeight) state.imageHeight = snapshot.imageHeight;
    state.floorPosition = snapshot.floorPosition || 1;
    state.floorCount = snapshot.floorCount || 1;
  }
  fogDirty = true;

  // If a sync references a map whose image we never received (assets message missed), ask for it.
  if (isPlayer && state.imageId && !state.imageData) {
    relay({ type: "request-assets" });
  }

  const finish = () => {
    if (snapshot._refit && !isPlayer) fitMap(false);
    if (!isPlayer) {
      updatePlayerSliderRanges();
      syncControlsFromState();
    }
    refreshFloorUI();
    updateInitiativeUI();
    render();
  };

  if (state.imageData) {
    loadImage(state.imageData, finish);
  } else {
    mapImage = new Image();
    finish();
  }
  if (state.splash.imageData) {
    loadSplashImage(state.splash.imageData, render);
  }
}

function applyAssets(message) {
  state.imageId = message.imageId;
  state.imageData = message.imageData;
  state.imageName = message.imageName;
  state.splash.imageData = message.splash?.imageData || "";
  state.splash.imageName = message.splash?.imageName || "";
  if (state.imageData) {
    loadImage(state.imageData, () => {
      state.imageWidth = mapImage.naturalWidth;
      state.imageHeight = mapImage.naturalHeight;
      fogDirty = true;
      render();
    });
  }
  if (state.splash.imageData) loadSplashImage(state.splash.imageData, render);
}

function applyRemoteView(message) {
  if (message.view) Object.assign(state.view, message.view);
  if (message.playerView) {
    if (isPlayer) applyIncomingPlayerView(message.playerView);
    else Object.assign(state.playerView, message.playerView);
  }
  if (message.aoe) {
    aoeTemplate.visible = message.aoe.visible;
    if (message.aoe.visible) {
      aoeTemplate.x = message.aoe.x;
      aoeTemplate.y = message.aoe.y;
      aoeShape = message.aoe.shape;
      aoeSizeFt = message.aoe.sizeFt;
      aoeAngle = message.aoe.angle;
      aoeColor = message.aoe.color;
    }
  }
  render();
}

// Player side: the player display is fully GM-driven, so it just adopts whatever
// playerView the GM sends (framing + rotation).
function applyIncomingPlayerView(pv) {
  Object.assign(state.playerView, pv);
}

function syncControlsFromState() {
  if (isPlayer) return;
  controls.gridEnabled.checked = state.grid.enabled;
  controls.gridSnap.checked = state.grid.snap;
  if (controls.imageSnap) controls.imageSnap.checked = !!state.grid.snapImages;
  controls.gridSize.value = state.grid.size;
  controls.gridOffsetX.value = state.grid.offsetX;
  controls.gridOffsetY.value = state.grid.offsetY;
  controls.gridColor.value = state.grid.color;
  controls.gridOpacity.value = state.grid.opacity;
  if (controls.gridLineWidth) controls.gridLineWidth.value = state.grid.lineWidth ?? 1;
  controls.splashEnabled.checked = state.splash.enabled;
  controls.blackoutEnabled.checked = state.blackout;
  controls.mapScale.value = state.map.scale;
  controls.brushSize.value = state.fog.toolSize;
  controls.fogTint.value = state.fog.gmColor;
  controls.gmFogOpacity.value = state.fog.gmOpacity;
  setToolShape(state.fog.toolShape);
  setStampShape(state.fog.stampShape || "rectangle");
  setAoeShape(aoeShape);
  if (controls.aoeColor) controls.aoeColor.value = aoeColor;
  if (controls.aoeCustomSize) controls.aoeCustomSize.value = aoeSizeFt;
  if (controls.measureUnit) controls.measureUnit.value = state.measure.unit || "imperial";
  if (controls.stairColor) controls.stairColor.value = state.stairColor || "#ffffff";
  updateMeasureCalibrateRow();
  updatePlayerSliderRanges();
  syncPlayerViewControls();
}

function updatePlayerSliderRanges() {
  if (isPlayer) return;
  const w = state.imageWidth || 1000;
  const h = state.imageHeight || 1000;
  controls.playerOffsetX.min = 0;
  controls.playerOffsetX.max = w;
  controls.playerOffsetY.min = 0;
  controls.playerOffsetY.max = h;
}

function syncPlayerViewControls() {
  controls.playerMatchDM.checked = state.playerView.matchDM;
  const v = state.playerView.matchDM ? state.view : state.playerView;
  controls.playerZoom.value = v.scale;
  controls.playerOffsetX.value = v.cx;
  controls.playerOffsetY.value = v.cy;
}

// One-shot copy of the GM's current framing onto the player view. Intentionally does
// NOT change the "Follow GM" toggle (matchDM) — clicking the button just snaps the
// player view once and leaves the follow mode as the user set it.
function snapPlayerViewToGM(sync) {
  state.playerView.scale = state.view.scale;
  state.playerView.cx = state.view.cx;
  state.playerView.cy = state.view.cy;
  state.playerView.rotation = state.view.rotation;
  syncPlayerViewControls();
  render();
  if (sync) broadcastState();
}

/* ----------------------------- floor management ----------------------------- */

// Flush active-floor mutable fields back into the floor record.
function captureCurrentFloor() {
  const floor = state.floors.find((f) => f.id === state.currentFloorId);
  if (!floor) return;
  floor.imageId = state.imageId;
  floor.imageData = state.imageData;
  floor.imageName = state.imageName;
  floor.imageWidth = state.imageWidth;
  floor.imageHeight = state.imageHeight;
  floor.mapScale = state.map.scale;
  floor.rooms = JSON.parse(JSON.stringify(state.fog.rooms));
  floor.strokes = JSON.parse(JSON.stringify(state.fog.strokes));
  floor.tokens = JSON.parse(JSON.stringify(state.tokens));
  floor.stairs = JSON.parse(JSON.stringify(state.stairs));
  floor.images = JSON.parse(JSON.stringify(state.images));
  floor.notes = JSON.parse(JSON.stringify(state.notes));
  floor.aoeMarkers = JSON.parse(JSON.stringify(state.aoeMarkers));
  floor.view = { ...state.view };
}

// Promote a floor record into the active state fields.
function applyFloor(floor) {
  selectedToken = selectedImage = selectedNote = null; // these arrays are about to be replaced
  state.currentFloorId = floor.id;
  state.imageId = floor.imageId || "";
  state.imageData = floor.imageData || "";
  state.imageName = floor.imageName || "";
  state.imageWidth = floor.imageWidth || 0;
  state.imageHeight = floor.imageHeight || 0;
  state.map.scale = floor.mapScale || 1;
  state.fog.rooms = JSON.parse(JSON.stringify(floor.rooms || []));
  state.fog.strokes = JSON.parse(JSON.stringify(floor.strokes || []));
  state.tokens = JSON.parse(JSON.stringify(floor.tokens || []));
  state.stairs = JSON.parse(JSON.stringify(floor.stairs || []));
  state.images = JSON.parse(JSON.stringify(floor.images || []));
  state.notes = JSON.parse(JSON.stringify(floor.notes || []));
  state.aoeMarkers = JSON.parse(JSON.stringify(floor.aoeMarkers || []));
  Object.assign(state.view, floor.view || { scale: 1, cx: 0, cy: 0 });
  state.view.rotation = floor.view?.rotation || 0; // default older floors with no rotation
  fogDirty = true;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButtons();
  mapImage = new Image();
  if (state.imageData) {
    loadImage(state.imageData, () => {
      fitMap(false);
      render();
    });
  } else {
    render();
  }
  applyPlayerSquareLock(); // keep the locked TV square size across map/floor changes
}

function currentFloorIndex() {
  return state.floors.findIndex((f) => f.id === state.currentFloorId);
}

function goToFloor(index) {
  if (index < 0 || index >= state.floors.length) return;
  captureCurrentFloor();
  drawingRoom = [];
  activeStroke = null;
  applyFloor(state.floors[index]);
  updatePlayerSliderRanges();
  syncControlsFromState();
  refreshFloorUI();
  broadcastAssets();
  broadcastState();
}

function addFloor(direction) {
  captureCurrentFloor();
  const newFloor = makeFloor();
  const idx = currentFloorIndex();
  if (direction === "up") {
    state.floors.splice(idx + 1, 0, newFloor);
    goToFloor(idx + 1);
  } else {
    state.floors.splice(idx, 0, newFloor);
    goToFloor(idx);
  }
}

function deleteCurrentFloor() {
  if (state.floors.length <= 1) {
    window.alert("You cannot delete the only floor.");
    return;
  }
  if (!window.confirm("Delete this floor? This cannot be undone.")) return;
  const idx = currentFloorIndex();
  state.floors.splice(idx, 1);
  goToFloor(Math.min(idx, state.floors.length - 1));
}

function refreshFloorUI() {
  if (isPlayer) {
    // Floor level is GM-only information; never reveal it on the player display.
    if (controls.playerFloorBadge) controls.playerFloorBadge.hidden = true;
    return;
  }
  const idx = currentFloorIndex();
  const total = state.floors.length;
  const floor = state.floors[idx];
  if (controls.floorName) controls.floorName.value = floor.name || `Floor ${idx + 1}`;
  if (controls.floorIndicator) {
    controls.floorIndicator.textContent = `${idx + 1} / ${total}`;
    controls.floorIndicator.title = floor.name || `Floor ${idx + 1}`;
  }
  if (controls.floorUp) controls.floorUp.disabled = idx >= total - 1;
  if (controls.floorDown) controls.floorDown.disabled = idx <= 0;
  if (controls.deleteFloor) controls.deleteFloor.disabled = total <= 1;
  if (controls.mapScale) controls.mapScale.value = state.map.scale;
}

/* ----------------------------- stairs ----------------------------- */

function promptStairPlacement(native) {
  if (!controls.stairDialog) return;
  const idx = currentFloorIndex();
  const select = controls.stairFloorSelect;
  if (!select) return;

  // Populate the floor list (exclude the current floor).
  select.replaceChildren();
  state.floors.forEach((floor, i) => {
    if (i === idx) return;
    const opt = document.createElement("option");
    opt.value = floor.id;
    opt.textContent = floor.name || `Floor ${i + 1}`;
    select.appendChild(opt);
  });

  if (!select.options.length) {
    window.alert("Add another floor first before placing stairs.");
    return;
  }

  if (controls.stairLabelInput) controls.stairLabelInput.value = "";
  controls.stairDialog.returnValue = "";
  controls.stairDialog.addEventListener(
    "close",
    () => {
      if (controls.stairDialog.returnValue !== "place") return;
      const targetId = select.value;
      const label = controls.stairLabelInput?.value?.trim() || "";
      pushHistory();
      state.stairs.push({
        id: uuid(),
        x: native.x,
        y: native.y,
        targetFloorId: targetId,
        label,
      });
      renderAndSync();
    },
    { once: true },
  );
  controls.stairDialog.showModal();
}

// Stair marker radius in native pixels — scales with the map as you zoom, just like tokens.
function hitStair(native) {
  // Square hit detection — the marker occupies exactly one grid cell.
  const half = gridCellNative() / 2;
  for (let i = state.stairs.length - 1; i >= 0; i--) {
    const s = state.stairs[i];
    if (Math.abs(native.x - s.x) <= half && Math.abs(native.y - s.y) <= half) {
      return state.stairs[i];
    }
  }
  return null;
}

function drawStairs() {
  if (!state.stairs.length) return;

  const myIdx = !isPlayer && state.floors
    ? state.floors.findIndex((f) => f.id === state.currentFloorId)
    : -1;

  // Marker fills exactly one grid cell — scales with grid size AND zoom, just like tokens.
  const cell = gridCellNative();
  const half = cell / 2;
  // Constant 2px screen line width regardless of zoom.
  const sw = 2 / (curK * curMs);

  ctx.save();
  const rot = currentViewRotation();

  state.stairs.forEach((stair) => {
    const { x, y } = stair;
    ctx.save();
    keepUpright(x, y, rot); // icon + label stay upright when the map is rotated

    // Determine direction: 1 = going UP (target floor has a higher index), -1 = DOWN.
    let dir = 0;
    if (!isPlayer && myIdx !== -1 && state.floors) {
      const targetIdx = state.floors.findIndex((f) => f.id === stair.targetFloorId);
      if (targetIdx !== -1) dir = targetIdx > myIdx ? 1 : -1;
    }

    // ---- bare stair icon (no box/background) in the tunable stair color ----
    // The Tabler icons are defined in a 24×24 coordinate space; fill ~90% of the cell.
    const stairColor = state.stairColor || "#ffffff";
    const iconFill = cell * 0.90;
    const iconScale = iconFill / 24;
    const iconPad = (cell - iconFill) / 2;

    ctx.save();
    ctx.translate(x - half + iconPad, y - half + iconPad);
    ctx.scale(iconScale, iconScale);
    ctx.strokeStyle = stairColor;
    ctx.lineWidth = 2.4 / (curK * curMs * iconScale); // stays a constant width on screen
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const icon = dir > 0 ? STAIRS_ICON_UP : dir < 0 ? STAIRS_ICON_DOWN : STAIRS_ICON_NEUTRAL;
    ctx.stroke(icon);
    ctx.restore();

    // ---- optional text label below the square ----
    if (stair.label) {
      ctx.save();
      ctx.font = `600 ${Math.round(half * 0.65)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#f4e8c8";
      ctx.fillText(stair.label, x, y + half + sw * 2);
      ctx.restore();
    }

    // ---- hover highlight outline in stair placement mode (GM only) ----
    if (!isPlayer && mode === "stair") {
      const gap = sw * 3;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - half - gap, y - half - gap, cell + gap * 2, cell + gap * 2);
      ctx.strokeStyle = "rgba(177,195,1,0.50)";
      ctx.lineWidth = sw * 1.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  });

  ctx.restore();
}

function broadcastAssets() {
  if (isPlayer) return;
  // Only the current floor's image is sent — the player follows the GM's active floor,
  // so it never needs the other floors' images.
  relay({
    type: "assets",
    imageId: state.imageId,
    imageData: state.imageData,
    imageName: state.imageName,
    splash: { imageData: state.splash.imageData, imageName: state.splash.imageName },
  });
}

// Sent on settings/fog/token changes. The player only needs the ACTIVE floor's live
// fields (which sit at the top level of state), so we omit the whole floor stack and
// the current image. Omitting (not blanking) the image means this never clobbers the
// image the player already received via the separate "assets" message.
function sanitizedState() {
  captureCurrentFloor();
  const { floors, imageData, ...rest } = state;
  const clone = JSON.parse(JSON.stringify(rest));
  if (clone.splash) delete clone.splash.imageData;
  delete clone.notes; // floating notes are GM-only and never leave the GM window
  // Send only player-visible markers; strip GM-only label field.
  if (clone.aoeMarkers) {
    clone.aoeMarkers = clone.aoeMarkers
      .filter((m) => m.showPlayers)
      // eslint-disable-next-line no-unused-vars
      .map(({ label, showPlayers, ...rest }) => rest);
  }
  return clone;
}

function broadcastState() {
  if (isPlayer) return;
  relay({ type: "sync", state: sanitizedState() });
}

// Lightweight view-only message, coalesced to one per frame for smooth pan/zoom.
function broadcastView() {
  if (isPlayer) return;
  if (viewSyncQueued) return;
  viewSyncQueued = true;
  requestAnimationFrame(() => {
    viewSyncQueued = false;
    relay({
      type: "view",
      view: { ...state.view },
      playerView: { ...state.playerView },
      aoe: {
        visible: aoeTemplate.visible,
        x: aoeTemplate.x,
        y: aoeTemplate.y,
        shape: aoeShape,
        sizeFt: aoeSizeFt,
        angle: aoeAngle,
        color: aoeColor,
      },
    });
  });
}

function renderAndSync() {
  render();
  broadcastState();
}

function renderAndSyncView() {
  render();
  broadcastView();
}

/* ----------------------------- modes / tools ----------------------------- */

const FOG_MODES = ["polygon", "namedPolygon", "brush", "eraser", "stamp"];
// Modes that use the shared fog-options popover (tint/opacity, plus tool-specific rows).
const FOG_TOOL_MODES = ["brush", "eraser", "stamp", "polygon", "namedPolygon"];

function isFogRibbonOpen() {
  return controls.fogRibbon && !controls.fogRibbon.classList.contains("hidden");
}
function openFogRibbon() {
  controls.fogRibbon?.classList.remove("hidden");
}
function closeFogRibbon() {
  controls.fogRibbon?.classList.add("hidden");
}
function toggleFogRibbon() {
  controls.fogRibbon?.classList.toggle("hidden");
}

function setMode(nextMode) {
  if (mode === "aoe" && nextMode !== "aoe") {
    aoeTemplate.visible = false;
    broadcastView();
  }
  mode = nextMode;
  closeFogRibbon();
  drawingRoom = [];
  stampDraft = null;
  selectedToken = null;
  selectedImage = selectedNote = selectedAoeMarker = null;
  tokenPath = null;
  updateSelectionPanels();
  canvas.style.cursor = ""; // clear any frame-hover cursor
  controls.fogToggle?.classList.toggle("active", FOG_MODES.includes(nextMode));
  [controls.panMode, controls.polygonMode, controls.namedPolygonMode, controls.brushMode, controls.eraserMode, controls.stampMode, controls.tokenMode, controls.aoeMode, controls.measureMode, controls.stairMode].forEach(
    (button) => button?.classList.remove("active"),
  );
  controls[`${nextMode}Mode`]?.classList.add("active");
  controls.modeHint.textContent = {
    pan: "Drag a token to move it, or drag the map to pan. Click a token to select it (then arrow keys nudge it). With nothing selected, arrow keys pan and +/− zoom. Middle-drag pans in any tool. Wheel to zoom. Alt+click to ping.",
    polygon: "Click corners, Enter to place. Ctrl+Z or Backspace removes the last point.",
    namedPolygon: "Click corners, Enter to place and name (GM-only label). Ctrl+Z removes the last point.",
    brush: "Drag to paint fog. Alt+click to ping.",
    eraser: "Drag over fog to erase brush/bucket fog. Right-click a polygon to clear its area.",
    stamp: "Drag to draw a fog shape. Right-click an area to remove it.",
    token: "Click to drop a token, drag to move it, right-click to remove it.",
    aoe: "Hover to preview. Click to drop a persistent AoE marker (grid-snapped, prompts for label). Right-click a marker to remove it. Double-click a marker to edit its label. Mouse wheel rotates the cone.",
    measure: "Drag to measure distance across the grid.",
    stair: "Click to place a staircase. Right-click a stair to remove it.",
  }[nextMode] ?? "";

  // Shared fog-options popover: shown for all fog tools, with tool-specific rows toggled.
  const showFogOptions = FOG_TOOL_MODES.includes(nextMode);
  controls.brushOptions.classList.toggle("hidden", !showFogOptions);
  const isBrush = nextMode === "brush" || nextMode === "eraser";
  controls.brushSizeRow?.classList.toggle("hidden", !isBrush);
  controls.brushShapeRow?.classList.toggle("hidden", !isBrush);
  controls.stampShapeRow?.classList.toggle("hidden", nextMode !== "stamp");
  if (controls.fogToolHeading) {
    controls.fogToolHeading.textContent =
      nextMode === "stamp" ? "Fog Shape" : isBrush ? "Fog Brush" : "Fog Area";
  }
  controls.tokenOptions.classList.toggle("hidden", nextMode !== "token");
  controls.aoeOptions?.classList.toggle("hidden", nextMode !== "aoe");
  controls.measureOptions?.classList.toggle("hidden", nextMode !== "measure");
  if (nextMode === "measure") updateMeasureCalibrateRow();
  // Switching tools cancels a pending calibration.
  if (calibrating) {
    calibrating = null;
    calibrationDraft = null;
    updateCalibrationUI();
  }
  measureLine = null;
  render();
}

function setStampShape(shape) {
  state.fog.stampShape = shape;
  [
    ["rectangle", controls.stampRect],
    ["square", controls.stampSquare],
    ["ellipse", controls.stampEllipse],
    ["circle", controls.stampCircle],
    ["triangle", controls.stampTriangle],
  ].forEach(([name, button]) => button?.classList.toggle("active", shape === name));
}

function setToolShape(shape) {
  state.fog.toolShape = shape;
  controls.roundShape.classList.toggle("active", shape === "round");
  controls.squareShape.classList.toggle("active", shape === "square");
  render();
}

function clearFog() {
  if (!state.fog.rooms.length && !state.fog.strokes.length) return;
  pushHistory();
  drawingRoom = [];
  state.fog.rooms = [];
  state.fog.strokes = [];
  fogDirty = true;
  renderAndSync();
}

// Bucket: cover the whole map in fog. Appended as a freeform "fill" op so later erases
// (and right-click area clears) carve through it normally.
function fillAllFog() {
  if (!state.imageData) return;
  pushHistory();
  state.fog.strokes.push({ id: uuid(), kind: "fill" });
  fogDirty = true;
  renderAndSync();
}

/* ----------------------------- history ----------------------------- */

function snapshotFog() {
  return JSON.stringify({ rooms: state.fog.rooms, strokes: state.fog.strokes, tokens: state.tokens, stairs: state.stairs, images: state.images, notes: state.notes, aoeMarkers: state.aoeMarkers });
}
function pushHistory() {
  undoStack.push(snapshotFog());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function applyFogSnapshot(serialized) {
  const data = JSON.parse(serialized);
  state.fog.rooms = data.rooms || [];
  state.fog.strokes = data.strokes || [];
  state.tokens = data.tokens || [];
  state.stairs = data.stairs || [];
  state.images = data.images || [];
  state.notes = data.notes || [];
  state.aoeMarkers = data.aoeMarkers || [];
  selectedImage = selectedNote = selectedAoeMarker = null;
  fogDirty = true;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotFog());
  applyFogSnapshot(undoStack.pop());
  drawingRoom = [];
  activeStroke = null;
  updateUndoButtons();
  renderAndSync();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotFog());
  applyFogSnapshot(redoStack.pop());
  updateUndoButtons();
  renderAndSync();
}
function updateUndoButtons() {
  if (isPlayer) return;
  if (controls.undo) controls.undo.disabled = !undoStack.length;
  if (controls.redo) controls.redo.disabled = !redoStack.length;
}

/* ----------------------------- canvas / view ----------------------------- */

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

// Keep the canvas backing store matched to its CSS box. A ResizeObserver catches the
// responsive panel breakpoint and the player window being resized; the DPR watcher
// catches the window being dragged to a monitor with different pixel density.
function watchCanvasSize() {
  let queued = false;
  const onChange = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      resizeCanvas();
      render();
      reportPlayerViewport(); // keep the GM's player-frame in sync with this display's size
    });
  };
  if (window.ResizeObserver) {
    new ResizeObserver(onChange).observe(canvas);
  } else {
    window.addEventListener("resize", onChange);
  }
  const watchDpr = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        onChange();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();
}

function activeView() {
  return isPlayer && !state.playerView.matchDM ? state.playerView : state.view;
}

function worldDims() {
  return { w: state.imageWidth * state.map.scale, h: state.imageHeight * state.map.scale };
}

// Scale that fits the (possibly rotated) map into a viewW x viewH box. At 90/270° the
// map's on-screen footprint has its width and height swapped.
function fitScaleFor(viewW, viewH, rotationDeg) {
  const { w, h } = worldDims();
  if (!w || !h) return 1;
  const swap = ((((rotationDeg || 0) % 180) + 180) % 180) === 90;
  const cw = swap ? h : w;
  const ch = swap ? w : h;
  return Math.min(viewW / cw, viewH / ch) * 0.96;
}

function fitMap(sync) {
  if (!state.imageWidth || !state.imageHeight) return;
  const rect = canvas.getBoundingClientRect();
  state.view.scale = fitScaleFor(rect.width, rect.height, state.view.rotation || 0);
  state.view.cx = state.imageWidth / 2;
  state.view.cy = state.imageHeight / 2;
  if (state.playerView.matchDM && !isPlayer) syncPlayerViewControls();
  render();
  if (sync) broadcastState();
}

// GM "rotate map": rotates the GM view in 90° steps and carries the orientation to the
// player too (overriding any independent player rotation). All content rides the view
// transform, so fog, tokens and stairs rotate with the map.
function rotateMap(deg) {
  state.view.rotation = ((((state.view.rotation || 0) + deg) % 360) + 360) % 360;
  state.playerView.rotation = state.view.rotation; // authoritative — overrides the player setting
  if (state.playerView.matchDM) {
    state.playerView.scale = state.view.scale;
    state.playerView.cx = state.view.cx;
    state.playerView.cy = state.view.cy;
  }
  renderAndSync();
}

// Rotate ONLY the player display. Like the zoom/offset sliders, this gives the player an
// independent view so the rotation is visible while the GM keeps their own orientation.
function rotatePlayerView(deg) {
  state.playerView.matchDM = false;
  if (controls.playerMatchDM) controls.playerMatchDM.checked = false;
  state.playerView.rotation = ((((state.playerView.rotation || 0) + deg) % 360) + 360) % 360;
  syncPlayerViewControls();
  renderAndSync();
}

// Fit-to-screen for the player display, using the size the player reported.
function fitPlayerView() {
  if (!state.imageWidth || !state.imageHeight) return;
  state.playerView.matchDM = false;
  if (controls.playerMatchDM) controls.playerMatchDM.checked = false;
  const rect = canvas.getBoundingClientRect();
  const vw = playerViewport?.w || rect.width;
  const vh = playerViewport?.h || rect.height;
  state.playerView.scale = fitScaleFor(vw, vh, state.playerView.rotation || 0);
  state.playerView.cx = state.imageWidth / 2;
  state.playerView.cy = state.imageHeight / 2;
  captureSquareLock(); // fitting re-dials the locked TV square size
  syncPlayerViewControls();
  renderAndSync();
}

// Begin dragging the red player-view frame. Detaches from "Follow GM" (seeding the player
// view from the GM's framing so it doesn't jump) and records the grab offset so the frame
// tracks the cursor; dragging then pans the player display live.
function startFrameDrag(native, pointerId) {
  if (state.playerView.matchDM) {
    state.playerView.matchDM = false;
    if (controls.playerMatchDM) controls.playerMatchDM.checked = false;
    state.playerView.scale = state.view.scale;
    state.playerView.cx = state.view.cx;
    state.playerView.cy = state.view.cy;
    state.playerView.rotation = state.view.rotation;
  }
  draggingFrame = true;
  dragGrab = { dx: state.playerView.cx - native.x, dy: state.playerView.cy - native.y };
  isDragging = true;
  capturePointer(pointerId);
}

/* ---- Player-square lock (IRL): keep one grid square a fixed physical size on the TV ---- */

// World px per grid square for the current map (calibrated grid, else the measured cell).
function cellWorldPx() {
  return state.grid.size > 0 ? state.grid.size : state.measure.cellSize > 0 ? state.measure.cellSize : 0;
}

// Screen px that one grid square currently occupies on the player display.
function playerSquareScreenPx() {
  const sc = state.playerView.matchDM ? state.view.scale : state.playerView.scale;
  return cellWorldPx() * (state.map.scale || 1) * sc;
}

function persistSquareLock() {
  try {
    localStorage.setItem(SQUARE_LOCK_KEY, JSON.stringify({ on: lockPlayerSquare, px: lockedSquarePx }));
  } catch {}
}

function loadSquareLock() {
  try {
    const v = JSON.parse(localStorage.getItem(SQUARE_LOCK_KEY) || "null");
    if (v && typeof v.px === "number") {
      lockPlayerSquare = !!v.on;
      lockedSquarePx = v.px;
    }
  } catch {}
}

// Re-capture the locked square size from the current player zoom (used when the GM
// deliberately re-dials the TV via the zoom slider or fit while the lock is on).
function captureSquareLock() {
  if (isPlayer || !lockPlayerSquare) return;
  const px = playerSquareScreenPx();
  if (px > 0) {
    lockedSquarePx = px;
    persistSquareLock();
  }
}

// Re-derive the player zoom for THIS map so one grid square equals the locked physical size.
// Different maps have different px-per-square, so the zoom differs per map but the square
// stays the same size on the TV. No-op until this map's grid is calibrated.
function applyPlayerSquareLock() {
  if (isPlayer || !lockPlayerSquare || !lockedSquarePx) return;
  const cell = cellWorldPx();
  const ms = state.map.scale || 1;
  if (cell <= 0) return;
  state.playerView.matchDM = false;
  if (controls.playerMatchDM) controls.playerMatchDM.checked = false;
  state.playerView.scale = lockedSquarePx / (cell * ms);
  syncPlayerViewControls();
  renderAndSync();
}

function setPlayerSquareLock(on) {
  lockPlayerSquare = on;
  if (on) {
    const px = playerSquareScreenPx();
    if (px > 0) lockedSquarePx = px; // capture the current TV calibration as the target
  }
  persistSquareLock();
  updateSquareLockUI();
  if (on) applyPlayerSquareLock();
}

function updateSquareLockUI() {
  if (controls.lockPlayerSquare) controls.lockPlayerSquare.checked = lockPlayerSquare;
}

function viewTransform() {
  const rect = canvas.getBoundingClientRect();
  const v = activeView();
  const ms = state.map.scale || 1;
  const k = v.scale;
  return {
    rect,
    k,
    ms,
    rot: ((v.rotation || 0) * Math.PI) / 180,
    cx: v.cx,
    cy: v.cy,
    centerX: rect.width / 2,
    centerY: rect.height / 2,
  };
}

function clientToCanvasPoint(point) {
  const rect = canvas.getBoundingClientRect();
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

// Current view rotation in radians (the angle the render transform applied). Markers like
// tokens and stairs counter-rotate by its negative so their art/labels stay screen-upright
// while their positions still ride the rotated map.
function currentViewRotation() {
  return ((activeView().rotation || 0) * Math.PI) / 180;
}

// Rotate the canvas about a native point so subsequent drawing at absolute coords keeps its
// position but is drawn upright on screen (cancels the view rotation).
function keepUpright(cx, cy, rot) {
  if (!rot) return;
  ctx.translate(cx, cy);
  ctx.rotate(-rot);
  ctx.translate(-cx, -cy);
}

// Screen <-> native conversions, rotation-aware. The view is centered on (cx,cy) in native
// coords, scaled by k*ms, and rotated by `rot` about the canvas center.
function screenToNative(point) {
  const t = viewTransform();
  const s = t.k * t.ms;
  const ox = point.x - t.centerX;
  const oy = point.y - t.centerY;
  const cos = Math.cos(-t.rot);
  const sin = Math.sin(-t.rot);
  return {
    x: t.cx + (ox * cos - oy * sin) / s,
    y: t.cy + (ox * sin + oy * cos) / s,
  };
}

function nativeToScreen(n) {
  const t = viewTransform();
  const s = t.k * t.ms;
  const dx = (n.x - t.cx) * s;
  const dy = (n.y - t.cy) * s;
  const cos = Math.cos(t.rot);
  const sin = Math.sin(t.rot);
  return {
    x: t.centerX + dx * cos - dy * sin,
    y: t.centerY + dx * sin + dy * cos,
  };
}

function toNativePoint(event) {
  return screenToNative(clientToCanvasPoint(event));
}

// Pointer capture keeps a drag tracking even if the cursor leaves the canvas. Guarded
// because a capture can legitimately fail (e.g. the pointer was already released).
function capturePointer(pointerId) {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {}
}

function releasePointer(pointerId) {
  try {
    canvas.releasePointerCapture?.(pointerId);
  } catch {}
}

/* ----------------------------- render ----------------------------- */

function render() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#080909";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (isPlayer && state.blackout) {
    emptyState.classList.add("hidden");
    return;
  }
  if (isPlayer && state.splash.enabled) {
    renderSplash(rect);
    return;
  }

  emptyState.classList.toggle("hidden", Boolean(state.imageData));
  if (!state.imageData || !mapImage.complete) return;

  const t = viewTransform();
  curK = t.k;
  curMs = t.ms;
  const { w, h } = worldDims();

  ctx.save();
  // Center the view, rotate, scale, then shift so (cx,cy) sits at the canvas center.
  ctx.translate(t.centerX, t.centerY);
  ctx.rotate(t.rot);
  ctx.scale(t.k, t.k);
  ctx.translate(-t.cx * t.ms, -t.cy * t.ms);

  // World block (native x map.scale)
  ctx.drawImage(mapImage, 0, 0, w, h);
  if (state.grid.enabled) drawGrid(w, h);

  // Native block
  ctx.save();
  ctx.scale(t.ms, t.ms);
  if (fogDirty) rebuildFog();
  // Images and tokens sit BELOW the fog so anything in an unrevealed area is hidden (solid
  // black for players, dimmed under the GM tint).
  drawImages();
  drawTokens();
  compositeFog();
  drawAoeMarkers(); // persistent AoE regions (above fog, below hover template)
  drawAoeTemplate(); // hover template sits above fog; visible to both GM and player
  if (!isPlayer) drawRoomOutlines();
  if (!isPlayer) drawStairs(); // stairs are a GM-only navigation aid stays above fog
  if (!isPlayer) drawDraftRoom();
  if (!isPlayer) drawStampDraft();
  if (!isPlayer) drawCalibrationDraft();
  if (measureLine) drawMeasureLine();
  if (!isPlayer) drawTokenMovePath();
  if (!isPlayer && ["brush", "eraser"].includes(mode) && state.imageData) {
    drawToolPreview(screenToNative(clientToCanvasPoint(lastPointer)));
  }
  ctx.restore();

  ctx.restore();

  // Screen-space overlays
  drawPings();
  if (measureLine) drawMeasureLabel();
  if (!isPlayer) drawTokenMoveLabel();
  if (!isPlayer && mode === "pan" && !draggingToken) drawOrientationArrows();
  if (!isPlayer) drawRoomNames();
  if (!isPlayer) drawNotes();
  if (!isPlayer) drawAoeMarkerLabels();
  if (!isPlayer) drawPlayerFrame();
}

// GM-only: a red rectangle marking the region the player display currently shows, so the
// GM can tell exactly what their players see. Uses the player's reported pixel size.
// Screen-space corners of the player's visible region, or null when no frame is shown.
// Un-rotates by the player's own rotation, then projects through the GM transform, so the
// frame is correct even when the GM and player views are rotated differently.
function playerFrameCorners() {
  if (!showPlayerFrame || !playerViewport || !state.imageData) return null;
  const ms = state.map.scale || 1;
  const pv = state.playerView.matchDM ? state.view : state.playerView;
  if (!pv.scale) return null;
  const s = pv.scale * ms;
  const hw = playerViewport.w / 2;
  const hh = playerViewport.h / 2;
  const pr = ((pv.rotation || 0) * Math.PI) / 180;
  const cosP = Math.cos(-pr);
  const sinP = Math.sin(-pr);
  const toNative = (ox, oy) => ({
    x: pv.cx + (ox * cosP - oy * sinP) / s,
    y: pv.cy + (ox * sinP + oy * cosP) / s,
  });
  return [
    nativeToScreen(toNative(-hw, -hh)),
    nativeToScreen(toNative(hw, -hh)),
    nativeToScreen(toNative(hw, hh)),
    nativeToScreen(toNative(-hw, hh)),
  ];
}

function drawPlayerFrame() {
  const corners = playerFrameCorners();
  if (!corners) return;
  ctx.save();
  ctx.globalAlpha = playerFrameOpacity;
  ctx.strokeStyle = playerFrameColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function renderSplash(rect) {
  emptyState.classList.add("hidden");
  if (!state.splash.imageData || !splashImage.complete) {
    ctx.fillStyle = "#080909";
    ctx.fillRect(0, 0, rect.width, rect.height);
    return;
  }
  const scale = Math.min(rect.width / splashImage.naturalWidth, rect.height / splashImage.naturalHeight);
  const width = splashImage.naturalWidth * scale;
  const height = splashImage.naturalHeight * scale;
  ctx.drawImage(splashImage, (rect.width - width) / 2, (rect.height - height) / 2, width, height);
}

function drawGrid(worldW, worldH) {
  const size = state.grid.size;
  if (size <= 0) return;
  ctx.save();
  ctx.globalAlpha = state.grid.opacity;
  ctx.strokeStyle = state.grid.color;
  ctx.lineWidth = (state.grid.lineWidth || 1) / curK;
  ctx.beginPath();
  const startX = ((state.grid.offsetX % size) + size) % size;
  const startY = ((state.grid.offsetY % size) + size) % size;
  for (let x = startX; x <= worldW; x += size) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, worldH);
  }
  for (let y = startY; y <= worldH; y += size) {
    ctx.moveTo(0, y);
    ctx.lineTo(worldW, y);
  }
  ctx.stroke();
  ctx.restore();
}

/* ----------------------------- fog ----------------------------- */

function resizeFogLayer() {
  const maxEdge = Math.max(state.imageWidth, state.imageHeight) || 1;
  fogResScale = Math.min(1, FOG_MAX_EDGE / maxEdge);
  const w = Math.max(1, Math.round(state.imageWidth * fogResScale));
  const h = Math.max(1, Math.round(state.imageHeight * fogResScale));
  [fogCanvas, liveCanvas, polyCanvas, strokeCanvas].forEach((c) => {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  });
}

// Build the freeform layer (brush paint, bucket fill, brush erase, and the polygon-shaped
// erases produced by right-clicking an area). Replayed in creation order, so an erase only
// affects fog that already existed — painting back over an erased spot works as expected.
function buildStrokeLayer() {
  const color = isPlayer ? "#080909" : state.fog.gmColor;
  strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
  strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
  state.fog.strokes.forEach((stroke) => {
    strokeCtx.save();
    strokeCtx.globalAlpha = 1;
    strokeCtx.fillStyle = color;
    strokeCtx.globalCompositeOperation = stroke.kind === "erase" ? "destination-out" : "source-over";
    if (stroke.kind === "fill") {
      strokeCtx.fillRect(0, 0, strokeCanvas.width, strokeCanvas.height);
    } else if (stroke.region === "polygon" && stroke.points) {
      strokeCtx.fill(roomPathFog(stroke.points));
    } else {
      strokeCtx.fill(strokePathFog(stroke));
    }
    strokeCtx.restore();
  });
}

// Rebuild the committed fog bitmap as the union of the polygon layer and the freeform layer.
// Full opacity; the GM tint/opacity is applied once at composite time so overlap never darkens.
function rebuildFog() {
  resizeFogLayer();
  const color = isPlayer ? "#080909" : state.fog.gmColor;
  // Polygon/stamp areas.
  polyCtx.setTransform(1, 0, 0, 1, 0, 0);
  polyCtx.clearRect(0, 0, polyCanvas.width, polyCanvas.height);
  polyCtx.save();
  polyCtx.globalAlpha = 1;
  polyCtx.fillStyle = color;
  state.fog.rooms.forEach((room) => {
    if (room.revealed) return;
    polyCtx.fill(roomPathFog(room.points));
  });
  polyCtx.restore();
  // Freeform layer.
  buildStrokeLayer();
  // Union the two into the displayed fog bitmap.
  fogCtx.setTransform(1, 0, 0, 1, 0, 0);
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  fogCtx.drawImage(polyCanvas, 0, 0);
  fogCtx.drawImage(strokeCanvas, 0, 0);
  fogDirty = false;
}

function compositeFog() {
  let source = fogCanvas;
  if (activeStroke) {
    // Preview the in-progress brush stroke on the freeform layer only, then re-union the
    // polygon layer beneath it so an erase preview never appears to remove polygon fog.
    liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    liveCtx.drawImage(strokeCanvas, 0, 0);
    liveCtx.save();
    liveCtx.globalCompositeOperation = activeStroke.kind === "erase" ? "destination-out" : "source-over";
    liveCtx.globalAlpha = 1;
    liveCtx.fillStyle = isPlayer ? "#080909" : state.fog.gmColor;
    liveCtx.fill(strokePathFog(activeStroke));
    liveCtx.restore();
    liveCtx.save();
    liveCtx.globalCompositeOperation = "destination-over";
    liveCtx.drawImage(polyCanvas, 0, 0);
    liveCtx.restore();
    source = liveCanvas;
  }
  ctx.save();
  ctx.globalAlpha = isPlayer ? 1 : state.fog.gmOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, fogCanvas.width, fogCanvas.height, 0, 0, state.imageWidth, state.imageHeight);
  ctx.restore();
}

function roomPathFog(points) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x * fogResScale, points[0].y * fogResScale);
  points.slice(1).forEach((p) => path.lineTo(p.x * fogResScale, p.y * fogResScale));
  path.closePath();
  return path;
}

function strokePathFog(stroke) {
  const path = new Path2D();
  const radius = (stroke.size * fogResScale) / 2;
  stroke.points.forEach((point) => {
    const x = point.x * fogResScale;
    const y = point.y * fogResScale;
    if (stroke.shape === "square") {
      path.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, Math.PI * 2);
    }
  });
  return path;
}

function drawRoomOutlines() {
  ctx.save();
  state.fog.rooms.forEach((room) => {
    if (room.revealed) return;
    drawPolygon(room.points);
    ctx.strokeStyle = "rgba(214,169,77,0.72)";
    ctx.lineWidth = 2 / (curK * curMs);
    ctx.stroke();
  });
  ctx.restore();
}

function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  points.forEach((p) => {
    x += p.x;
    y += p.y;
  });
  return { x: x / points.length, y: y / points.length };
}

// Wrap text to maxW screen px (ctx.font must already be set). Hard-breaks words longer than
// the line, and caps at maxLines with an ellipsis so a long name never overflows its label.
function wrapLabel(text, maxW, maxLines) {
  const fits = (s) => ctx.measureText(s).width <= maxW;
  const lines = [];
  let line = "";
  for (let word of String(text).trim().split(/\s+/).filter(Boolean)) {
    while (!fits(word) && word.length > 1) {
      let cut = word.length;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const test = line ? line + " " + word : word;
    if (line && !fits(test)) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && !fits(last + "…")) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines.length ? lines : [""];
}

// GM-only labels ("cartouches") for named fog areas. Drawn in screen space so they stay
// readable at any zoom; long names wrap (up to 3 lines) and truncate instead of overflowing.
// Players never call this, so the names are never shown on the player display.
function drawRoomNames() {
  const named = state.fog.rooms.filter((room) => room.name);
  if (!named.length) return;
  ctx.save();
  ctx.font = "600 13px Inter, ui-sans-serif, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = 200;
  const lh = 16;
  const padX = 7;
  const padY = 5;
  named.forEach((room) => {
    const screen = nativeToScreen(polygonCentroid(room.points));
    const lines = wrapLabel(room.name, maxW, 3);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.min(maxW, textW) + padX * 2;
    const boxH = lines.length * lh + padY * 2;
    const top = screen.y - boxH / 2;
    ctx.fillStyle = "rgba(8, 9, 9, 0.78)";
    ctx.fillRect(screen.x - boxW / 2, top, boxW, boxH);
    ctx.fillStyle = room.revealed ? "rgba(244, 232, 200, 0.5)" : "#f4e8c8";
    lines.forEach((line, i) => ctx.fillText(line, screen.x, top + padY + lh / 2 + i * lh));
  });
  ctx.restore();
}

function drawToolPreview(point) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = mode === "eraser" ? "rgba(214,106,95,0.95)" : "rgba(127,182,166,0.95)";
  ctx.fillStyle = mode === "eraser" ? "rgba(214,106,95,0.12)" : "rgba(127,182,166,0.12)";
  ctx.lineWidth = 2 / (curK * curMs);
  drawToolShapePath(point, state.fog.toolSize, state.fog.toolShape);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawToolShapePath(point, size, shape) {
  const radius = size / 2;
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(point.x - radius, point.y - radius, size, size);
  } else {
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }
}

function drawDraftRoom() {
  if (!drawingRoom.length) return;
  ctx.save();
  ctx.fillStyle = "rgba(127, 182, 166, 0.18)";
  ctx.strokeStyle = "rgba(127, 182, 166, 0.95)";
  ctx.lineWidth = 2 / (curK * curMs);
  drawPolygon(drawingRoom);
  if (drawingRoom.length > 2) ctx.fill();
  ctx.stroke();
  drawingRoom.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4 / (curK * curMs), 0, Math.PI * 2);
    ctx.fillStyle = "#7fb6a6";
    ctx.fill();
  });
  ctx.restore();
}

// Arm a "drag one square" calibration. The next drag on the map sets either the grid
// size ('grid') or the measurement cell size when the grid overlay is off ('measure').
function armCalibration(purpose) {
  calibrating = calibrating === purpose ? null : purpose;
  calibrationDraft = null;
  updateCalibrationUI();
  controls.modeHint.textContent = calibrating
    ? "Drag a square over one grid cell on the map, then release to set the size."
    : "";
  render();
}

// Both calibrate buttons (Grid and Measure) do the same thing: from the dragged square they
// set the grid cell SIZE, align the grid OFFSET to where the square was drawn, and store the
// measure cell size. Because token snapping and the ruler both read grid size+offset, tokens
// land on the printed cells whether or not the grid overlay is shown.
function finishCalibration() {
  const draft = calibrationDraft;
  const purpose = calibrating;
  calibrationDraft = null;
  calibrating = null;
  updateCalibrationUI();
  if (!draft || !purpose) {
    render();
    return;
  }
  const ms = state.map.scale || 1;
  const wpx = Math.abs(draft.end.x - draft.start.x) * ms;
  const hpx = Math.abs(draft.end.y - draft.start.y) * ms;
  const side = Math.max(wpx, hpx); // tolerate a slightly non-square drag
  if (side < 4) {
    render();
    return;
  }
  const size = Math.max(4, Math.round(side));
  // World-space coords of the square's top-left corner; align a grid line to it.
  const x0w = Math.min(draft.start.x, draft.end.x) * ms;
  const y0w = Math.min(draft.start.y, draft.end.y) * ms;
  const normOffset = (v) => {
    let o = ((v % size) + size) % size; // 0..size
    if (o > size / 2) o -= size; // keep it small: (-size/2, size/2]
    return Math.round(o);
  };
  state.grid.size = size;
  state.grid.offsetX = normOffset(x0w);
  state.grid.offsetY = normOffset(y0w);
  state.measure.cellSize = size; // keeps the ruler correct when the overlay is off
  syncControlsFromState();
  controls.modeHint.textContent = `Calibrated: 1 cell = ${size} px, grid aligned to the square.`;
  renderAndSync();
  applyPlayerSquareLock(); // a fresh calibration re-derives the locked player zoom for this map
}

function updateCalibrationUI() {
  controls.gridCalibrate?.classList.toggle("active", calibrating === "grid");
  controls.measureCalibrate?.classList.toggle("active", calibrating === "measure");
}

// The "measure one square" calibration is only offered when the grid overlay is off
// (i.e. the map has its own printed grid to calibrate the ruler against).
function updateMeasureCalibrateRow() {
  controls.measureCalibrateRow?.classList.toggle("hidden", state.grid.enabled);
}

function drawCalibrationDraft() {
  if (!calibrationDraft) return;
  const a = calibrationDraft.start;
  const b = calibrationDraft.end;
  const ms = state.map.scale || 1;
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const sx = b.x >= a.x ? 1 : -1;
  const sy = b.y >= a.y ? 1 : -1;
  const x0 = Math.min(a.x, a.x + sx * side);
  const y0 = Math.min(a.y, a.y + sy * side);
  ctx.save();
  ctx.fillStyle = "rgba(177, 195, 1, 0.18)";
  ctx.strokeStyle = "#b1c301";
  ctx.lineWidth = 2 / (curK * curMs);
  ctx.setLineDash([6 / (curK * curMs), 4 / (curK * curMs)]);
  ctx.strokeRect(x0, y0, side, side);
  ctx.fillRect(x0, y0, side, side);
  ctx.restore();
}

/* ----------------------------- area of effect ----------------------------- */

// Draw the live AoE hover template at the current cursor position (native coords).
// Visible on both GM and player screens via the view broadcast.
function drawAoeTemplate() {
  if (!aoeTemplate.visible) return;
  const x = aoeTemplate.x;
  const y = aoeTemplate.y;
  const pxPerFt = measureCellWorld() / FEET_PER_CELL / (state.map.scale || 1);
  const size = aoeSizeFt * pxPerFt; // size in native px (radius, half-side, or cone length)

  ctx.save();
  ctx.beginPath();
  if (aoeShape === "circle") {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  } else if (aoeShape === "square") {
    ctx.rect(x - size / 2, y - size / 2, size, size);
  } else if (aoeShape === "cone") {
    // A real triangle: apex at the cursor, two straight edges to a flat far side.
    const a1 = aoeAngle - AOE_CONE_HALF_ANGLE;
    const a2 = aoeAngle + AOE_CONE_HALF_ANGLE;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a1) * size, y + Math.sin(a1) * size);
    ctx.lineTo(x + Math.cos(a2) * size, y + Math.sin(a2) * size);
    ctx.closePath();
  }
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = aoeColor;
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2 / (curK * curMs);
  ctx.strokeStyle = aoeColor;
  ctx.stroke();
  ctx.restore();
}

function setAoeShape(shape) {
  aoeShape = shape;
  [
    ["circle", controls.aoeCircle],
    ["square", controls.aoeSquare],
    ["cone", controls.aoeCone],
  ].forEach(([name, btn]) => btn?.classList.toggle("active", shape === name));
  updateAoePresets();
  controls.aoeAngleRow?.classList.toggle("hidden", shape !== "cone");
}

// Size in native px for a placed AoE marker (radius, half-side, or cone length).
function aoePxSize(m) {
  return m.sizeFt * measureCellWorld() / FEET_PER_CELL / (state.map.scale || 1);
}

// Hit-test a native point against all placed AoE markers (reverse order = top first).
function hitAoeMarker(native) {
  const list = state.aoeMarkers || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const size = aoePxSize(m);
    const dx = native.x - m.x;
    const dy = native.y - m.y;
    if (m.shape === "circle") {
      if (Math.hypot(dx, dy) <= size) return m;
    } else if (m.shape === "square") {
      if (Math.abs(dx) <= size / 2 && Math.abs(dy) <= size / 2) return m;
    } else if (m.shape === "cone") {
      const a1 = m.angle - AOE_CONE_HALF_ANGLE;
      const a2 = m.angle + AOE_CONE_HALF_ANGLE;
      const pts = [
        { x: m.x, y: m.y },
        { x: m.x + Math.cos(a1) * size, y: m.y + Math.sin(a1) * size },
        { x: m.x + Math.cos(a2) * size, y: m.y + Math.sin(a2) * size },
      ];
      if (pointInPolygon(native, pts)) return m;
    }
  }
  return null;
}

// Drop the current AoE template as a persistent marker at native point (grid-snapped).
function placeAoeMarker(native) {
  const label = window.prompt("Label for this area (GM-only, optional):", "");
  if (label === null) return; // cancelled
  pushHistory();
  const pos = snapNative(native);
  const marker = {
    id: uuid(),
    shape: aoeShape,
    x: pos.x,
    y: pos.y,
    sizeFt: aoeSizeFt,
    angle: aoeAngle,
    color: aoeColor,
    label: label.trim(),
    showPlayers: true,
  };
  state.aoeMarkers.push(marker);
  renderAndSync();
}

function editAoeMarkerLabel(marker) {
  const text = window.prompt("Edit label (GM-only, optional):", marker.label || "");
  if (text === null) return;
  pushHistory();
  marker.label = text.trim();
  render();
}

// Draw all persistent AoE markers in native coords (called inside the map transform).
function drawAoeMarkers() {
  const list = state.aoeMarkers || [];
  if (!list.length) return;
  list.forEach((m) => {
    if (isPlayer && !m.showPlayers) return;
    const size = aoePxSize(m);
    ctx.save();
    ctx.beginPath();
    if (m.shape === "circle") {
      ctx.arc(m.x, m.y, size, 0, Math.PI * 2);
    } else if (m.shape === "square") {
      ctx.rect(m.x - size / 2, m.y - size / 2, size, size);
    } else if (m.shape === "cone") {
      const a1 = m.angle - AOE_CONE_HALF_ANGLE;
      const a2 = m.angle + AOE_CONE_HALF_ANGLE;
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x + Math.cos(a1) * size, m.y + Math.sin(a1) * size);
      ctx.lineTo(m.x + Math.cos(a2) * size, m.y + Math.sin(a2) * size);
      ctx.closePath();
    }
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2 / (curK * curMs);
    ctx.strokeStyle = m.color;
    ctx.stroke();
    if (!isPlayer && m === selectedAoeMarker) {
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 3 / (curK * curMs);
      ctx.strokeStyle = "#b1c301";
      ctx.setLineDash([8 / (curK * curMs), 5 / (curK * curMs)]);
      ctx.stroke();
    }
    ctx.restore();
  });
}

// GM-only: draw AoE marker labels in screen space above each marker center.
function drawAoeMarkerLabels() {
  if (isPlayer) return;
  const list = state.aoeMarkers || [];
  if (!list.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "bold 13px Inter, ui-sans-serif, sans-serif";
  list.forEach((m) => {
    if (!m.label) return;
    const size = aoePxSize(m);
    const center = nativeToScreen({ x: m.x, y: m.y - size * 0.15 });
    const tw = ctx.measureText(m.label).width;
    const pad = 5;
    const bw = tw + pad * 2;
    const bh = 18;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(center.x - bw / 2, center.y - bh, bw, bh, 3);
    } else {
      ctx.rect(center.x - bw / 2, center.y - bh, bw, bh);
    }
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.fillText(m.label, center.x, center.y - 2);
  });
  ctx.restore();
}

// Rebuild the preset size buttons for the current shape.
function updateAoePresets() {
  const row = controls.aoePresetsRow;
  if (!row) return;
  const presets = AOE_PRESETS[aoeShape] || [];
  row.innerHTML = "";
  presets.forEach((ft) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${ft} ft`;
    btn.classList.toggle("active", ft === aoeSizeFt);
    btn.addEventListener("click", () => {
      aoeSizeFt = ft;
      if (controls.aoeCustomSize) controls.aoeCustomSize.value = ft;
      updateAoePresets();
      render();
    });
    row.appendChild(btn);
  });
}

function drawStampDraft() {
  if (!stampDraft) return;
  const points = stampPolygon(stampDraft.shape, stampDraft.start, stampDraft.end);
  if (!points) return;
  ctx.save();
  ctx.fillStyle = "rgba(127, 182, 166, 0.18)";
  ctx.strokeStyle = "rgba(127, 182, 166, 0.95)";
  ctx.lineWidth = 2 / (curK * curMs);
  drawPolygon(points);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPolygon(points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

/* ----------------------------- tokens ----------------------------- */

function gridCellNative() {
  return (state.grid.size || 70) / (state.map.scale || 1);
}

function tokenRadius(token) {
  return Math.max(6, ((token.cells || 1) * gridCellNative()) / 2);
}

// Multi-cell tokens render as squares (they fill their grid footprint); single-cell
// tokens stay circular.
function tokenIsSquare(token) {
  return (token.cells || 1) > 1;
}

function tokenOutline(token, r) {
  if (tokenIsSquare(token)) {
    ctx.rect(token.x - r, token.y - r, r * 2, r * 2);
  } else {
    ctx.arc(token.x, token.y, r, 0, Math.PI * 2);
  }
}

function drawTokens() {
  const lineW = Math.max(1, 2 / (curK * curMs));
  const rot = currentViewRotation();
  state.tokens.forEach((token) => {
    const r = tokenRadius(token);
    ctx.save();
    keepUpright(token.x, token.y, rot); // art + label stay upright when the map is rotated
    const img = getTokenImage(token.image);
    if (img && img.complete && img.naturalWidth) {
      // Token art: cover-fit the image into the token outline and ring it.
      ctx.save();
      ctx.beginPath();
      tokenOutline(token, r);
      ctx.clip();
      const scale = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, token.x - w / 2, token.y - h / 2, w, h);
      ctx.restore();
      ctx.beginPath();
      tokenOutline(token, r);
      ctx.lineWidth = lineW;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.stroke();
    } else {
      ctx.beginPath();
      tokenOutline(token, r);
      ctx.fillStyle = token.color || "#d6a94d";
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = lineW;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.stroke();
      if (token.label) {
        ctx.fillStyle = "#0c0d0d";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.round(gridCellNative() / 2)}px Inter, sans-serif`;
        ctx.fillText(String(token.label).slice(0, 3), token.x, token.y);
      }
    }
    // Selection highlight (GM only): an accent outline around the active token.
    if (!isPlayer && token === selectedToken) {
      ctx.beginPath();
      tokenOutline(token, r + 3 / (curK * curMs));
      ctx.lineWidth = Math.max(1.5, 3 / (curK * curMs));
      ctx.strokeStyle = "#b1c301";
      ctx.stroke();
    }
    ctx.restore();
  });
}

function hitToken(native) {
  for (let i = state.tokens.length - 1; i >= 0; i--) {
    const token = state.tokens[i];
    const r = tokenRadius(token);
    if (tokenIsSquare(token)) {
      if (Math.abs(native.x - token.x) <= r && Math.abs(native.y - token.y) <= r) return token;
    } else if (Math.hypot(native.x - token.x, native.y - token.y) <= r) {
      return token;
    }
  }
  return null;
}

// Snap a native point to the nearest grid cell center (ungated).
function snapToGrid(native) {
  const ms = state.map.scale || 1;
  const size = state.grid.size || 70;
  const wx = native.x * ms;
  const wy = native.y * ms;
  const cx = Math.floor((wx - state.grid.offsetX) / size) * size + state.grid.offsetX + size / 2;
  const cy = Math.floor((wy - state.grid.offsetY) / size) * size + state.grid.offsetY + size / 2;
  return { x: cx / ms, y: cy / ms };
}

function snapNative(native) {
  return state.grid.snap ? snapToGrid(native) : native;
}

// Snap an image's center when the image snap toggle is on.
function snapImage(native) {
  return state.grid.snapImages ? snapToGrid(native) : native;
}

function addToken(native) {
  pushHistory();
  const pos = snapNative(native);
  state.tokens.push({
    id: uuid(),
    x: pos.x,
    y: pos.y,
    cells: Number(controls.tokenCells?.value) || 1,
    color: controls.tokenColor?.value || "#d6a94d",
    label: controls.tokenLabel?.value?.trim() || "",
    image: tokenImageData || "",
  });
  renderAndSync();
}

// Drop one token per selected image file, laid out in a tidy grid centred on the GM view.
function bulkAddTokenImages(files) {
  const list = [...(files || [])].filter((f) => f.type.startsWith("image/"));
  if (!list.length || !state.imageData) return;
  pushHistory();
  const cell = gridCellNative() || 70;
  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  const x0 = state.view.cx - ((cols - 1) * cell) / 2;
  const y0 = state.view.cy - ((rows - 1) * cell) / 2;
  const cells = Number(controls.tokenCells?.value) || 1;
  const color = controls.tokenColor?.value || "#d6a94d";
  let pending = list.length;
  const done = () => {
    if (--pending <= 0) renderAndSync();
    else render();
  };
  list.forEach((file, i) => {
    const pos = snapNative({ x: x0 + (i % cols) * cell, y: y0 + Math.floor(i / cols) * cell });
    const reader = new FileReader();
    reader.onerror = done;
    reader.onload = () => {
      downscaleImage(reader.result, TOKEN_IMAGE_MAX_EDGE, (data) => {
        state.tokens.push({ id: uuid(), x: pos.x, y: pos.y, cells, color, label: "", image: data });
        done();
      });
    };
    reader.readAsDataURL(file);
  });
}

// Token art is loaded once per data URL and cached; the image draws on every frame.
function getTokenImage(src) {
  if (!src) return null;
  let img = tokenImageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = render; // redraw once the art is decoded
    img.src = src;
    tokenImageCache.set(src, img);
  }
  return img;
}

const TOKEN_IMAGE_MAX_EDGE = 256; // token art is tiny on screen; cap it to keep saves small

// Downscale a data URL so its longest edge is at most maxEdge, re-encoding to PNG.
// Keeps token art (and therefore the synced/saved state) small regardless of source size.
function downscaleImage(src, maxEdge, callback) {
  const img = new Image();
  img.onload = () => {
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxEdge / longest);
    if (scale >= 1) {
      callback(src); // already small enough
      return;
    }
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    callback(c.toDataURL("image/png"));
  };
  img.onerror = () => callback(src);
  img.src = src;
}

function loadTokenImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => window.alert("Could not read that image file.");
  reader.onload = () => {
    downscaleImage(reader.result, TOKEN_IMAGE_MAX_EDGE, (data) => {
      tokenImageData = data;
      // If a token is selected in Move mode, re-skin it immediately; otherwise this image
      // becomes the default for newly dropped tokens.
      if (selectedToken) {
        pushHistory();
        selectedToken.image = tokenImageData;
        renderAndSync();
      }
      updateTokenImagePreview();
    });
  };
  reader.readAsDataURL(file);
  event.target.value = ""; // allow re-selecting the same file later
}

function clearTokenImage() {
  tokenImageData = "";
  if (selectedToken && selectedToken.image) {
    pushHistory();
    selectedToken.image = "";
    renderAndSync();
  }
  updateTokenImagePreview();
}

function updateTokenImagePreview() {
  if (!controls.tokenImagePreview) return;
  const has = Boolean(tokenImageData);
  controls.tokenImagePreview.src = has ? tokenImageData : "";
  controls.tokenImagePreview.classList.toggle("hidden", !has);
  controls.tokenImageClear?.classList.toggle("hidden", !has);
}

function nudgeSelectedToken(key) {
  const delta = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key];
  if (delta) moveSelectedTokenByCell(delta[0], delta[1]);
}

/* ----------------------------- map images & notes ----------------------------- */

// Droppable images live in native coords (x,y = center; w,h = size) and rotate with the map.
// On the player display only images flagged showPlayers are drawn.
function drawImages() {
  const list = state.images || [];
  if (!list.length) return;
  list.forEach((im) => {
    if (isPlayer && !im.showPlayers) return;
    const img = getTokenImage(im.src);
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.save();
    const irot = (im.rotation || 0) * Math.PI / 180;
    if (irot) {
      ctx.translate(im.x, im.y);
      ctx.rotate(irot);
      ctx.translate(-im.x, -im.y);
    }
    ctx.drawImage(img, im.x - im.w / 2, im.y - im.h / 2, im.w, im.h);
    if (!isPlayer && im === selectedImage) {
      ctx.lineWidth = 2 / (curK * curMs);
      ctx.strokeStyle = "#b1c301";
      ctx.setLineDash([8 / (curK * curMs), 5 / (curK * curMs)]);
      ctx.strokeRect(im.x - im.w / 2, im.y - im.h / 2, im.w, im.h);
    }
    ctx.restore();
  });
}

function hitImage(native) {
  for (let i = state.images.length - 1; i >= 0; i--) {
    const im = state.images[i];
    let dx = native.x - im.x;
    let dy = native.y - im.y;
    const irot = (im.rotation || 0) * Math.PI / 180;
    if (irot) {
      const c = Math.cos(-irot);
      const s = Math.sin(-irot);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    }
    if (Math.abs(dx) <= im.w / 2 && Math.abs(dy) <= im.h / 2) return im;
  }
  return null;
}

// Notes are GM-only sticky labels anchored to a native point but drawn in screen space so the
// text stays a constant, readable size and orientation at any zoom or rotation.
function wrapNoteText(text, maxW) {
  const out = [];
  String(text || "").split("\n").forEach((para) => {
    const words = para.split(/\s+/);
    let line = "";
    words.forEach((w) => {
      const test = line ? line + " " + w : w;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    });
    out.push(line);
  });
  return out.length ? out : [""];
}

function noteFont(note) {
  return `600 ${Math.round(13 * (note.scale || 1))}px Inter, ui-sans-serif, sans-serif`;
}

function noteLayout(note) {
  const sc = note.scale || 1;
  ctx.save();
  ctx.font = noteFont(note);
  const padX = 9 * sc;
  const padY = 7 * sc;
  const lh = 17 * sc;
  const boxW = 176 * sc;
  const lines = wrapNoteText(note.text, boxW - padX * 2);
  ctx.restore();
  return { lines, padX, padY, lh, boxW, boxH: padY * 2 + lines.length * lh };
}

function noteScreenRect(note) {
  const s = nativeToScreen({ x: note.x, y: note.y });
  const { boxW, boxH } = noteLayout(note);
  return { x: s.x, y: s.y, w: boxW, h: boxH };
}

function drawNotes() {
  const list = state.notes || [];
  if (!list.length) return;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  list.forEach((note) => {
    const s = nativeToScreen({ x: note.x, y: note.y });
    const { lines, padX, padY, lh, boxW, boxH } = noteLayout(note);
    ctx.font = noteFont(note);
    const sel = note === selectedNote;
    ctx.fillStyle = "rgba(244, 226, 140, 0.95)";
    ctx.strokeStyle = sel ? "#b1c301" : "rgba(0,0,0,0.45)";
    ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath();
    ctx.rect(s.x, s.y, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a1400";
    lines.forEach((ln, i) => ctx.fillText(ln, s.x + padX, s.y + padY + i * lh));
  });
  ctx.restore();
}

function hitNote(screenPt) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const r = noteScreenRect(state.notes[i]);
    if (screenPt.x >= r.x && screenPt.x <= r.x + r.w && screenPt.y >= r.y && screenPt.y <= r.y + r.h) {
      return state.notes[i];
    }
  }
  return null;
}

// Add a map image from a (raw) data URL, centered at native (nx, ny). Downscaled to bound size.
function addImageFromDataURL(rawSrc, nx, ny) {
  downscaleImage(rawSrc, IMAGE_MAX_EDGE, (src) => {
    const probe = new Image();
    probe.onload = () => {
      const aspect = probe.naturalWidth / probe.naturalHeight || 1;
      const w = Math.max(40, (state.imageWidth || 1000) * 0.25);
      pushHistory();
      const pos = snapImage({ x: nx, y: ny });
      const im = { id: uuid(), x: pos.x, y: pos.y, w, h: w / aspect, rotation: 0, src, showPlayers: false };
      state.images.push(im);
      selectedToken = selectedNote = null;
      selectedImage = im;
      updateSelectionPanels();
      renderAndSync();
    };
    probe.onerror = () => window.alert("Could not load that image.");
    probe.src = src;
  });
}

function addImageFile(file, nx, ny) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onerror = () => window.alert("Could not read that image file.");
  reader.onload = () => addImageFromDataURL(reader.result, nx, ny);
  reader.readAsDataURL(file);
}

function addNote() {
  const text = window.prompt("Note text (GM only):", "");
  if (text === null) return;
  pushHistory();
  const note = { id: uuid(), x: state.view.cx, y: state.view.cy, text: text || "Note", scale: 1 };
  state.notes.push(note);
  selectedToken = selectedImage = null;
  selectedNote = note;
  updateSelectionPanels();
  render(); // notes are GM-only, no broadcast needed
}

function editNote(note) {
  const text = window.prompt("Edit note (GM only):", note.text || "");
  if (text === null) return;
  pushHistory();
  note.text = text;
  render();
}

// Show/populate the View-section panels for the currently selected image or note.
function updateSelectionPanels() {
  if (isPlayer) return;
  if (controls.imageSelPanel) {
    controls.imageSelPanel.classList.toggle("hidden", !selectedImage);
    if (selectedImage) {
      if (controls.imageShowPlayers) controls.imageShowPlayers.checked = !!selectedImage.showPlayers;
      if (controls.imageSize) controls.imageSize.value = Math.round(selectedImage.w);
      if (controls.imageRotation) controls.imageRotation.value = Math.round(selectedImage.rotation || 0);
    }
  }
  if (controls.noteSelPanel) {
    controls.noteSelPanel.classList.toggle("hidden", !selectedNote);
    if (selectedNote && controls.noteSize) controls.noteSize.value = selectedNote.scale || 1;
  }
  if (controls.aoeMarkerSelPanel) {
    controls.aoeMarkerSelPanel.classList.toggle("hidden", !selectedAoeMarker);
    if (selectedAoeMarker) {
      if (controls.aoeMarkerLabel) controls.aoeMarkerLabel.value = selectedAoeMarker.label || "";
      if (controls.aoeMarkerShowPlayers) controls.aoeMarkerShowPlayers.checked = !!selectedAoeMarker.showPlayers;
    }
  }
}

function deleteTokenOrRoom(native) {
  const stair = hitStair(native);
  if (stair) {
    pushHistory();
    state.stairs = state.stairs.filter((s) => s !== stair);
    renderAndSync();
    return true;
  }
  const token = hitToken(native);
  if (token) {
    pushHistory();
    if (token === selectedToken) selectedToken = null;
    state.tokens = state.tokens.filter((item) => item !== token);
    renderAndSync();
    return true;
  }
  const image = hitImage(native);
  if (image) {
    pushHistory();
    if (image === selectedImage) { selectedImage = null; updateSelectionPanels(); }
    state.images = state.images.filter((item) => item !== image);
    renderAndSync();
    return true;
  }
  const room = [...state.fog.rooms].reverse().find((item) => pointInPolygon(native, item.points));
  if (room) {
    pushHistory();
    state.fog.rooms = state.fog.rooms.filter((item) => item !== room);
    // Also clear freeform (brush/bucket) fog inside this area — other polygons are unaffected.
    state.fog.strokes.push({ id: uuid(), kind: "erase", region: "polygon", points: room.points });
    fogDirty = true;
    renderAndSync();
    return true;
  }
  return false;
}

/* ----------------------------- initiative tracker ----------------------------- */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Turn order: highest initiative first. JS sort is stable, so ties keep insertion order.
function sortedCombatants() {
  return [...state.initiative.combatants].sort((a, b) => b.init - a.init);
}

function clampInitiativeTurn() {
  const n = state.initiative.combatants.length;
  state.initiative.turn = n ? Math.min(Math.max(0, state.initiative.turn), n - 1) : 0;
}

// Collapse/expand the left control panel. The grid column width animates in CSS; the
// canvas ResizeObserver re-measures the stage as it grows/shrinks.
function togglePanelCollapsed() {
  const collapsed = shell.classList.toggle("panel-collapsed");
  if (controls.panelToggle) {
    const label = collapsed ? "Show controls" : "Hide controls";
    controls.panelToggle.title = label;
    controls.panelToggle.setAttribute("aria-label", collapsed ? "Expand the control panel" : "Collapse the control panel");
  }
}

function toggleInitiative() {
  setInitiativeActive(!state.initiative.active);
}

function setInitiativeActive(on) {
  state.initiative.active = on;
  updateInitiativeUI();
  broadcastState();
  // The docked panel adds/removes a layout column, so the canvas must re-measure.
  requestAnimationFrame(() => {
    resizeCanvas();
    render();
  });
}

function addCombatant() {
  const name = controls.initName.value.trim();
  if (!name) return;
  const init = Number(controls.initRoll.value) || 0;
  const hp = controls.initHp.value === "" ? null : Math.max(0, Number(controls.initHp.value) || 0);
  const type = controls.initType.value || "player";
  state.initiative.combatants.push({ id: uuid(), name, type, init, hp, maxHp: hp });
  controls.initName.value = "";
  controls.initRoll.value = "";
  controls.initHp.value = "";
  controls.initName.focus();
  if (!state.initiative.active) {
    setInitiativeActive(true);
  } else {
    updateInitiativeUI();
    broadcastState();
  }
}

function removeCombatant(id) {
  state.initiative.combatants = state.initiative.combatants.filter((c) => c.id !== id);
  clampInitiativeTurn();
  updateInitiativeUI();
  broadcastState();
}

function adjustHp(id, delta) {
  const c = state.initiative.combatants.find((x) => x.id === id);
  if (!c || c.hp == null) return;
  const cap = c.maxHp == null ? Infinity : c.maxHp;
  c.hp = Math.max(0, Math.min(cap, (c.hp || 0) + delta));
  updateInitiativeUI();
  broadcastState();
}

function setTurnToId(id) {
  const idx = sortedCombatants().findIndex((c) => c.id === id);
  if (idx >= 0) {
    state.initiative.turn = idx;
    updateInitiativeUI();
    broadcastState();
  }
}

function stepInitiative(dir) {
  const list = sortedCombatants();
  if (!list.length) return;
  let turn = state.initiative.turn + dir;
  let round = state.initiative.round;
  if (turn >= list.length) {
    turn = 0;
    round += 1;
  } else if (turn < 0) {
    turn = list.length - 1;
    round = Math.max(1, round - 1);
  }
  state.initiative.turn = turn;
  state.initiative.round = round;
  updateInitiativeUI();
  broadcastState();
}

function resetInitiative() {
  state.initiative.round = 1;
  state.initiative.turn = 0;
  updateInitiativeUI();
  broadcastState();
}

function updateInitiativeUI() {
  if (!isPlayer) renderInitiativePanel();
  renderInitiativeOverlay();
}

function renderInitiativePanel() {
  const init = state.initiative;
  // Visibility is driven by the grid column width (the `has-initiative` class), which
  // animates open/shut — so we don't toggle the `hidden` attribute here.
  shell.classList.toggle("has-initiative", init.active);
  controls.initToggle?.classList.toggle("active", init.active);
  if (controls.initShowPlayers) controls.initShowPlayers.checked = init.showPlayers;
  if (controls.initShowOverlay) controls.initShowOverlay.checked = init.showOverlay !== false;
  if (controls.initRoundLabel) controls.initRoundLabel.textContent = `Round ${init.round}`;
  if (!controls.initList) return;
  const list = sortedCombatants();
  controls.initList.innerHTML = list
    .map((c, i) => {
      const pct = c.maxHp > 0 ? Math.max(0, Math.min(100, ((c.hp || 0) / c.maxHp) * 100)) : 0;
      return `<div class="init-row${i === init.turn ? " current" : ""}" data-id="${c.id}">
        <div class="init-row-top">
          <span class="init-dot ${c.type}"></span>
          <button type="button" class="init-name" data-act="set-turn" title="Set as current turn">${escapeHtml(c.name)}</button>
          <input class="init-init" type="number" data-field="init" value="${c.init}" title="Initiative">
          <button type="button" class="init-remove" data-act="remove" title="Remove" aria-label="Remove">&times;</button>
        </div>
        <div class="init-hp-line">
          <button type="button" class="init-hp-step" data-act="hp-down" title="Damage 1" aria-label="Damage">&minus;</button>
          <div class="init-hp-bar"><span style="width:${pct}%"></span></div>
          <input class="init-hp-input" type="number" data-field="hp" value="${c.hp ?? ""}" placeholder="–" title="Current HP">
          <span class="init-hp-max">/ ${c.maxHp ?? "–"}</span>
          <button type="button" class="init-hp-step" data-act="hp-up" title="Heal 1" aria-label="Heal">+</button>
        </div>
      </div>`;
    })
    .join("");
  if (!list.length) {
    controls.initList.innerHTML = '<p class="hint">No characters yet. Add one below.</p>';
  }
}

function renderInitiativeOverlay() {
  const ov = controls.initiativeOverlay;
  if (!ov) return;
  const init = state.initiative;
  // The overlay is independent of the docked panel: it shows whenever its toggle is on
  // (GM toggle on the GM screen, players toggle on the player display), so it persists when
  // the panel is closed and the toggle has an immediate, visible effect when the panel is open.
  const show = init.combatants.length > 0 && (isPlayer ? init.showPlayers : init.showOverlay !== false);
  ov.hidden = !show;
  if (!show) return;
  const list = sortedCombatants();
  const rows = list
    .map((c, i) => {
      const hp = !isPlayer && c.hp != null ? ` <em>${c.hp}${c.maxHp != null ? `/${c.maxHp}` : ""}</em>` : "";
      return `<li class="${i === init.turn ? "current" : ""}"><span class="init-dot ${c.type}"></span><span class="init-ov-name">${escapeHtml(c.name)}</span>${hp}</li>`;
    })
    .join("");
  // GM gets turn arrows + a hide button in the header; the player just sees the round label.
  const head = isPlayer
    ? `<div class="init-ov-round">Round ${init.round}</div>`
    : `<div class="init-ov-head">
        <button type="button" class="init-ov-btn" data-act="ov-prev" title="Previous turn" aria-label="Previous turn">‹</button>
        <span class="init-ov-round">Round ${init.round}</span>
        <button type="button" class="init-ov-btn" data-act="ov-next" title="Next turn" aria-label="Next turn">›</button>
        <button type="button" class="init-ov-btn" data-act="ov-hide" title="Hide overlay" aria-label="Hide overlay">×</button>
      </div>`;
  ov.innerHTML = `${head}<ol>${rows}</ol>`;
}

// Hide/show the GM order overlay (the bottom-left box's × button and the GM toggle).
function setOverlayVisible(on) {
  state.initiative.showOverlay = on;
  if (controls.initShowOverlay) controls.initShowOverlay.checked = on;
  updateInitiativeUI();
  broadcastState();
}

/* ----------------------------- ping / measure ----------------------------- */

function triggerPing(native) {
  const color = "#d6a94d";
  addPing(native.x, native.y, color);
  if (!isPlayer) relay({ type: "ping", x: native.x, y: native.y, color });
}

function addPing(x, y, color) {
  pings.push({ x, y, color: color || "#d6a94d", start: performance.now() });
  ensurePingLoop();
}

function ensurePingLoop() {
  if (pingRaf) return;
  const tick = () => {
    pings = pings.filter((p) => performance.now() - p.start < PING_DURATION);
    render();
    if (pings.length) {
      pingRaf = requestAnimationFrame(tick);
    } else {
      pingRaf = 0;
    }
  };
  pingRaf = requestAnimationFrame(tick);
}

function drawPings() {
  if (!pings.length) return;
  const now = performance.now();
  ctx.save();
  pings.forEach((ping) => {
    const t = (now - ping.start) / PING_DURATION;
    const screen = nativeToScreen(ping);
    const radius = 8 + t * 46;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.strokeStyle = ping.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

// Draw a dashed measure segment between two native points (called inside the map transform).
function drawMeasureSegment(start, end) {
  ctx.save();
  ctx.strokeStyle = "rgba(214,169,77,0.95)";
  ctx.lineWidth = 2 / (curK * curMs);
  ctx.setLineDash([8 / (curK * curMs), 6 / (curK * curMs)]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  [start, end].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 / (curK * curMs), 0, Math.PI * 2);
    ctx.fillStyle = "#d6a94d";
    ctx.fill();
  });
  ctx.restore();
}

function drawMeasureLine() {
  drawMeasureSegment(measureLine.start, measureLine.end);
}

// Squares a movement path covers, using the D&D 5e "alternating" diagonal rule: every other
// diagonal step costs 2. The diagonal counter runs across the whole path (it "repeats at the
// beginning" as you keep going), and each segment is counted cell-by-cell so corners are exact.
function pathSquares(path) {
  const ms = state.map.scale || 1;
  const cellW = measureCellWorld();
  if (cellW <= 0 || !path || path.length < 2) return 0;
  let diagCount = 0;
  let squares = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = Math.round((Math.abs(path[i].x - path[i - 1].x) * ms) / cellW);
    const dy = Math.round((Math.abs(path[i].y - path[i - 1].y) * ms) / cellW);
    const diag = Math.min(dx, dy);
    squares += Math.abs(dx - dy); // orthogonal portion of the segment
    for (let d = 0; d < diag; d++) {
      diagCount++;
      squares += diagCount % 2 === 1 ? 1 : 2;
    }
  }
  return squares;
}

function moveDistanceLabel(squares) {
  const unit = MEASURE_UNITS[state.measure.unit] || MEASURE_UNITS.imperial;
  const dist = squares * unit.perCell;
  const distStr = state.measure.unit === "metric" ? dist.toFixed(1) : String(Math.round(dist));
  return `${squares} sq · ${distStr} ${unit.label}`;
}

// The path to display for the selected token: the committed cells, plus a live segment to the
// current (snapped) cell while it's being mouse-dragged.
function effectiveTokenPath() {
  if (isPlayer || !selectedToken || !tokenPath) return null;
  if (draggingToken === selectedToken && tokenDragMoved) {
    const cur = snapNative({ x: selectedToken.x, y: selectedToken.y });
    const last = tokenPath[tokenPath.length - 1];
    if (cur.x !== last.x || cur.y !== last.y) return [...tokenPath, cur];
  }
  return tokenPath;
}

// Draw the route a selected token has travelled (GM only): a ghost ring at the start, the
// dashed polyline through each waypoint, and dots at the corners.
function drawTokenMovePath() {
  const path = effectiveTokenPath();
  if (!path || path.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(path[0].x, path[0].y, tokenRadius(selectedToken), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(214,169,77,0.5)";
  ctx.lineWidth = 2 / (curK * curMs);
  ctx.setLineDash([6 / (curK * curMs), 5 / (curK * curMs)]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.strokeStyle = "rgba(214,169,77,0.95)";
  ctx.lineWidth = 2 / (curK * curMs);
  ctx.setLineDash([8 / (curK * curMs), 6 / (curK * curMs)]);
  ctx.stroke();
  ctx.setLineDash([]);
  path.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5 / (curK * curMs), 0, Math.PI * 2);
    ctx.fillStyle = "#d6a94d";
    ctx.fill();
  });
  ctx.restore();
}

// Eight-way orientation movers around the selected token. Drawn at a constant screen distance
// in each grid direction (so they follow the map's rotation), and clicked to step one cell.
const ORIENTATION_DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

function orientationArrowPositions() {
  if (!selectedToken) return [];
  const cell = gridCellNative() || 70;
  const base = nativeToScreen({ x: selectedToken.x, y: selectedToken.y });
  const radius = tokenRadius(selectedToken) * curK * curMs + 24;
  return ORIENTATION_DIRS.map(({ dx, dy }) => {
    const off = nativeToScreen({ x: selectedToken.x + dx * cell, y: selectedToken.y + dy * cell });
    let sx = off.x - base.x;
    let sy = off.y - base.y;
    const len = Math.hypot(sx, sy) || 1;
    sx /= len;
    sy /= len;
    return { dx, dy, sx, sy, x: base.x + sx * radius, y: base.y + sy * radius };
  });
}

function hitOrientationArrow(screenPt) {
  if (!selectedToken) return null;
  for (const a of orientationArrowPositions()) {
    if (Math.hypot(screenPt.x - a.x, screenPt.y - a.y) <= 14) return a;
  }
  return null;
}

function drawOrientationArrows() {
  const arrows = orientationArrowPositions();
  if (!arrows.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  arrows.forEach((a) => {
    ctx.beginPath();
    ctx.arc(a.x, a.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12,13,13,0.82)";
    ctx.fill();
    ctx.strokeStyle = "#b1c301";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(a.sy, a.sx));
    ctx.beginPath();
    ctx.moveTo(-3, -4);
    ctx.lineTo(4, 0);
    ctx.lineTo(-3, 4);
    ctx.strokeStyle = "#c6fff1";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}

// World px that represent one cell for measurement: the live grid when it's on, else the
// calibrated size (from "measure one square"), else the grid size as a fallback.
function measureCellWorld() {
  if (state.grid.enabled && state.grid.size > 0) return state.grid.size;
  if (state.measure.cellSize > 0) return state.measure.cellSize;
  return state.grid.size > 0 ? state.grid.size : 0;
}

function measureLabelText(start, end) {
  const ms = state.map.scale || 1;
  const worldDist = Math.hypot((end.x - start.x) * ms, (end.y - start.y) * ms);
  const cellW = measureCellWorld();
  const cells = cellW > 0 ? worldDist / cellW : 0;
  const unit = MEASURE_UNITS[state.measure.unit] || MEASURE_UNITS.imperial;
  const dist = cells * unit.perCell;
  const distStr = state.measure.unit === "metric" ? dist.toFixed(1) : String(Math.round(dist));
  return `${cells.toFixed(1)} cells · ${distStr} ${unit.label}`;
}

// Screen-space distance label centred on a native segment (called after the map transform).
function drawMeasureLabelAt(start, end, labelOverride) {
  const label = labelOverride || measureLabelText(start, end);
  const mid = nativeToScreen({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  ctx.save();
  ctx.font = "600 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padding = 6;
  const width = ctx.measureText(label).width + padding * 2;
  ctx.fillStyle = "rgba(12,13,13,0.85)";
  ctx.fillRect(mid.x - width / 2, mid.y - 24, width, 20);
  ctx.fillStyle = "#f4e8c8";
  ctx.fillText(label, mid.x, mid.y - 14);
  ctx.restore();
}

function drawMeasureLabel() {
  drawMeasureLabelAt(measureLine.start, measureLine.end);
}

function drawTokenMoveLabel() {
  const path = effectiveTokenPath();
  if (!path || path.length < 2) return;
  const label = moveDistanceLabel(pathSquares(path));
  const end = path[path.length - 1];
  const s = nativeToScreen(end);
  // Sit clearly above the orientation-arrow ring (token radius + arrow offset + arrow size)
  // so the arrows never cover the readout.
  const yOff = -(tokenRadius(selectedToken) * curK * curMs + 50);
  ctx.save();
  ctx.font = "600 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(label).width + 12;
  ctx.fillStyle = "rgba(12,13,13,0.85)";
  ctx.fillRect(s.x - width / 2, s.y + yOff - 10, width, 20);
  ctx.fillStyle = "#f4e8c8";
  ctx.fillText(label, s.x, s.y + yOff);
  ctx.restore();
}

function appendTokenPath(cell) {
  if (!tokenPath) {
    tokenPath = [{ x: cell.x, y: cell.y }];
    return;
  }
  const last = tokenPath[tokenPath.length - 1];
  if (cell.x !== last.x || cell.y !== last.y) tokenPath.push({ x: cell.x, y: cell.y });
}

// Step the selected token one cell in a grid direction (orientation arrows / arrow keys),
// recording the move in its path.
function moveSelectedTokenByCell(dx, dy) {
  if (!selectedToken) return;
  const cell = gridCellNative();
  pushHistory();
  selectedToken.x += dx * cell;
  selectedToken.y += dy * cell;
  const snapped = snapNative(selectedToken);
  selectedToken.x = snapped.x;
  selectedToken.y = snapped.y;
  appendTokenPath(snapped);
  renderAndSync();
}

/* ----------------------------- pointer input ----------------------------- */

function onPointerDown(event) {
  lastPointer = { clientX: event.clientX, clientY: event.clientY };

  // Player display: view-only, fully driven by the GM.
  if (isPlayer) return;

  // Middle-mouse drags the map in ANY tool, so you can reposition the view without
  // switching tools or accidentally dropping fog.
  if (event.button === 1 && state.imageData) {
    event.preventDefault();
    isDragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    viewStart = { cx: state.view.cx, cy: state.view.cy };
    capturePointer(event.pointerId);
    return;
  }

  if (event.button === 2) return; // right-click handled by contextmenu

  const native = toNativePoint(event);

  // Calibration drag (set grid size / measure scale by drawing one square) takes priority.
  if (calibrating) {
    calibrationDraft = { start: native, end: native };
    isDragging = true;
    capturePointer(event.pointerId);
    render();
    return;
  }

  if (event.altKey) {
    triggerPing(native);
    return;
  }

  if (mode === "stamp") {
    stampDraft = { shape: state.fog.stampShape, start: native, end: native };
    isDragging = true;
    capturePointer(event.pointerId);
    render();
    return;
  }

  if (mode === "aoe") {
    if (!state.imageData) return;
    placeAoeMarker(toNativePoint(event));
    return;
  }

  if (mode === "polygon" || mode === "namedPolygon") {
    drawingRoom.push(native);
    render();
    return;
  }

  if (mode === "token") {
    const hit = hitToken(native);
    if (hit) {
      draggingToken = hit;
      tokenDragMoved = false;
      isDragging = true;
      capturePointer(event.pointerId);
    } else {
      addToken(native);
    }
    return;
  }

  if (mode === "stair") {
    if (state.floors.length < 2) {
      window.alert("Add a second floor first.");
      return;
    }
    promptStairPlacement(native);
    return;
  }

  // In Move mode: click a token to select it and drag to move it, a note or image to
  // select+drag it, or a stair to jump floors. Clicking empty space clears selection and pans.
  if (mode === "pan") {
    // Clicking an orientation arrow steps the selected token one cell that way.
    if (selectedToken) {
      const arrow = hitOrientationArrow(clientToCanvasPoint(event));
      if (arrow) {
        moveSelectedTokenByCell(arrow.dx, arrow.dy);
        return;
      }
    }
    const token = hitToken(native);
    if (token) {
      // Selecting a different token starts a fresh movement path; re-grabbing the same one
      // (e.g. to drag it) keeps the path it already has.
      if (selectedToken !== token) {
        selectedToken = token;
        tokenPath = [{ x: token.x, y: token.y }];
      }
      selectedImage = selectedNote = selectedAoeMarker = null;
      updateSelectionPanels();
      draggingToken = token;
      tokenDragMoved = false;
      isDragging = true;
      capturePointer(event.pointerId);
      render();
      return;
    }
    const note = hitNote(clientToCanvasPoint(event));
    if (note) {
      pushHistory();
      selectedNote = note;
      selectedToken = selectedImage = selectedAoeMarker = null;
      draggingNote = note;
      dragGrab = { dx: note.x - native.x, dy: note.y - native.y };
      isDragging = true;
      capturePointer(event.pointerId);
      updateSelectionPanels();
      render();
      return;
    }
    const image = hitImage(native);
    if (image) {
      pushHistory();
      selectedImage = image;
      selectedToken = selectedNote = selectedAoeMarker = null;
      draggingImage = image;
      dragGrab = { dx: image.x - native.x, dy: image.y - native.y };
      isDragging = true;
      capturePointer(event.pointerId);
      updateSelectionPanels();
      render();
      return;
    }
    const stair = hitStair(native);
    if (stair) {
      const idx = state.floors.findIndex((f) => f.id === stair.targetFloorId);
      if (idx !== -1) goToFloor(idx);
      return;
    }
    const aoeMarker = hitAoeMarker(native);
    if (aoeMarker) {
      selectedAoeMarker = aoeMarker;
      selectedToken = selectedImage = selectedNote = null;
      tokenPath = null;
      updateSelectionPanels();
      render();
      return;
    }
    // Dragging the red player-view frame pans the player display in real time.
    const frame = playerFrameCorners();
    if (frame && pointInPolygon(clientToCanvasPoint(event), frame)) {
      startFrameDrag(native, event.pointerId);
      return;
    }
    if (selectedToken || selectedImage || selectedNote || selectedAoeMarker) {
      selectedToken = selectedImage = selectedNote = selectedAoeMarker = null;
      tokenPath = null;
      updateSelectionPanels();
      render();
    }
  }

  if (mode === "measure") {
    measureLine = { start: native, end: native };
    isDragging = true;
    capturePointer(event.pointerId);
    render();
    relay({ type: "measure", line: measureLine });
    return;
  }

  if (mode === "brush" || mode === "eraser") {
    pushHistory();
    activeStroke = {
      id: uuid(),
      kind: mode === "eraser" ? "erase" : "paint",
      shape: state.fog.toolShape,
      size: state.fog.toolSize,
      points: [native],
    };
    isDragging = true;
    capturePointer(event.pointerId);
    render();
    return;
  }

  // pan
  if (!state.imageData) return;
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  viewStart = { cx: state.view.cx, cy: state.view.cy };
  capturePointer(event.pointerId);
}

function onPointerMove(event) {
  lastPointer = { clientX: event.clientX, clientY: event.clientY };

  // Player display is view-only.
  if (isPlayer) return;

  if (!isDragging) {
    if (["brush", "eraser"].includes(mode)) render(); // live tool preview
    if (mode === "aoe" && state.imageData) {
      const native = toNativePoint(event);
      aoeTemplate.x = native.x;
      aoeTemplate.y = native.y;
      aoeTemplate.visible = true;
      renderAndSyncView();
    }
    // Hint that the player-view frame can be dragged.
    if (mode === "pan" && state.imageData) {
      const frame = playerFrameCorners();
      canvas.style.cursor = frame && pointInPolygon(clientToCanvasPoint(event), frame) ? "move" : "";
    }
    return;
  }

  if (calibrationDraft) {
    calibrationDraft.end = toNativePoint(event);
    render();
    return;
  }

  if (stampDraft) {
    stampDraft.end = toNativePoint(event);
    render();
    return;
  }

  if (activeStroke) {
    const point = toNativePoint(event);
    const previous = activeStroke.points[activeStroke.points.length - 1];
    const spacing = Math.max(2, activeStroke.size / 4);
    addInterpolatedStrokePoints(activeStroke, previous, point, spacing);
    render();
    return;
  }

  if (draggingFrame) {
    const native = toNativePoint(event);
    state.playerView.cx = native.x + dragGrab.dx;
    state.playerView.cy = native.y + dragGrab.dy;
    syncPlayerViewControls();
    renderAndSyncView(); // pans the player display live
    return;
  }

  if (draggingToken) {
    if (!tokenDragMoved) {
      pushHistory(); // first movement of this drag — record one undo step
      tokenDragMoved = true;
    }
    const native = toNativePoint(event);
    draggingToken.x = native.x;
    draggingToken.y = native.y;
    render(); // local only; players get the token's final position on drop
    return;
  }

  if (draggingImage) {
    const native = toNativePoint(event);
    draggingImage.x = native.x + dragGrab.dx;
    draggingImage.y = native.y + dragGrab.dy;
    render();
    return;
  }

  if (draggingNote) {
    const native = toNativePoint(event);
    draggingNote.x = native.x + dragGrab.dx;
    draggingNote.y = native.y + dragGrab.dy;
    render();
    return;
  }

  if (measureLine) {
    measureLine.end = toNativePoint(event);
    render();
    relay({ type: "measure", line: measureLine });
    return;
  }

  // pan — un-rotate the screen-space drag delta into native coords
  const t = viewTransform();
  const ddx = event.clientX - dragStart.x;
  const ddy = event.clientY - dragStart.y;
  const cos = Math.cos(-t.rot);
  const sin = Math.sin(-t.rot);
  const s = t.k * t.ms;
  state.view.cx = viewStart.cx - (ddx * cos - ddy * sin) / s;
  state.view.cy = viewStart.cy - (ddx * sin + ddy * cos) / s;
  if (state.playerView.matchDM) {
    state.playerView.cx = state.view.cx;
    state.playerView.cy = state.view.cy;
    syncPlayerViewControls();
  }
  renderAndSyncView();
}

function onPointerUp(event) {
  if (isPlayer) {
    isDragging = false;
    return;
  }

  if (calibrationDraft) {
    finishCalibration();
    releasePointer(event.pointerId);
    isDragging = false;
    return;
  }

  if (stampDraft) {
    const points = stampPolygon(stampDraft.shape, stampDraft.start, stampDraft.end);
    stampDraft = null;
    if (points) {
      pushHistory();
      state.fog.rooms.push({ id: uuid(), points, revealed: false, name: "" });
      fogDirty = true;
      renderAndSync();
    } else {
      render();
    }
  }

  if (activeStroke) {
    state.fog.strokes.push(activeStroke);
    activeStroke = null;
    fogDirty = true; // re-bake the freeform layer so the committed stroke composites correctly
    renderAndSync();
  }

  if (draggingToken) {
    if (tokenDragMoved) {
      const snapped = snapNative({ x: draggingToken.x, y: draggingToken.y });
      draggingToken.x = snapped.x;
      draggingToken.y = snapped.y;
      // A mouse move adds a waypoint to the selected token's path (so the readout continues).
      if (selectedToken === draggingToken) appendTokenPath(snapped);
      renderAndSync();
    }
    draggingToken = null;
    tokenDragMoved = false;
  }

  if (draggingImage) {
    const snapped = snapImage({ x: draggingImage.x, y: draggingImage.y });
    draggingImage.x = snapped.x;
    draggingImage.y = snapped.y;
    draggingImage = null;
    renderAndSync(); // sync the moved image to players
  }

  if (draggingNote) {
    draggingNote = null;
    render(); // notes are GM-only
  }

  if (draggingFrame) {
    draggingFrame = false;
    renderAndSync(); // persist the player view position
  }

  if (measureLine && mode === "measure") {
    measureLine = null;
    render();
    relay({ type: "measure", line: null });
  }

  if (isDragging) {
    releasePointer(event.pointerId);
    broadcastState();
  }
  isDragging = false;
}

function onWheel(event) {
  if (!state.imageData) return;

  // The player display is view-only; the GM drives its framing.
  if (isPlayer) return;

  // Rotate cone when in AoE mode (don't zoom)
  if (mode === "aoe" && aoeShape === "cone") {
    event.preventDefault();
    aoeAngle += event.deltaY < 0 ? -0.1 : 0.1;
    if (controls.aoeAngleSlider) {
      const deg = ((aoeAngle * 180 / Math.PI) % 360 + 360) % 360;
      controls.aoeAngleSlider.value = Math.round(deg);
    }
    renderAndSyncView();
    return;
  }

  event.preventDefault();
  const p = clientToCanvasPoint(event);
  const before = screenToNative(p);
  const zoom = event.deltaY < 0 ? 1.08 : 0.92;
  state.view.scale = Math.min(16, Math.max(0.02, state.view.scale * zoom));
  // Recompute the center so the point under the cursor stays put (rotation-aware).
  const t = viewTransform();
  const s = t.k * t.ms;
  const ox = p.x - t.centerX;
  const oy = p.y - t.centerY;
  const cos = Math.cos(-t.rot);
  const sin = Math.sin(-t.rot);
  state.view.cx = before.x - (ox * cos - oy * sin) / s;
  state.view.cy = before.y - (ox * sin + oy * cos) / s;
  if (state.playerView.matchDM) {
    state.playerView.scale = state.view.scale;
    state.playerView.cx = state.view.cx;
    state.playerView.cy = state.view.cy;
    syncPlayerViewControls();
  }
  renderAndSyncView();
}

function onDoubleClick(event) {
  if (isPlayer) {
    toggleFullscreen();
    return;
  }
  const native = toNativePoint(event);
  const aoeMarker = hitAoeMarker(native);
  if (aoeMarker) {
    editAoeMarkerLabel(aoeMarker);
    return;
  }
  const note = hitNote(clientToCanvasPoint(event));
  if (note) {
    editNote(note);
    return;
  }
  if (mode === "polygon" || mode === "namedPolygon") finishRoom();
}

function onContextMenu(event) {
  if (isPlayer) return;
  event.preventDefault();
  const native = toNativePoint(event);
  const aoeMarker = hitAoeMarker(native);
  if (aoeMarker) {
    pushHistory();
    if (aoeMarker === selectedAoeMarker) { selectedAoeMarker = null; updateSelectionPanels(); }
    state.aoeMarkers = state.aoeMarkers.filter((m) => m !== aoeMarker);
    renderAndSync();
    return;
  }
  const note = hitNote(clientToCanvasPoint(event));
  if (note) {
    pushHistory();
    if (note === selectedNote) { selectedNote = null; updateSelectionPanels(); }
    state.notes = state.notes.filter((n) => n !== note);
    render();
    return;
  }
  deleteTokenOrRoom(native);
}

function onKeyDown(event) {
  if (isPlayer) {
    if (event.key === "f" || event.key === "F") toggleFullscreen();
    return;
  }

  if (event.key === "Escape" && isFogRibbonOpen()) {
    closeFogRibbon();
    return;
  }
  if (event.target?.matches?.("input, button, textarea, select")) return;

  const drawingPolygon = mode === "polygon" || mode === "namedPolygon";
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === "z") {
    event.preventDefault();
    // While placing a polygon, Ctrl+Z removes just the last point you dropped,
    // so a single misclick doesn't scrap the whole shape (or earlier committed work).
    if (!event.shiftKey && drawingPolygon && drawingRoom.length) {
      drawingRoom.pop();
      render();
      return;
    }
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (ctrl && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }

  // Backspace also removes the last placed polygon point (intuitive while drawing).
  if ((event.key === "Backspace" || event.key === "Delete") && drawingPolygon && drawingRoom.length) {
    event.preventDefault();
    drawingRoom.pop();
    render();
    return;
  }

  // A selected token (Move mode) nudges one grid cell per arrow press, snapped to grid.
  if (selectedToken && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    nudgeSelectedToken(event.key);
    return;
  }
  if (selectedToken && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    pushHistory();
    state.tokens = state.tokens.filter((t) => t !== selectedToken);
    selectedToken = null;
    tokenPath = null;
    renderAndSync();
    return;
  }
  if (selectedImage && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    pushHistory();
    state.images = state.images.filter((im) => im !== selectedImage);
    selectedImage = null;
    updateSelectionPanels();
    renderAndSync();
    return;
  }
  if (selectedNote && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    pushHistory();
    state.notes = state.notes.filter((n) => n !== selectedNote);
    selectedNote = null;
    render(); // notes are GM-only
    return;
  }
  if (selectedAoeMarker && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    pushHistory();
    state.aoeMarkers = state.aoeMarkers.filter((m) => m !== selectedAoeMarker);
    selectedAoeMarker = null;
    updateSelectionPanels();
    renderAndSync();
    return;
  }
  if (event.key === "Enter" && drawingPolygon) {
    event.preventDefault();
    finishRoom();
    return;
  }
  if (event.key === "Escape" && drawingPolygon && drawingRoom.length) {
    event.preventDefault();
    drawingRoom = [];
    render();
    return;
  }

  // Pan the map with the arrow keys when nothing is selected (handy on a trackpad).
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const step = 90;
    const delta = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key];
    nudgeView(delta[0], delta[1]);
    return;
  }
  // Zoom with + / - (and = / _), about the centre of the view.
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomView(1.12);
    return;
  }
  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomView(1 / 1.12);
    return;
  }

  const shortcuts = { v: "pan", h: "pan", p: "polygon", n: "namedPolygon", b: "brush", e: "eraser", t: "token", a: "aoe", m: "measure", s: "stair" };
  const key = event.key.toLowerCase();
  if (shortcuts[key]) {
    setMode(shortcuts[key]);
    return;
  }
  if (key === "f") fitMap(true);
  if (key === "[") adjustBrush(-10);
  if (key === "]") adjustBrush(10);
}

// Keyboard pan/zoom (trackpad-friendly). Pan nudges the view by a screen-space step
// (rotation-aware); zoom keeps the view centre fixed.
function nudgeView(dxScreen, dyScreen) {
  if (!state.imageData) return;
  const t = viewTransform();
  const s = t.k * t.ms;
  const cos = Math.cos(-t.rot);
  const sin = Math.sin(-t.rot);
  state.view.cx += (dxScreen * cos - dyScreen * sin) / s;
  state.view.cy += (dxScreen * sin + dyScreen * cos) / s;
  if (state.playerView.matchDM) {
    state.playerView.cx = state.view.cx;
    state.playerView.cy = state.view.cy;
    syncPlayerViewControls();
  }
  renderAndSyncView();
}

function zoomView(factor) {
  if (!state.imageData) return;
  state.view.scale = Math.min(16, Math.max(0.02, state.view.scale * factor));
  if (state.playerView.matchDM) {
    state.playerView.scale = state.view.scale;
    syncPlayerViewControls();
  }
  renderAndSyncView();
}

function adjustBrush(delta) {
  if (!["brush", "eraser"].includes(mode)) return;
  const next = Math.min(Number(controls.brushSize.max), Math.max(Number(controls.brushSize.min), state.fog.toolSize + delta));
  state.fog.toolSize = next;
  controls.brushSize.value = next;
  render();
}

function finishRoom() {
  if (isPlayer || drawingRoom.length < 3) return;
  pushHistory();
  const room = {
    id: uuid(),
    points: drawingRoom.map((point) => ({ ...point })),
    revealed: false,
    name: "",
  };
  state.fog.rooms.push(room);
  drawingRoom = [];
  fogDirty = true;
  renderAndSync();
  if (mode === "namedPolygon") {
    // Defer one tick so the Enter keypress that finished the polygon can't also submit the dialog.
    setTimeout(() => promptRoomName(room), 0);
  }
}

// GM-only: ask for a name for a freshly placed fog area. The name rides along in state
// (so it survives save/undo) but is only ever drawn on the GM screen.
function promptRoomName(room) {
  if (!controls.nameDialog || !controls.roomNameInput) return;
  controls.roomNameInput.value = room.name || "";
  controls.nameDialog.returnValue = "";
  controls.nameDialog.addEventListener(
    "close",
    () => {
      if (controls.nameDialog.returnValue === "save") {
        room.name = controls.roomNameInput.value.trim();
      }
      render();
      broadcastState();
    },
    { once: true },
  );
  controls.nameDialog.showModal();
  controls.roomNameInput.focus();
  controls.roomNameInput.select();
}

// Build a polygon (in native coords) for a drag-drawn fog stamp. Shapes become regular
// rooms, so they reveal, get outlines/names, undo, and delete just like polygon areas.
// "square" and "circle" force an equal-sided bounding box following the drag direction.
function stampPolygon(shape, a, b) {
  let x0 = Math.min(a.x, b.x);
  let y0 = Math.min(a.y, b.y);
  let x1 = Math.max(a.x, b.x);
  let y1 = Math.max(a.y, b.y);
  if (shape === "square" || shape === "circle") {
    const side = Math.max(x1 - x0, y1 - y0);
    const sx = b.x >= a.x ? 1 : -1;
    const sy = b.y >= a.y ? 1 : -1;
    x0 = Math.min(a.x, a.x + sx * side);
    x1 = Math.max(a.x, a.x + sx * side);
    y0 = Math.min(a.y, a.y + sy * side);
    y1 = Math.max(a.y, a.y + sy * side);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return null; // ignore stray clicks
  if (shape === "rectangle" || shape === "square") {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  if (shape === "triangle") {
    return [
      { x: (x0 + x1) / 2, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  // ellipse / circle, approximated as a 64-gon
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = w / 2;
  const ry = h / 2;
  const points = [];
  const segments = 64;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

function addInterpolatedStrokePoints(stroke, from, to, spacing) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(distance / spacing));
  for (let index = 1; index <= steps; index++) {
    stroke.points.push({ x: from.x + (dx * index) / steps, y: from.y + (dy * index) / steps });
  }
}

/* ----------------------------- misc ----------------------------- */

function loadImage(src, afterLoad) {
  mapImage = new Image();
  mapImage.onload = afterLoad;
  mapImage.src = src;
}

function loadSplashImage(src, afterLoad) {
  splashImage = new Image();
  splashImage.onload = afterLoad;
  splashImage.src = src;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.();
  }
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

setup();
