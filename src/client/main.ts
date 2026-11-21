import { StopLabels } from './app/stopLabels';
import { $, isTouch } from './app/dom';
import { initAuth } from './app/auth';
import { Toast } from './app/toast';
import { StationPicker } from './app/stationPicker';
import { BulldozeOptions } from './app/bulldozeOptions';
import { FacilityPicker } from './app/facilityPicker';
import { Toolbar } from './app/toolbar';
import { PlayerMenu } from './app/playerMenu';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { Simulation, TICKS_PER_DAY } from '../shared/sim/simulation';
import { net } from './connection/net';
import { Mirror } from './connection/mirror';
import { Camera } from './render/camera';
import { ChunkRenderer, lodForZoom } from './render/chunkRenderer';
import { Minimap } from './ui/minimap';
import { ToolController, type Tool } from './ui/tools';
import type { Cmd, CmdResult, PlaceTool } from '../shared/protocol';
import { type FacilityType, planFacility, placeFacility } from '../shared/world/facilities';
import { RoutePanel } from './ui/routePanel';
import { loadBuildingSprites } from './render/buildingSprites';
import { loadVehicleSprites } from './render/vehicleSprites';
import { StatsPanel } from './ui/statsPanel';
import { AnalysisPanel } from './ui/analysisPanel';
import { AuctionPanel } from './ui/auctionPanel';
import { FinancePanel } from './ui/financePanel';
import { RankingPanel } from './ui/rankingPanel';
import { DiagramPanel } from './ui/diagramPanel';
import { ListPanel } from './ui/listPanel';
import type { CompanyRow } from '../shared/sim/economy/ranking';
import { WEEKDAYS } from '../shared/sim/world/calendar';
import { WEATHER_ICON, WEATHER_NAME, eventsToday, isHoliday, weatherOf } from '../shared/sim/world/events';
import { START_TOD, DAY_TICKS } from '../shared/sim/network/transit';
import { yen } from '../shared/sim/economy/economy';
import { ratingName } from '../shared/sim/economy/rating';
import { InfoPanel, type Selection, findSelection } from './ui/infoPanel';
import { findVehicle } from './ui/vehicleSelect';
import { TransitLayer } from './render/transitLayer';
import { LEVEL_PX, SEA_LEVEL } from '../shared/world/constants';
import { TIERS, townTier } from '../shared/world/town';
import { placeAirport } from '../shared/world/airports';
import type { GameMap } from '../shared/world/gameMap';

initAuth(startGame);

/** 時刻(0〜24)ごとの乗算色: 夜は青く暗く、朝夕は暖色 */
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
      // 量子化してオーバーレイの再描画を減らす
      return ((r & 0xfc) << 16) | ((g & 0xfc) << 8) | (b & 0xfc);
    }
  }
  return 0xffffff;
}
const pad = (n: number) => String(n).padStart(2, '0');

async function startGame(map: GameMap, sim: Simulation, mirror: Mirror, startAt: { x: number; y: number }, cam?: { x: number; y: number; zoom: number }): Promise<void> {
  await loadBuildingSprites();
  await loadVehicleSprites();
  const app = new Application();
  await app.init({ resizeTo: window, background: '#0b1a2b', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2) });
  $('game').append(app.canvas);

  const chunks = new ChunkRenderer(map, { lowMem: isTouch });
  map.onTouch = (x, y) => chunks.markDirty(x, y);
  const worldRoot = new Container();
  worldRoot.addChild(chunks.container);
  app.stage.addChild(worldRoot);
  // 昼夜の色味(乗算オーバーレイ)。世界の上・ラベル/HUDの下
  const tintLayer = new Graphics();
  tintLayer.blendMode = 'multiply';
  app.stage.addChild(tintLayer);
  let dayNight = localStorage.getItem('sim.daynight') !== 'off';
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

  let setToolRef: (t: Tool) => void = () => {};
  const panel = new RoutePanel(
    $('routes'),
    transit,
    () => sim.tick,
    () => setToolRef('route'),
    () => setToolRef('pan'),
    () => sim.company,
  );
  const facOcc = (i: number) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)) || !!transit.depotAtTile(i % map.size, Math.floor(i / map.size));
  const stationPicker = new StationPicker();
  const bulldozeOptions = new BulldozeOptions();
  const facilityPicker = new FacilityPicker();
  const toast = new Toast();
  /** 操作をサーバーへ送り、結果のメッセージを表示する */
  const run = async (cmd: Cmd): Promise<CmdResult> => {
    const r = await net.cmd(cmd);
    if (r.msg) tools.onMessage?.(r.msg);
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
    } else if (tool === 'station') void run({ t: 'place', tool, x: tile.x, y: tile.y, opts: { ...stationPicker.opts } });
    else if (tool !== 'route' && tool !== 'pan')
      void run({ t: 'place', tool: tool as PlaceTool, x: tile.x, y: tile.y, ...(FacilityPicker.choosable(tool) ? { fac: { ...facilityPicker.sel } } : {}) });
  });
  tools.remoteBuild = (tool, a, b) => {
    if ((tool as string) === 'bulldoze') void run({ t: 'bulldoze', a, b, kinds: bulldozeOptions.kinds() });
    else if ((tool as string) === 'signalline') void run({ t: 'signalLine', a, b, interval: Number($<HTMLInputElement>('optSigInt').value) || 3 });
    else void run({ t: 'build', tool, a, b });
  };
  tools.onMessage = (msg) => toast.show(msg);
  tools.facilityPlanner = (x, y, type) => facilityPicker.plan(map, x, y, type, facOcc);
  tools.stationPlanner = (x, y) => stationPicker.plan(map, x, y, (i) => !!transit.stopAtTile(i % map.size, Math.floor(i / map.size)));
  worldRoot.addChild(tools.overlay);

  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), map, (tx, ty) => camera.centerOnTile(tx, ty));
  // 右下のマップの表示/非表示(設定は保存)
  let discAt = 0;
  const plan: { id: number; at: number; ver: number; drawn: string; data: { legs: number[][]; stops: number[] } | null } = { id: -1, at: 0, ver: 0, drawn: '', data: null };
  let showMap = localStorage.getItem('simulator-minimap') !== '0';
  const mapEl = $('minimap');
  const mapBtn = $('mapBtn');
  const applyMap = () => {
    mapEl.style.display = showMap ? '' : 'none';
    mapBtn.classList.toggle('on', showMap);
    mapBtn.textContent = showMap ? '🗺 マップを隠す (M)' : '🗺 マップを表示 (M)';
  };
  applyMap();
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

  const dnBtn = $('dnBtn');
  const syncDn = () => dnBtn.classList.toggle('on', dayNight);
  syncDn();
  dnBtn.addEventListener('click', () => {
    dayNight = !dayNight;
    localStorage.setItem('sim.daynight', dayNight ? 'on' : 'off');
    syncDn();
  });

  // 路線パネルの開閉(スマホでは下からのシート)
  const routesEl = $('routes');
  if (!isTouch) routesEl.classList.add('open');
  $('routesBtn').addEventListener('click', () => (routesWin.isOpen ? routesWin.close() : routesWin.open()));
  const routesWin = {
    get isOpen() {
      return routesEl.classList.contains('open');
    },
    open: () => routesEl.classList.add('open'),
    close: () => routesEl.classList.remove('open'),
  };

  const toolbar = new Toolbar();
  const setTool = (t: Tool) => {
    tools.setTool(t);
    stationPicker.setVisible(t === 'station');
    facilityPicker.setTool(t);
    $('signalOpts').hidden = t !== 'signalline';
    bulldozeOptions.setVisible(t === 'bulldoze');
    toolbar.highlight(t);
    if (t !== 'route' && (panel.building || panel.inserting)) panel.cancelBuild();
  };
  setToolRef = setTool;
  const setSpeed = (s: number) => {
    sim.speed = s;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
    const lab = document.getElementById('speedLabel');
    if (lab) lab.textContent = `${s === 0 ? '⏸' : 'x' + s} ▾`;
  };
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      if (isTouch) routesWin.close(); // スマホ: ツールを選んだら路線シートは閉じる
      setTool(b.dataset.tool as Tool);
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
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

  // 街の名前ラベル(画面座標)
  const labelTexts = new Map<number, Text>();
  const stopLabels = new StopLabels(labels, transit, map, $('stopNameBtn'));

  (window as unknown as Record<string, unknown>).__mp = { map, sim, camera, net, mirror };
  if (import.meta.env.DEV)
    (window as unknown as Record<string, unknown>).__game = {
      map,
      sim,
      camera,
      setSpeed,
      transitLayer,
      chunks,
      placeAirport,
      placeFacility: (type: FacilityType, x: number, y: number) => {
        const pl = planFacility(map, x, y, type, () => false);
        return pl.ok ? placeFacility(map, pl, type) : pl.reason;
      },
    };

  // 停留所/街のタップ情報(移動ツールで、ほぼ動かさずに離したとき)
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
  const infoPanel = info; // 毎フレームの処理内では info が別の変数名に隠れるため
  // 車両の追跡: カメラが車両を追いかける。カメラを手で動かす/情報パネルを閉じると解除
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
    // 車両が乗っているタイルを押したら車両を優先(経路を矢印で表示)。なければ停留所・街など、最後に隣のタイルの車両
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

  // 統計画面
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
    tools.onMessage?.(`第${r.period}期決算(${r.from}〜${r.to}): 当期純利益 ${yen(r.netIncome)}、法人税 ${yen(r.tax)}、配当 ${yen(r.dividend)}。経営画面(F)で決算書を確認できます`);
  };
  const companyRows = (): CompanyRow[] => {
    const rows: CompanyRow[] = mirror.players.map((p) => ({
      name: p.id === net.id ? `自社(${p.company})` : p.company,
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
  // 画面内のウィンドウは同時に1つだけ: 別のウィンドウを開くと前のものを閉じる
  // スマホでは路線シート・情報パネルも画面を覆うので対象に含める(PCでは常時表示のサイドパネルなので除外)
  const infoWin = {
    get isOpen() {
      return info.isOpen;
    },
    open() {},
    close: () => info.close(),
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

  const playerMenu = new PlayerMenu({ transit, players: () => mirror.players, notify: (m) => tools.onMessage?.(m), beforeOpen: () => closeWindows('menu') });

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
    transit.smoothMirror(); // サーバーの10Hzの状態を、60fpsになめらかに補間する
    const view = camera.update(dt);
    chunks.update(view);
    const tC = performance.now();
    tools.draw();
    {
      const d0 = sim.date;
      const color = dayNight ? tintOf(d0.hour + d0.minute / 60) : 0xffffff;
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
    const tD = performance.now();
    perfSim = perfSim * 0.9 + (tB - tA) * 0.1;
    perfChunk = perfChunk * 0.9 + (tC - tB) * 0.1;
    perfLayer = perfLayer * 0.9 + (tD - tC) * 0.1;
    // 数値の表示更新(DOM)は 4Hz に間引く。構造の変化は即時反映
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
    // 選んだ車両の経路を矢印で表示する(今向かっている区間は手元の経路、その先はサーバーが計算した予定)
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
      // 見ている範囲(タイル)をサーバーに知らせる: その範囲のタイル・車両だけが届く
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

    // 街ラベル
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
      const text = `${town.name} 【${TIERS[townTier(town)].name}】${town.pop}`;
      if (label.text !== text) label.text = text;
      label.visible = true;
      label.position.set(x, y);
    }

    stopLabels.update(camera, w, h);

    fpsAcc += t.deltaMS;
    if (++fpsN >= 20) {
      fps = Math.round((fpsN * 1000) / fpsAcc);
      fpsAcc = fpsN = 0;
    }
    const d = sim.date;
    const rt = sim.rating;
    const rname = ratingName(rt.score);
    const rtext = rt.locked ? `評価 ${rname}(${Math.round(rt.score)}) 開発不可` : `評価 ${rname}(${Math.round(rt.score)})`;
    if (ratingEl.textContent !== rtext) {
      ratingEl.textContent = rtext;
      ratingEl.className = rt.locked || rt.score < 35 ? 'bad' : rt.score >= 75 ? 'good' : '';
    }
    const rankEl = $('rank');
    if (uiTick) {
      const rows = companyRows();
      const rk = rows.findIndex((p) => p.isPlayer) + 1;
      const rtxt = `🏆 ${rk}位/${rows.length}社`;
      if (rankEl.textContent !== rtxt) rankEl.textContent = rtxt;
    }
    const cashEl = $('cash');
    const narrow = window.matchMedia('(max-width: 820px)').matches; // 狭い画面では借入を短く表示(長いとバッジが縦に積み上がって地図の上を塞ぐ)
    const cashText = `💴 ${yen(sim.company.cash)}${sim.company.loan > 0 ? (narrow ? ` 借${Math.round(sim.company.loan / 10000).toLocaleString()}万` : ` (借入 ${yen(sim.company.loan)})`) : ''}`;
    if (cashEl.textContent !== cashText) {
      cashEl.textContent = cashText;
      cashEl.className = sim.company.cash < 0 ? 'neg' : '';
    }
    const dayNo = Math.floor((sim.tick + START_TOD) / DAY_TICKS);
    const wx = weatherOf(map.seed, dayNo);
    if (dayNo !== lastEventDay) {
      if (lastEventDay >= 0) {
        const mine = eventsToday(map.seed, map.facilities, dayNo, (f) => (f.owner ?? 'player') === 'player' && f.playerId === net.id);
        const ev = mine.map((e) => `${e.facility.name}で${e.event.name}(需要${e.event.mul}倍)`).join('、');
        tools.onMessage?.(`今日は${WEATHER_NAME[wx]}${isHoliday(dayNo) ? '・休日' : ''}${ev ? `。${ev}` : ''}`);
      }
      lastEventDay = dayNo;
    }
    const ctext = `${d.year}年${d.month}月${d.day}日(${WEEKDAYS[d.weekday]})${isHoliday(dayNo) ? '祝' : ''}${WEATHER_ICON[wx]} ${pad(d.hour)}:${pad(d.minute)} 第${d.period}期Q${d.quarter}${sim.speed === 0 ? ' ⏸' : ''}`;
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
        `tile (${tile.x}, ${tile.y})  ${hgt <= SEA_LEVEL ? '海' : '陸'} 高度 ${hgt}` +
        (town ? `  [${town.name}]` : '') +
        (stop ? `  🚏${stop.name} 待ち${Math.floor(stop.waiting)} 圏人口${stop.pop}` : '');
    }
    const pop = map.towns.reduce((s, t) => s + t.pop, 0);
    stats.textContent =
      `FPS ${fps}  zoom ${camera.zoom.toFixed(2)}  LOD ${lodForZoom(camera.zoom)}  sim ${perfSim.toFixed(1)}ms 描画準備 ${perfChunk.toFixed(1)}ms 車両 ${perfLayer.toFixed(1)}ms\n` +
      `map ${map.size}² seed ${map.seed}  街 ${map.towns.length} 総人口 ${pop}\n` +
      `chunks ${chunks.chunksVisible} (待ち ${chunks.pendingCount}) cache ${chunks.cacheMB.toFixed(0)}MB  tick/日 ${TICKS_PER_DAY}\n` +
      info;
  });
}
