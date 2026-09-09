"use client";

import { useEffect, useRef, useState } from "react";

type RideStatus =
  | "idle"
  | "locating"
  | "recording"
  | "paused"
  | "finished"
  | "error";

type GeoPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type RideSnapshot = {
  distanceM: number;
  stoppedMs: number;
  restMs: number;
  totalMs: number;
  currentSpeedKmh: number;
  averageSpeedKmh: number;
  maxSpeedKmh: number;
};

type NaverLatLng = object;

type NaverMap = {
  setCenter(position: NaverLatLng): void;
  setZoom(zoom: number): void;
};

type NaverPolyline = {
  setMap(map: NaverMap | null): void;
  setPath(path: NaverLatLng[]): void;
};

type NaverMarker = {
  setMap(map: NaverMap | null): void;
  setPosition(position: NaverLatLng): void;
};

type NaverMapsApi = {
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  Map: new (element: HTMLElement, options: object) => NaverMap;
  Polyline: new (options: object) => NaverPolyline;
  Marker: new (options: object) => NaverMarker;
};

type WakeLockSentinelLike = {
  release(): Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
  standalone?: boolean;
};

type PauseRecord = {
  point: GeoPoint;
  startedAt: number;
  endedAt: number | null;
};

type SavedRide = {
  id: string;
  startedAt: number;
  endedAt: number;
  summary: RideSnapshot;
  routeSegments: GeoPoint[][];
  pauses: PauseRecord[];
};

declare global {
  interface Window {
    naver?: { maps: NaverMapsApi };
    navermap_authFailure?: () => void;
  }
}

const EMPTY_SNAPSHOT: RideSnapshot = {
  distanceM: 0,
  stoppedMs: 0,
  restMs: 0,
  totalMs: 0,
  currentSpeedKmh: 0,
  averageSpeedKmh: 0,
  maxSpeedKmh: 0,
};

const STOP_SPEED_KMH = 1;
const MAX_REASONABLE_SPEED_KMH = 150;
const MAX_ACCEPTED_ACCURACY_M = 65;

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

function haversineDistance(from: GeoPoint, to: GeoPoint) {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export default function Home() {
  const naverClientId =
    process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? "7n6zawq9b6";
  const [status, setStatus] = useState<RideStatus>("idle");
  const [message, setMessage] = useState("출발 준비가 되면 시작을 눌러주세요.");
  const [snapshot, setSnapshot] = useState<RideSnapshot>(EMPTY_SNAPSHOT);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [savedRideCount, setSavedRideCount] = useState(0);

  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const activePolylineRef = useRef<NaverPolyline | null>(null);
  const polylinesRef = useRef<NaverPolyline[]>([]);
  const markerRef = useRef<NaverMarker | null>(null);
  const pauseMarkersRef = useRef<NaverMarker[]>([]);
  const routeSegmentsRef = useRef<GeoPoint[][]>([[]]);
  const pauseRecordsRef = useRef<PauseRecord[]>([]);
  const previewPointRef = useRef<GeoPoint | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const isActiveRef = useRef(false);
  const isPausedRef = useRef(false);
  const hasFixRef = useRef(false);
  const startAtRef = useRef(0);
  const lastTimerAtRef = useRef(0);
  const lastSpeedAtRef = useRef(0);
  const stoppedMsRef = useRef(0);
  const restMsRef = useRef(0);
  const distanceMRef = useRef(0);
  const currentSpeedKmhRef = useRef(0);
  const maxSpeedKmhRef = useRef(0);
  const lastPointRef = useRef<GeoPoint | null>(null);

  useEffect(() => {
    const mobileNavigator = navigator as NavigatorWithWakeLock;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      mobileNavigator.standalone === true;

    queueMicrotask(() => setShowInstallHint(isIOS && !isStandalone));

    if ("serviceWorker" in navigator) {
      const serviceWorkerUrl = new URL("sw.js", document.baseURI);
      navigator.serviceWorker.register(serviceWorkerUrl.pathname).catch(() => {
        // The ride tracker still works if offline caching is unavailable.
      });
    }
  }, []);

  useEffect(() => {
    try {
      const savedRides = JSON.parse(localStorage.getItem("biketour-rides") ?? "[]");
      if (Array.isArray(savedRides)) {
        queueMicrotask(() => setSavedRideCount(savedRides.length));
      }
    } catch {
      // Ignore malformed data from an older app version.
    }

    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        const point: GeoPoint = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          timestamp,
        };
        previewPointRef.current = point;

        if (window.naver && mapRef.current) {
          const position = new window.naver.maps.LatLng(
            point.latitude,
            point.longitude,
          );
          mapRef.current.setCenter(position);
          mapRef.current.setZoom(17);
          markerRef.current = new window.naver.maps.Marker({
            map: mapRef.current,
            position,
          });
        }
        setMessage(`현재 위치를 찾았습니다 · 정확도 약 ${Math.round(coords.accuracy)}m`);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setMessage("현재 위치를 보려면 Safari에서 위치 권한을 허용해주세요.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 },
    );
  }, []);

  useEffect(() => {
    let active = true;
    window.navermap_authFailure = () => {
      if (active) setMapError(true);
    };

    if (window.naver?.maps?.Map) {
      queueMicrotask(() => {
        if (active) setMapReady(true);
      });
      return () => {
        active = false;
        delete window.navermap_authFailure;
      };
    }

    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${naverClientId}`;
    script.async = true;
    script.onload = () => {
      if (active) setMapReady(true);
    };
    script.onerror = () => {
      if (active) setMapError(true);
    };
    document.head.appendChild(script);

    return () => {
      active = false;
      delete window.navermap_authFailure;
    };
  }, [naverClientId]);

  useEffect(() => {
    if (!mapReady || !mapElementRef.current || mapRef.current || !window.naver) {
      return;
    }

    const maps = window.naver.maps;
    const routeSegments = routeSegmentsRef.current;
    const initialPoint =
      routeSegments.at(-1)?.at(-1) ?? previewPointRef.current;
    const center = new maps.LatLng(
      initialPoint?.latitude ?? 37.5666103,
      initialPoint?.longitude ?? 126.9783882,
    );
    const map = new maps.Map(mapElementRef.current, {
      center,
      zoom: initialPoint ? 17 : 13,
      zoomControl: false,
      scaleControl: false,
      mapDataControl: false,
    });
    mapRef.current = map;
    polylinesRef.current = routeSegments
      .filter((segment) => segment.length > 0)
      .map(
        (segment) =>
          new maps.Polyline({
            map,
            path: segment.map(
              (point) => new maps.LatLng(point.latitude, point.longitude),
            ),
            strokeColor: "#16e58c",
            strokeOpacity: 0.95,
            strokeWeight: 6,
            strokeLineCap: "round",
            strokeLineJoin: "round",
          }),
      );
    activePolylineRef.current = polylinesRef.current.at(-1) ?? null;

    if (initialPoint) {
      markerRef.current = new maps.Marker({ map, position: center });
    }
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;

    const authCheck = window.setTimeout(() => {
      if (mapElementRef.current?.textContent?.includes("인증이 실패")) {
        setMapError(true);
      }
    }, 1_500);

    return () => window.clearTimeout(authCheck);
  }, [mapReady]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
      void wakeLockRef.current?.release();
    };
  }, []);

  const createSnapshot = (now: number): RideSnapshot => {
    const totalMs = startAtRef.current ? now - startAtRef.current : 0;
    const movingMs = Math.max(
      0,
      totalMs - stoppedMsRef.current - restMsRef.current,
    );
    const averageSpeedKmh = movingMs
      ? (distanceMRef.current / 1000) / (movingMs / 3_600_000)
      : 0;

    return {
      distanceM: distanceMRef.current,
      stoppedMs: stoppedMsRef.current,
      restMs: restMsRef.current,
      totalMs,
      currentSpeedKmh: currentSpeedKmhRef.current,
      averageSpeedKmh,
      maxSpeedKmh: maxSpeedKmhRef.current,
    };
  };

  const updateClock = (now: number) => {
    const elapsed = Math.max(0, now - lastTimerAtRef.current);
    const gpsIsStale = now - lastSpeedAtRef.current > 8_000;

    if (isPausedRef.current) {
      restMsRef.current += elapsed;
    } else if (
      hasFixRef.current &&
      (gpsIsStale || currentSpeedKmhRef.current < STOP_SPEED_KMH)
    ) {
      stoppedMsRef.current += elapsed;
    }
    if (gpsIsStale) {
      currentSpeedKmhRef.current = 0;
    }

    lastTimerAtRef.current = now;
    setSnapshot(createSnapshot(now));
  };

  const clearTrackers = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const moveCurrentMarker = (point: GeoPoint) => {
    if (!window.naver || !mapRef.current) return;
    const maps = window.naver.maps;
    const position = new maps.LatLng(point.latitude, point.longitude);
    mapRef.current.setCenter(position);

    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      markerRef.current = new maps.Marker({ map: mapRef.current, position });
    }
  };

  const drawPoint = (point: GeoPoint) => {
    if (!window.naver || !mapRef.current) return;

    const maps = window.naver.maps;
    const currentSegment = routeSegmentsRef.current.at(-1) ?? [];

    if (!activePolylineRef.current) {
      activePolylineRef.current = new maps.Polyline({
        map: mapRef.current,
        path: [],
        strokeColor: "#16e58c",
        strokeOpacity: 0.95,
        strokeWeight: 6,
        strokeLineCap: "round",
        strokeLineJoin: "round",
      });
      polylinesRef.current.push(activePolylineRef.current);
    }

    activePolylineRef.current.setPath(
      currentSegment.map(
        (routePoint) =>
          new maps.LatLng(routePoint.latitude, routePoint.longitude),
      ),
    );
    moveCurrentMarker(point);
  };

  const markPausePoint = (point: GeoPoint) => {
    if (!window.naver || !mapRef.current) return;

    const marker = new window.naver.maps.Marker({
      map: mapRef.current,
      position: new window.naver.maps.LatLng(point.latitude, point.longitude),
      title: `휴식 지점 ${pauseRecordsRef.current.length}`,
    });
    pauseMarkersRef.current.push(marker);
  };

  const requestWakeLock = async () => {
    const mobileNavigator = navigator as NavigatorWithWakeLock;
    try {
      wakeLockRef.current =
        (await mobileNavigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  };

  const releaseWakeLock = async () => {
    try {
      await wakeLockRef.current?.release();
    } finally {
      wakeLockRef.current = null;
    }
  };

  const startRide = () => {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setMessage("이 브라우저에서는 GPS 위치 기능을 사용할 수 없습니다.");
      return;
    }

    clearTrackers();
    const now = Date.now();
    isActiveRef.current = true;
    isPausedRef.current = false;
    hasFixRef.current = false;
    startAtRef.current = now;
    lastTimerAtRef.current = now;
    lastSpeedAtRef.current = 0;
    stoppedMsRef.current = 0;
    restMsRef.current = 0;
    distanceMRef.current = 0;
    currentSpeedKmhRef.current = 0;
    maxSpeedKmhRef.current = 0;
    lastPointRef.current = null;
    polylinesRef.current.forEach((polyline) => polyline.setMap(null));
    pauseMarkersRef.current.forEach((pauseMarker) => pauseMarker.setMap(null));
    polylinesRef.current = [];
    pauseMarkersRef.current = [];
    activePolylineRef.current = null;
    routeSegmentsRef.current = [[]];
    pauseRecordsRef.current = [];
    markerRef.current?.setMap(null);
    markerRef.current = null;
    setSnapshot(EMPTY_SNAPSHOT);
    setStatus("locating");
    setMessage("GPS 신호를 찾고 있습니다…");
    void requestWakeLock();

    timerRef.current = setInterval(() => updateClock(Date.now()), 1_000);
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (!isActiveRef.current) return;

        if (coords.accuracy > MAX_ACCEPTED_ACCURACY_M) {
          setMessage(`GPS 정확도 개선 중 · 약 ${Math.round(coords.accuracy)}m`);
          return;
        }

        const point: GeoPoint = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          timestamp,
        };

        if (isPausedRef.current) {
          previewPointRef.current = point;
          lastPointRef.current = point;
          lastSpeedAtRef.current = Date.now();
          currentSpeedKmhRef.current = 0;
          moveCurrentMarker(point);
          setSnapshot(createSnapshot(Date.now()));
          return;
        }

        const previousPoint = lastPointRef.current;
        let segmentDistanceM = 0;
        let calculatedSpeedKmh = 0;

        if (previousPoint) {
          segmentDistanceM = haversineDistance(previousPoint, point);
          const elapsedHours = (timestamp - previousPoint.timestamp) / 3_600_000;
          calculatedSpeedKmh = elapsedHours > 0
            ? segmentDistanceM / 1000 / elapsedHours
            : 0;
        }

        const sensorSpeedKmh = coords.speed === null
          ? null
          : Math.max(0, coords.speed * 3.6);
        const speedKmh = Math.min(
          sensorSpeedKmh ?? calculatedSpeedKmh,
          MAX_REASONABLE_SPEED_KMH,
        );
        const segmentIsValid =
          previousPoint !== null &&
          segmentDistanceM >= 2 &&
          calculatedSpeedKmh <= MAX_REASONABLE_SPEED_KMH;

        if (!previousPoint || segmentIsValid) {
          const currentSegment = routeSegmentsRef.current.at(-1);
          currentSegment?.push(point);
          if (segmentIsValid) {
            distanceMRef.current += segmentDistanceM;
          }
          drawPoint(point);
        }

        lastPointRef.current = point;
        lastSpeedAtRef.current = Date.now();
        currentSpeedKmhRef.current = speedKmh;
        maxSpeedKmhRef.current = Math.max(maxSpeedKmhRef.current, speedKmh);
        hasFixRef.current = true;
        setStatus("recording");
        setMessage(`GPS 연결됨 · 정확도 약 ${Math.round(coords.accuracy)}m`);
        setSnapshot(createSnapshot(Date.now()));
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          isActiveRef.current = false;
          clearTrackers();
          setStatus("error");
          setMessage("위치 권한이 필요합니다. 브라우저 설정에서 위치를 허용해주세요.");
          return;
        }

        setMessage(
          error.code === error.TIMEOUT
            ? "GPS 응답을 기다리고 있습니다…"
            : "GPS 신호가 약합니다. 하늘이 잘 보이는 곳에서 기다려주세요.",
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1_000,
        timeout: 15_000,
      },
    );
  };

  const pauseRide = () => {
    if (!isActiveRef.current || isPausedRef.current || !lastPointRef.current) {
      return;
    }

    const now = Date.now();
    updateClock(now);
    isPausedRef.current = true;
    currentSpeedKmhRef.current = 0;
    const pausePoint = { ...lastPointRef.current, timestamp: now };
    pauseRecordsRef.current.push({
      point: pausePoint,
      startedAt: now,
      endedAt: null,
    });
    markPausePoint(pausePoint);
    setSnapshot({ ...createSnapshot(now), currentSpeedKmh: 0 });
    setStatus("paused");
    setMessage("라이딩 일시정지 · 휴식시간을 기록하고 있습니다.");
    void releaseWakeLock();
  };

  const resumeRide = () => {
    if (!isActiveRef.current || !isPausedRef.current) return;

    const now = Date.now();
    updateClock(now);
    const currentPause = pauseRecordsRef.current.at(-1);
    if (currentPause && currentPause.endedAt === null) {
      currentPause.endedAt = now;
    }
    isPausedRef.current = false;
    lastPointRef.current = null;
    currentSpeedKmhRef.current = 0;
    routeSegmentsRef.current.push([]);
    activePolylineRef.current = null;
    setStatus("recording");
    setMessage("라이딩 재개 · GPS 신호를 확인하고 있습니다…");
    void requestWakeLock();
  };

  const saveRide = (ride: SavedRide) => {
    try {
      const savedRides = JSON.parse(
        localStorage.getItem("biketour-rides") ?? "[]",
      );
      const rides = Array.isArray(savedRides) ? savedRides : [];
      const updatedRides = [ride, ...rides].slice(0, 50);
      localStorage.setItem("biketour-rides", JSON.stringify(updatedRides));
      setSavedRideCount(updatedRides.length);
      return true;
    } catch {
      return false;
    }
  };

  const finishRide = () => {
    if (!isActiveRef.current) return;

    const now = Date.now();
    updateClock(now);
    const currentPause = pauseRecordsRef.current.at(-1);
    if (isPausedRef.current && currentPause && currentPause.endedAt === null) {
      currentPause.endedAt = now;
    }
    isActiveRef.current = false;
    isPausedRef.current = false;
    clearTrackers();
    void releaseWakeLock();
    currentSpeedKmhRef.current = 0;
    const finalSnapshot = { ...createSnapshot(now), currentSpeedKmh: 0 };
    const ride: SavedRide = {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${startAtRef.current}-${now}`,
      startedAt: startAtRef.current,
      endedAt: now,
      summary: finalSnapshot,
      routeSegments: routeSegmentsRef.current
        .filter((segment) => segment.length > 0)
        .map((segment) => segment.map((point) => ({ ...point }))),
      pauses: pauseRecordsRef.current.map((pause) => ({
        ...pause,
        point: { ...pause.point },
      })),
    };
    const saved = saveRide(ride);
    setSnapshot(finalSnapshot);
    setStatus("finished");
    setMessage(
      saved
        ? "라이딩이 종료되어 이 기기에 저장됐습니다."
        : "라이딩은 종료됐지만 저장공간을 확인해주세요.",
    );
  };

  const isRiding =
    status === "locating" || status === "recording" || status === "paused";
  const statusLabel = {
    idle: "준비",
    locating: "GPS 연결 중",
    recording: "기록 중",
    paused: "휴식 중",
    finished: "완료",
    error: "확인 필요",
  }[status];

  return (
    <main className="min-h-dvh overflow-hidden bg-[#07110f] text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <header className="mb-4 flex items-center justify-between px-1">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.28em] text-emerald-400">
              BIKE TOUR
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">라이딩 기록</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/70">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "recording"
                  ? "animate-pulse bg-emerald-400"
                  : status === "paused"
                    ? "animate-pulse bg-amber-300"
                  : status === "error"
                    ? "bg-amber-400"
                    : "bg-white/30"
              }`}
            />
            {statusLabel}
          </div>
        </header>

        {showInstallHint && (
          <button
            type="button"
            onClick={() => setInstallGuideOpen(true)}
            className="mb-3 flex w-full items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-left transition active:scale-[0.99]"
          >
            <span>
              <span className="block text-sm font-semibold text-emerald-300">
                아이폰에 앱으로 설치하기
              </span>
              <span className="mt-0.5 block text-[11px] text-white/45">
                홈 화면에서 전체 화면으로 실행해요
              </span>
            </span>
            <span className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-bold text-[#04251a]">
              방법 보기
            </span>
          </button>
        )}

        <section className="relative h-[285px] overflow-hidden rounded-[28px] border border-white/10 bg-[#13201d] shadow-2xl shadow-black/30">
          <div ref={mapElementRef} className="h-full w-full" aria-label="주행 경로 지도" />
          {mapError && (
            <div className="absolute inset-0 grid place-items-center bg-[#13201d] px-10 text-center">
              <div>
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-xl">⌖</div>
                <p className="font-semibold">지도를 불러올 수 없습니다</p>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  네이버 지도 API 설정과 등록된 웹 서비스 URL을 확인해주세요.
                </p>
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-2xl border border-white/10 bg-[#07110f]/90 px-4 py-3 shadow-xl backdrop-blur">
            <p className="text-[10px] font-semibold tracking-widest text-white/45">현재 속도</p>
            <div className="mt-0.5 flex items-end gap-1.5">
              <strong className="font-mono text-3xl leading-none tabular-nums">
                {snapshot.currentSpeedKmh.toFixed(1)}
              </strong>
              <span className="pb-0.5 text-xs text-white/50">km/h</span>
            </div>
          </div>
        </section>

        <p className="my-4 flex min-h-5 items-center justify-center gap-2 text-center text-xs text-white/55" aria-live="polite">
          <span className="text-emerald-400">●</span>
          {message}
        </p>

        <section className="grid grid-cols-2 gap-3">
          <MetricCard
            label="총 이동거리"
            value={(snapshot.distanceM / 1000).toFixed(2)}
            unit="km"
            featured
          />
          <MetricCard
            label="총 이동시간"
            value={formatDuration(snapshot.totalMs)}
          />
          <MetricCard
            label="평균속도"
            value={snapshot.averageSpeedKmh.toFixed(1)}
            unit="km/h"
          />
          <MetricCard
            label="최대속도"
            value={snapshot.maxSpeedKmh.toFixed(1)}
            unit="km/h"
          />
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4">
            <span className="text-xs text-white/45">정지시간</span>
            <strong className="mt-2 block font-mono text-lg tabular-nums">
              {formatDuration(snapshot.stoppedMs)}
            </strong>
          </div>
          <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] p-4">
            <span className="text-xs text-amber-100/50">휴식시간</span>
            <strong className="mt-2 block font-mono text-lg tabular-nums text-amber-100">
              {formatDuration(snapshot.restMs)}
            </strong>
          </div>
        </section>

        <div className="mt-auto pt-5">
          {status === "recording" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={pauseRide}
                className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-amber-300 text-base font-bold text-[#352508] transition active:scale-[0.98] active:bg-amber-200"
              >
                <span className="flex gap-1">
                  <span className="h-4 w-1.5 rounded-sm bg-[#352508]" />
                  <span className="h-4 w-1.5 rounded-sm bg-[#352508]" />
                </span>
                일시정지
              </button>
              <button
                type="button"
                onClick={finishRide}
                className="flex h-16 items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/15 text-base font-semibold text-red-200 transition active:scale-[0.98] active:bg-red-500/25"
              >
                <span className="h-3.5 w-3.5 rounded-[3px] bg-red-400" />
                라이딩 종료
              </button>
            </div>
          ) : status === "paused" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={resumeRide}
                className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-emerald-400 text-base font-bold text-[#04251a] transition active:scale-[0.98] active:bg-emerald-300"
              >
                <span className="h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-[#04251a]" />
                라이딩 재개
              </button>
              <button
                type="button"
                onClick={finishRide}
                className="flex h-16 items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/15 text-base font-semibold text-red-200 transition active:scale-[0.98] active:bg-red-500/25"
              >
                <span className="h-3.5 w-3.5 rounded-[3px] bg-red-400" />
                라이딩 종료
              </button>
            </div>
          ) : isRiding ? (
            <button
              type="button"
              onClick={finishRide}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl border border-red-400/20 bg-red-500/15 text-lg font-semibold text-red-200 transition active:scale-[0.98] active:bg-red-500/25"
            >
              <span className="h-3.5 w-3.5 rounded-[3px] bg-red-400" />
              라이딩 종료
            </button>
          ) : (
            <button
              type="button"
              onClick={startRide}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-400 text-lg font-bold text-[#04251a] shadow-lg shadow-emerald-500/15 transition active:scale-[0.98] active:bg-emerald-300"
            >
              <span className="ml-0.5 h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-[#04251a]" />
              {status === "finished" ? "새 라이딩 시작" : "라이딩 시작"}
            </button>
          )}
          <p className="mt-3 text-center text-[11px] leading-4 text-white/35">
            저장된 라이딩 {savedRideCount}개 · 라이딩 중 화면을 켜두세요.
          </p>
        </div>
      </div>

      {installGuideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 px-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-title"
          onClick={() => setInstallGuideOpen(false)}
        >
          <div
            className="mb-[max(env(safe-area-inset-bottom),0.75rem)] w-full max-w-lg rounded-[28px] border border-white/10 bg-[#12201c] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.22em] text-emerald-400">
                  INSTALL ON IPHONE
                </p>
                <h2 id="install-title" className="mt-1 text-xl font-bold">
                  홈 화면에 바이크투어 추가
                </h2>
              </div>
              <button
                type="button"
                aria-label="설치 안내 닫기"
                onClick={() => setInstallGuideOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.07] text-xl text-white/55"
              >
                ×
              </button>
            </div>

            <ol className="space-y-4">
              <InstallStep number="1" text="Safari 하단의 공유 버튼을 누르세요." symbol="⇧" />
              <InstallStep number="2" text="메뉴에서 '홈 화면에 추가'를 선택하세요." symbol="+" />
              <InstallStep number="3" text="오른쪽 위 '추가'를 누르면 설치가 완료됩니다." symbol="✓" />
            </ol>

            <p className="mt-5 rounded-xl bg-black/20 px-4 py-3 text-xs leading-5 text-white/50">
              설치 후 홈 화면의 아이콘을 누르면 Safari 주소창 없이 앱처럼 실행됩니다.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function InstallStep({
  number,
  text,
  symbol,
}: {
  number: string;
  text: string;
  symbol: string;
}) {
  return (
    <li className="flex items-center gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400 text-lg font-bold text-[#04251a]">
        {symbol}
      </span>
      <p className="text-sm leading-6 text-white/75">
        <span className="mr-1.5 font-semibold text-white">{number}.</span>
        {text}
      </p>
    </li>
  );
}

function MetricCard({
  label,
  value,
  unit,
  featured = false,
}: {
  label: string;
  value: string;
  unit?: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        featured
          ? "border-emerald-400/20 bg-emerald-400/[0.08]"
          : "border-white/[0.08] bg-white/[0.045]"
      }`}
    >
      <p className="text-xs text-white/45">{label}</p>
      <div className="mt-2 flex min-h-8 items-end gap-1.5">
        <strong className="font-mono text-2xl leading-none tabular-nums tracking-tight">
          {value}
        </strong>
        {unit && <span className="pb-0.5 text-[11px] text-white/40">{unit}</span>}
      </div>
    </div>
  );
}
