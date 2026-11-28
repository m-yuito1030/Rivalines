import { StopLabels } from './app/stopLabels';
import { $, isTouch } from './app/dom';
import { initAuth } from './app/auth';
import { initI18n, locale, onLangChange, tr } from './i18n';
import { Toast } from './app/toast';
import { StationPicker } from './app/stationPicker';
import { BulldozeOptions } from './app/bulldozeOptions';
import { MoneyFloat, type ToScreen } from './app/moneyFloat';
import { PaxBadges } from './app/paxBadges';
import { bulldozeTargets } from './app/bulldozeTargets';
import { confirmDialog } from './ui/confirm';
import { FacilityPicker } from './app/facilityPicker';
import { AirportPicker } from './app/airportPicker';
import { Toolbar } from './app/toolbar';
import { PlayerMenu } from './app/playerMenu';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { Simulation, TICKS_PER_DAY } from '../shared/sim/simulation';
import { BASE, net } from './connection/net';
import { Mirror } from './connection/mirror';
import { Camera } from './render/camera';
import { ChunkRenderer, lodForZoom } from './render/chunkRenderer';
import { Minimap } from './ui/minimap';
import { ToolController, type Tool } from './ui/tools';
import type { Cmd, CmdResult, PlaceTool } from '../shared/protocol';
import { type FacilityType, planFacility, placeFacility } from '../shared/world/facilities';
import { RoutePanel } from './ui/routePanel';
import { loadBuildingSprites } from './render/buildingSprites';
import { loadStationSprites } from './render/stationSprites';
import { loadAirportSprites } from './render/airportSprites';
import { loadVehicleSprites } from './render/vehicleSprites';
import { StatsPanel } from './ui/statsPanel';
import { AnalysisPanel } from './ui/analysisPanel';
import { AuctionPanel } from './ui/auctionPanel';
import { ForSalePanel } from './ui/forSalePanel';
import { ConsultPanel } from './ui/consultPanel';
import { ForSaleLabels } from './app/forSaleLabels';
import { FinancePanel } from './ui/financePanel';
import { RankingPanel } from './ui/rankingPanel';
import { DiagramPanel } from './ui/diagramPanel';
import { ListPanel } from './ui/listPanel';
import type { CompanyRow } from '../shared/sim/economy/ranking';
import { WEATHER_ICON, WEATHER_NAME, eventsToday, isHoliday, weatherOf } from '../shared/sim/world/events';
import { START_TOD, DAY_TICKS } from '../shared/sim/network/transit';
import { CAT_LABEL, yen } from '../shared/sim/economy/economy';
import { ratingName } from '../shared/sim/economy/rating';
import { InfoPanel, type Selection, findSelection } from './ui/infoPanel';
import { findVehicle } from './ui/vehicleSelect';
import { TransitLayer } from './render/transitLayer';
import { ChatPanel } from './ui/chatPanel';
import { GovPanel } from './ui/govPanel';
import { NewsPanel } from './ui/newsPanel';
import { TownNewsPanel } from './ui/townNews';
import { FirstGuide } from './ui/guide';
import { ConstructionFx } from './render/constructionFx';
import { UndergroundView } from './render/undergroundView';
import { LEVEL_PX, SEA_LEVEL } from '../shared/world/constants';
import { TIERS, townTier } from '../shared/world/town';
import { placeAirport } from '../shared/world/airports';
import type { GameMap } from '../shared/world/gameMap';

initI18n();
initAuth(startGame);

/** Multiply color by time of day (0-24): blue and dark at night, warm at dawn and dusk */
const TINTS: [number, [number, number, number]][] = [
  [0, [78, 90, 140]],
  [5, [88, 100, 150]],
  [6.2, [255, 196, 160]],
  [7.8, [255, 242, 228]],
  [9, [255, 255, 255]],
  [16, [255, 255, 255]],
  [17.6, [255, 216, 172]],
  [19, [160, 146, 190]],
  [20.6, [86, 96, 146]],
  [24, [78, 90, 140]],
];
function tintOf(hour: number): number {
  for (let i = 1; i < TINTS.length; i++) {
    const [h1, c1] = TINTS[i];
    if (hour <= h1) {
      const [h0, c0] = TINTS[i - 1];
      const t = (hour - h0) / (h1 - h0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      // Quantize to reduce redrawing of the overlay
      return ((r & 0xfc) << 16) | ((g & 0xfc) << 8) | (b & 0xfc);
    }
  }
  return 0xffffff;
}
const pad = (n: number) => String(n).padStart(2, '0');

async function startGame(map: GameMap, sim: Simulation, mirror: Mirror, startAt: { x: number; y: number }, cam?: { x: number; y: number; zoom: number }): Promise<void> {
  await loadBuildingSprites();
  await loadVehicleSprites();
  await loadStationSprites();
  await loadAirportSprites();
  const app = new Application();
  await app.init({ resizeTo: window, background: '#0b1a2b', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2) });
  $('game').append(app.canvas);

  const chunks = new ChunkRenderer(map, { lowMem: isTouch });
  map.onTouch = (x, y) => chunks.markDirty(x, y);
  const worldRoot = new Container();
  worldRoot.addChild(chunks.container);
  app.stage.addChild(worldRoot);
  // Day/night tint (a multiply overlay). Above the world, below the labels/HUD. It follows the in-game time sent by the server (there is no switch)
  const tintLayer = new Graphics();
  tintLayer.blendMode = 'multiply';
  app.stage.addChild(tintLayer);
  let lastTint = -1;
  let lastW = 0;
  let lastH = 0;
  const labels = new Container();
  app.stage.addChild(labels);

  const camera = new Camera(worldRoot, app.canvas, map.size);
  if (cam) {
    camera.x = cam.x;
    camera.y = cam.y;
    camera.zoom = cam.zoom;
  } else {
    camera.centerOnTile(startAt.x, startAt.y);
    camera.zoom = 0.7;
  }

  const pick = (sx: number, sy: number) => {
    const w = camera.screenToWorld(sx, sy);
    let tile = Camera.worldToTile(w.x, w.y);
    for (let i = 0; i < 3; i++) {
      const lvl = map.inBounds(Math.floor(tile.x), Math.floor(tile.y)) ? map.levelAt(Math.floor(tile.x), Math.floor(tile.y)) : 0;
      tile = Camera.worldToTile(w.x, w.y + lvl * LEVEL_PX);
    }
    const x = Math.floor(tile.x);
    const y = Math.floor(tile.y);
    return map.inBounds(x, y) ? { x, y } : null;
  };

  const transit = sim.transit;
  const transitLayer = new TransitLayer(map, transit, app.renderer);
  worldRoot.addChild(transitLayer.g);
  const constructionFx = new ConstructionFx(map);
  worldRoot.addChild(constructionFx.g);

  let setToolRef: (t: Tool) => void = () => {};
  const panel = new RoutePanel(
    $('routes'),
    transit,
    () => sim.tick,
    () => setToolRef('route'),
    () => setToolRef('pan'),
    () => sim.company,
    (msg, error) => toast.show(msg, error),
  );
  const facOcc = (i: number) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!transit.depotAtTile(i % map.size, Math.floor(i / map.size));
  const stationPicker = new StationPicker();
  const bulldozeOptions = new BulldozeOptions();
  const facilityPicker = new FacilityPicker();
  const airportPicker = new AirportPicker();
  const toast = new Toast();
  /** Send an action to the server and show the result message */
  const run = async (cmd: Cmd): Promise<CmdResult> => {
    // Remember the place so the construction cost (a red minus) can be shown above where it was built
    if (cmd.t === 'place' || cmd.t === 'ensureStop') moneyFloat.setSpendAt(cmd.x + 0.5, cmd.y + 0.5);
    else if (cmd.t === 'build') moneyFloat.setSpendAt((cmd.a.x + cmd.b.x) / 2 + 0.5, (cmd.a.y + cmd.b.y) / 2 + 0.5);
    const r = await net.cmd(cmd);
    if (r.msg) toast.show(r.msg, !r.ok);
    return r;
  };
  const tools = new ToolController(map, camera, app.canvas, pick, (tool, tile) => {
    if (tool === 'route' && panel.inserting) {
      const ins = panel.inserting;
      const mode = transit.routes.get(ins.routeId)?.mode ?? 'road';
      void run({ t: 'ensureStop', x: tile.x, y: tile.y, kind: mode }).then((r) => {
        if (r.ok && r.id !== undefined) panel.completeInsert(r.id);
      });
    } else if (tool === 'route' && panel.building) {
      const b = panel.building;
      void run({ t: 'ensureStop', x: tile.x, y: tile.y, kind: b.kind }).then((r) => {
        if (r.ok && r.id !== undefined && b.stops[b.stops.length - 1] !== r.id) panel.addToBuild(r.id);
      });
    } else if (tool === 'subdepot') void run({ t: 'place', tool: 'depot', x: tile.x, y: tile.y, kind: 'rail' });
    else if (tool === 'station') void run({ t: 'place', tool, x: tile.x, y: tile.y, opts: { ...stationPicker.opts } });
    else if (tool !== 'route' && tool !== 'pan')
      void run({
        t: 'place',
        tool: tool as PlaceTool,
        x: tile.x,
        y: tile.y,
        ...(tool === 'airport' ? { air: { ...airportPicker.sel } } : {}),
        ...(FacilityPicker.choosable(tool) ? { fac: { ...facilityPicker.sel } } : {}),
      });
  });
  tools.remoteBuild = (tool, a, b) => {
    if ((tool as string) === 'bulldoze' || (tool as string) === 'subwaydel') {
      // In the underground view (and with the subway's own "Remove" tool) only the underground is demolished: the track, and the stations and depots on it
      const underOnly = (tool as string) === 'subwaydel' || underground.active;
      const kinds = underOnly
        ? { road: false, rail: false, signal: false, stop: true, depot: true, waypoint: false, span: false, building: false, airport: false, subway: true }
        : bulldozeOptions.kinds();
      const what = bulldozeTargets(map, transit, a, b, kinds, net.id, underOnly);
      const go = () => void run({ t: 'bulldoze', a, b, kinds, ...(underOnly ? { under: true } : {}) });
      // If it includes things that involve money or routes (stations, stops, depots, facilities, airports, ...), confirm before running it
      if (what.length === 0) go();
      else void confirmDialog(tr('次のものを撤去します: {parts}', { parts: what.join(tr('、')) }) + '\n' + tr('元に戻せません。よろしいですか?')).then((ok) => ok && go());
    } else if ((tool as string) === 'signalline') void run({ t: 'signalLine', a, b, interval: Number($<HTMLInputElement>('optSigInt').value) || 3 });
    else void run({ t: 'build', tool, a, b, ...(tool === 'subway' ? { z: [...tools.subwayZ] as [number, number] } : {}) });
  };
  tools.onMessage = (msg) => toast.show(msg);
  tools.facilityPlanner = (x, y, type) => facilityPicker.plan(map, x, y, type, facOcc);
  tools.airportSel = airportPicker;
  tools.stationPlanner = (x, y) => stationPicker.plan(map, x, y, (i) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)));
  const underground = new UndergroundView(map, chunks.container);
  let manualUnderground = false;
  let subwayToolOn = false;
  // The grey backdrop goes under the (see-through) terrain, the tunnels right above it (below stops and vehicles)
  worldRoot.addChildAt(underground.backdrop, 0);
  worldRoot.addChildAt(underground.tracks, 2);
  worldRoot.addChild(tools.overlay);

  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), map, (tx, ty) => camera.centerOnTile(tx, ty));
  // Show/hide the minimap at the bottom right (the setting is saved)
  let discAt = 0;
  const plan: { id: number; at: number; ver: number; drawn: string; data: { legs: number[][]; stops: number[] } | null } = { id: -1, at: 0, ver: 0, drawn: '', data: null };
  let showMap = localStorage.getItem('simulator-minimap') !== '0';
  const mapEl = $('minimap');
  const mapBtn = $('mapBtn');
  const applyMap = () => {
    mapEl.style.display = showMap ? '' : 'none';
    mapBtn.classList.toggle('on', showMap);
    mapBtn.textContent = showMap ? tr('🗺 マップを隠す (M)') : tr('🗺 マップを表示 (M)');
  };
  applyMap();
  onLangChange(applyMap);
  const toggleMap = () => {
    showMap = !showMap;
    localStorage.setItem('simulator-minimap', showMap ? '1' : '0');
    applyMap();
  };
  mapBtn.addEventListener('click', toggleMap);
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) toggleMap();
  });
  const stats = $('stats');
  // Tile coordinates -> screen coordinates (so the floating money numbers and boarding counts show above vehicles and facilities)
  const toScreen: ToScreen = (tx, ty) => {
    const w = Camera.tileToWorld(tx, ty);
    const W = app.canvas.clientWidth;
    const H = app.canvas.clientHeight;
    const x = (w.x - camera.x) * camera.zoom + W / 2;
    const y = (w.y - camera.y) * camera.zoom + H / 2;
    return x < -80 || y < -80 || x > W + 80 || y > H + 80 ? null : { x, y };
  };
  const moneyFloat = new MoneyFloat($('cash'), yen, toScreen);
  const paxBadges = new PaxBadges(transit, toScreen, () => camera.zoom);
  // Money earned by the company's own vehicles and facilities shows as a green plus above whatever earned it
  mirror.onEarn = (kind, id, amount) => {
    if (kind === 'veh') {
      const v = transit.vehicles.find((x) => x.id === id);
      if (!v) return;
      moneyFloat.earn(`v:${id}`, amount, tr(CAT_LABEL[`fare-${v.mode}`] ?? '運賃'), () => {
        const cur = transit.vehicles.find((x) => x.id === id);
        if (!cur) return null;
        const p = transit.position(cur);
        return { x: p.x + 0.5, y: p.y + 0.5 };
      });
    } else {
      const f = map.facilities.find((x) => x.id === id);
      if (f) moneyFloat.earn(`f:${id}`, amount, tr(CAT_LABEL.facility), () => ({ x: f.x0 + f.w / 2, y: f.y0 + f.h / 2 }));
    }
  };
  // The development display (FPS, drawing state, etc.) is normally hidden. It appears with Ctrl+Shift+D, or by adding ?debug=1 to the URL.
  // On a phone, tapping the clock at the top of the screen five times quickly also toggles it. The chosen state is remembered
  const DEBUG_KEY = 'rivalines-debug';
  const setDebug = (on: boolean) => {
    document.body.classList.toggle('debug', on);
    try {
      localStorage.setItem(DEBUG_KEY, on ? '1' : '0');
    } catch {
      /* it works even if saving fails */
    }
  };
  const qDebug = new URLSearchParams(location.search).get('debug');
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DEBUG_KEY);
  } catch {
    /* it works even if reading fails */
  }
  setDebug(qDebug !== null ? qDebug !== '0' : saved === '1');
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      setDebug(!document.body.classList.contains('debug'));
    }
  });
  let clockTaps: number[] = [];
  $('clock').addEventListener('click', () => {
    const now = performance.now();
    clockTaps = [...clockTaps.filter((t) => now - t < 2000), now];
    if (clockTaps.length >= 5) {
      clockTaps = [];
      setDebug(!document.body.classList.contains('debug'));
    }
  });
  let mmVersion = 0;
  let mmTime = 0;
  const clock = $('clock');
  let lastEventDay = -1;
  const ratingEl = $('rating');
  ratingEl.addEventListener('click', () => statsPanel.toggle());
  let mouse = { x: 0, y: 0 };
  const track = (e: PointerEvent) => (mouse = { x: e.clientX, y: e.clientY });
  app.canvas.addEventListener('pointermove', track);
  app.canvas.addEventListener('pointerdown', track);

  // Opening and closing the route panel (a bottom sheet on phones)
  const routesEl = $('routes');
  // The route panel starts closed (open it with "Routes"). On a PC too, so the screen has more room
  $('routesBtn').addEventListener('click', () => (routesWin.isOpen ? routesWin.close() : routesWin.open()));
  const routesWin = {
    get isOpen() {
      return routesEl.classList.contains('open');
    },
    open: () => routesEl.classList.add('open'),
    close: () => routesEl.classList.remove('open'),
  };
  panel.onClose = () => routesWin.close();

  const toolbar = new Toolbar();
  // When the language changes, also relabel the dropdown buttons
  onLangChange(() => toolbar.highlight(tools.tool));
  const setTool = (t: Tool) => {
    tools.setTool(t);
    stationPicker.setVisible(t === 'station');
    facilityPicker.setTool(t);
    airportPicker.setVisible(t === 'airport');
    $('signalOpts').hidden = t !== 'signalline';
    // Every subway tool shows the underground (and the how-to panel)
    const subwayTool = t === 'subway' || t === 'subwaydel' || t === 'portal' || t === 'substation' || t === 'subdepot';
    $('subwayOpts').hidden = !subwayTool;
    subwayToolOn = subwayTool;
    bulldozeOptions.setVisible(t === 'bulldoze');
    toolbar.highlight(t);
    if (t !== 'route' && (panel.building || panel.inserting)) panel.cancelBuild();
  };
  setToolRef = setTool;
  // Subway depth selectors (depth at the start and at the end of the line)
  const syncSubwayZ = () => {
    tools.subwayZ = [Number($<HTMLSelectElement>('optSubZ0').value) || 1, Number($<HTMLSelectElement>('optSubZ1').value) || 1];
  };
  $('optSubZ0').addEventListener('change', syncSubwayZ);
  $('optSubZ1').addEventListener('change', syncSubwayZ);
  document.querySelectorAll('.optx').forEach((b) => b.addEventListener('click', () => setTool('pan')));
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      if (isTouch) routesWin.close(); // phone: selecting a tool closes the route sheet
      setTool(b.dataset.tool as Tool);
    }),
  );
  // Underground view on / off: the button, and PageDown / PageUp
  const setUnderground = (on: boolean) => {
    manualUnderground = on;
    $('ugBtn').classList.toggle('on', on);
  };
  $('ugBtn').addEventListener('click', () => setUnderground(!manualUnderground));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'PageDown') setUnderground(true);
    else if (e.key === 'PageUp') setUnderground(false);
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'enter' && panel.building) panel.finishBuild();
    else if (k === 'b') setTool('stop');
    else if (k === 'l') setTool('rail');
    else if (k === 'k') setTool('station');
    else if (k === 'p') setTool('airport');
    else if (k === 'u') setTool('raise');
    else if (k === 'j') setTool('lower');
    else if (k === 'g') setTool('level');
    else if (k === 'v' || k === 'escape') setTool('pan');
    else if (k === 'r') setTool('road');
    else if (k === 'o') setTool('oneway');
    else if (k === 't') setTool('twoway');
    else if (k === 'x') setTool('bulldoze');
    else if (k === 'y') setTool('roadspan');
    else if (k === 'n') setTool('signal');
    else if (k === 'h') setTool('railspan');
  });

  // Town name labels (screen coordinates)
  const labelTexts = new Map<number, Text>();
  const stopLabels = new StopLabels(
    labels,
    transit,
    map,
    $('stopNameBtn'),
    () => underground.active,
    () => transitLayer.showAll,
  );
  const forSaleLabels = new ForSaleLabels(labels, map, () => sim.day);

  (window as unknown as Record<string, unknown>).__mp = { map, sim, camera, net, mirror };
  if (import.meta.env.DEV)
    (window as unknown as Record<string, unknown>).__game = {
      map,
      sim,
      camera,
      transitLayer,
      chunks,
      placeAirport,
      placeFacility: (type: FacilityType, x: number, y: number) => {
        const pl = planFacility(map, x, y, type, () => false);
        return pl.ok ? placeFacility(map, pl, type) : pl.reason;
      },
    };

  // Info for tapping a stop/town (with the move tool, released with almost no movement)
  const info = new InfoPanel(
    $('info'),
    map,
    transit,
    () => sim.tick,
    (x, y) => camera.centerOnTile(x, y),
    (msg) => tools.onMessage?.(msg),
    () => sim.company,
  );
  info.players = () => mirror.players;
  const infoPanel = info; // inside the per-frame code, `info` is shadowed by another variable name
  // Vehicle follow: the camera follows a vehicle. Moving the camera by hand or closing the info panel releases it
  let followId = -1;
  let followAt = { x: 0, y: 0 };
  infoPanel.onFollow = (id) => {
    followId = followId === id ? -1 : id;
    infoPanel.followId = followId;
    followAt = { x: camera.x, y: camera.y };
  };
  let down: { x: number; y: number; t: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 && !camera.multiTouch ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  app.canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.button !== 0 || tools.tool !== 'pan' || camera.multiTouch) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const tile = pick(e.clientX, e.clientY);
    // If a tile with a vehicle on it is pressed, the vehicle takes priority (its path is shown with arrows). Otherwise a stop, town, etc., and last a vehicle on a neighbouring tile
    const veh0 = tile ? findVehicle(transit, map.size, tile.x, tile.y, 0) : null;
    let sel: Selection | null = veh0 ? { kind: 'vehicle', id: veh0.id } : tile ? findSelection(map, transit, tile.x, tile.y) : null;
    if (!sel && tile) {
      const near = findVehicle(transit, map.size, tile.x, tile.y, 1);
      if (near) sel = { kind: 'vehicle', id: near.id };
    }
    if (sel) {
      if (isTouch) closeWindows(infoWin);
      info.show(sel);
    } else info.close();
  });

  // Statistics screen
  const statsPanel = new StatsPanel(
    $('stats-modal'),
    $('statsBody'),
    transit,
    () => map.towns,
    () => sim.rating,
    () => sim.migrated,
  );
  $('statsBtn').addEventListener('click', () => statsPanel.toggle());
  const anaPanel = new AnalysisPanel(
    $('analysis-modal'),
    $('anaBody'),
    transit,
    () => map.facilities,
    (x, y) => camera.centerOnTile(x, y),
    (m) => tools.onMessage?.(m),
  );
  $('anaBtn').addEventListener('click', () => anaPanel.toggle());
  const salePanel = new ForSalePanel(
    $('sale-modal'),
    $('saleBody'),
    map,
    () => sim.day,
    () => sim.company.cash,
    (x, y) => camera.centerOnTile(x, y),
    (m) => tools.onMessage?.(m),
  );
  $('saleBtn').addEventListener('click', () => salePanel.toggle());
  const consultPanel = new ConsultPanel(
    $('consult-modal'),
    $('consultBody'),
    () => sim.company,
    () => map.facilities,
    () => map.towns,
    transit,
    () => sim.rivals,
    () => sim.day,
    (x, y) => camera.centerOnTile(x, y),
    (m) => tools.onMessage?.(m),
  );
  $('consultBtn').addEventListener('click', () => consultPanel.toggle());
  const aucPanel = new AuctionPanel(
    $('auction-modal'),
    $('aucBody'),
    () => mirror.auctions,
    () => map.towns,
    () => mirror.players,
    (x, y) => camera.centerOnTile(x, y),
    (m) => tools.onMessage?.(m),
  );
  $('aucBtn').addEventListener('click', () => aucPanel.toggle());
  const finPanel = new FinancePanel(
    $('fin-modal'),
    $('finBody'),
    () => sim.company,
    map,
    transit,
    () => sim.rating,
    (msg) => tools.onMessage?.(msg),
    () => sim.rivals,
    () => sim.date,
    () => mirror.pacts,
    () => mirror.players,
  );
  $('finBtn').addEventListener('click', () => finPanel.toggle());
  sim.onFiscalClose = (r) => {
    tools.onMessage?.(
      tr('第{period}期決算({from}〜{to}): 当期純利益 {net}、法人税 {tax}、配当 {dividend}。経営画面(F)で決算書を確認できます', {
        period: r.period,
        from: r.from,
        to: r.to,
        net: yen(r.netIncome),
        tax: yen(r.tax),
        dividend: yen(r.dividend),
      }),
    );
  };
  const companyRows = (): CompanyRow[] => {
    const rows: CompanyRow[] = mirror.players.map((p) => ({
      name: p.id === net.id ? tr('自社({name})', { name: p.company }) : p.company,
      marketCap: p.marketCap,
      price: p.price,
      netWorth: p.netWorth,
      profit: p.profit,
      passengers: p.passengers,
      isPlayer: p.id === net.id,
      subsidiary: false,
    }));
    for (const r of sim.rivals)
      if (!r.acquired)
        rows.push({
          name: r.name,
          marketCap: r.value,
          price: r.value / 100000,
          netWorth: r.value * 0.8,
          profit: r.profit,
          passengers: r.passengers,
          isPlayer: false,
          subsidiary: false,
        });
    return rows.sort((a, b) => b.marketCap - a.marketCap);
  };
  const rankPanel = new RankingPanel(
    $('rank-modal'),
    $('rankBody'),
    companyRows,
    map,
    transit,
    () => mirror.weekly,
    () => mirror.players,
  );
  $('rankBtn').addEventListener('click', () => rankPanel.toggle());
  const diaPanel = new DiagramPanel(
    $('dia-modal'),
    $('diaBody'),
    transit,
    () => sim.tick,
    (m) => tools.onMessage?.(m),
  );
  $('diaBtn').addEventListener('click', () => diaPanel.toggle());
  const listPanel = new ListPanel(
    $('list-modal'),
    $('listBody'),
    map,
    transit,
    (x, y) => camera.centerOnTile(x, y),
    () => mirror.myVehicles,
  );
  $('listBtn').addEventListener('click', () => listPanel.toggle());
  $('rank').addEventListener('click', () => rankPanel.toggle());
  $('cash').addEventListener('click', () => finPanel.toggle());
  // Only one window on screen at a time: opening another closes the previous one
  // On phones the route sheet and the info panel also cover the screen, so they are included (on a PC they are always-visible side panels, so they are excluded)
  const infoWin = {
    get isOpen() {
      return info.isOpen;
    },
    open() {},
    close: () => info.close(),
  };
  // On a touch screen, the floating windows (tool options, route and info sheets, the guide) step aside while the map is being moved
  let panTimer = 0;
  camera.onGesture = (on) => {
    window.clearTimeout(panTimer);
    if (on) document.body.classList.add('panning');
    else panTimer = window.setTimeout(() => document.body.classList.remove('panning'), 250);
  };
  const windows: { isOpen: boolean; open(): void; close(): void }[] = [statsPanel, finPanel, rankPanel, diaPanel];
  const listWin = {
    get isOpen() {
      return listPanel.isOpen;
    },
    open() {},
    close: () => listPanel.close(),
  };
  windows.push(listWin);
  if (isTouch) windows.push(routesWin, infoWin);
  const closeWindows = (except?: unknown) => {
    for (const w of windows) if (w !== except && w.isOpen) w.close();
    if (except !== 'menu') playerMenu.close();
  };
  for (const w of windows) {
    if (w === infoWin) continue;
    const open = w.open.bind(w);
    w.open = () => {
      closeWindows(w);
      open();
    };
  }
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) finPanel.toggle();
    else if (e.key === 'Escape' && finPanel.isOpen) finPanel.close();
    else if (e.key === 'Escape' && rankPanel.isOpen) rankPanel.close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) statsPanel.toggle();
    else if (e.key === 'Escape' && statsPanel.isOpen) statsPanel.close();
    else if (e.key === 'Escape' && info.isOpen) info.close();
  });

  // Public chat and announcements (a red dot on the menu when there is a new message or announcement)
  const chatPanel = new ChatPanel(
    (m) => tools.onMessage?.(m),
    () => isTouch && closeWindows(),
  );
  const newsPanel = new NewsPanel();
  const townNews = new TownNewsPanel(() => mirror.news);
  window.setInterval(() => townNews.update(), 2000);
  // The first-steps card for a company that has no bus running yet, and the menu entries that bring it (and the manual) back
  const openManual = () => window.open(document.querySelector<HTMLAnchorElement>('a[data-legal=manual]')!.href, '_blank', 'noopener');
  const guide = new FirstGuide(transit, {
    stop: () => setTool('stop'),
    depot: () => setTool('depot'),
    routes: () => routesWin.open(),
    manual: openManual,
  });
  window.setInterval(() => guide.update(), 1500);
  $('guideBtn').addEventListener('click', () => guide.show());
  $('manualBtn').addEventListener('click', openManual);
  const govPanel = new GovPanel((m) => tools.onMessage?.(m));
  const showDots = () => {
    const news = newsPanel.hasUnread;
    $('menuBtn').classList.toggle('unread', news);
    document.querySelector('.ddbtn[data-fixed]')?.classList.toggle('unread', news || chatPanel.hasUnread);
  };
  document.addEventListener('rivalines:unread', showDots);
  const playerMenu = new PlayerMenu({ transit, players: () => mirror.players, notify: (m) => tools.onMessage?.(m), beforeOpen: () => closeWindows('menu') });

  $('verLine').textContent = `Rivalines v${__APP_VERSION__}`;
  // When playing in a world other than production (the next version), show a prominent mark on screen (because the data may be wiped)
  void fetch(`${BASE}api/status`)
    .then((r) => r.json())
    .then((s: { env?: { name: string; label: string; version: string } }) => {
      if (s.env && s.env.name !== 'live') $('verLine').textContent = `Rivalines v${__APP_VERSION__}-${s.env.name}`;
      if (!s.env || s.env.name === 'live') return;
      const b = $('envBadge');
      b.textContent = `🧪 ${tr('{label}(テスト・データは消えることがあります)', { label: s.env.label })}`;
      b.hidden = false;
      document.title = `Rivalines — ${s.env.label}`;
    })
    .catch(() => {});
  $('switchWorld').addEventListener('click', () => (location.href = new URL('../', location.href).href));

  $('start').hidden = true;
  $('hud').hidden = false;

  let uiAt = 0;
  let mmZoom = -1;
  let mmLeft = 0;
  let mmTop = 0;
  let perfSim = 0;
  let perfChunk = 0;
  let perfLayer = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  app.ticker.add((t) => {
    const dt = Math.min(0.1, t.deltaMS / 1000);
    const tA = performance.now();
    const tB = performance.now();
    transit.smoothMirror(); // smoothly interpolate the server's 10 Hz state to 60 fps
    paxBadges.update();
    moneyFloat.tick();
    const view = camera.update(dt);
    chunks.update(view);
    const tC = performance.now();
    tools.draw();
    {
      const d0 = sim.date;
      // It always follows the server's in-game time, except underground: there it is the same day and night (otherwise the subway view goes dark at night)
      const color = underground.active ? 0xffffff : tintOf(d0.hour + d0.minute / 60);
      const w0 = app.screen.width;
      const h0 = app.screen.height;
      if (color !== lastTint || w0 !== lastW || h0 !== lastH) {
        lastTint = color;
        lastW = w0;
        lastH = h0;
        tintLayer.clear().rect(0, 0, w0, h0).fill(color);
      }
    }
    transitLayer.draw(view, new Set(panel.building?.stops ?? []));
    constructionFx.draw(view, performance.now());
    // The underground is shown while a subway tool is selected, and also while a rail route is being made (so its subway stations can be clicked)
    const routeRail = panel.building?.kind === 'rail';
    underground.active = subwayToolOn || routeRail || manualUnderground;
    transitLayer.underground = underground.active;
    transitLayer.showAll = routeRail && !subwayToolOn;
    underground.draw(view);
    const tD = performance.now();
    perfSim = perfSim * 0.9 + (tB - tA) * 0.1;
    perfChunk = perfChunk * 0.9 + (tC - tB) * 0.1;
    perfLayer = perfLayer * 0.9 + (tD - tC) * 0.1;
    // Throttle numeric display updates (DOM) to 4 Hz. Structural changes are reflected immediately
    const nowMs = performance.now();
    const uiTick = nowMs - uiAt > 250;
    if (uiTick) uiAt = nowMs;
    panel.refresh(uiTick);
    if (map.editVersion !== mmVersion && performance.now() - mmTime > 1000) {
      mmVersion = map.editVersion;
      mmTime = performance.now();
      minimap.rebuild();
    }
    if (followId >= 0) {
      const sel = infoPanel.selection;
      const fv = transit.vehicles.find((x) => x.id === followId);
      const moved = Math.hypot(camera.x - followAt.x, camera.y - followAt.y) > 4;
      if (!fv || moved || !(sel?.kind === 'vehicle' && sel.id === followId)) {
        followId = -1;
        infoPanel.followId = -1;
      } else {
        const p = fv.mode === 'air' ? transit.planePos(fv) : transit.position(fv);
        const w = Camera.tileToWorld(p.x, p.y);
        camera.x += (w.x - camera.x) * 0.2;
        camera.y += (w.y - camera.y) * 0.2;
        followAt = { x: camera.x, y: camera.y };
      }
    }
    // Show the selected vehicle's path with arrows (the leg it is heading for now uses the local path; beyond that, the plan the server computed)
    {
      const sel = infoPanel.selection;
      const v = sel?.kind === 'vehicle' ? transit.vehicles.find((x) => x.id === sel.id) : undefined;
      if (v) {
        if (plan.id !== v.id || nowMs - plan.at > 3000) {
          plan.id = v.id;
          plan.at = nowMs;
          void net.cmd({ t: 'vehPlan', id: v.id }).then((r) => {
            if (r.ok && plan.id === v.id) {
              plan.data = r.data as { legs: number[][]; stops: number[] };
              plan.ver++;
            }
          });
        }
        const key = `${v.id}:${v.state}:${v.pi}:${v.order}:${plan.ver}`;
        if (key !== plan.drawn) {
          plan.drawn = key;
          const route = transit.routes.get(v.routeId);
          const cur = v.state === 'move' ? Array.from(v.path.subarray(Math.min(v.pi, v.path.length - 1))) : [];
          const legs = [cur, ...(plan.data?.legs ?? [])].filter((l) => l.length > 1);
          const stopTiles: number[] = [];
          for (const oi of plan.data?.stops ?? []) {
            const st = route && transit.stops.get(route.orders[oi]?.stopId);
            if (st) stopTiles.push(st.idx);
          }
          const dst = route && transit.stops.get(route.orders[v.order]?.stopId);
          if (dst && v.state === 'move') stopTiles.unshift(dst.idx);
          const reserved = v.mode === 'rail' && v.state === 'move' ? Array.from(v.path.subarray(Math.min(v.pi, v.path.length - 1), Math.min(v.resTo, v.path.length - 1) + 1)) : [];
          transitLayer.setRoute(legs, route?.color ?? 0xffd24a, stopTiles, reserved);
        }
      } else if (plan.drawn) {
        plan.drawn = '';
        plan.id = -1;
        plan.data = null;
        transitLayer.setRoute(null);
      }
    }
    if (nowMs - discAt > 400) {
      // Tell the server the area being viewed (tiles): only tiles and vehicles in that area are sent
      discAt = nowMs;
      const tl = [
        Camera.worldToTile(view.left, view.top),
        Camera.worldToTile(view.right, view.top),
        Camera.worldToTile(view.right, view.bottom),
        Camera.worldToTile(view.left, view.bottom),
      ];
      const x0 = Math.floor(Math.min(...tl.map((q) => q.x)));
      const x1 = Math.ceil(Math.max(...tl.map((q) => q.x)));
      const y0 = Math.floor(Math.min(...tl.map((q) => q.y)));
      const y1 = Math.ceil(Math.max(...tl.map((q) => q.y)));
      net.sendView(x0, y0, x1, y1);
    }
    if (showMap && (uiTick || view.zoom !== mmZoom || view.left !== mmLeft || view.top !== mmTop)) {
      minimap.draw(view);
      mmZoom = view.zoom;
      mmLeft = view.left;
      mmTop = view.top;
    }

    // Town labels
    const w = app.screen.width;
    const h = app.screen.height;
    for (const town of map.towns) {
      const wp = Camera.tileToWorld(town.x, town.y);
      const x = (wp.x - camera.x) * camera.zoom + w / 2;
      const y = (wp.y - camera.y) * camera.zoom + h / 2 - 20;
      let label = labelTexts.get(town.id);
      const show = x > -100 && x < w + 100 && y > -50 && y < h + 50 && (camera.zoom >= 0.12 || town.pop >= 300);
      if (!show) {
        if (label) label.visible = false;
        continue;
      }
      if (!label) {
        label = new Text({ text: '', style: { fontSize: 14, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, fontFamily: 'sans-serif' } });
        label.anchor.set(0.5, 1);
        labels.addChild(label);
        labelTexts.set(town.id, label);
      }
      const text = `${town.name} 【${tr(TIERS[townTier(town)].name)}】${town.pop}`;
      if (label.text !== text) label.text = text;
      label.visible = true;
      label.position.set(x, y);
    }

    stopLabels.update(camera, w, h);
    forSaleLabels.update(camera, w, h);

    fpsAcc += t.deltaMS;
    if (++fpsN >= 20) {
      fps = Math.round((fpsN * 1000) / fpsAcc);
      fpsAcc = fpsN = 0;
    }
    const d = sim.date;
    const rt = sim.rating;
    const rname = ratingName(rt.score);
    const rtext = tr(rt.locked ? '評価 {rating}({score}) 開発不可' : '評価 {rating}({score})', { rating: tr(rname), score: Math.round(rt.score) });
    if (ratingEl.textContent !== rtext) {
      ratingEl.textContent = rtext;
      ratingEl.className = rt.locked || rt.score < 35 ? 'bad' : rt.score >= 75 ? 'good' : '';
    }
    const rankEl = $('rank');
    if (uiTick) {
      const rows = companyRows();
      const rk = rows.findIndex((p) => p.isPlayer) + 1;
      const rtxt = tr('🏆 {rank}位/{total}社', { rank: rk, total: rows.length });
      if (rankEl.textContent !== rtxt) rankEl.textContent = rtxt;
    }
    const cashEl = $('cash');
    const narrow = window.matchMedia('(max-width: 820px)').matches; // on narrow screens show the loan shortened (if long, the badges stack up and block the map)
    const cashText = `💴 ${yen(sim.company.cash)}${sim.company.loan > 0 ? (narrow ? tr(' 借{amount}', { amount: locale().compactMoney(sim.company.loan) }) : tr(' (借入 {amount})', { amount: yen(sim.company.loan) })) : ''}`;
    if (cashEl.textContent !== cashText) {
      cashEl.textContent = cashText;
      cashEl.className = sim.company.cash < 0 ? 'neg' : '';
    }
    if (uiTick) moneyFloat.update(sim.company.total);
    if (uiTick) govPanel.update(mirror.gov);
    const dayNo = Math.floor((sim.tick + START_TOD) / DAY_TICKS);
    const wx = weatherOf(map.seed, dayNo);
    if (dayNo !== lastEventDay) {
      if (lastEventDay >= 0) {
        const mine = eventsToday(map.seed, map.facilities, dayNo, (f) => (f.owner ?? 'player') === 'player' && f.playerId === net.id);
        const ev = mine.map((e) => tr('{facility}で{event}(需要{mul}倍)', { facility: e.facility.name, event: tr(e.event.name), mul: e.event.mul })).join(tr('、'));
        tools.onMessage?.(
          tr('今日は{weather}{holiday}{events}', { weather: tr(WEATHER_NAME[wx]), holiday: isHoliday(dayNo) ? tr('・休日') : '', events: ev ? tr('。') + ev : '' }),
        );
      }
      lastEventDay = dayNo;
    }
    const ctext = tr('{date}{holiday}{weather} {time} 第{period}期Q{quarter}', {
      date: locale().date(d.year, d.month, d.day, d.weekday),
      holiday: isHoliday(dayNo) ? tr('祝') : '',
      weather: WEATHER_ICON[wx],
      time: `${pad(d.hour)}:${pad(d.minute)}`,
      period: d.period,
      quarter: d.quarter,
    });
    if (clock.textContent !== ctext) clock.textContent = ctext;

    if (!uiTick) return;
    const tile = pick(mouse.x, mouse.y);
    let info = 'tile -';
    if (tile) {
      const i = map.idx(tile.x, tile.y);
      const hgt = map.heightAt(tile.x, tile.y);
      const town = map.towns[map.owner.get(i) - 1];
      const stop = transit.stopAtTile(tile.x, tile.y);
      info =
        tr('tile ({x}, {y})  {terrain} 高度 {height}', { x: tile.x, y: tile.y, terrain: tr(hgt <= SEA_LEVEL ? '海' : '陸'), height: hgt }) +
        (town ? `  [${town.name}]` : '') +
        (stop ? tr('  🚏{name} 待ち{waiting} 圏人口{pop}', { name: stop.name, waiting: Math.floor(stop.waiting), pop: stop.pop }) : '');
    }
    if (!document.body.classList.contains('debug')) return;
    const pop = map.towns.reduce((s, t) => s + t.pop, 0);
    stats.textContent =
      tr('FPS {fps}  zoom {zoom}  LOD {lod}  sim {sim}ms 描画準備 {chunk}ms 車両 {layer}ms', {
        fps,
        zoom: camera.zoom.toFixed(2),
        lod: lodForZoom(camera.zoom),
        sim: perfSim.toFixed(1),
        chunk: perfChunk.toFixed(1),
        layer: perfLayer.toFixed(1),
      }) +
      '\n' +
      tr('map {size}² seed {seed}  街 {towns} 総人口 {pop}', { size: map.size, seed: map.seed, towns: map.towns.length, pop }) +
      '\n' +
      tr('chunks {chunks} (待ち {pending}) cache {cache}MB  tick/日 {ticks}', {
        chunks: chunks.chunksVisible,
        pending: chunks.pendingCount,
        cache: chunks.cacheMB.toFixed(0),
        ticks: TICKS_PER_DAY,
      }) +
      '\n' +
      info;
  });
}
