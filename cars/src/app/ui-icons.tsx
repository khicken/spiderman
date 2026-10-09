import type { ReactNode, SVGProps } from "react";
import type { Weather } from "./contracts";

type P = SVGProps<SVGSVGElement> & { size?: number | string };

function svg(body: ReactNode, fill = false) {
  return function Icon({ size = "1em", ...p }: P) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...p}
      >
        {body}
      </svg>
    );
  };
}

export const Gas = svg(
  <>
    <path d="M8 2.5h8l1.5 19h-11z" />
    <path d="M9.5 7h5M9.3 10.5h5.4M9.1 14h5.8M8.9 17.5h6.2" />
  </>,
);
export const Brake = svg(
  <>
    <path d="M3.5 7h17l-1.5 11H5z" />
    <path d="M7 10.5h10M7.4 14h9.2" />
  </>,
);
export const Handbrake = svg(
  <>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 9v3.5M12 15h.01M4.5 5.5a10 10 0 0 0 0 13M19.5 5.5a10 10 0 0 1 0 13" />
  </>,
);
export const Camera = svg(
  <>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </>,
);
export const Rewind = svg(
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3 3v5h5" />
    <path d="M12 8v4l3 2" />
  </>,
);
export const Pause = svg(<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />, true);
export const Play = svg(<path d="M7 4l13 8-13 8z" />, true);
export const Cog = svg(
  <>
    <path d="M10.3 2.5h3.4l.6 2.6 1.9 1.1 2.5-.8 1.7 2.9-2 1.8v2.2l2 1.8-1.7 2.9-2.5-.8-1.9 1.1-.6 2.6h-3.4l-.6-2.6-1.9-1.1-2.5.8-1.7-2.9 2-1.8v-2.2l-2-1.8 1.7-2.9 2.5.8 1.9-1.1z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const Crown = svg(<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />, true);
export const Copy = svg(
  <>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </>,
);
export const Link = svg(
  <>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </>,
);
export const Check = svg(<path d="M4 12.5l5 5L20 6.5" />);
export const Close = svg(<path d="M6 6l12 12M18 6L6 18" />);
export const Trophy = svg(
  <>
    <path d="M7 3h10v6a5 5 0 0 1-10 0z" />
    <path d="M7 5H3.5v1.5A3.5 3.5 0 0 0 7 10M17 5h3.5v1.5A3.5 3.5 0 0 1 17 10M12 14v4M8 21h8M9 18h6" />
  </>,
);
export const Flag = svg(
  <>
    <path d="M5 21V3" />
    <path d="M5 4h14l-2.5 4.5L19 13H5" fill="currentColor" fillOpacity="0.2" />
    <path d="M9 4v9M13 4v9M5 8.5h13" strokeWidth="1.2" />
  </>,
);
export const Clock = svg(
  <>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M10 2.5h4M19 5.5l1.5-1.5" />
  </>,
);
export const Sun = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const Moon = svg(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const Cloud = svg(<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z" />);
export const Rain = svg(
  <>
    <path d="M7 14a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 5.5a4.3 4.3 0 0 1-.5 8.5z" />
    <path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" />
  </>,
);
export const Fog = svg(<path d="M3 8h14M6 12h15M3 16h13M8 20h10" />);
export const Snow = svg(<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5" />);
export const Keyboard = svg(
  <>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M10 12.5h.01M14 12.5h.01M18 12.5h.01M7 16h10" />
  </>,
);
export const Gamepad = svg(
  <>
    <path d="M7 7h10a5 5 0 0 1 4.8 6.3l-1 3.7a2.5 2.5 0 0 1-4.3 1L15 16H9l-1.5 2a2.5 2.5 0 0 1-4.3-1l-1-3.7A5 5 0 0 1 7 7z" />
    <path d="M7 10v4M5 12h4M16 11h.01M18 13h.01" />
  </>,
);
export const Touch = svg(
  <>
    <path d="M9 11V5a1.5 1.5 0 0 1 3 0v5.5" />
    <path d="M12 10a1.5 1.5 0 0 1 3 0v1M15 10.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.7L4 15.5a1.5 1.5 0 0 1 2.4-1.8L9 16" />
  </>,
);
export const Back = svg(<path d="M15 4l-8 8 8 8" />);
export const Fwd = svg(<path d="M9 4l8 8-8 8" />);
export const Plus = svg(<path d="M12 5v14M5 12h14" />);
export const Minus = svg(<path d="M5 12h14" />);
export const Restart = svg(
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 3v5h-5" />
  </>,
);
export const Next = svg(<path d="M5 4l10 8-10 8zM17 4h2.5v16H17z" />, true);
export const Home = svg(<path d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" />);
export const Exit = svg(
  <>
    <path d="M14 4h5v16h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </>,
);
export const Volume = svg(
  <>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </>,
);
export const Music = svg(
  <>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </>,
);
export const Speed = svg(
  <>
    <path d="M3.5 17a9 9 0 1 1 17 0" />
    <path d="M12 13l4.5-5" />
    <circle cx="12" cy="13.5" r="1" fill="currentColor" />
  </>,
);
export const Wheel = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M3.5 10.5l6 1M20.5 10.5l-6 1M12 14.5V21" />
  </>,
);
export const Bolt = svg(<path d="M13 2L4 14h7l-1 8 9-12h-7z" />);
export const Disc = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M16 3.9a9 9 0 0 1 4.3 5.4" strokeWidth="4" />
  </>,
);
export const Laps = svg(
  <>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" />
    <path d="M20 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" />
    <path d="M4 20v-5h5" />
  </>,
);
export const Road = svg(<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3" />);
export const Globe = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);
export const Users = svg(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
  </>,
);
export const Bot = svg(
  <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" />
    <circle cx="12" cy="3.5" r="1" />
  </>,
);
export const Car = svg(
  <>
    <path d="M3 15.5v-3l2.2-4.3A2 2 0 0 1 7 7h10a2 2 0 0 1 1.8 1.2L21 12.5v3a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5zM4 12.5h16" />
    <circle cx="7.5" cy="17" r="2" fill="currentColor" />
    <circle cx="16.5" cy="17" r="2" fill="currentColor" />
  </>,
);
export const Eye = svg(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const Monitor = svg(
  <>
    <rect x="2.5" y="4" width="19" height="13" rx="1.5" />
    <path d="M8 21h8M12 17v4" />
  </>,
);
export const Turn = svg(
  <>
    <path d="M7 21V10a5 5 0 0 1 10 0v4" />
    <path d="M13.5 11l3.5 3.5 3.5-3.5" />
  </>,
);
export const Rotate = svg(
  <>
    <rect x="7" y="2" width="10" height="17" rx="2" />
    <path d="M3 13.5A9 9 0 0 0 11 22M2 18.5l1-5 4.5 2" />
  </>,
);
export const Pencil = svg(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const Ruler = svg(<path d="M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2" />);
export const Roam = svg(<path d="M6.5 8.5c-3.5 0-3.5 7 0 7 3 0 4.5-3.5 5.5-3.5s2.5 3.5 5.5 3.5c3.5 0 3.5-7 0-7-3 0-4.5 3.5-5.5 3.5S9.5 8.5 6.5 8.5z" />);
export const Stopwatch = Clock;
export const Assist = svg(
  <>
    <path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </>,
);
export const Gears = svg(
  <>
    <path d="M6 4v16M12 4v16M18 4v8H6" />
    <circle cx="6" cy="4" r="1.5" fill="currentColor" />
    <circle cx="12" cy="4" r="1.5" fill="currentColor" />
    <circle cx="18" cy="4" r="1.5" fill="currentColor" />
  </>,
);
export const Tilt = svg(
  <>
    <rect x="3" y="7" width="18" height="10" rx="2" transform="rotate(-15 12 12)" />
    <path d="M2 4a12 12 0 0 1 6-2M22 20a12 12 0 0 1-6 2" />
  </>,
);
export const Slider = svg(
  <>
    <path d="M3 12h18" />
    <rect x="9" y="8" width="6" height="8" rx="1.5" fill="currentColor" />
  </>,
);
export const Expand = svg(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const Pin = svg(
  <>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>,
);
export const Lock = svg(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </>,
);

export function Bars({ level, size = "1em", className }: { level: 0 | 1 | 2 | 3 | 4; size?: number | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={3 + i * 5} y={18 - i * 4.5} width="3.4" height={4 + i * 4.5} rx="0.8" fill="currentColor" opacity={i < level ? 1 : 0.22} />
      ))}
    </svg>
  );
}

export function pingLevel(ms: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (ms == null) return 0;
  return ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1;
}

export function WeatherIcon({ weather, hour, ...p }: P & { weather: Weather; hour: number }) {
  const night = hour < 6.5 || hour > 19.5;
  if (weather === "rain") return <Rain {...p} />;
  if (weather === "fog") return <Fog {...p} />;
  if (weather === "snow") return <Snow {...p} />;
  if (weather === "overcast") return <Cloud {...p} />;
  return night ? <Moon {...p} /> : <Sun {...p} />;
}
