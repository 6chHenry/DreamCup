"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/**
 * 全站轻交互：鼠标移动涟漪、可点击元素上的「碎裂」微粒。
 * 水流漂移由 globals.css 中 `.dream-veil::after` 承担。
 * prefers-reduced-motion: reduce 时整组件不挂载动画逻辑。
 */

const SHATTER_SELECTOR =
  "button, a[href], [role='button'], input[type='submit'], input[type='button'], .btn-dream-primary, .btn-dream-secondary";

const RIPPLE_DIST_MIN = 48;
const RIPPLE_INTERVAL_MS = 110;
const MAX_RIPPLES = 12;
const SHATTER_DEBOUNCE_MS = 120;
const SHATTER_CLEANUP_MS = 1900;

type Ripple = { id: number; x: number; y: number };
type Shatter = { id: number; x: number; y: number; seed: number };

function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ShatterBloom({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="dream-shatter-bloom pointer-events-none absolute"
      style={{ left: x, top: y }}
    />
  );
}

function ShatterBurst({ x, y, seed }: { x: number; y: number; seed: number }) {
  const shards = useMemo(() => {
    const rand = mulberry32(Math.floor(seed * 1e9) || 1);
    /* 内圈粉尘 + 外圈更慢的飘移，距离偏短、更「梦醒后消散」 */
    return Array.from({ length: 26 }, () => {
      const angle = rand() * Math.PI * 2;
      const t = Math.pow(rand(), 0.85);
      const dist = 8 + t * 58;
      const wisp = rand() < 0.45;
      return {
        tx: Math.cos(angle) * dist * (wisp ? 0.55 : 1),
        ty: Math.sin(angle) * dist * (wisp ? 0.55 : 1) + (rand() - 0.4) * 6,
        w: wisp ? 1 + rand() * 2.5 : 1.5 + rand() * 3.5,
        h: wisp ? 3 + rand() * 9 : 0.6 + rand() * 2.2,
        rot: (rand() - 0.5) * 100,
        delay: Math.floor(rand() * 120),
        opacity: 0.18 + rand() * 0.35,
      };
    });
  }, [seed]);

  return (
    <>
      <ShatterBloom x={x} y={y} />
      {shards.map((p, i) => (
        <span
          key={i}
          className="dream-shard-dream pointer-events-none absolute"
          style={
            {
              left: x,
              top: y,
              width: p.w,
              height: p.h,
              borderRadius: 999,
              background: `linear-gradient(135deg, rgba(255,255,255,${(p.opacity * 0.9).toFixed(2)}), rgba(220,230,255,${(p.opacity * 0.25).toFixed(2)}))`,
              boxShadow: `0 0 ${6 + p.w * 0.4}px rgba(230,235,255,${(0.04 + p.opacity * 0.08).toFixed(2)})`,
              ["--tx" as string]: `${p.tx}px`,
              ["--ty" as string]: `${p.ty}px`,
              ["--rot" as string]: `${p.rot}deg`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

export default function DreamEffects() {
  /** null = 尚未检测（SSR/水合前不渲染动效，避免闪烁与 mismatch） */
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [shatters, setShatters] = useState<Shatter[]>([]);
  const rippleSerial = useRef(0);
  const shatterSerial = useRef(0);
  const lastRipple = useRef({ x: 0, y: 0, t: 0 });
  const lastShatterAt = useRef(0);
  const rafMove = useRef<number | null>(null);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const pushRipple = useCallback((x: number, y: number) => {
    const now = performance.now();
    const d = Math.hypot(x - lastRipple.current.x, y - lastRipple.current.y);
    if (d < RIPPLE_DIST_MIN && now - lastRipple.current.t < RIPPLE_INTERVAL_MS) return;
    lastRipple.current = { x, y, t: now };
    const id = ++rippleSerial.current;
    setRipples((prev) => {
      const next = [...prev, { id, x, y }];
      return next.length > MAX_RIPPLES ? next.slice(-MAX_RIPPLES) : next;
    });
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 980);
  }, []);

  useEffect(() => {
    if (reduced !== false) return;

    const onMove = (e: MouseEvent) => {
      pendingMove.current = { x: e.clientX, y: e.clientY };
      if (rafMove.current != null) return;
      rafMove.current = window.requestAnimationFrame(() => {
        rafMove.current = null;
        const p = pendingMove.current;
        if (p) pushRipple(p.x, p.y);
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafMove.current != null) cancelAnimationFrame(rafMove.current);
    };
  }, [reduced, pushRipple]);

  useEffect(() => {
    if (reduced !== false) return;

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      if (target.closest("[data-dream-skip-fx]")) return;

      const el = target.closest(SHATTER_SELECTOR) as HTMLElement | null;
      if (!el) return;
      if (el.hasAttribute("disabled")) return;
      if (el.getAttribute("aria-disabled") === "true") return;
      if (el instanceof HTMLAnchorElement && (!el.href || el.href === "#")) {
        /* still allow visual for in-page anchors */
      }
      const t = performance.now();
      if (t - lastShatterAt.current < SHATTER_DEBOUNCE_MS) return;
      lastShatterAt.current = t;

      const id = ++shatterSerial.current;
      const seed = Math.random();
      setShatters((prev) => [...prev, { id, x: e.clientX, y: e.clientY, seed }]);
      window.setTimeout(() => {
        setShatters((prev) => prev.filter((s) => s.id !== id));
      }, SHATTER_CLEANUP_MS);
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [reduced]);

  if (reduced === null || reduced) return null;

  return (
    <div
      className="fixed inset-0 z-[20] pointer-events-none overflow-hidden"
      aria-hidden
    >
      {ripples.map((r) => (
        <div
          key={r.id}
          className="dream-ripple-ring absolute"
          style={{ left: r.x, top: r.y }}
        />
      ))}
      {shatters.map((s) => (
        <ShatterBurst key={s.id} x={s.x} y={s.y} seed={s.seed} />
      ))}
    </div>
  );
}
